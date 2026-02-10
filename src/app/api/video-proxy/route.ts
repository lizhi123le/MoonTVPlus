import { NextResponse } from 'next/server';

// 视频代理接口 - 支持 Range 请求和浏览器缓存
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
  }

  try {
    // 获取客户端的 Range 请求头
    const range = request.headers.get('range');

    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      'Referer': 'https://movie.douban.com/',
    };

    // 只有当有 Range 请求时才转发
    if (range) {
      fetchHeaders['Range'] = range;
    }

    const response = await fetch(videoUrl, {
      headers: fetchHeaders,
    });

    const responseHeaders = new Headers(response.headers);

    // 生成 ETag 用于缓存验证
    const etag = `"${videoUrl.substring(videoUrl.lastIndexOf('/') + 1)}-${response.status}-${response.headers.get('content-length') || 'unknown'}"`;
    responseHeaders.set('ETag', etag);
    responseHeaders.set('Last-Modified', new Date().toUTCString());

    // 添加缓存控制头 - 使用 immutable 表示内容不会变化
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    responseHeaders.set('CDN-Cache-Control', 'public, max-age=31536000');
    responseHeaders.set('Vercel-CDN-Cache-Control', 'public, max-age=31536000');

    // 设置 CORS 头
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, ETag, Accept-Ranges');
    responseHeaders.set('Accept-Ranges', 'bytes');

    // 如果源服务器返回了 Content-Range，设置 206 状态
    const contentRange = response.headers.get('content-range');
    const status = (range && contentRange) ? 206 : response.status;

    return new Response(response.body, {
      status,
      statusText: response.statusText,
      headers: responseHeaders,
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
      'Access-Control-Allow-Headers': 'Range, Origin, Accept, If-Range',
      'Access-Control-Max-Age': '86400',
    },
  });
}
