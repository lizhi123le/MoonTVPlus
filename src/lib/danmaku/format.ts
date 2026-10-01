/**
 * 移除弹幕标题中用【】包裹的来源标记，返回纯净标题。
 * 弹幕源常把来源（平台/字幕组等）用【】包裹放在标题里，展示分集名时应去掉。
 */
export function stripDanmakuSource(title: string | undefined | null): string {
  if (!title) return '';
  return title
    .replace(/【[^】]*】/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 在移除来源标记的基础上，进一步去掉标题中的「第x集 / 第x话 / 第x話」序号，
 * 得到用于选集列表展示的纯净分集名。
 * 若去除后已无实质内容（分集名本身就只是集号），返回空串，调用方可据此降级到 TMDB。
 */
export function cleanEpisodeDisplayName(
  title: string | undefined | null
): string {
  const base = stripDanmakuSource(title);
  if (!base) return '';
  return base
    .replace(/第\s*\d+\s*[集话話]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 把标题清洗成更适合弹幕库检索的关键词。
 *
 * 视频源（CMS）的标题常带各种修饰，直接丢给弹幕搜索接口大概率搜不到，
 * 而用户在弹幕面板里手输的往往是干净的名字。这里把常见的修饰去掉：
 *   - 【】等来源/字幕组标记
 *   - 括号补充说明（年份、别名、"国语版"等）
 *   - 第N季 / 第N部 / S02 等季号
 *   - "更新至第X集 / 全X集 / 完结"等进度描述
 *   - 独立的 4 位年份、清晰度/语言标记
 *   - 各类分隔符
 *
 * 清洗结果只作为「搜索关键词」的候选，不会覆盖原标题，属于纯增量兜底。
 */
export function cleanDanmakuSearchKeyword(
  title: string | undefined | null
): string {
  if (!title) return '';
  let t = stripDanmakuSource(title);
  t = t.replace(/[（(][^）)]*[）)]/g, ' ');
  t = t.replace(/第\s*[0-9一二三四五六七八九十]+\s*[季部期]/g, ' ');
  t = t.replace(/[Ss]\d{1,2}(?![0-9])/g, ' ');
  t = t.replace(/(?:更新至|更新到|已完结|完结|连载中|全集)/g, ' ');
  t = t.replace(/全\s*\d+\s*[集话話]/g, ' ');
  t = t.replace(/(?:19|20)\d{2}/g, ' ');
  t = t.replace(/第\s*\d+\s*[集话話]/g, ' ');
  t = t.replace(/\bHD\b/gi, ' ');
  t = t.replace(/(?:高清|蓝光|国语|粤语|日语|中字|中文字幕|双语)版?/g, ' ');
  t = t.replace(/[【】\[\]「」『』《》<>]/g, ' ');
  // 只清理真正的分隔符，保留 "Re:Zero"、"K-ON!" 这类标题自身的标点
  t = t.replace(/[_·・,，.。!！?？/\\|~～+]+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * 按优先级生成弹幕搜索关键词候选列表（已去重、去空）。
 *
 * 顺序即尝试顺序：越靠前越精确。调用方应依次搜索，前一个搜不到结果时再退化到后一个，
 * 这样既保留了用户/来源给出的精确关键词，又不会因为标题里多了个"第二季"就整部搜不到。
 *
 * @param titles 候选标题，按优先级从高到低传入（如：已记住的关键词、搜索页关键词、视频标题）
 */
export function buildDanmakuSearchKeywordCandidates(
  titles: Array<string | undefined | null>
): string[] {
  const result: string[] = [];
  const push = (value: string | undefined | null) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!result.includes(trimmed)) result.push(trimmed);
  };

  for (const raw of titles) {
    if (!raw) continue;
    push(raw);
    push(cleanDanmakuSearchKeyword(raw));
  }

  return result;
}

