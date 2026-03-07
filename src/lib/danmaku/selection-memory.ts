/**
 * 弹幕选择记忆管理
 * 用于记住用户在多个弹幕源中的选择，避免换集时重复弹出选择对话框
 * 使用 localStorage 持久化保存，关闭浏览器后依然有效
 */

const STORAGE_KEY_PREFIX = 'danmaku_selection_';

/**
 * 带 TTL 的保存函数
 */
function saveWithTTL(key: string, value: any): void {
  if (typeof window === 'undefined') return;
  try {
    const data = {
      value,
      timestamp: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.error(`[弹幕记忆] 保存失败 (${key}):`, error);
  }
}

/**
 * 带 TTL 的读取函数
 */
function getWithTTL<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const data = JSON.parse(item);
    if (!data || typeof data.timestamp !== 'number') {
      // 老版本数据，直接返回并升级或失效
      return data as T;
    }

    // 永久缓存，不再检查时间戳，除非显式被新匹配覆盖
    return (data.value !== undefined ? data.value : data) as T;
  } catch (error) {
    console.error(`[弹幕记忆] 读取失败 (${key}):`, error);
    return null;
  }
}

/**
 * 保存自动搜索时用户选择的弹幕源下标
 * @param title 视频标题
 * @param selectedIndex 用户选择的弹幕源在搜索结果中的下标
 */
export function saveDanmakuSourceIndex(title: string, selectedIndex: number): void {
  const key = `${STORAGE_KEY_PREFIX}index_${title}`;
  saveWithTTL(key, selectedIndex);
  console.log(`[弹幕记忆] 保存弹幕源下标: ${title} -> ${selectedIndex}`);
}

/**
 * 获取自动搜索时上次选择的弹幕源下标
 * @param title 视频标题
 * @returns 上次选择的下标，如果没有记录则返回 null
 */
export function getDanmakuSourceIndex(title: string): number | null {
  const key = `${STORAGE_KEY_PREFIX}index_${title}`;
  const index = getWithTTL<number>(key);

  if (index !== null && index >= 0) {
    console.log(`[弹幕记忆] 读取弹幕源下标: ${title} -> ${index}`);
    return index;
  }

  return null;
}

/**
 * 保存用户手动选择的弹幕剧集 ID
 * @param title 视频标题
 * @param episodeIndex 视频集数下标
 * @param episodeId 弹幕剧集 ID
 */
export function saveManualDanmakuSelection(
  title: string,
  episodeIndex: number,
  episodeId: number
): void {
  const key = `${STORAGE_KEY_PREFIX}manual_${title}_${episodeIndex}`;
  saveWithTTL(key, episodeId);
  console.log(`[弹幕记忆] 保存手动选择: ${title} 第${episodeIndex}集 -> ${episodeId}`);
}

/**
 * 获取用户手动选择的弹幕剧集 ID
 * @param title 视频标题
 * @param episodeIndex 视频集数下标
 * @returns 弹幕剧集 ID，如果没有记录则返回 null
 */
export function getManualDanmakuSelection(
  title: string,
  episodeIndex: number
): number | null {
  const key = `${STORAGE_KEY_PREFIX}manual_${title}_${episodeIndex}`;
  const episodeId = getWithTTL<number>(key);

  if (episodeId !== null) {
    console.log(`[弹幕记忆] 读取手动选择: ${title} 第${episodeIndex}集 -> ${episodeId}`);
    return episodeId;
  }

  return null;
}

/**
 * 清除指定视频的所有弹幕选择记忆
 * @param title 视频标题
 */
export function clearDanmakuSelectionMemory(title: string): void {
  if (typeof window === 'undefined') return;

  try {
    // 清除弹幕源下标记忆
    const indexKey = `${STORAGE_KEY_PREFIX}index_${title}`;
    localStorage.removeItem(indexKey);

    // 清除所有手动选择记忆（遍历所有 localStorage 键）
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${STORAGE_KEY_PREFIX}manual_${title}_`)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));

    console.log(`[弹幕记忆] 清除记忆: ${title}`);
  } catch (error) {
    console.error('[弹幕记忆] 清除记忆失败:', error);
  }
}

/**
 * 清除所有弹幕选择记忆
 */
export function clearAllDanmakuSelectionMemory(): void {
  if (typeof window === 'undefined') return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));

    console.log('[弹幕记忆] 清除所有记忆');
  } catch (error) {
    console.error('[弹幕记忆] 清除所有记忆失败:', error);
  }
}

/**
 * 保存用户搜索的弹幕关键词
 * @param title 视频标题
 * @param keyword 搜索关键词
 */
export function saveDanmakuSearchKeyword(title: string, keyword: string): void {
  const key = `${STORAGE_KEY_PREFIX}keyword_${title}`;
  saveWithTTL(key, keyword);
  console.log(`[弹幕记忆] 保存搜索关键词: ${title} -> ${keyword}`);
}

/**
 * 获取用户搜索的弹幕关键词
 * @param title 视频标题
 * @returns 搜索关键词，如果没有记录则返回 null
 */
export function getDanmakuSearchKeyword(title: string): string | null {
  const key = `${STORAGE_KEY_PREFIX}keyword_${title}`;
  const keyword = getWithTTL<string>(key);

  if (keyword) {
    console.log(`[弹幕记忆] 读取搜索关键词: ${title} -> ${keyword}`);
    return keyword;
  }

  return null;
}

/**
 * 保存用户手动选择的弹幕动漫ID（用于换集时自动匹配）
 * @param title 视频标题
 * @param animeId 弹幕动漫ID
 */
export function saveDanmakuAnimeId(title: string, animeId: number): void {
  const key = `${STORAGE_KEY_PREFIX}anime_${title}`;
  saveWithTTL(key, animeId);
  console.log(`[弹幕记忆] 保存动漫ID: ${title} -> ${animeId}`);
}

/**
 * 获取用户手动选择的弹幕动漫ID
 * @param title 视频标题
 * @returns 弹幕动漫ID，如果没有记录则返回 null
 */
export function getDanmakuAnimeId(title: string): number | null {
  const key = `${STORAGE_KEY_PREFIX}anime_${title}`;
  const animeId = getWithTTL<number>(key);

  if (animeId !== null) {
    console.log(`[弹幕记忆] 读取动漫ID: ${title} -> ${animeId}`);
    return animeId;
  }

  return null;
}

/**
 * 保存多个弹幕源候选（用于匹配失败时自动尝试下一个）
 * @param title 视频标题
 * @param animeIds 弹幕动漫ID列表
 */
export function saveDanmakuAnimeCandidates(title: string, animeIds: number[]): void {
  const key = `${STORAGE_KEY_PREFIX}candidates_${title}`;
  saveWithTTL(key, animeIds);
  console.log(`[弹幕记忆] 保存弹幕源候选: ${title} -> ${animeIds.join(', ')}`);
}

/**
 * 获取多个弹幕源候选
 * @param title 视频标题
 * @returns 弹幕动漫ID列表，如果没有记录则返回空数组
 */
export function getDanmakuAnimeCandidates(title: string): number[] {
  const key = `${STORAGE_KEY_PREFIX}candidates_${title}`;
  const candidates = getWithTTL<number[]>(key);

  if (Array.isArray(candidates)) {
    console.log(`[弹幕记忆] 读取弹幕源候选: ${title} -> ${candidates.join(', ')}`);
    return candidates;
  }

  return [];
}
