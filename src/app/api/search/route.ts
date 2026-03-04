/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { getProxyToken } from '@/lib/emby-token';
import {
  executeSavedSourceScript,
  listEnabledSourceScripts,
  normalizeScriptSearchResults,
  normalizeScriptSources,
} from '@/lib/source-script';
import { yellowWords } from '@/lib/yellow';
import { getProxyToken } from '@/lib/emby-token';

export const runtime = 'nodejs';

// ============ 并发控制配置 ============
const MAX_CONCURRENT = 3; // 最大并发搜索任务数（统一限制）
const SEARCH_TIMEOUT_MS = 8000; // 单个源搜索超时时间
const EMBY_SEARCH_TIMEOUT_MS = 5000; // Emby搜索超时时间
const OPENLIST_SEARCH_TIMEOUT_MS = 5000; // OpenList搜索超时时间
const MAX_RESULTS_PER_SOURCE = 30; // 每个源最大结果数

/**
 * 并发控制器 - 确保最多同时运行指定数量的任务
 * 任务一个接一个执行，完成一个启动下一个，确保所有任务最终都会被执行
 */
async function runWithConcurrencyControl<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onProgress?: (completed: number, total: number) => void
): Promise<T[]> {
  const results: T[] = [];
  const total = tasks.length;
  let running = 0;
  let completed = 0;
  let index = 0;

  const startNext = async (): Promise<void> => {
    while (running < limit && index < total) {
      const taskIndex = index++;
      const task = tasks[taskIndex];
      running++;

      try {
        const result = await task();
        results[taskIndex] = result;
      } catch (error) {
        console.warn(`Task ${taskIndex} failed:`, error);
        results[taskIndex] = undefined as unknown as T;
      } finally {
        running--;
        completed++;
        onProgress?.(completed, total);
        await startNext();
      }
    }
  };

  await startNext();

  while (completed < total) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await startNext();
  }

  return results.filter((r): r is T => r !== undefined);
}

