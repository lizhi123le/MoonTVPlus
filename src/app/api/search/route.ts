/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

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

  try {
    const searchTasks: (() => Promise<{ source: string; sourceName: string; results: any[] }>)[] = [];

    // 1. OpenList 搜索任务
    if (hasOpenList) {
      searchTasks.push(async () => {
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
            title: item.Name,
            poster: client.getImageUrl(item.Id, 'Primary'),
            episodes: [],
            episodes_titles: [],
            year: item.ProductionYear?.toString() || '',
            desc: item.Overview || '',
            type_name: item.Type === 'Movie' ? '电影' : '电视剧',
            douban_id: 0,
          }));

          return { source: sourceValue, sourceName, results };
        } catch (error) {
          console.error(`[Search] Emby ${embyConfig.name} failed:`, error);
          return { source: 'emby', sourceName: embyConfig.name, results: [] };
        }
      });
    }

    // 3. API 搜索任务
    for (const site of allApiSites) {
      searchTasks.push(async () => {
        try {
          const results = await withTimeout(
            searchFromApi(site, query),
            SEARCH_TIMEOUT_MS,
            `${site.name} timeout`
          ) as any[];
          
          const filteredResults = config.SiteConfig.DisableYellowFilter
            ? results
            : results.filter((r: any) => {
                const typeName = r.type_name || '';
                return !yellowWords.some((word: string) => typeName.includes(word));
              });

          return { source: site.key, sourceName: site.name, results: filteredResults };
        } catch (error) {
          console.warn(`[Search] API ${site.name} failed:`, error);
          return { source: site.key, sourceName: site.name, results: [] };
        }
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
      const weightA = weightMap.get(a.source) ?? 0;
      const weightB = weightMap.get(b.source) ?? 0;
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
