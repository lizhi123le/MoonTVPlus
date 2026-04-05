// 弹幕 API 服务封装（通过本地代理转发）
import {
  clearAllDanmakuCache,
  clearDanmakuCache,
  clearDanmakuCacheByTitle,
  clearExpiredDanmakuCache,
  generateCacheKey,
  getDanmakuCacheStats,
  getDanmakuFromCache,
  saveDanmakuToCache,
} from './cache';
import type {
  DanmakuComment,
  DanmakuCommentsResponse,
  DanmakuEpisodesResponse,
  DanmakuMatchRequest,
  DanmakuMatchResponse,
  DanmakuSearchResponse,
  DanmakuSettings,
} from './types';

// 初始化弹幕模块（清理过期缓存）
let _cacheCleanupInitialized = false;

export function initDanmakuModule(): void {
  if (typeof window === 'undefined') return;
  if (_cacheCleanupInitialized) return;

  _cacheCleanupInitialized = true;

  // 启动时清理一次过期缓存
  clearExpiredDanmakuCache()
    .then((count) => {
      if (count > 0) {
        console.log(`[弹幕缓存] 启动清理: 已删除 ${count} 个过期缓存`);
      }
    })
    .catch((error) => {
      console.error('[弹幕缓存] 清理失败:', error);
    });
}

// 导出缓存管理函数
export {
  clearAllDanmakuCache,
  clearDanmakuCache,
  clearDanmakuCacheByTitle,
  clearExpiredDanmakuCache,
  generateCacheKey,
  getDanmakuCacheStats,
  getDanmakuFromCache,
};

// 搜索动漫
export async function searchAnime(
  keyword: string
): Promise<DanmakuSearchResponse> {
  try {
    const url = `/api/danmaku/search?keyword=${encodeURIComponent(keyword)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('弹幕服务器连接异常，请检查你的设置');
    }

    const data = (await response.json()) as DanmakuSearchResponse;
    return data;
  } catch (error) {
    console.error('搜索动漫失败:', error);
    return {
      errorCode: -1,
      success: false,
      errorMessage: error instanceof Error ? error.message : '搜索失败',
      animes: [],
    };
  }
}

// 自动匹配（根据文件名）
export async function matchAnime(
  fileName: string
): Promise<DanmakuMatchResponse> {
  try {
    const url = '/api/danmaku/match';
    const requestBody: DanmakuMatchRequest = { fileName };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error('弹幕服务器连接异常，请检查你的设置');
    }

    const data = (await response.json()) as DanmakuMatchResponse;
    return data;
  } catch (error) {
    console.error('自动匹配失败:', error);
    return {
      errorCode: -1,
      success: false,
      errorMessage: error instanceof Error ? error.message : '匹配失败',
      isMatched: false,
      matches: [],
    };
  }
}

// 获取剧集列表
export async function getEpisodes(
  animeId: number
): Promise<DanmakuEpisodesResponse> {
  try {
    const url = `/api/danmaku/episodes?animeId=${animeId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('弹幕服务器连接异常，请检查你的设置');
    }

    const data = (await response.json()) as DanmakuEpisodesResponse;
    return data;
  } catch (error) {
    console.error('获取剧集列表失败:', error);
    return {
      errorCode: -1,
      success: false,
      errorMessage: error instanceof Error ? error.message : '获取失败',
      bangumi: {
        bangumiId: '',
        animeTitle: '',
        episodes: [],
      },
    };
  }
}

