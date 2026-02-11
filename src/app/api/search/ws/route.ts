/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';
import { getProxyToken } from '@/lib/emby-token';
import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSearchResults,
  normalizeScriptSources,
} from '@/lib/source-script';

export const runtime = 'nodejs';

// 并发控制配置
const MAX_CONCURRENT = 3; // 最大并发搜索任务数（统一限制）
const SEARCH_TIMEOUT_MS = 8000; // 单个源搜索超时时间
const EMBY_SEARCH_TIMEOUT_MS = 5000; // Emby搜索超时时间
const MAX_RESULTS_PER_SOURCE = 20; // 每个源最大结果数
const MAX_TOTAL_TIME_MS = 25000; // 最大总执行时间25秒（Cloudflare限制是30秒）

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    return new Response(
      JSON.stringify({ error: '搜索关键词不能为空' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 创建权重映射表
  const weightMap = new Map<string, number>();
  config.SourceConfig.forEach(source => {
    weightMap.set(source.key, source.weight ?? 0);
  });

  // 按权重降序排序（不再限制数量）
  const sortedApiSites = [...apiSites]
    .sort((a, b) => {
      const weightA = weightMap.get(a.key) ?? 0;
      const weightB = weightMap.get(b.key) ?? 0;
      return weightB - weightA;
    });

  // 检查是否配置了 OpenList
  const hasOpenList = !!(
    config.OpenListConfig?.Enabled &&
    config.OpenListConfig?.URL &&
    config.OpenListConfig?.Username &&
    config.OpenListConfig?.Password
  );

  // 检查是否配置了 Emby（支持多源）
  const hasEmby = !!(
    config.EmbyConfig?.Sources &&
    config.EmbyConfig.Sources.length > 0 &&
    config.EmbyConfig.Sources.some(s => s.enabled && s.ServerURL)
  );
  const enabledScripts = await listEnabledSourceScripts();

  // 共享状态
  let streamClosed = false;
  const startTime = Date.now();
  const MAX_TOTAL_TIME_MS = 25000; // 最大总执行时间25秒（Cloudflare限制是30秒）

  // 创建可读流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 辅助函数：安全地向控制器写入数据
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (streamClosed || (!controller.desiredSize && controller.desiredSize !== 0)) {
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          console.warn('Failed to enqueue data:', error);
          streamClosed = true;
          return false;
        }
      };

      // 检查是否超时的辅助函数
      const isTimeExceeded = () => {
        return Date.now() - startTime > MAX_TOTAL_TIME_MS;
      };

      // 获取所有Emby源（不再限制数量）
      let embySourcesCount = 0;
      let embySources: Array<{ client: any; config: any }> = [];
      if (hasEmby) {
        try {
          const { embyManager } = await import('@/lib/emby-manager');
          const embySourcesMap = await embyManager.getAllClients();
          embySources = Array.from(embySourcesMap.values()); // 不再限制数量
          embySourcesCount = embySources.length;
        } catch (error) {
          console.error('[Search WS] 获取 Emby 源失败:', error);
        }
      }

      // 计算总源数
      const totalSources = sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount;

      // 发送开始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        totalSources: sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length,
        timestamp: Date.now()
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return; // 连接已关闭，提前退出
      }

      // 记录已完成的源数量
      let completedSources = 0;
      const allResults: any[] = [];

      // 创建限流器 - 限制并发数量
      async function runWithConcurrencyLimit<T>(
        tasks: (() => Promise<T>)[],
        limit: number
      ): Promise<T[]> {
        const results: T[] = [];
        const executing: Promise<void>[] = [];

        for (const task of tasks) {
          const p = Promise.resolve().then(async () => {
            if (streamClosed || isTimeExceeded()) {
              return;
            }
            try {
              await task();
            } catch (error) {
              console.warn('Task failed:', error);
            }
          });

          executing.push(p);

          if (executing.length >= limit) {
            await Promise.race(executing);
          }
        }

        await Promise.allSettled(executing);
        return results;
      }

      // 搜索 Emby（如果配置了）- 限制并发
      if (hasEmby && embySources.length > 0) {
        const embyTasks = embySources.map(({ client, config: embyConfig }) => async () => {
          try {
            const { embyManager } = await import('@/lib/emby-manager');
            const embySourcesMap = await embyManager.getAllClients();
            const embySources = Array.from(embySourcesMap.values());

            // 获取代理 token（用于图片代理）
            const proxyToken = await getProxyToken(request);

            // 为每个 Emby 源并发搜索，并单独发送结果
            const embySearchPromises = embySources.map(async ({ client, config: embyConfig }) => {
              try {
                const searchResult = await client.getItems({
                  searchTerm: query,
                  IncludeItemTypes: 'Movie,Series',
                  Recursive: true,
                  Fields: 'Overview,ProductionYear',
                  Limit: 50,
                });

                const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
                const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;

                // 添加安全检查，确保 Items 存在且是数组
                const items = Array.isArray(searchResult?.Items) ? searchResult.Items : [];
                const results = items.map((item) => ({
                  id: item.Id,
                  source: sourceValue,
                  source_name: sourceName,
                  weight: weightMap.get(sourceValue) ?? 0,
                  title: item.Name,
                  poster: client.getImageUrl(item.Id, 'Primary', undefined, client.isProxyEnabled() ? proxyToken || undefined : undefined),
                  episodes: [],
                  episodes_titles: [],
                  year: item.ProductionYear?.toString() || '',
                  desc: item.Overview || '',
                  type_name: item.Type === 'Movie' ? '电影' : '电视剧',
                  douban_id: 0,
                }));

                // 单独发送每个源的结果
                embyCompletedCount++;
                completedSources++;
                if (!streamClosed) {
                  const sourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: sourceValue,
                    sourceName: sourceName,
                    results: results,
                    timestamp: Date.now()
                  })}\n\n`;
                  if (safeEnqueue(encoder.encode(sourceEvent))) {
                    if (results.length > 0) {
                      allResults.push(...results);
                    }
                  } else {
                    streamClosed = true;
                  }
                }

                return results;
              } catch (error) {
                console.error(`[Search WS] 搜索 ${embyConfig.name} 失败:`, error);
                embyCompletedCount++;
                completedSources++;
                // 发送空结果
                if (!streamClosed) {
                  const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
                  const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;
                  const sourceEvent = `data: ${JSON.stringify({
                    type: 'source_result',
                    source: sourceValue,
                    sourceName: sourceName,
                    results: [],
                    timestamp: Date.now()
                  })}\n\n`;
                  safeEnqueue(encoder.encode(sourceEvent));
                }
                return [];
              }
            });

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Emby timeout')), EMBY_SEARCH_TIMEOUT_MS)
            );

            const searchResult = await Promise.race([searchPromise, timeoutPromise]);

            const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
            const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;

            const items = Array.isArray((searchResult as any)?.Items) ? (searchResult as any).Items : [];
            const results = items.slice(0, MAX_RESULTS_PER_SOURCE).map((item: any) => ({
              id: item.Id,
              source: sourceValue,
              source_name: sourceName,
              title: item.Name,
              poster: client.getImageUrl(item.Id, 'Primary'),
              episodes: [],
              episodes_titles: [],
              year: item.ProductionYear?.toString() || '',
              desc: item.Overview || '',
              type_name: item.Type === 'Movie' ? '电影' : '电视剧',
              douban_id: 0,
            }));

            completedSources++;
            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: sourceValue,
                sourceName: sourceName,
                results: results,
                timestamp: Date.now()
              })}\n\n`;
              if (safeEnqueue(encoder.encode(sourceEvent))) {
                if (results.length > 0) {
                  allResults.push(...results);
                }
              } else {
                streamClosed = true;
              }
            }
          } catch (error) {
            console.error(`[Search WS] 搜索 ${embyConfig.name} 失败:`, error);
            completedSources++;
            const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
            const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;
            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: sourceValue,
                sourceName: sourceName,
                results: [],
                timestamp: Date.now()
              })}\n\n`;
              safeEnqueue(encoder.encode(sourceEvent));
            }
          }
        });

        // 并发执行Emby搜索（使用统一的并发控制）
        runWithConcurrencyLimit(embyTasks, MAX_CONCURRENT);
      }

      // 搜索 OpenList（如果配置了）- 异步带超时
      if (hasOpenList) {
        (async () => {
          try {
            const { getCachedMetaInfo } = await import('@/lib/openlist-cache');
            const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
            const { db } = await import('@/lib/db');

            let metaInfo = getCachedMetaInfo();

            if (!metaInfo) {
              // 使用Promise.race添加超时
              const metaInfoPromise = (async () => {
                const metainfoJson = await db.getGlobalValue('video.metainfo');
                if (metainfoJson) {
                  return JSON.parse(metainfoJson);
                }
                return null;
              })();

              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('OpenList DB timeout')), 3000)
              );

              metaInfo = await Promise.race([metaInfoPromise, timeoutPromise]);
            }

            if (metaInfo && metaInfo.folders) {
              const queryLower = query.toLowerCase();
              const folderEntries = Object.entries(metaInfo.folders);
              
              // 限制遍历的文件夹数量
              const maxFoldersToSearch = Math.min(folderEntries.length, 500);
              const results = [];
              
              for (let i = 0; i < maxFoldersToSearch; i++) {
                if (streamClosed || isTimeExceeded()) break;
                
                const [key, info] = folderEntries[i] as [string, any];
                const matchFolder = info.folderName?.toLowerCase().includes(queryLower);
                const matchTitle = info.title?.toLowerCase().includes(queryLower);
                
                if (matchFolder || matchTitle) {
                  results.push({
                    id: key,
                    source: 'openlist',
                    source_name: '私人影库',
                    weight: weightMap.get('openlist') ?? 0,
                    title: info.title,
                    poster: getTMDBImageUrl(info.poster_path),
                    episodes: [],
                    episodes_titles: [],
                    year: info.release_date?.split('-')[0] || '',
                    desc: info.overview || '',
                    type_name: info.media_type === 'movie' ? '电影' : '电视剧',
                    douban_id: 0,
                  });
                  
                  // 限制结果数量
                  if (results.length >= MAX_RESULTS_PER_SOURCE) break;
                }
              }

              completedSources++;
              if (!streamClosed) {
                const sourceEvent = `data: ${JSON.stringify({
                  type: 'source_result',
                  source: 'openlist',
                  sourceName: '私人影库',
                  results: results,
                  timestamp: Date.now()
                })}\n\n`;
                if (safeEnqueue(encoder.encode(sourceEvent))) {
                  allResults.push(...results);
                } else {
                  streamClosed = true;
                }
              }
            } else {
              completedSources++;
            }
          } catch (error) {
            console.error('[Search WS] 搜索 OpenList 失败:', error);
            completedSources++;
            if (!streamClosed) {
              const sourceEvent = `data: ${JSON.stringify({
                type: 'source_result',
                source: 'openlist',
                sourceName: '私人影库',
                results: [],
                timestamp: Date.now()
              })}\n\n`;
              safeEnqueue(encoder.encode(sourceEvent));
            }
          }
        })();
      }

      // 为每个源创建搜索任务
      const searchTasks = sortedApiSites.map((site) => async () => {
        try {
          // 检查是否超时
          if (isTimeExceeded()) {
            throw new Error('Search timeout - overall time exceeded');
          }

          // 使用更短的超时控制
          const searchPromise = searchFromApi(site, query);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${site.name} timeout`)), SEARCH_TIMEOUT_MS)
          );

          const results = await Promise.race([searchPromise, timeoutPromise]) as any[];

          // 安全检查并限制结果数量
          const safeResults = (Array.isArray(results) ? results : []).slice(0, MAX_RESULTS_PER_SOURCE);

          // 过滤黄色内容
          let filteredResults = safeResults;
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = safeResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          filteredResults = filteredResults.map((result) => ({
            ...result,
            weight: result.weight ?? (weightMap.get(result.source) ?? 0),
          }));

          // 发送该源的搜索结果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return;
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }

        } catch (error) {
          console.warn(`搜索失败 ${site.name}:`, error);

          // 发送源错误事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: error instanceof Error ? error.message : '搜索失败',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        }

        // 检查是否所有源都已完成
        if (completedSources === sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length) {
          if (!streamClosed) {
            // 发送最终完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now()
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      const scriptPromises = enabledScripts.map(async (script) => {
        try {
          const sourcesExecution = await Promise.race([
            executeSavedSourceScript({
              key: script.key,
              hook: 'getSources',
              payload: {},
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${script.name} timeout`)), 20000)
            ),
          ]);

          const sources = normalizeScriptSources((sourcesExecution as any).result);
          const sourceResults = await Promise.all(
            sources.map(async (source) => {
              const execution = await Promise.race([
                executeSavedSourceScript({
                  key: script.key,
                  hook: 'search',
                  payload: {
                    keyword: query,
                    page: 1,
                    sourceId: source.id,
                  },
                }),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error(`${script.name}/${source.name} timeout`)), 20000)
                ),
              ]);

              return normalizeScriptSearchResults({
                scriptKey: script.key,
                scriptName: script.name,
                sourceId: source.id,
                sourceName: source.name,
                result: (execution as any).result,
              });
            })
          );

          let filteredResults = sourceResults.flat();
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = filteredResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) => typeName.includes(word));
            });
          }

          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: `script:${script.key}`,
              sourceName: script.name,
              results: filteredResults,
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return;
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }
        } catch (error) {
          console.warn(`搜索脚本失败 ${script.name}:`, error);

          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: `script:${script.key}`,
              sourceName: script.name,
              error: error instanceof Error ? error.message : '搜索失败',
              timestamp: Date.now()
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return;
            }
          }
        }

        if (completedSources === sortedApiSites.length + (hasOpenList ? 1 : 0) + embySourcesCount + enabledScripts.length) {
          if (!streamClosed) {
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now()
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              try {
                controller.close();
              } catch (error) {
                console.warn('Failed to close controller:', error);
              }
            }
          }
        }
      });

      // 等待所有搜索完成
      await Promise.allSettled([...searchPromises, ...scriptPromises]);
    },

    cancel() {
      // 客户端断开连接时，标记流已关闭
      streamClosed = true;
      console.log('Client disconnected, cancelling search stream');
    },
  });

  // 返回流式响应
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
