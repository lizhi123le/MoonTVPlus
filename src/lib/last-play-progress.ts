/**
 * 最后播放进度本地缓存模块
 * 用于记住影片最后播放的集数和时间进度，缓存在浏览器 localStorage 中
 * 下次播放同名影片时自动恢复对应的集数和播放进度
 * 
 * 记忆规则：
 * - 基于影片名称记忆，不区分来源
 * - 同一影片只记忆一个最新的播放进度
 * - 每12秒自动保存一次
 */

import { getAuthInfoFromBrowserCookie } from './auth';

// 生成标准化的标题（与服务器端保持一致）
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[\s\-_]+/g, '')  // 移除空格、连字符，下划线
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');  // 只保留字母数字和中文
}

// 生成存储 key（只基于标题，不区分来源）
function generateStorageKey(title: string): string {
  const normalizedTitle = normalizeTitle(title);
  return `moontv_last_play_${normalizedTitle}`;
}

// 最后播放进度数据类型
export interface LastPlayProgress {
  title: string;
  episodeIndex: number; // 0-based 集数索引
  playTime: number; // 播放时间（秒）
  totalTime: number; // 总时长（秒）
  updatedAt: number; // 更新时间戳
}

/**
 * 保存最后播放进度到 localStorage
 * 只保存一条记录，基于影片名称，不区分来源
 * @param title 影片标题
 * @param episodeIndex 集数索引（0-based）
 * @param playTime 播放时间（秒）
 * @param totalTime 总时长（秒）
 */
export function saveLastPlayProgress(
  title: string,
  episodeIndex: number,
  playTime: number,
  totalTime: number = 0
): void {
  if (typeof window === 'undefined') return;

  try {
    const data: LastPlayProgress = {
      title,
      episodeIndex,
      playTime,
      totalTime,
      updatedAt: Date.now(),
    };

    // 只保存一条记录（基于标题）
    const key = generateStorageKey(title);
    localStorage.setItem(key, JSON.stringify(data));

    console.log('[LastPlayProgress] 保存成功:', { title, episodeIndex, playTime });
  } catch (error) {
    console.error('[LastPlayProgress] 保存失败:', error);
  }
}

/**
 * 获取最后播放进度
 * 基于影片名称读取，不区分来源
 * @param title 影片标题
 * @returns 返回播放进度信息，如果不存在则返回 null
 */
export function getLastPlayProgress(
  title: string
): LastPlayProgress | null {
  if (typeof window === 'undefined') return null;

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  try {
    const key = generateStorageKey(title);
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw) as LastPlayProgress;
      // 检查数据是否过期（30天）
      if (Date.now() - data.updatedAt > thirtyDays) {
        // 数据过期，删除
        localStorage.removeItem(key);
      } else {
        console.log('[LastPlayProgress] 读取成功:', { title, episodeIndex: data.episodeIndex });
        return data;
      }
    }
  } catch (error) {
    console.error('[LastPlayProgress] 读取失败:', error);
  }

  return null;
}

/**
 * 清除指定影片的播放进度
 * @param title 影片标题
 */
export function clearLastPlayProgress(title: string): void {
  if (typeof window === 'undefined') return;

  try {
    const key = generateStorageKey(title);
    localStorage.removeItem(key);

    console.log('[LastPlayProgress] 清除成功:', { title });
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
