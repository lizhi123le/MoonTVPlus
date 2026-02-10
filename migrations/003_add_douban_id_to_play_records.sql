-- ============================================
-- MoonTV Plus - 添加 douban_id 到播放记录表
-- 版本: 1.0.1
-- 创建时间: 2026-02-10
-- ============================================

-- 为 play_records 表添加 douban_id 字段
ALTER TABLE play_records ADD COLUMN douban_id INTEGER;
