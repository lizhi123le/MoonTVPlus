// 弹幕源排序 + 集数匹配的纯函数工具。
// 网页播放页与 TV 播放页共用，避免两处各写一套导致修复不同步。
import type { DanmakuAnime } from './types';

export interface DanmakuEpisodeLike {
  episodeId: number;
  episodeTitle: string;
}

/**
 * 从分集标题里解析集号：优先 Emby 的 S01E01，其次纯数字 / "第X集/话"。
 */
export function extractDanmakuEpisodeNumber(title: string): number | null {
  if (!title) return null;

  // 优先匹配 Emby 格式：S01E01, S02E09 等
  const embyMatch = title.match(/[Ss]\d+[Ee](\d+)/);
  if (embyMatch) {
    return parseInt(embyMatch[1], 10);
  }

  // 降级到原本的策略：纯数字或"第X集/话"格式
  const match = title.match(/^(\d+)$|第?\s*(\d+)\s*[集话話]?/);
  return match ? parseInt(match[1] || match[2], 10) : null;
}

/**
 * 生成该弹幕源下当前视频集对应的**候选集列表**（按可信度从高到低，已去重）。
 *
 * 旧实现只会返回单个集：标题集号对不上时退化到 `Math.min(index, len-1)`。
 * 一旦分集列表带总集篇/OVA/预告导致下标整体偏移，就会稳定命中一个**没有弹幕的集**，
 * 级联随即判定"所有源都没弹幕"。
 *
 * 现在改成返回一个候选窗口（标题集号命中 → 索引 → 索引±1..±window），
 * 由调用方逐个尝试，直到某个集真的能取到弹幕为止。
 *
 * @param options.strict 只返回"集号严格命中"的候选，用于判断该源是否真的有这一集
 * @param options.window 索引兜底时向两侧扩展的集数，默认 2（3~5 个候选，兼顾命中率与请求量）
 */
export function buildDanmakuEpisodeCandidates(
  currentEpisodeIndex: number,
  danmakuEpisodes: DanmakuEpisodeLike[],
  videoEpisodeTitle?: string,
  options?: { strict?: boolean; window?: number }
): DanmakuEpisodeLike[] {
  if (!danmakuEpisodes.length) return [];

  const result: DanmakuEpisodeLike[] = [];
  const seen = new Set<number>();
  const add = (ep?: DanmakuEpisodeLike) => {
    if (!ep || seen.has(ep.episodeId)) return;
    seen.add(ep.episodeId);
    result.push(ep);
  };

  // 1. 集号严格命中（最高可信度）
  if (videoEpisodeTitle) {
    const episodeNum = extractDanmakuEpisodeNumber(videoEpisodeTitle);
    if (episodeNum !== null) {
      const titleMatches = danmakuEpisodes.filter(
        (ep) => extractDanmakuEpisodeNumber(ep.episodeTitle) === episodeNum
      );
      titleMatches.forEach(add);
      if (titleMatches.length > 0) {
        console.log(
          `[弹幕匹配] 根据集数标题匹配: ${videoEpisodeTitle} -> ${titleMatches
            .map((ep) => ep.episodeTitle)
            .join(' / ')}`
        );
      }
    }
  }

  // 严格模式：只认集号命中，命中不到就交给调用方换源
  if (options?.strict) {
    if (result.length === 0) {
      console.log('[弹幕匹配] 严格模式下未找到对应集数');
    }
    return result;
  }

  // 2. 索引兜底：先把目标索引放进队列，再向两侧扩展窗口
  const baseIndex = Math.min(
    Math.max(currentEpisodeIndex, 0),
    danmakuEpisodes.length - 1
  );
  const before = result.length;
  add(danmakuEpisodes[baseIndex]);

  const windowSize = options?.window ?? 2;
  for (let offset = 1; offset <= windowSize; offset++) {
    if (baseIndex - offset >= 0) add(danmakuEpisodes[baseIndex - offset]);
    if (baseIndex + offset < danmakuEpisodes.length) {
      add(danmakuEpisodes[baseIndex + offset]);
    }
  }

  if (result.length > before) {
    console.log(
      `[弹幕匹配] 降级到索引兜底: 索引 ${currentEpisodeIndex}，候选 ${result
        .map((ep) => ep.episodeTitle)
        .join(' / ')}`
    );
  }

  return result;
}

/**
 * 匹配弹幕集数：优先根据集数标题中的数字匹配，降级到索引兜底。
 *
 * @param options.strict = true 时不做索引兜底，用于判断"该源是否真的有这一集"
 * @returns 最可信的一个候选集，找不到返回 null
 */
export function matchDanmakuEpisode(
  currentEpisodeIndex: number,
  danmakuEpisodes: DanmakuEpisodeLike[],
  videoEpisodeTitle?: string,
  options?: { strict?: boolean }
): DanmakuEpisodeLike | null {
  const candidates = buildDanmakuEpisodeCandidates(
    currentEpisodeIndex,
    danmakuEpisodes,
    videoEpisodeTitle,
    { strict: options?.strict }
  );
  return candidates[0] ?? null;
}

/**
 * 给弹幕源按「匹配可信度」排序（**只重排，绝不丢弃**）。
 *
 * 旧实现会在"年份+标题"、"纯标题"都不命中时退回"只按年份"，并直接返回那批源，
 * 把正确的源整个排除在自动级联之外——这是"自动匹配不到、手动搜索却有"的主因之一。
 * 现在无论命中与否都返回全部源，只是把更可信的排在前面，由级联逻辑逐个尝试。
 *
 * @param animes 所有搜索到的弹幕源
 * @param videoTitle 视频标题
 * @param videoYear 视频年份（如 "2024"）
 * @returns 重排后的完整弹幕源列表（长度与入参一致）
 */
export function filterDanmakuSources(
  animes: DanmakuAnime[],
  videoTitle: string,
  videoYear?: string
): DanmakuAnime[] {
  if (animes.length <= 1) return animes;

  // 标准化标题：移除空格、全角转半角
  const normalizeTitle = (title: string): string => {
    return title
      .replace(/\s+/g, '')
      .replace(/[\uff01-\uff5e]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
      )
      .toLowerCase();
  };

  // 从日期字符串中提取年份（如 "2024-01" -> "2024"）
  const extractYear = (dateStr?: string): string | null => {
    if (!dateStr) return null;
    const match = dateStr.match(/^(\d{4})/);
    return match ? match[1] : null;
  };

  const normalizedVideoTitle = normalizeTitle(videoTitle);

  // 打分：年份+标题 > 纯标题 > 纯年份 > 其它。分数只决定顺序，不决定去留。
  const scoreSource = (anime: DanmakuAnime): number => {
    const animeYear = extractYear(anime.startDate);
    const titleMatched = normalizeTitle(anime.animeTitle) === normalizedVideoTitle;
    const yearMatched = !!videoYear && animeYear === videoYear;
    if (titleMatched && yearMatched) return 3;
    if (titleMatched) return 2;
    if (yearMatched) return 1;
    return 0;
  };

  const ranked = animes
    .map((anime, index) => ({ anime, index, score: scoreSource(anime) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.anime);

  const exactCount = ranked.filter((anime) => scoreSource(anime) === 3).length;
  const titleCount = ranked.filter((anime) => scoreSource(anime) === 2).length;
  console.log(
    `[弹幕匹配] 弹幕源排序完成：年份+标题精确 ${exactCount} 个、标题精确 ${titleCount} 个，共 ${ranked.length} 个源（全部保留）`
  );

  return ranked;
}
