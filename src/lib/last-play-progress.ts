/**
 * 最后播放进度本地缓存模块
 * 用于记住影片最后播放的集数和时间进度，缓存在浏览器 localStorage 中
 * 下次播放同名影片时自动恢复对应的集数和播放进度
 * 
 * 支持跨源记忆：
 * - 同源记忆：同一来源内换集后记得上次集数
 * - 跨源记忆：换源后仍能记住上次播放的集数
 */

import { getAuthInfoFromBrowserCookie } from './auth';

// 生成标准化的标题（与服务器端保持一致）
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[\s\-_]+/g, '')  // 移除空格、连字符，下划线
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');  // 只保留字母数字和中文
}

// 生成存储 key
// isGlobal: true 时生成跨源全局 key（不含 source）
function generateStorageKey(title: string, source: string, isGlobal: boolean = false): string {
  const normalizedTitle = normalizeTitle(title);
  if (isGlobal) {
    // 全局 key：跨来源记忆
    return `moontv_last_play_${normalizedTitle}_global`;
  }
  // 特定来源 key：同源记忆
  const normalizedSource = source.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return `moontv_last_play_${normalizedTitle}_${normalizedSource}`;
}

// 最后播放进度数据类型
export interface LastPlayProgress {
  title: string;
  source: string;
  episodeIndex: number; // 0-based 集数索引
  playTime: number; // 播放时间（秒）
  totalTime: number; // 总时长（秒）
  updatedAt: number; // 更新时间戳
}

/**
 * 保存最后播放进度到 localStorage
 * 同时保存两条记录：
 * 1. 特定来源记录 - 用于同源记忆
 * 2. 全局记录 - 用于跨源记忆（换源后仍能记住集数）
 * @param title 影片标题
 * @param source 播放源名称
 * @param episodeIndex 集数索引（0-based）
 * @param playTime 播放时间（秒）
 * @param totalTime 总时长（秒）
 */
export function saveLastPlayProgress(
  title: string,
  source: string,
  episodeIndex: number,
  playTime: number,
  totalTime: number = 0
): void {
  if (typeof window === 'undefined') return;

  try {
    const data: LastPlayProgress = {
      title,
      source,
      episodeIndex,
      playTime,
      totalTime,
      updatedAt: Date.now(),
    };

    // 1. 保存特定来源记录（同源记忆）
    const sourceKey = generateStorageKey(title, source, false);
    localStorage.setItem(sourceKey, JSON.stringify(data));

    // 2. 保存全局记录（跨源记忆）
    // 读取现有全局记录，如果存在且比当前新，则不覆盖
    const globalKey = generateStorageKey(title, source, true);
    const existingGlobalRaw = localStorage.getItem(globalKey);
    if (existingGlobalRaw) {
      try {
        const existingGlobal = JSON.parse(existingGlobalRaw) as LastPlayProgress;
        // 只在以下情况更新全局记录：
        // - 全局记录已过期，或
        // - 当前播放进度比全局记录更新
        const thirtyDays = 30 * 24 * 60 * 60 * 1000;
        const isExpired = Date.now() - existingGlobal.updatedAt > thirtyDays;
        const isNewer = data.updatedAt > existingGlobal.updatedAt;
        if (!isExpired || isNewer) {
          localStorage.setItem(globalKey, JSON.stringify(data));
        }
      } catch {
        // 解析失败，直接保存
        localStorage.setItem(globalKey, JSON.stringify(data));
      }
    } else {
      localStorage.setItem(globalKey, JSON.stringify(data));
    }

    console.log('[LastPlayProgress] 保存成功:', { title, source, episodeIndex, playTime });
  } catch (error) {
    console.error('[LastPlayProgress] 保存失败:', error);
  }
}

/**
 * 获取最后播放进度
 * 优先读取特定来源记录，如果没有则读取全局记录（跨源记忆）
 * @param title 影片标题
 * @param source 播放源名称
 * @returns 返回播放进度信息，如果不存在则返回 null
 */
export function getLastPlayProgress(
  title: string,
  source: string
): LastPlayProgress | null {
  if (typeof window === 'undefined') return null;

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  // 1. 优先读取特定来源记录（同源记忆）
  try {
    const sourceKey = generateStorageKey(title, source, false);
    const raw = localStorage.getItem(sourceKey);
    if (raw) {
      const data = JSON.parse(raw) as LastPlayProgress;
      // 检查数据是否过期（30天）
      if (Date.now() - data.updatedAt > thirtyDays) {
        // 数据过期，删除
        localStorage.removeItem(sourceKey);
      } else {
        console.log('[LastPlayProgress] 读取成功（同源）:', { title, source, episodeIndex: data.episodeIndex });
        return data;
      }
    }
  } catch (error) {
    console.error('[LastPlayProgress] 读取失败（同源）:', error);
  }

  // 2. 特定来源没有记录，尝试读取全局记录（跨源记忆）
  try {
    const globalKey = generateStorageKey(title, source, true);
    const raw = localStorage.getItem(globalKey);
    if (raw) {
      const data = JSON.parse(raw) as LastPlayProgress;
      // 检查数据是否过期（30天）
      if (Date.now() - data.updatedAt > thirtyDays) {
        // 数据过期，删除
        localStorage.removeItem(globalKey);
        return null;
      }
      console.log('[LastPlayProgress] 读取成功（跨源）:', { title, source, episodeIndex: data.episodeIndex, originalSource: data.source });
      return data;
    }
  } catch (error) {
    console.error('[LastPlayProgress] 读取失败（跨源）:', error);
  }

  return null;
}

/**
 * 清除指定影片的播放进度
 * 同时清除特定来源记录和全局记录
 * @param title 影片标题
 * @param source 播放源名称
 */
export function clearLastPlayProgress(title: string, source: string): void {
  if (typeof window === 'undefined') return;

  try {
    // 清除特定来源记录
    const sourceKey = generateStorageKey(title, source, false);
    localStorage.removeItem(sourceKey);

    // 清除全局记录
    const globalKey = generateStorageKey(title, source, true);
    localStorage.removeItem(globalKey);

    console.log('[LastPlayProgress] 清除成功:', { title, source });
  } catch (error) {
    console.error('[LastPlayProgress] 清除失败:', error);
  }
}

/**
 * 获取当前用户播放进度存储前缀（基于用户名区分不同用户）
 * 注意：此模块默认不区分用户，如果需要区分用户可以使用此函数
 */
export function getUserPrefix(): string {
  if (typeof window === 'undefined') return '';
  
  const authInfo = getAuthInfoFromBrowserCookie();
  return authInfo?.username || 'anonymous';
}
