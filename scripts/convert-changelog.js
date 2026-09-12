#!/usr/bin / env node

/* eslint-disable */

const fs = require('fs');
const path = require('path');

// 章节标题 → 数据字段的映射（大小写不敏感，支持中英文别名）。
// 说明：早先只识别 Added/Changed/Fixed，导致 "### Security Fixed"、"### Breaking Changes"
// 这类标题下的条目被并入上一个章节（通常是 changed），在 App 里显示成"功能改进"。
const SECTION_ALIASES = {
  added: ['added', '新增', '新增功能'],
  changed: ['changed', '变更', '功能改进'],
  fixed: ['fixed', '修复', '问题修复'],
  security: ['security fixed', 'security', '安全修复', '安全'],
  breaking: ['breaking changes', 'breaking', '破坏性变更'],
};

const SECTION_KEYS = Object.keys(SECTION_ALIASES);

// 解析 "### xxx" 标题对应的字段；返回 null 表示未知标题
function resolveSection(heading) {
  const text = heading
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase();
  for (const key of SECTION_KEYS) {
    if (SECTION_ALIASES[key].includes(text)) {
      return key;
    }
  }
  return null;
}

// 转义为合法的 TS 双引号字符串字面量：
// 直双引号、反斜杠、换行都不会再破坏生成结果（此前条目里出现直引号会产出非法 TS）
function escapeTsString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

function createEmptySections() {
  const sections = {};
  for (const key of SECTION_KEYS) {
    sections[key] = [];
  }
  return sections;
}

function parseChangelog(content) {
  const lines = content.split('\n');
  const versions = [];
  let currentVersion = null;
  let currentSection = null;
  let inVersionContent = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 匹配版本行: ## [X.Y.Z] - YYYY-MM-DD
    const versionMatch = trimmedLine.match(
      /^## \[([\d.]+)\] - (\d{4}-\d{2}-\d{2})$/
    );
    if (versionMatch) {
      if (currentVersion) {
        versions.push(currentVersion);
      }

      currentVersion = {
        version: versionMatch[1],
        date: versionMatch[2],
        ...createEmptySections(),
        content: [], // 用于存储原始内容，当没有分类时使用
      };
      currentSection = null;
      inVersionContent = true;
      continue;
    }

    // 如果遇到下一个版本或到达文件末尾，停止处理当前版本
    if (inVersionContent && currentVersion) {
      // 匹配章节标题（### 开头）
      if (trimmedLine.startsWith('###')) {
        // 未知标题归入 changed，避免条目被错误地并入上一个章节
        currentSection = resolveSection(trimmedLine) || 'changed';
        continue;
      }

      // 匹配条目: - 内容
      if (trimmedLine.startsWith('- ') && currentSection) {
        const entry = trimmedLine.substring(2);
        currentVersion[currentSection].push(entry);
      } else if (trimmedLine && !trimmedLine.startsWith('#')) {
        currentVersion.content.push(trimmedLine);
      }
    }
  }

  // 添加最后一个版本
  if (currentVersion) {
    versions.push(currentVersion);
  }

  // 后处理：如果某个版本没有分类内容，但有 content，则将 content 放到 changed 中
  versions.forEach((version) => {
    const hasCategories = SECTION_KEYS.some(
      (key) => version[key].length > 0
    );
    if (!hasCategories && version.content.length > 0) {
      version.changed = version.content;
    }
    // 清理 content 字段
    delete version.content;
  });

  return { versions };
}

function generateTypeScript(changelogData) {
  const renderItems = (items, emptyHint) =>
    items.map((entry) => `    "${escapeTsString(entry)}"`).join(',\n') ||
    `      // ${emptyHint}`;

  const entries = changelogData.versions
    .map((version) => {
      const addedEntries = renderItems(version.added, '无新增内容');
      const changedEntries = renderItems(version.changed, '无变更内容');
      const fixedEntries = renderItems(version.fixed, '无修复内容');
      const securityEntries = renderItems(version.security, '无安全修复内容');
      const breakingEntries = renderItems(version.breaking, '无破坏性变更');

      return `  {
    version: "${escapeTsString(version.version)}",
    date: "${escapeTsString(version.date)}",
    added: [
${addedEntries}
    ],
    changed: [
${changedEntries}
    ],
    fixed: [
${fixedEntries}
    ],
    security: [
${securityEntries}
    ],
    breaking: [
${breakingEntries}
    ]
  }`;
    })
    .join(',\n');

  return `// 此文件由 scripts/convert-changelog.js 自动生成
// 请勿手动编辑

export interface ChangelogEntry {
  version: string;
  date: string;
  added: string[];
  changed: string[];
  fixed: string[];
  security: string[];
  breaking: string[];
}

export const changelog: ChangelogEntry[] = [
${entries}
];

export default changelog;
`;
}

