/**
 * User-Agent 随机化工具
 * 用于在请求源站资源时提供不同的 UA，避免被识别为同一用户。
 *
 * 最后更新: 2026-06-06
 * Chrome 149 / Firefox 151 / Edge 149 / Safari 26.5 / iOS 26.5
 */

const USER_AGENTS = [
  // ── Chrome Family (v148–149) ──
  // Chrome 110+ 实施了 User-Agent Reduction，桌面端 Chrome 的 UA 已被冻结：
  //   平台固定为 Windows NT 10.0 / macOS 10_15_7 / Linux x86_64
  //   版本号固定为 Chrome/MAJOR.0.0.0（无小版本）
  // Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  // macOS（冻结为 Intel Mac OS X 10_15_7，即使真实系统是 macOS Tahoe）
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  // Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',

  // ── Safari Family (v26.4–26.5) ──
  // Safari 不受 Chromium UA Reduction 影响，使用真实版本号
  // macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 26_5_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Safari/605.1.15',
  // iOS（iPhone）
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1',
  // iPadOS
  'Mozilla/5.0 (iPad; CPU OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
  // iOS Chrome & iPad Chrome（CriOS — 不受 UA Reduction 影响）
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.7827.45 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/149.0.7827.45 Mobile/15E148 Safari/604.1',

  // ── Firefox Family (v150–151) ──
  // Firefox 不受 Chromium UA Reduction 影响，使用真实版本号
  // Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0',
  // macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 26.5; rv:151.0) Gecko/20100101 Firefox/151.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:150.0) Gecko/20100101 Firefox/150.0',
  // Linux
  'Mozilla/5.0 (X11; Linux x86_64; rv:151.0) Gecko/20100101 Firefox/151.0',
  // Android
  'Mozilla/5.0 (Android 15; Mobile; rv:151.0) Gecko/151.0 Firefox/151.0',

  // ── Edge Family (v148–149) ──
  // Edge 同样基于 Chromium，Chrome 部分使用 Reduction 格式；Edg 令牌可含小版本
  // Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.4022.52',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.3967.83',
  // macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.4022.52',

  // ── Mobile Chrome (Android) ──
  // Android Chrome 同样受 UA Reduction 影响：
  //   平台固定为 (Linux; Android 10; K)
  //   版本固定为 Chrome/MAJOR.0.0.0 Mobile
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',

  // ── TV & Entertainment ──
  // Android TV（非标准的 Chrome 场景，使用完整设备信息）
  'Mozilla/5.0 (Linux; Android 14; Sony BRAVIA XR Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  // Apple TV（非 Chromium，使用真实版本）
  'Mozilla/5.0 (AppleTV; CPU OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
];

/**
 * 获取一个随机的 User-Agent
 */
export function getRandomUA(): string {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index];
}