// 通过剧集 ID 获取弹幕（优先从缓存读取）
export async function getDanmakuById(
  episodeId: number,
  title?: string,
  episodeIndex?: number,
  options?: {
    bypassCache?: boolean;
  },
  metadata?: {
    animeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
    searchKeyword?: string;
    danmakuCount?: number;
  }
): Promise<DanmakuComment[]> {
  try {
    // 1. 如果提供了 title 和 episodeIndex，先尝试从缓存读取
    if (title && episodeIndex !== undefined && !options?.bypassCache) {
      const cachedData = await getDanmakuFromCache(title, episodeIndex);
      if (cachedData) {
        console.log(`[弹幕缓存] 使用缓存: title=${title}, episodeIndex=${episodeIndex}, 数量=${cachedData.comments.length}`);
        return cachedData.comments;
      }
      console.log(`[弹幕缓存] 缓存未命中，从 API 获取: title=${title}, episodeIndex=${episodeIndex}`);
    } else if (title && episodeIndex !== undefined && options?.bypassCache) {
      console.log(`[弹幕缓存] 手动选择，跳过缓存读取: title=${title}, episodeIndex=${episodeIndex}, episodeId=${episodeId}`);
    } else {
      console.log(`[弹幕缓存] 未提供 title/episodeIndex，跳过缓存: episodeId=${episodeId}`);
    }

    // 2. 缓存未命中，从 API 获取
    const url = `/api/danmaku/comment?episodeId=${episodeId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('弹幕服务器连接异常，请检查你的设置');
    }

    const data = (await response.json()) as DanmakuCommentsResponse;
    const comments = data.comments || [];

    // 3. 如果提供了 title 和 episodeIndex，保存到缓存
    if (comments.length > 0 && title && title.trim() !== '' && episodeIndex !== undefined && episodeIndex >= 0) {
      try {
        console.log(`[弹幕缓存] 尝试保存缓存: title="${title}", episodeIndex=${episodeIndex}, 数量=${comments.length}`);
        await saveDanmakuToCache(title, episodeIndex, comments, {
          animeId: metadata?.animeId,
          episodeId: episodeId,
          animeTitle: metadata?.animeTitle,
          episodeTitle: metadata?.episodeTitle,
          searchKeyword: metadata?.searchKeyword,
          danmakuCount: metadata?.danmakuCount ?? comments.length,
        });
        console.log(`[弹幕缓存] 已缓存: title=${title}, episodeIndex=${episodeIndex}, 数量=${comments.length}`);
      } catch (cacheError) {
        console.error('[弹幕缓存] 保存缓存失败:', cacheError);
        // 缓存失败不影响返回结果
      }
    } else {
      console.log(`[弹幕缓存] 不满足缓存条件: title="${title}", episodeIndex=${episodeIndex}, comments.length=${comments.length}`);
    }

    return comments;
  } catch (error) {
    console.error('获取弹幕失败:', error);
    return [];
  }
}

// 通过视频 URL 获取弹幕
export async function getDanmakuByUrl(url: string): Promise<DanmakuComment[]> {
  try {
    const apiUrl = `/api/danmaku/comment?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error('弹幕服务器连接异常，请检查你的设置');
    }

    const data = (await response.json()) as DanmakuCommentsResponse;
    return data.comments || [];
  } catch (error) {
    console.error('获取弹幕失败:', error);
    return [];
  }
}

// 将 danmu_api 的弹幕格式转换为 artplayer-plugin-danmuku 格式
export function convertDanmakuFormat(
  comments: DanmakuComment[]
): Array<{
  text: string;
  time: number;
  color: string;
  border: boolean;
  mode: number;
}> {
  return comments.map((comment) => {
    // 解析弹幕属性: "时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID"
    const parts = comment.p.split(',');
    const time = parseFloat(parts[0]) || 0;
    const type = parseInt(parts[1]) || 1; // 1=滚动, 4=底部, 5=顶部
    const colorValue = parseInt(parts[3]) || 16777215; // 默认白色

    // 将十进制颜色值转换为十六进制
    const color = `#${colorValue.toString(16).padStart(6, '0')}`;

    // 转换弹幕类型: 1=滚动(0), 4=底部(1), 5=顶部(2)
    let mode = 0; // 默认滚动
    if (type === 5) mode = 1; // 顶部
    else if (type === 4) mode = 2; // 底部

    return {
      text: comment.m,
      time,
      color,
      border: false,
      mode,
    };
  });
}

// 默认弹幕设置
export const DEFAULT_DANMAKU_SETTINGS: DanmakuSettings = {
  enabled: true,
  opacity: 1,
  fontSize: 25,
  speed: 5,
  marginTop: 10,
  marginBottom: '50%',
  maxlength: 100,
  filterRules: [],
  unlimited: false,
  synchronousPlayback: false,
};

// 从 localStorage 读取弹幕设置
export function loadDanmakuSettings(): DanmakuSettings {
  if (typeof window === 'undefined') return DEFAULT_DANMAKU_SETTINGS;

  try {
    const saved = localStorage.getItem('danmaku_settings');
    let settings = DEFAULT_DANMAKU_SETTINGS;

    if (saved) {
      settings = { ...DEFAULT_DANMAKU_SETTINGS, ...JSON.parse(saved) };
    }

    return settings;
  } catch (error) {
    console.error('读取弹幕设置失败:', error);
  }
  return DEFAULT_DANMAKU_SETTINGS;
}

// 保存弹幕设置到 localStorage
export function saveDanmakuSettings(settings: DanmakuSettings): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem('danmaku_settings', JSON.stringify(settings));
  } catch (error) {
    console.error('保存弹幕设置失败:', error);
  }
}

// 保存弹幕显示状态到 localStorage（独立的 key）
export function saveDanmakuDisplayState(enabled: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem('danmaku_display_enabled', String(enabled));
  } catch (error) {
    console.error('保存弹幕显示状态失败:', error);
  }
}

// 读取弹幕显示状态
export function loadDanmakuDisplayState(): boolean | null {
  if (typeof window === 'undefined') return null;

  try {
    const saved = localStorage.getItem('danmaku_display_enabled');
    if (saved === null) return null;
    return saved === 'true';
  } catch (error) {
    console.error('读取弹幕显示状态失败:', error);
    return null;
  }
}