/**
 * 带超时的搜索任务包装器
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
    ),
  ]);
}

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');

  if (!query) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(
      { results: [] },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  }

  const config = await getConfig();

  // 获取所有可用的API站点（不再限制数量）
  const allApiSites = await getAvailableApiSites(authInfo.username);

  // 创建权重映射表
  const weightMap = new Map<string, number>();
  config.SourceConfig.forEach(source => {
    weightMap.set(source.key, source.weight ?? 0);
  });

  // 检查是否配置了 OpenList
  const hasOpenList = !!(
    config.OpenListConfig?.Enabled &&
    config.OpenListConfig?.URL &&
    config.OpenListConfig?.Username &&
    config.OpenListConfig?.Password
  );

  // 获取所有启用的 Emby 源（不再限制数量）
  const { embyManager } = await import('@/lib/emby-manager');
  const embySourcesMap = await embyManager.getAllClients();
  const allEmbySources = Array.from(embySourcesMap.values());

  console.log('[Search] Total API sites:', allApiSites.length);
  console.log('[Search] Total Emby sources:', allEmbySources.length);

  // 获取代理 token（用于图片代理）
  const proxyToken = await getProxyToken(request);

  // 为每个 Emby 源创建搜索 Promise（全部并发，无限制）
  const embyPromises = embySources.map(({ client, config: embyConfig }) =>
    Promise.race([
      (async () => {
        try {
          const { getCachedMetaInfo } = await import('@/lib/openlist-cache');
          const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
          const { db } = await import('@/lib/db');

          let metaInfo = getCachedMetaInfo();
          if (!metaInfo) {
            const metainfoJson = await db.getGlobalValue('video.metainfo');
            if (metainfoJson) {
              metaInfo = JSON.parse(metainfoJson);
            }
          }

          const results: any[] = [];
          if (metaInfo?.folders) {
            const queryLower = query.toLowerCase();
            const folderEntries = Object.entries(metaInfo.folders);
            
            for (let i = 0; i < folderEntries.length; i++) {
              const [folderName, info] = folderEntries[i] as [string, any];
              const matchFolder = folderName?.toLowerCase().includes(queryLower);
              const matchTitle = info.title?.toLowerCase().includes(queryLower);
              
              if (matchFolder || matchTitle) {
                results.push({
                  id: folderName,
                  source: 'openlist',
                  source_name: '私人影库',
                  title: info.title,
                  poster: getTMDBImageUrl(info.poster_path),
                  episodes: [],
                  episodes_titles: [],
                  year: info.release_date?.split('-')[0] || '',
                  desc: info.overview || '',
                  type_name: info.media_type === 'movie' ? '电影' : '电视剧',
                  douban_id: 0,
                });
                if (results.length >= MAX_RESULTS_PER_SOURCE) break;
              }
            }
          }
          
          return { source: 'openlist', sourceName: '私人影库', results };
        } catch (error) {
          console.error('[Search] OpenList failed:', error);
          return { source: 'openlist', sourceName: '私人影库', results: [] };
        }
      });
    }

    // 2. Emby 搜索任务
    for (const { client, config: embyConfig } of allEmbySources) {
      searchTasks.push(async () => {
        try {
          const searchResult = await withTimeout(
            client.getItems({
              searchTerm: query,
              IncludeItemTypes: 'Movie,Series',
              Recursive: true,
              Fields: 'Overview,ProductionYear',
              Limit: MAX_RESULTS_PER_SOURCE,
            }),
            EMBY_SEARCH_TIMEOUT_MS,
            `${embyConfig.name} timeout`
          );

          const sourceValue = allEmbySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
          const sourceName = allEmbySources.length === 1 ? 'Emby' : embyConfig.name;

          const results = (searchResult.Items || []).map((item: any) => ({
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

          return { source: sourceValue, sourceName, results };
        } catch (error) {
          console.error(`[Search] 搜索 ${embyConfig.name} 失败:`, error);
          return [];
        }
      })(),
      new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error(`${embyConfig.name} timeout`)), EMBY_SEARCH_TIMEOUT_MS)
      ),
    ]).catch((error) => {
      console.error(`[Search] 搜索 ${embyConfig.name} 超时:`, error);
      return [];
    })
  );

  // 搜索 OpenList（如果配置了）- 异步带超时
  const openlistPromise = hasOpenList
    ? Promise.race([
        (async () => {
          try {
            const { getCachedMetaInfo, setCachedMetaInfo } = await import('@/lib/openlist-cache');
            const { getTMDBImageUrl } = await import('@/lib/tmdb.search');
            const { db } = await import('@/lib/db');

            let metaInfo = getCachedMetaInfo();

            if (!metaInfo) {
              const metainfoJson = await db.getGlobalValue('video.metainfo');
              if (metainfoJson) {
                metaInfo = JSON.parse(metainfoJson);
                if (metaInfo) {
                  setCachedMetaInfo(metaInfo);
                }
              }
            }

            if (metaInfo && metaInfo.folders) {
              return Object.entries(metaInfo.folders)
                .filter(([folderName, info]: [string, any]) => {
                  const matchFolder = folderName.toLowerCase().includes(query.toLowerCase());
                  const matchTitle = info.title.toLowerCase().includes(query.toLowerCase());
                  return matchFolder || matchTitle;
                })
                .map(([folderName, info]: [string, any]) => ({
                  id: folderName,
                  source: 'openlist',
                  source_name: '私人影库',
                  weight: weightMap.get('openlist') ?? 0,
                  title: info.title,
                  poster: getTMDBImageUrl(info.poster_path),
                  episodes: [],
                  episodes_titles: [],
                  year: info.release_date.split('-')[0] || '',
                  desc: info.overview,
                  type_name: info.media_type === 'movie' ? '电影' : '电视剧',
                  douban_id: 0,
                }));
            }
            return [];
          } catch (error) {
            console.error('[Search] 搜索 OpenList 失败:', error);
            return [];
          }
        })(),
        new Promise<any[]>((_, reject) =>
          setTimeout(() => reject(new Error('OpenList timeout')), OPENLIST_SEARCH_TIMEOUT_MS)
        ),
      ]).catch((error) => {
        console.error('[Search] 搜索 OpenList 超时:', error);
        return [];
      })
    : Promise.resolve([]);

  // 添加超时控制和错误处理，避免慢接口拖累整体响应
  const searchPromises = apiSites.map((site) =>
    Promise.race([
      searchFromApi(site, query, { timeoutMs: API_SEARCH_TIMEOUT_MS }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${site.name} timeout`)), API_SEARCH_TIMEOUT_MS)
      ),
    ]).catch((err) => {
      console.warn(`搜索失败 ${site.name}:`, err.message);
      return []; // 返回空数组而不是抛出错误
    })
  );

  const scriptSummaries = await listEnabledSourceScripts();
  const scriptPromises = scriptSummaries.map((script) =>
    Promise.race([
      (async () => {
        try {
          const sourcesExecution = await executeSavedSourceScript({
            key: script.key,
            hook: 'getSources',
            payload: {},
          });
          const sources = normalizeScriptSources(sourcesExecution.result);

          const searchResults = await Promise.all(
            sources.map(async (source) => {
              const execution = await executeSavedSourceScript({
                key: script.key,
                hook: 'search',
                payload: {
                  keyword: query,
                  page: 1,
                  sourceId: source.id,
                },
              });

              return normalizeScriptSearchResults({
                scriptKey: script.key,
                scriptName: script.name,
                sourceId: source.id,
                sourceName: source.name,
                result: execution.result,
              });
            })
          );

          return searchResults.flat();
        } catch (error) {
          console.error(`[Search] 搜索脚本 ${script.name} 失败:`, error);
          return [];
        }
      })(),
      new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error(`${script.name} timeout`)), 20000)
      ),
    ]).catch((error) => {
      console.error(`[Search] 搜索脚本 ${script.name} 超时:`, error);
      return [];
    })
  );

  try {
    // 在等待结果时定期检查总执行时间
    const allResults: any[] = [];
    
    // OpenList 结果
    const openlistResult = await Promise.race([
      openlistPromise,
      ...embyPromises,
      ...searchPromises,
      ...scriptPromises,
    ]);

    // 分离结果：第一个是 openlist，接下来是 emby 结果，最后是 api 结果
    // 添加安全检查，确保即使某个结果处理出错也不影响其他结果
    const openlistResults = Array.isArray(allResults[0]) ? allResults[0] : [];
    const embyResultsArray = allResults.slice(1, 1 + embyPromises.length);
    const apiResults = allResults.slice(1 + embyPromises.length, 1 + embyPromises.length + searchPromises.length);
    const scriptResults = allResults.slice(1 + embyPromises.length + searchPromises.length);

    // 合并所有 Emby 结果，添加安全检查
    const embyResults = embyResultsArray.filter(Array.isArray).flat();
    const apiResultsFlat = apiResults.filter(Array.isArray).flat();
    const scriptResultsFlat = scriptResults.filter(Array.isArray).flat();

    let flattenedResults = [...openlistResults, ...embyResults, ...apiResultsFlat, ...scriptResultsFlat];

    flattenedResults = flattenedResults.map((result) => ({
      ...result,
      weight: result.weight ?? (weightMap.get(result.source) ?? 0),
    }));

    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    console.log(`[Search] Starting ${searchTasks.length} tasks with concurrency=${MAX_CONCURRENT}`);

    const allSourceResults = await runWithConcurrencyControl(
      searchTasks,
      MAX_CONCURRENT,
      (completed, total) => {
        if (completed % 5 === 0 || completed === total) {
          console.log(`[Search] Progress: ${completed}/${total}`);
        }
      }
    );

    console.log(`[Search] All ${allSourceResults.length} sources completed`);

    let flattenedResults = allSourceResults.flatMap(r => r.results);

    flattenedResults.sort((a, b) => {
      const weightA = a.weight ?? 0;
      const weightB = b.weight ?? 0;
      return weightB - weightA;
    });

    const cacheTime = await getCacheTime();

    return NextResponse.json(
      { results: flattenedResults },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      }
    );
  } catch (error) {
    console.error('[Search] Overall failed:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
