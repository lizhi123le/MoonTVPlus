/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';

// 搜索API优化配置
const MAX_CONCURRENT_API_SITES = 5; // 最大并发API站点数
const MAX_CONCURRENT_EMBY_SOURCES = 3; // 最大并发Emby源数
const API_SEARCH_TIMEOUT_MS = 8000; // API搜索超时时间
const EMBY_SEARCH_TIMEOUT_MS = 5000; // Emby搜索超时时间
const OPENLIST_SEARCH_TIMEOUT_MS = 5000; // OpenList搜索超时时间
const MAX_RESULTS_PER_SOURCE = 30; // 每个源最大结果数
const MAX_TOTAL_TIME_MS = 25000; // 最大总执行时间25秒（Cloudflare限制是30秒）

export async function GET(request: NextRequest) {
  const startTime = Date.now(); // 记录开始时间
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
  // 限制并发API站点数量
  const apiSites = (await getAvailableApiSites(authInfo.username)).slice(0, MAX_CONCURRENT_API_SITES);

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

  // 获取所有启用的 Emby 源（限制数量）
  const { embyManager } = await import('@/lib/emby-manager');
  const embySourcesMap = await embyManager.getAllClients();
  const embySources = Array.from(embySourcesMap.values()).slice(0, MAX_CONCURRENT_EMBY_SOURCES);

  console.log('[Search] Emby sources count:', embySources.length);
  console.log('[Search] Emby sources:', embySources.map(s => ({ key: s.config.key, name: s.config.name })));

  // 为每个 Emby 源创建搜索 Promise（限制并发）
  const embyPromises = embySources.map(({ client, config: embyConfig }) =>
    Promise.race([
      (async () => {
        try {
          const searchResult = await client.getItems({
            searchTerm: query,
            IncludeItemTypes: 'Movie,Series',
            Recursive: true,
            Fields: 'Overview,ProductionYear',
            Limit: 20, // 限制结果数量
          });

          // 如果只有一个Emby源，保持旧格式（向后兼容）
          const sourceValue = embySources.length === 1 ? 'emby' : `emby_${embyConfig.key}`;
          const sourceName = embySources.length === 1 ? 'Emby' : embyConfig.name;

          // 限制结果数量
          return (searchResult.Items || []).slice(0, MAX_RESULTS_PER_SOURCE).map((item) => ({
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
              const queryLower = query.toLowerCase();
              const folderEntries = Object.entries(metaInfo.folders);
              
              // 限制遍历的文件夹数量
              const maxFoldersToSearch = Math.min(folderEntries.length, 500);
              const results = [];
              
              for (let i = 0; i < maxFoldersToSearch; i++) {
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
                  
                  // 限制结果数量
                  if (results.length >= MAX_RESULTS_PER_SOURCE) break;
                }
              }
              
              return results;
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

  // 检查是否超时的辅助函数
  const isTimeExceeded = () => {
    return Date.now() - startTime > MAX_TOTAL_TIME_MS;
  };

  try {
    // 在等待结果时定期检查总执行时间
    const allResults: any[] = [];
    
    // OpenList 结果
    const openlistResult = await Promise.race([
      openlistPromise,
      new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error('OpenList timeout')), OPENLIST_SEARCH_TIMEOUT_MS)
      ),
    ]).catch(() => []);
    
    if (!isTimeExceeded()) {
      allResults.push(openlistResult);
    }
    
    // Emby 结果（并发3个）
    if (!isTimeExceeded()) {
      const embyResults = await Promise.allSettled(embyPromises);
      embyResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          allResults.push(result.value);
        }
      });
    }
    
    // API 搜索结果（并发5个，逐步完成）
    if (!isTimeExceeded()) {
      const searchResults = await Promise.allSettled(searchPromises);
      searchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          allResults.push(result.value);
        }
      });
    }

    // 分离结果：第一个是 openlist，接下来是 emby 结果，最后是 api 结果
    // 添加安全检查，确保即使某个结果处理出错也不影响其他结果
    const openlistResults = Array.isArray(allResults[0]) ? allResults[0] : [];
    const embyResultsArray = allResults.slice(1, 1 + embyPromises.length);
    const apiResults = allResults.slice(1 + embyPromises.length);

    // 合并所有 Emby 结果，添加安全检查
    const embyResults = embyResultsArray.filter(Array.isArray).flat();
    const apiResultsFlat = apiResults.filter(Array.isArray).flat();

    // 限制总结果数量，避免返回过多数据
    let flattenedResults = [...openlistResults, ...embyResults, ...apiResultsFlat]
      .slice(0, MAX_RESULTS_PER_SOURCE * (apiSites.length + embySources.length + 1));

    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }

    // 按权重降序排序
    flattenedResults.sort((a, b) => {
      const weightA = weightMap.get(a.source) ?? 0;
      const weightB = weightMap.get(b.source) ?? 0;
      return weightB - weightA;
    });

    const cacheTime = await getCacheTime();

    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json({ results: [] }, { status: 200 });
    }

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
    console.error('[Search] 搜索结果处理失败:', error);
    return NextResponse.json({ error: '搜索失败' }, { status: 500 });
  }
}
