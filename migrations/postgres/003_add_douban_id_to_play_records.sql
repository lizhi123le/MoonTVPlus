-- ============================================
-- MoonTV Plus - 添加 douban_id 到播放记录表 (PostgreSQL)
-- 版本: 1.0.1
-- 创建时间: 2026-02-10
-- ============================================

-- 为 play_records 表添加 douban_id 字段
ALTER TABLE play_records ADD COLUMN IF NOT EXISTS douban_id INTEGER;

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_play_records_douban_id ON play_records(douban_id) WHERE douban_id IS NOT NULL;
