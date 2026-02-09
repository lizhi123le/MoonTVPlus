// 跳过时间 API（跨来源共享，双向同步）
import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';

// 生成标准化的标题（与客户端保持一致）
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase()
    .replace(/[\s\-_]+/g, '')  // 移除空格、连字符、下划线
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');  // 只保留字母数字和中文
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');

    // 获取所有跳过时间（用于全量同步）
    const all = searchParams.get('all');

    const db = await getDB();

    if (all === 'true') {
      const skipTimes = await db.getAllSkipTimes();
      return NextResponse.json({ skipTimes });
    }

    if (!title) {
      return NextResponse.json({ error: '缺少 title 参数' }, { status: 400 });
    }

    const titleNormalized = normalizeTitle(title);
    const skipTime = await db.getSkipTime(titleNormalized);

    return NextResponse.json({ skipTime });
  } catch (error) {
    console.error('获取跳过时间失败:', error);
    return NextResponse.json({ error: '获取跳过时间失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, intro_time, outro_time, skipTimes } = body;

    const db = await getDB();

    // 批量保存跳过时间
    if (skipTimes && Array.isArray(skipTimes)) {
      const now = Date.now();
      const normalizedSkipTimes = skipTimes.map((skip: { title: string; intro_time: number; outro_time: number }) => ({
        title_normalized: normalizeTitle(skip.title),
        intro_time: skip.intro_time,
        outro_time: skip.outro_time,
        updated_at: now,
      }));
      await db.bulkSetSkipTimes(normalizedSkipTimes);
      return NextResponse.json({ success: true, count: skipTimes.length });
    }

    // 单条保存
    if (!title) {
      return NextResponse.json({ error: '缺少 title 参数' }, { status: 400 });
    }

    const titleNormalized = normalizeTitle(title);
    await db.setSkipTime(titleNormalized, intro_time || 0, outro_time || 0);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('保存跳过时间失败:', error);
    return NextResponse.json({ error: '保存跳过时间失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');

    if (!title) {
      return NextResponse.json({ error: '缺少 title 参数' }, { status: 400 });
    }

    const db = await getDB();
    const titleNormalized = normalizeTitle(title);
    await db.deleteSkipTime(titleNormalized);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除跳过时间失败:', error);
    return NextResponse.json({ error: '删除跳过时间失败' }, { status: 500 });
  }
}
