/**
 * 视频源「本地顺序覆盖」
 *
 * 背景：后台拖拽排序 / 置顶 / 权重保存写入的是服务端配置（D1 / KV），
 * 而源站寻片页拿源列表要走 /api/source-search/sources → getConfig()，
 * 默认有 15 分钟内存缓存，多节点（边缘）部署还存在最终一致延迟。
 * 于是"刚在后台改完顺序"时，寻片页可能仍按旧顺序显示。
 *
 * 方案：后台改顺序时，把 key 顺序写进浏览器 localStorage；
 * 寻片页拿到服务端列表后按本地顺序重排，从而**本机即时生效**，
 * 不受服务端缓存 / 边缘同步延迟影响。
 *
 * 收敛：当"按本地顺序重排"是空操作（服务端顺序已与本地一致）时，
 * 自动清除覆盖；另有 TTL 兜底。避免本地顺序永久压过服务端，
 * 导致换设备 / 换管理员后顺序长期打架。
 *
 * 注意：localStorage 是**每浏览器**的，本机制只让"做改动的那台设备"
 * 即时生效；其他观看端仍以服务端顺序为准。
 */

const STORAGE_KEY = 'moontv:sourceOrder';

/** 覆盖有效期：与 getConfig 默认 15 分钟缓存窗口对齐 */
const OVERRIDE_TTL_MS = 15 * 60 * 1000;

interface LocalSourceOrder {
  /** 视频源 key 的目标顺序 */
  order: string[];
  /** 写入时间戳，用于 TTL 兜底 */
  ts: number;
}

/**
 * 记录后台调整后的视频源顺序。
 * 应在拖拽排序、批量置顶、权重弹窗保存等会改变顺序的操作中调用。
 */
export function saveLocalSourceOrder(keys: string[]): void {
  if (typeof window === 'undefined') return;

  const order = keys.filter((key) => typeof key === 'string' && key.length > 0);
  if (order.length === 0) return;

  try {
    const payload: LocalSourceOrder = { order, ts: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage 不可用（隐私模式 / 配额超限）时静默降级为服务端顺序
  }
}

/** 读取本地顺序；已过期或格式非法时返回 null */
export function getLocalSourceOrder(): LocalSourceOrder | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<LocalSourceOrder>;
    if (!Array.isArray(parsed.order) || typeof parsed.ts !== 'number') {
      return null;
    }

    if (Date.now() - parsed.ts > OVERRIDE_TTL_MS) {
      clearLocalSourceOrder();
      return null;
    }

    return {
      order: parsed.order.filter((key) => typeof key === 'string'),
      ts: parsed.ts,
    };
  } catch {
    return null;
  }
}

export function clearLocalSourceOrder(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略清除失败
  }
}

/**
 * 按本地顺序重排源列表。
 * 本地顺序中不存在的源（如新增源）保持服务端相对顺序并追加到末尾。
 *
 * @param options.converge 是否允许在上面的"收敛检测"命中时清除覆盖。
 *   仅在输入是**服务端刚返回的权威列表**时才能置为 true；
 *   对内存中已经重排过的列表再次应用时必须传 false，
 *   否则会在服务端仍延迟时误清覆盖，导致下次刷新回退到旧顺序。
 */
export function applyLocalSourceOrder<T extends { key: string }>(
  sites: T[],
  options: { converge?: boolean } = {}
): T[] {
  if (typeof window === 'undefined' || sites.length === 0) return sites;

  const local = getLocalSourceOrder();
  if (!local) return sites;

  const rank = new Map<string, number>();
  local.order.forEach((key, index) => {
    if (!rank.has(key)) rank.set(key, index);
  });

  const known: T[] = [];
  const unknown: T[] = [];
  for (const site of sites) {
    if (rank.has(site.key)) {
      known.push(site);
    } else {
      unknown.push(site);
    }
  }

  known.sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  const reordered = [...known, ...unknown];

  // 收敛检测：重排没有改变任何位置，说明服务端顺序已与本地一致，
  // 覆盖已无意义（含源被删除/禁用导致本地 key 比服务端多的情况）。
  if (options.converge !== false) {
    const sameOrder =
      reordered.length === sites.length &&
      reordered.every((site, index) => site.key === sites[index].key);
    if (sameOrder) {
      clearLocalSourceOrder();
      return sites;
    }
  }

  return reordered;
}

/**
 * 订阅本地顺序变化。
 * 返回清理函数。源站寻片页用它在后台（同一浏览器的另一个标签页）
 * 改完顺序后立即重排当前列表。
 */
export function subscribeLocalSourceOrder(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    // event.key 为 null 表示 localStorage.clear()
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };

  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