// 记忆上次选择的弹幕
export interface DanmakuMemory {
  videoTitle: string;
  animeId: number;
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  timestamp: number;
  searchKeyword?: string; // 用户手动搜索时使用的关键词
}

// 保存弹幕选择记忆
export function saveDanmakuMemory(
  videoTitle: string,
  animeId: number,
  episodeId: number,
  animeTitle: string,
  episodeTitle: string,
  searchKeyword?: string // 可选的搜索关键词
): void {
  if (typeof window === 'undefined') return;

  try {
    const memory: DanmakuMemory = {
      videoTitle,
      animeId,
      episodeId,
      animeTitle,
      episodeTitle,
      timestamp: Date.now(),
      searchKeyword, // 保存搜索关键词
    };

    // 获取现有的记忆
    const memoriesJson = localStorage.getItem('danmaku_memories');
    const memories: Record<string, DanmakuMemory> = memoriesJson
      ? JSON.parse(memoriesJson)
      : {};

    // 保存新记忆
    memories[videoTitle] = memory;

    // 只保留最近 100 条记忆
    const entries = Object.entries(memories);
    if (entries.length > 100) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const top100 = entries.slice(0, 100);
      const newMemories = Object.fromEntries(top100);
      localStorage.setItem('danmaku_memories', JSON.stringify(newMemories));
    } else {
      localStorage.setItem('danmaku_memories', JSON.stringify(memories));
    }
  } catch (error) {
    console.error('保存弹幕记忆失败:', error);
  }
}

// 读取弹幕选择记忆
export function loadDanmakuMemory(
  videoTitle: string
): DanmakuMemory | null {
  if (typeof window === 'undefined') return null;

  try {
    const memoriesJson = localStorage.getItem('danmaku_memories');
    if (!memoriesJson) return null;

    const memories: Record<string, DanmakuMemory> = JSON.parse(memoriesJson);
    return memories[videoTitle] || null;
  } catch (error) {
    console.error('读取弹幕记忆失败:', error);
    return null;
  }
}

// ---------------- 播放器设置服务端存储 ----------------

// 播放器设置接口
export interface playerSettings {
  volume: number;           // 音量 (0-1)
  playbackRate: number;     // 播放速率
  autoPlay: boolean;        // 自动播放
  danmakuEnabled: boolean;   // 弹幕开关
  theaterMode: boolean;     // 影院模式
  anime4kEnabled: boolean;    // Anime4K超分开关
  anime4kMode: string;       // Anime4K超分模式
  anime4kScale: number;       // Anime4K超分倍数
}

// 默认播放器设置
const defaultPlayerSettings: playerSettings = {
  volume: 0.7,
  playbackRate: 1.0,
  autoPlay: false,
  danmakuEnabled: true,
  theaterMode: false,
  anime4kEnabled: false,
  anime4kMode: 'ModeA',
  anime4kScale: 2.0,
};

// 从 cookie 中获取有效用户 ID（登录用户用 username，匿名用户用 'anonymous'）
function getEffectiveUserId(): string {
  if (typeof document === 'undefined') return 'anonymous';
  const match = document.cookie.match(/(?:^|;\s*)username=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : 'anonymous';
}

// 通过 API 保存播放器设置
export async function savePlayerSettings(settings: Partial<playerSettings>): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const userId = getEffectiveUserId();
    // 读取现有设置
    const currentSettings = await loadPlayerSettings();
    // 合并新设置
    const mergedSettings = { ...currentSettings, ...settings };
    // POST 到服务端
    await fetch('/api/player-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, settings: mergedSettings }),
    });
  } catch (error) {
    console.error('保存播放器设置失败:', error);
  }
}

