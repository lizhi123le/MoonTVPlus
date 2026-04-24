import { NextRequest } from 'next/server';
import { AdminConfig } from '@/lib/admin.types';

/**
 * 解析代理 Origin 域名（带随机化逻辑）
 */
export async function resolveProxyOrigin(request: NextRequest, config: AdminConfig): Promise<string> {
  const proxyDomains = config.SiteConfig.ProxyDomains || [];
  
  // 优先级 1: 随机抽取多域名
  if (proxyDomains.length > 0) {
    const randomIndex = Math.floor(Math.random() * proxyDomains.length);
    let domain = proxyDomains[randomIndex];
    
    if (domain && !domain.startsWith('http://') && !domain.startsWith('https://')) {
      domain = 'https://' + domain;
    }
    if (domain && domain.endsWith('/')) {
      domain = domain.slice(0, -1);
    }
    return domain;
  }

  // 优先级 2: SITE_BASE 环境变量
  if (process.env.SITE_BASE) {
    let domain = process.env.SITE_BASE;
    if (domain.endsWith('/')) {
      domain = domain.slice(0, -1);
    }
    return domain;
  }

  // 优先级 3: 当前请求的 Host
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host');
  const proto = request.headers.get('x-forwarded-proto') ||
                (host?.includes('localhost') || host?.includes('127.0.0.1') ? 'http' : 'https');
  return `${proto}://${host}`;
}