function updateVersionFile(version) {
  const versionTxtPath = path.join(process.cwd(), 'VERSION.txt');
  try {
    fs.writeFileSync(versionTxtPath, version, 'utf8');
    console.log(`✅ 已更新 VERSION.txt: ${version}`);
  } catch (error) {
    console.error(`❌ 无法更新 VERSION.txt:`, error.message);
    process.exit(1);
  }
}

function generateVersionTs(version) {
  return `/* eslint-disable no-console */

const CURRENT_VERSION = '${version}';

// 导出当前版本号供其他地方使用
export { CURRENT_VERSION };
`;
}

function convertVersionTxtToTs() {
  const versionTxtPath = path.join(process.cwd(), 'VERSION.txt');
  const versionTsPath = path.join(process.cwd(), 'src/lib/version.ts');
  try {
    const version = fs.readFileSync(versionTxtPath, 'utf8').trim();
    if (!/^[\d.]+$/.test(version)) {
      throw new Error(`VERSION.txt 内容无效: "${version}"`);
    }

    const outputDir = path.dirname(versionTsPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(versionTsPath, generateVersionTs(version), 'utf8');
    console.log(`✅ 已从 VERSION.txt (${version}) 生成 version.ts`);
  } catch (error) {
    console.error(`❌ 转换 VERSION.txt → version.ts 失败:`, error.message);
    process.exit(1);
  }
}

function main() {
  // 独立模式：仅从 VERSION.txt 生成 version.ts
  if (process.argv.includes('--sync-version')) {
    console.log('正在转换 VERSION.txt → version.ts...');
    convertVersionTxtToTs();
    console.log('\n🎉 转换完成!');
    return;
  }

  try {
    const changelogPath = path.join(process.cwd(), 'CHANGELOG');
    const outputPath = path.join(process.cwd(), 'src/lib/changelog.ts');

    console.log('正在读取 CHANGELOG 文件...');
    const changelogContent = fs.readFileSync(changelogPath, 'utf-8');

    console.log('正在解析 CHANGELOG 内容...');
    const changelogData = parseChangelog(changelogContent);

    if (changelogData.versions.length === 0) {
      console.error('❌ 未在 CHANGELOG 中找到任何版本');
      process.exit(1);
    }

    // 获取最新版本号（CHANGELOG中的第一个版本）
    const latestVersion = changelogData.versions[0].version;
    console.log(`🔢 最新版本: ${latestVersion}`);

    console.log('正在生成 TypeScript 文件...');
    const tsContent = generateTypeScript(changelogData);

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, tsContent, 'utf-8');

    // 检查是否在 GitHub Actions 环境中运行
    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

    if (isGitHubActions) {
      // 在 GitHub Actions 中，更新版本文件
      console.log('正在更新版本文件...');
      updateVersionFile(latestVersion);
      convertVersionTxtToTs();
    } else {
      // 在本地运行时，只提示但不更新版本文件
      console.log('🔧 本地运行模式：跳过版本文件更新');
      console.log('💡 版本文件更新将在 git tag 触发的 release 工作流中完成');
      console.log('💡 本地可执行 node scripts/convert-changelog.js --sync-version 从 VERSION.txt 同步 version.ts');
    }

    console.log(`✅ 成功生成 ${outputPath}`);
    console.log(`📊 版本统计:`);
    changelogData.versions.forEach((version) => {
      console.log(
        `   ${version.version} (${version.date}): +${version.added.length} ~${version.changed.length} !${version.fixed.length} 安全${version.security.length} 破坏性${version.breaking.length}`
      );
    });

    console.log('\n🎉 转换完成!');
  } catch (error) {
    console.error('❌ 转换失败:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