// 通过 API 读取播放器设置
export async function loadPlayerSettings(): Promise<playerSettings> {
  if (typeof window === 'undefined') return { ...defaultPlayerSettings };

  try {
    const userId = getEffectiveUserId();
    const res = await fetch(`/api/player-settings?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.settings) {
        return { ...defaultPlayerSettings, ...JSON.parse(data.settings) };
      }
    }
  } catch (error) {
    console.error('读取播放器设置失败:', error);
  }

  return { ...defaultPlayerSettings };
}

// 保存音量
export async function savePlayerVolume(volume: number): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ volume: Math.max(0, Math.min(1, volume)) });
}

// 读取音量
export async function loadPlayerVolume(): Promise<number> {
  if (typeof window === 'undefined') return 0.7;
  return (await loadPlayerSettings()).volume;
}

// 保存播放速率
export async function savePlayerPlaybackRate(rate: number): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ playbackRate: rate });
}

// 读取播放速率
export async function loadPlayerPlaybackRate(): Promise<number> {
  if (typeof window === 'undefined') return 1.0;
  return (await loadPlayerSettings()).playbackRate;
}

// 保存自动播放设置
export async function savePlayerAutoPlay(autoPlay: boolean): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ autoPlay });
}

// 读取自动播放设置
export async function loadPlayerAutoPlay(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return (await loadPlayerSettings()).autoPlay;
}

// 保存弹幕开关状态
export async function savePlayerDanmakuEnabled(enabled: boolean): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ danmakuEnabled: enabled });
}

// 读取弹幕开关状态
export async function loadPlayerDanmakuEnabled(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  return (await loadPlayerSettings()).danmakuEnabled;
}

// 保存影院模式状态
export async function savePlayerTheaterMode(enabled: boolean): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ theaterMode: enabled });
}

// 读取影院模式状态
export async function loadPlayerTheaterMode(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return (await loadPlayerSettings()).theaterMode;
}

// 保存 Anime4K 超分开关状态
export async function savePlayerAnime4kEnabled(enabled: boolean): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ anime4kEnabled: enabled });
}

// 读取 Anime4K 超分开关状态
export async function loadPlayerAnime4kEnabled(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return (await loadPlayerSettings()).anime4kEnabled;
}

// 保存 Anime4K 超分模式
export async function savePlayerAnime4kMode(mode: string): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ anime4kMode: mode });
}

// 读取 Anime4K 超分模式
export async function loadPlayerAnime4kMode(): Promise<string> {
  if (typeof window === 'undefined') return 'ModeA';
  return (await loadPlayerSettings()).anime4kMode || 'ModeA';
}

// 保存 Anime4K 超分倍数
export async function savePlayerAnime4kScale(scale: number): Promise<void> {
  if (typeof window === 'undefined') return;
  await savePlayerSettings({ anime4kScale: scale });
}

// 读取 Anime4K 超分倍数
export async function loadPlayerAnime4kScale(): Promise<number> {
  if (typeof window === 'undefined') return 2.0;
  return (await loadPlayerSettings()).anime4kScale || 2.0;
}

// ---------------- 跳过片头片尾时间跨来源共享 ----------------

// 跳过片头片尾时间接口
export interface SkipTimeSettings {
  intro_time: number;  // 片头跳过时间（秒）
  outro_time: number;  // 片尾跳过时间（秒，为负数表示从结尾向前计算）
  updated_at: number;   // 更新时间戳
}

// 生成跨来源共享的跳过配置 key（使用视频标题）
function getSkipTimeKey(title: string): string {
  // 清理标题，移除特殊字符，统一格式
  const normalizedTitle = title.trim().toLowerCase()
    .replace(/[\s\-_]+/g, '')  // 移除空格、连字符、下划线
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');  // 只保留字母数字和中文
  return `skip_time:${normalizedTitle}`;
}

// 保存跳过片头片尾时间（跨来源共享）
export function saveSkipTime(title: string, intro_time: number, outro_time: number): void {
  if (typeof window === 'undefined') return;
  if (!title.trim()) return;

  try {
    const key = getSkipTimeKey(title);
    const skipData: SkipTimeSettings = {
      intro_time,
      outro_time,
      updated_at: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(skipData));
    console.log(`[跳过配置] 已保存跨来源跳过配置: ${title}`, skipData);
  } catch (error) {
    console.error('保存跳过配置失败:', error);
  }
}

// 读取跳过片头片尾时间（跨来源共享）
export function loadSkipTime(title: string): SkipTimeSettings | null {
  if (typeof window === 'undefined') return null;
  if (!title.trim()) return null;

  try {
    const key = getSkipTimeKey(title);
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved) as SkipTimeSettings;
      // 检查配置是否过期（30天）
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - parsed.updated_at > thirtyDays) {
        localStorage.removeItem(key);
        return null;
      }
      console.log(`[跳过配置] 已加载跨来源跳过配置: ${title}`, parsed);
      return parsed;
    }
  } catch (error) {
    console.error('读取跳过配置失败:', error);
  }

  return null;
}

// 从视频标题获取跨来源跳过配置（用于同名视频不同来源）
export function getCrossSourceSkipConfig(title: string): { intro_time: number; outro_time: number } | null {
  const skipData = loadSkipTime(title);
  if (skipData) {
    return {
      intro_time: skipData.intro_time,
      outro_time: skipData.outro_time,
    };
  }
  return null;
}

// 删除跳过片头片尾时间（跨来源共享）
export function deleteSkipTime(title: string): void {
  if (typeof window === 'undefined') return;
  if (!title.trim()) return;

  try {
    const key = getSkipTimeKey(title);
    localStorage.removeItem(key);
    console.log(`[跳过配置] 已删除跨来源跳过配置: ${title}`);
  } catch (error) {
    console.error('删除跳过配置失败:', error);
  }
}

