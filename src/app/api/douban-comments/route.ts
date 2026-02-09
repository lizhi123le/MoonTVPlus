import * as cheerio from 'cheerio';
import { NextRequest, NextResponse } from 'next/server';

import { fetchDoubanWithVerification } from '@/lib/douban-anti-crawler';

export const runtime = 'nodejs';

interface DoubanComment {
  id: string;
  userName: string;
  userAvatar: string;
  userUrl: string;
  rating: number | null; // 1-5 星，null 表示未评分
  content: string;
  time: string;
  votes: number;
}

/**
 * 获取豆瓣代理配置（服务端版本）
 */
function getDoubanProxyConfig(): {
  proxyType: 'direct' | 'cors-proxy-zwei' | 'cmliussss-cdn-tencent' | 'cmliussss-cdn-ali' | 'cors-anywhere' | 'custom';
  proxyUrl: string;
} {
  const proxyType = (process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent') as 'direct' | 'cors-proxy-zwei' | 'cmliussss-cdn-tencent' | 'cmliussss-cdn-ali' | 'cors-anywhere' | 'custom';
  const proxyUrl = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  return { proxyType, proxyUrl };
}

/**
 * 使用代理获取页面
 */
async function fetchWithDoubanProxy(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  const { proxyType, proxyUrl } = getDoubanProxyConfig();

  switch (proxyType) {
    case 'cmliussss-cdn-tencent': {
      // 使用腾讯 CDN 代理
      response = await fetch(`https://m.douban.cmliussss.net/rexxar/api/v2${url.replace('https://movie.douban.com', '')}`, {
        headers,
      });
      break;
    }

    case 'cmliussss-cdn-ali': {
      // 使用阿里云 CDN 代理
      response = await fetch(`https://m.douban.cmliussss.com/rexxar/api/v2${url.replace('https://movie.douban.com', '')}`, {
        headers,
      });
      break;
    }

    case 'cors-proxy-zwei': {
      response = await fetch('https://ciao-cors.is-an.org/' + url, {
        headers,
      });
      break;
    }

    case 'cors-anywhere': {
      response = await fetch('https://cors-anywhere.com/' + url, {
        headers,
      });
      break;
    }

    case 'custom': {
      // 自定义代理
      const customProxyUrl = proxyUrl || '';
      if (customProxyUrl.endsWith('/')) {
        response = await fetch(customProxyUrl + url, { headers });
      } else {
        response = await fetch(customProxyUrl + '?url=' + encodeURIComponent(url), { headers });
      }
      break;
    }

    case 'direct':
    default: {
      // 直接请求（使用反爬虫机制）
      response = await fetchDoubanWithVerification(url, { headers });
      break;
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id');
  const start = searchParams.get('start') || '0';
  const limit = searchParams.get('limit') || '20';

  if (!doubanId) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  try {
    // 请求豆瓣短评页面
    const url = `https://movie.douban.com/subject/${doubanId}/comments?start=${start}&limit=${limit}&status=P&sort=new_score`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://movie.douban.com/',
    };

    const { proxyType } = getDoubanProxyConfig();
    console.log(`Fetching Douban comments with proxy type: ${proxyType}`);

    let response: Response;

    try {
      response = await fetchWithDoubanProxy(url, headers);
    } catch (proxyError) {
      console.error('Proxy fetch failed, trying direct:', proxyError);
      // 降级到直接请求
      response = await fetchDoubanWithVerification(url, { headers });
    }

    if (!response.ok) {
      console.error('Douban fetch failed with status:', response.status);
      return NextResponse.json(
        { error: '获取评论失败，请检查网络或代理配置' },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const comments: DoubanComment[] = [];

    console.log('开始解析豆瓣评论，start:', start, 'limit:', limit);

    // 检查是否被屏蔽或需要验证
    const bodyText = $('body').text();
    if (bodyText.includes('验证') || bodyText.includes('验证码') || bodyText.includes('security check')) {
      console.warn('Douban verification/security check detected');
      return NextResponse.json(
        { error: '豆瓣访问受限，请检查代理配置' },
        { status: 403 }
      );
    }

    // 解析每条短评
    $('.comment-item').each((_index, element) => {
      const $comment = $(element);

      // 提取评论 ID
      const commentId = $comment.attr('data-cid') || '';

      // 提取用户信息
      const $avatar = $comment.find('.avatar');
      const userUrl = $avatar.find('a').attr('href') || '';
      const userAvatar = $avatar.find('img').attr('src') || '';
      const userName = $avatar.find('a').attr('title') || '';

      // 提取评分（星级）
      const ratingClass = $comment.find('.rating').attr('class') || '';
      let rating: number | null = null;
      const ratingMatch = ratingClass.match(/allstar(\d)0/);
      if (ratingMatch) {
        rating = parseInt(ratingMatch[1], 10);
      }

      // 提取短评内容
      const $content = $comment.find('.short');
      const content = $content.text().trim();

      // 提取时间
      const $commentInfo = $comment.find('.comment-info');
      const time = $commentInfo.find('.comment-time').attr('title') || '';

      // 提取有用数
      const votesText = $comment.find('.votes.vote-count').text().trim();
      const votes = parseInt(votesText, 10) || 0;

      if (commentId && content) {
        comments.push({
          id: commentId,
          userName,
          userAvatar,
          userUrl,
          rating,
          content,
          time,
          votes,
        });
      }
    });

    console.log('解析到评论数:', comments.length);

    // 获取总评论数 - 尝试多种方式
    let total = 0;

    // 方式1: 从标题获取 "全部 XXX 条"
    const titleText = $('.mod-hd h2, h2, .section-title').text();
    const titleMatch = titleText.match(/全部\s*(\d+)\s*条/);
    if (titleMatch) {
      total = parseInt(titleMatch[1], 10);
    }

    // 方式2: 从导航标签获取 "看过(XXX)"
    if (total === 0) {
      const navText = $('.tabs, .nav-tabs, a').text();
      const navMatch = navText.match(/看过\s*\((\d+)\)/);
      if (navMatch) {
        total = parseInt(navMatch[1], 10);
      }
    }

    // 方式3: 从页面所有文本查找
    if (total === 0) {
      const bodyText2 = $('body').text();
      const bodyMatch = bodyText2.match(/全部\s*(\d+)\s*条|看过\s*\((\d+)\)/);
      if (bodyMatch) {
        total = parseInt(bodyMatch[1] || bodyMatch[2], 10);
      }
    }

    // 方式4: 如果有评论但 total 为 0，至少设置为当前评论数，并假设有更多
    if (total === 0 && comments.length > 0) {
      total = parseInt(start, 10) + comments.length;
      // 如果本次获取了完整的 limit 数量，可能还有更多
      if (comments.length >= parseInt(limit, 10)) {
        total += 1; // 暂定有更多
      }
    }

    // 如果没有获取到评论，且没有 total，返回友好错误
    if (comments.length === 0 && total === 0) {
      return NextResponse.json(
        { error: '暂无评论或访问受限' },
        { status: 404 }
      );
    }

    console.log('豆瓣评论统计:', {
      total,
      commentsCount: comments.length,
      start,
      limit,
      hasMore: parseInt(start, 10) + comments.length < total || (total === 0 && comments.length >= parseInt(limit, 10)),
    });

    return NextResponse.json(
      {
        comments,
        total,
        start: parseInt(start, 10),
        limit: parseInt(limit, 10),
        // 如果知道总数，就用总数判断；否则如果获取了完整页，假设还有更多
        hasMore: total > 0
          ? parseInt(start, 10) + comments.length < total
          : comments.length >= parseInt(limit, 10),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=600, s-maxage=600',
        },
      }
    );
  } catch (error) {
    console.error('Douban comments fetch error:', error);
    return NextResponse.json(
      { error: '获取评论失败，请稍后重试' },
      { status: 500 }
    );
  }
}
