import * as cheerio from 'cheerio';
import { NextRequest, NextResponse } from 'next/server';

import { fetchDoubanWithVerification } from '@/lib/douban-anti-crawler';

export const runtime = 'nodejs';

// 获取代理配置
function getProxyUrl(): string | null {
  return process.env.DOUBAN_PROXY_URL || process.env.https_proxy || process.env.HTTPS_PROXY || null;
}

// 使用代理获取页面
async function fetchWithProxy(url: string, headers: Record<string, string>): Promise<Response> {
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    console.log('Using proxy:', proxyUrl);
    return fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        headers,
      }),
    });
  }
  
  // 没有代理，使用原始方法
  return fetchDoubanWithVerification(url, { headers });
}

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id');
  const start = searchParams.get('start') || '0';
  const limit = searchParams.get('limit') || '20';

  if (!doubanId) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  try {
    // 请求豆瓣短评页面（使用反爬验证）
    const url = `https://movie.douban.com/subject/${doubanId}/comments?start=${start}&limit=${limit}&status=P&sort=new_score`;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://movie.douban.com/',
    };

    let response: Response;
    
    try {
      response = await fetchWithProxy(url, headers);
    } catch (proxyError) {
      console.error('Proxy fetch failed, trying direct:', proxyError);
      // 降级到直接请求（可能也会失败）
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
        { error: '豆瓣访问受限，请配置代理或稍后再试' },
        { status: 403 }
      );
    }

    // 解析每条短评
    $('.comment-item').each((index, element) => {
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
        rating = parseInt(ratingMatch[1]);
      }

      // 提取短评内容
      const $content = $comment.find('.short');
      const content = $content.text().trim();

      // 提取时间
      const $commentInfo = $comment.find('.comment-info');
      const time = $commentInfo.find('.comment-time').attr('title') || '';

      // 提取有用数
      const votesText = $comment.find('.votes.vote-count').text().trim();
      const votes = parseInt(votesText) || 0;

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
      total = parseInt(titleMatch[1]);
    }

    // 方式2: 从导航标签获取 "看过(XXX)"
    if (total === 0) {
      const navText = $('.tabs, .nav-tabs, a').text();
      const navMatch = navText.match(/看过\s*\((\d+)\)/);
      if (navMatch) {
        total = parseInt(navMatch[1]);
      }
    }

    // 方式3: 从页面所有文本查找
    if (total === 0) {
      const bodyText = $('body').text();
      const bodyMatch = bodyText.match(/全部\s*(\d+)\s*条|看过\s*\((\d+)\)/);
      if (bodyMatch) {
        total = parseInt(bodyMatch[1] || bodyMatch[2]);
      }
    }

    // 方式4: 如果有评论但 total 为 0，至少设置为当前评论数，并假设有更多
    if (total === 0 && comments.length > 0) {
      total = parseInt(start) + comments.length;
      // 如果本次获取了完整的 limit 数量，可能还有更多
      if (comments.length >= parseInt(limit)) {
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
      hasMore: parseInt(start) + comments.length < total || (total === 0 && comments.length >= parseInt(limit)),
    });

    return NextResponse.json(
      {
        comments,
        total,
        start: parseInt(start),
        limit: parseInt(limit),
        // 如果知道总数，就用总数判断；否则如果获取了完整页，假设还有更多
        hasMore: total > 0
          ? parseInt(start) + comments.length < total
          : comments.length >= parseInt(limit),
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
