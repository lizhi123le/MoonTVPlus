-- ============================================
-- MoonTV Plus - 音乐模块数据表
-- 版本: 1.2.0
-- 创建时间: 2026-02-01
-- 更新时间: 2026-02-02
-- ============================================

-- 音乐播放记录表
CREATE TABLE IF NOT EXISTS music_play_records (
  username TEXT NOT NULL,
  key TEXT NOT NULL, -- format: "platform+id" (e.g., "netease+12345")
  platform TEXT NOT NULL CHECK(platform IN ('netease', 'qq', 'kuwo')), -- 音乐平台
  song_id TEXT NOT NULL, -- 歌曲ID
  name TEXT NOT NULL, -- 歌曲名
  artist TEXT NOT NULL, -- 艺术家
  album TEXT, -- 专辑（可选）
  pic TEXT, -- 封面图URL（可选）
  play_time REAL NOT NULL DEFAULT 0, -- 播放进度（秒）
  duration REAL NOT NULL DEFAULT 0, -- 总时长（秒）
  save_time INTEGER NOT NULL, -- 保存时间戳
  PRIMARY KEY (username, key),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_music_play_records_username ON music_play_records(username);
CREATE INDEX IF NOT EXISTS idx_music_play_records_save_time ON music_play_records(username, save_time DESC);
CREATE INDEX IF NOT EXISTS idx_music_play_records_platform ON music_play_records(username, platform);

-- ============================================
-- 音乐歌单表
-- ============================================

-- 音乐歌单表
CREATE TABLE IF NOT EXISTS music_playlists (
  id TEXT NOT NULL, -- 歌单ID (UUID)
  username TEXT NOT NULL, -- 用户名
  name TEXT NOT NULL, -- 歌单名称
  description TEXT, -- 歌单描述（可选）
  cover TEXT, -- 歌单封面（可选，使用第一首歌的封面）
  created_at INTEGER NOT NULL, -- 创建时间戳
  updated_at INTEGER NOT NULL, -- 更新时间戳
  PRIMARY KEY (id),
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- 音乐歌单歌曲关联表
CREATE TABLE IF NOT EXISTS music_playlist_songs (
  playlist_id TEXT NOT NULL, -- 歌单ID
  platform TEXT NOT NULL CHECK(platform IN ('netease', 'qq', 'kuwo')), -- 音乐平台
  song_id TEXT NOT NULL, -- 歌曲ID
  name TEXT NOT NULL, -- 歌曲名
  artist TEXT NOT NULL, -- 艺术家
  album TEXT, -- 专辑（可选）
  pic TEXT, -- 封面图URL（可选）
  duration REAL NOT NULL DEFAULT 0, -- 总时长（秒）
  added_at INTEGER NOT NULL, -- 添加时间戳
  sort_order INTEGER NOT NULL DEFAULT 0, -- 排序顺序
  PRIMARY KEY (playlist_id, platform, song_id),
  FOREIGN KEY (playlist_id) REFERENCES music_playlists(id) ON DELETE CASCADE
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_music_playlists_username ON music_playlists(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_music_playlist_songs_playlist ON music_playlist_songs(playlist_id, sort_order ASC);
CREATE INDEX IF NOT EXISTS idx_music_playlist_songs_added_at ON music_playlist_songs(playlist_id, added_at DESC);

-- ============================================
-- 播放器设置和跳过时间表
-- 版本: 1.3.0
-- 更新时间: 2026-02-10
-- ============================================

-- 播放器设置表（支持匿名用户和登录用户）
CREATE TABLE IF NOT EXISTS player_settings (
  user_id TEXT PRIMARY KEY,  -- 'anonymous' 或用户名
  settings TEXT NOT NULL,    -- JSON blob
  updated_at INTEGER NOT NULL
);

-- 跳过时间表（跨来源共享，使用标准化标题）
CREATE TABLE IF NOT EXISTS skip_times (
  title_normalized TEXT PRIMARY KEY,
  intro_time INTEGER NOT NULL DEFAULT 0,
  outro_time INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skip_times_updated ON skip_times(updated_at DESC);
