// 播放器设置 API（支持匿名用户和登录用户双向同步）
import { NextRequest, NextResponse } from 'next/server';
import { getDB } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId') || 'anonymous';

    // 兼容登录用户：如果传了 username 参数，使用 username 作为 userId
    const username = searchParams.get('username');
    const effectiveUserId = username || userId;

    const db = await getDB();
    const settings = await db.getPlayerSettings(effectiveUserId);

    if (settings === null) {
      return NextResponse.json({ settings: null });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('获取播放器设置失败:', error);
    return NextResponse.json({ error: '获取播放器设置失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId = 'anonymous', settings } = body;

    if (!settings) {
      return NextResponse.json({ error: '缺少 settings 参数' }, { status: 400 });
    }

    const db = await getDB();
    await db.setPlayerSettings(userId, JSON.stringify(settings));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('保存播放器设置失败:', error);
    return NextResponse.json({ error: '保存播放器设置失败' }, { status: 500 });
  }
}
