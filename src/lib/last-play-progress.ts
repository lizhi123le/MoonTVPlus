/**
 * 最后播放进度本地缓存模块
 * 用于记住影片最后播放的集数和时间进度，缓存在浏览器 localStorage 中
 * 下次播放同名影片时自动恢复对应的集数和播放进度
 */

import { getAuthInfoFromBrowserCookie } from './auth';

// 生成标准化的标题（与服务器端保持一致）
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[\s\-_]+/g, '')  // 移除空格、连字符、下划线
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');  // 只保留字母数字和中文
}

// 生成存储 key
function generateStorageKey(title: string, source: string): string {
  const normalizedTitle = normalizeTitle(title);
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
    const key = generateStorageKey(title, source);
    const data: LastPlayProgress = {
      title,
      source,
      episodeIndex,
      playTime,
      totalTime,
      updatedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
    console.log('[LastPlayProgress] 保存成功:', { title, source, episodeIndex, playTime });
  } catch (error) {
    console.error('[LastPlayProgress] 保存失败:', error);
  }
}

/**
 * 获取最后播放进度
 * @param title 影片标题
 * @param source 播放源名称
 * @returns 返回播放进度信息，如果不存在则返回 null
 */
export function getLastPlayProgress(
  title: string,
  source: string
): LastPlayProgress | null {
  if (typeof window === 'undefined') return null;

  try {
    const key = generateStorageKey(title, source);
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const data = JSON.parse(raw) as LastPlayProgress;
    
    // 检查数据是否过期（30天）
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - data.updatedAt > thirtyDays) {
      // 数据过期，删除
      localStorage.removeItem(key);
      return null;
    }

    return data;
  } catch (error) {
    console.error('[LastPlayProgress] 读取失败:', error);
    return null;
  }
}

/**
 * 清除指定影片的播放进度
 * @param title 影片标题
 * @param source 播放源名称
 */
export function clearLastPlayProgress(title: string, source: string): void {
  if (typeof window === 'undefined') return;

  try {
    const key = generateStorageKey(title, source);
    localStorage.removeItem(key);
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
