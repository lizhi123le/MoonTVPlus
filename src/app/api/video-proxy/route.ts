import { NextResponse } from 'next/server';

// 视频代理接口 - 简化版，直接透传响应
// Cloudflare Workers 对视频流有严格的 CPU 限制
// 解决方案：直接透传响应，不做任何处理
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
  }

  try {
    // 获取客户端的Range请求头
    const range = request.headers.get('range');

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      'Referer': 'https://movie.douban.com/',
    };

    // 如果客户端发送了Range请求，转发给源服务器
    if (range) {
      fetchHeaders['Range'] = range;
    }

    // 直接返回响应，不做任何处理
    // 这样可以避免 CPU 超时，因为 Workers 会直接转发流
    return fetch(videoUrl, {
      headers: fetchHeaders,
    });
  } catch (error) {
    console.error('Error proxying video:', error);
    return NextResponse.json(
      { error: 'Error fetching video' },
      { status: 500 }
    );
  }
}

// 处理 OPTIONS 预检请求
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Origin, Accept',
      'Access-Control-Max-Age': '86400',
    },
  });
}
