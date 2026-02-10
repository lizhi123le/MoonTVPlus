import { NextResponse } from 'next/server';

// 视频代理接口，支持Range请求和流式传输
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json({ error: 'Missing video URL' }, { status: 400 });
  }

  try {
    // 获取客户端的Range请求头
    const range = request.headers.get('range');

    const fetchHeaders: HeadersInit = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      Referer: 'https://movie.douban.com/',
    };

    // 如果客户端发送了Range请求，转发给源服务器
    if (range) {
      fetchHeaders['Range'] = range;
    }

    const videoResponse = await fetch(videoUrl, {
      headers: fetchHeaders,
    });

    if (!videoResponse.ok) {
      return NextResponse.json(
        { error: videoResponse.statusText },
        { status: videoResponse.status }
      );
    }

    if (!videoResponse.body) {
      return NextResponse.json(
        { error: 'Video response has no body' },
        { status: 500 }
      );
    }

    // 创建响应头
    const headers = new Headers();

    // 复制重要的响应头
    const contentType = videoResponse.headers.get('content-type');
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    const contentLength = videoResponse.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    const contentRange = videoResponse.headers.get('content-range');
    if (contentRange) {
      headers.set('Content-Range', contentRange);
    }

    const acceptRanges = videoResponse.headers.get('accept-ranges');
    if (acceptRanges) {
      headers.set('Accept-Ranges', acceptRanges);
    }

    // 设置缓存头
    headers.set('Cache-Control', 'public, max-age=31536000, s-maxage=31536000');
    headers.set('CDN-Cache-Control', 'public, s-maxage=31536000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000');

    // 设置CORS头，允许跨域请求
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range, Origin, Accept');
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    // 移除 Transfer-Encoding: chunked
    // 手动设置 Transfer-Encoding: chunked 会导致 Cloudflare Workers CPU 超时
    // HTTP/2 和 HTTP/1.1 的分块传输应该由服务器自动处理

    // 返回视频流，状态码根据是否有Range请求决定
    const status = range && contentRange ? 206 : 200;

    return new Response(videoResponse.body, {
      status,
      headers,
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
