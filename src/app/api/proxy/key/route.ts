/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');
  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';

  try {
    const decodedUrl = decodeURIComponent(url);
    console.log(decodedUrl);
    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': ua,
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch key' }, { status: 500 });
    }
    const keyData = await response.arrayBuffer();
    return new Response(keyData, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Cache-Control': 'public, max-age=3600'
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch key' }, { status: 500 });
  }
}

// 处理 OPTIONS 预检请求
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Origin, Accept',
      'Access-Control-Max-Age': '86400',
    },
  });
}