import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { isTVModeEnabled } from '@/lib/tv-mode';
import type { TVRemoteKeyCommand } from '@/lib/tv-remote-types';

// eslint-disable-next-line @typescript-eslint/no-var-requires -- 延迟加载，避免把 socket.io 聚合器静态打进这些路由
const { sendTVRemoteCommand } = require('@/lib/tv-remote-hub');

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!isTVModeEnabled()) {
    return NextResponse.json({ error: 'TV 模式未启用' }, { status: 404 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as {
    deviceId?: string;
    command?: TVRemoteKeyCommand;
  } | null;

  if (!body?.deviceId || !body.command?.key) {
    return NextResponse.json({ error: '参数不完整' }, { status: 400 });
  }

  const result = sendTVRemoteCommand(
    authInfo.username,
    body.deviceId,
    'tv-remote:key',
    body.command
  );

  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
