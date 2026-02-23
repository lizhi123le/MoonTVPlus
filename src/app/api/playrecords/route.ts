/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { PlayRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 检查用户状态和执行迁移
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }

      // 检查播放记录迁移标识，没有迁移标识时执行迁移
      if (!userInfoV2.playrecord_migrated) {
        console.log(`用户 ${authInfo.username} 播放记录未迁移，开始执行迁移...`);
        await db.migratePlayRecords(authInfo.username);
      }
    } else {
      // 站长也需要执行迁移（站长可能不在数据库中，直接尝试迁移）
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2 || !userInfoV2.playrecord_migrated) {
        console.log(`站长 ${authInfo.username} 播放记录未迁移，开始执行迁移...`);
        await db.migratePlayRecords(authInfo.username);
      }
    }

    const records = await db.getAllPlayRecords(authInfo.username);
    return NextResponse.json(records, { status: 200 });
  } catch (err) {
    console.error('获取播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    // 验证播放记录数据
    if (!record.title || !record.source_name || record.index < 1) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 }
      );
    }

    // 新的key是title-based（通过normalizeTitleForKey生成），直接从record中获取source和id
    // 这样可以实现：同名影片只保存一个最新记录，同时保留source和id用于播放跳转
    const source = record.source || '';
    const id = record.id || '';

    const finalRecord = {
      ...record,
      save_time: record.save_time ?? Date.now(),
    } as PlayRecord;

    // 清理可能存在的旧格式记录（source+id 格式的 key）
    // 避免同名影片因为新旧 key 格式不同而产生重复记录
    try {
      const allRecords = await (db as any).storage.getAllPlayRecords(authInfo.username) as Record<string, PlayRecord>;
      const normalizedTitle = key; // 新的title-based key
      
      // 遍历所有记录，找出与当前标题相同的旧记录并删除
      for (const [oldKey, oldRecord] of Object.entries(allRecords)) {
        // 如果是旧的title-based key（与当前key相同），跳过因为会覆盖
        if (oldKey === normalizedTitle) continue;
        
        // 检查旧记录的标题是否与当前标题相同（使用相同的normalizeTitleForKey逻辑）
        const oldNormalizedTitle = ((oldRecord as PlayRecord).title || '').trim().toLowerCase()
          .replace(/[\s\-_]+/g, '')
          .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
        
        if (oldNormalizedTitle === normalizedTitle) {
          console.log('[播放记录] 清理旧格式记录:', { oldKey, title: (oldRecord as PlayRecord).title });
          await (db as any).storage.deletePlayRecord(authInfo.username, oldKey);
        }
      }
    } catch (err) {
      console.error('清理旧记录失败:', err);
      // 不阻塞保存流程
    }

    // 使用title-based key存储，这样同名影片会覆盖旧记录
    // 直接调用存储层，绕过db.savePlayRecord的source+id key生成逻辑
    await (db as any).storage.setPlayRecord(authInfo.username, key, finalRecord);

    // 异步清理旧的播放记录（不阻塞响应）
    (db as any).storage.cleanupOldPlayRecords(authInfo.username).catch((err: Error) => {
      console.error('异步清理播放记录失败:', err);
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('保存播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查用户存在或被封禁
      const userInfoV2 = await db.getUserInfoV2(authInfo.username);
      if (!userInfoV2) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (userInfoV2.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 使用title-based key删除记录，直接调用存储层
      await (db as any).storage.deletePlayRecord(username, key);
    } else {
      // 未提供 key，则清空全部播放记录
      // 目前 DbManager 没有对应方法，这里直接遍历删除
      const all = await db.getAllPlayRecords(username);
      await Promise.all(
        Object.keys(all).map(async (k) => {
          const [s, i] = k.split('+');
          if (s && i) await db.deletePlayRecord(username, s, i);
        })
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除播放记录失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
