/**
 * 邮件模板
 */

export interface FavoriteUpdate {
  title: string;
  oldEpisodes: number;
  newEpisodes: number;
  url: string;
  cover?: string;
}

/**
 * 收藏更新邮件模板
 */
export function getFavoriteUpdateEmailTemplate(
  userName: string,
  updates: FavoriteUpdate[],
  siteUrl: string,
  siteName?: string
): string {
  const updatesList = updates
    .map(
      (u) => `
    <div style="margin: 15px 0; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      ${
        u.cover
          ? `<img src="${u.cover}" alt="${u.title}" style="width: 100%; max-width: 200px; border-radius: 5px; margin-bottom: 10px;" />`
          : ''
      }
      <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">${u.title}</div>
      <div style="color: #666; margin-bottom: 10px;">
        更新：第 ${u.oldEpisodes} 集 → <span style="color: #4F46E5; font-weight: bold;">第 ${u.newEpisodes} 集</span>
      </div>
      <a href="${u.url}" style="display: inline-block; padding: 8px 16px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; font-size: 14px;">立即观看</a>
    </div>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 600px;
          margin: 20px auto;
          background: white;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
          background: white;
          color: #333;
          padding: 30px 20px;
          text-align: center;
          border-bottom: 2px solid #f0f0f0;
        }
        .header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
        }
        .content {
          padding: 30px 20px;
          background: white;
        }
        .greeting {
          font-size: 16px;
          color: #333;
          margin-bottom: 20px;
        }
        .footer {
          padding: 20px;
          text-align: center;
          color: #999;
          font-size: 12px;
          background: white;
          border-top: 1px solid #eee;
        }
        .footer a {
          color: #4F46E5;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📺 收藏更新通知</h1>
        </div>
        <div class="content">
          <div class="greeting">
            Hi <strong>${userName}</strong>，
          </div>
          <p style="color: #666; margin-bottom: 20px;">您收藏的以下影片有更新：</p>
          ${updatesList}
          <p style="color: #666; margin-top: 20px;">快去观看吧！</p>
        </div>
        <div class="footer">
          <p>此邮件由 <a href="${siteUrl}">${siteName || 'MoonTVPlus'}</a> 自动发送</p>
          <p>如不想接收此类邮件，请在用户设置中关闭邮件通知</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * 单个收藏更新邮件模板（简化版）
 */
export function getSingleFavoriteUpdateEmailTemplate(
  userName: string,
  title: string,
  oldEpisodes: number,
  newEpisodes: number,
  url: string,
  cover?: string,
  siteName?: string
): string {
  return getFavoriteUpdateEmailTemplate(
    userName,
    [{ title, oldEpisodes, newEpisodes, url, cover }],
    url.split('/play')[0] || 'http://localhost:3000',
    siteName
  );
}

/**
 * 批量收藏更新邮件模板（每日汇总）
 */
export function getBatchFavoriteUpdateEmailTemplate(
  userName: string,
  updates: FavoriteUpdate[],
  siteUrl: string,
  siteName?: string
): string {
  const totalUpdates = updates.length;
  const totalNewEpisodes = updates.reduce(
    (sum, u) => sum + (u.newEpisodes - u.oldEpisodes),
    0
  );

  const updatesList = updates
    .map(
      (u) => `
    <div style="margin: 15px 0; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="display: flex; align-items: center; gap: 15px;">
        ${
          u.cover
            ? `<img src="${u.cover}" alt="${u.title}" style="width: 80px; height: 120px; object-fit: cover; border-radius: 5px;" />`
            : ''
        }
        <div style="flex: 1;">
          <div style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">${u.title}</div>
          <div style="color: #666; margin-bottom: 10px;">
            第 ${u.oldEpisodes} 集 → <span style="color: #4F46E5; font-weight: bold;">第 ${u.newEpisodes} 集</span>
            <span style="color: #10b981; font-weight: bold;">(+${u.newEpisodes - u.oldEpisodes})</span>
          </div>
          <a href="${u.url}" style="display: inline-block; padding: 6px 12px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; font-size: 13px;">立即观看</a>
        </div>
      </div>
    </div>
  `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 600px;
          margin: 20px auto;
          background: white;
          border-radius: 10px;
          overflow: hidden;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
          background: white;
          color: #333;
          padding: 30px 20px;
          text-align: center;
          border-bottom: 2px solid #f0f0f0;
        }
        .header h1 {
          margin: 0 0 10px 0;
          font-size: 24px;
          font-weight: 600;
        }
        .header .stats {
          font-size: 14px;
          color: #666;
        }
        .content {
          padding: 30px 20px;
          background: white;
        }
        .greeting {
          font-size: 16px;
          color: #333;
          margin-bottom: 20px;
        }
        .footer {
          padding: 20px;
          text-align: center;
          color: #999;
          font-size: 12px;
          background: white;
          border-top: 1px solid #eee;
        }
        .footer a {
          color: #4F46E5;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📺 收藏更新汇总</h1>
          <div class="stats">
            ${totalUpdates} 部影片更新 · 共 ${totalNewEpisodes} 集新内容
          </div>
        </div>
        <div class="content">
          <div class="greeting">
            Hi <strong>${userName}</strong>，
          </div>
          <p style="color: #666; margin-bottom: 20px;">您收藏的影片有以下更新：</p>
          ${updatesList}
          <p style="color: #666; margin-top: 20px;">快去观看吧！</p>
        </div>
        <div class="footer">
          <p>此邮件由 <a href="${siteUrl}">${siteName || 'MoonTVPlus'}</a> 自动发送</p>
          <p>如不想接收此类邮件，请在用户设置中关闭邮件通知</p>
        </div>
      </div>
    </body>
    </html>
  `;
}
