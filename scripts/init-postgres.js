/**
 * Vercel Postgres 数据库初始化脚本
 *
 * 创建数据库表结构并初始化默认管理员用户
 */

const { sql } = require('@vercel/postgres');
const crypto = require('crypto');

// SHA-256 加密密码
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

console.log('📦 Initializing Vercel Postgres database...');

// 读取迁移脚本
const fs = require('fs');
const path = require('path');

// 获取所有迁移文件
const migrationsDir = path.join(__dirname, '../migrations/postgres');
if (!fs.existsSync(migrationsDir)) {
  console.error('❌ Migrations directory not found:', migrationsDir);
  process.exit(1);
}

// 读取并排序所有 .sql 文件
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(file => file.endsWith('.sql'))
  .sort(); // 按文件名排序，确保按顺序执行

if (migrationFiles.length === 0) {
  console.error('❌ No migration files found in:', migrationsDir);
  process.exit(1);
}

console.log(`📄 Found ${migrationFiles.length} migration file(s):`, migrationFiles.join(', '));

/**
 * 改进的 SQL 语句分割器
 * 处理 SQL 内部的分号（字符串、注释中）
 */
function splitSqlStatements(sqlContent) {
  const statements = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inCommentLine = false;
  let inCommentBlock = false;
  let i = 0;

  while (i < sqlContent.length) {
    const char = sqlContent[i];
    const nextChar = sqlContent[i + 1];

    // 处理单行注释
    if (!inString && !inCommentBlock && char === '-' && nextChar === '-') {
      inCommentLine = true;
      i += 2;
      continue;
    }

    // 单行注释结束
    if (inCommentLine && char === '\n') {
      inCommentLine = false;
    }

    // 跳过单行注释内容
    if (inCommentLine) {
      i++;
      continue;
    }

    // 处理多行注释
    if (!inString && char === '/' && nextChar === '*') {
      inCommentBlock = true;
      i += 2;
      continue;
    }

    // 多行注释结束
    if (inCommentBlock && char === '*' && nextChar === '/') {
      inCommentBlock = false;
      i += 2;
      continue;
    }

    // 跳过多行注释内容
    if (inCommentBlock) {
      i++;
      continue;
    }

    // 处理字符串
    if (!inCommentLine && !inCommentBlock && (char === "'" || char === '"')) {
      // 检查是否为转义字符
      let escapeCount = 0;
      let j = current.length - 1;
      while (j >= 0 && current[j] === '\\') {
        escapeCount++;
        j--;
      }

      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (char === stringChar && escapeCount % 2 === 0) {
        inString = false;
        stringChar = '';
      }
    }

    // 分割语句
    if (char === ';' && !inString) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }

    i++;
  }

  // 处理最后一个语句（如果没有分号）
  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

/**
 * 执行带回滚的迁移
 */
async function migrateWithRollback(migrationFile, statements) {
  const executedStatements = [];

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    try {
      console.log(`    📝 Executing statement ${i + 1}/${statements.length}`);
      await sql.query(statement);
      executedStatements.push(statement);
    } catch (err) {
      console.error(`    ❌ Statement ${i + 1} failed:`, err.message);

      // 回滚已执行的语句
      console.log('    🔄 Rolling back executed statements...');
      for (let j = executedStatements.length - 1; j >= 0; j--) {
        try {
          const rollbackStmt = executedStatements[j];
          // 生成回滚语句（简化版：只处理 DROP TABLE）
          if (rollbackStmt.match(/^\s*CREATE\s+TABLE/i)) {
            const tableMatch = rollbackStmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/i);
            if (tableMatch && tableMatch[1]) {
              const tableName = tableMatch[1];
              console.log(`    🗑️ Dropping table: ${tableName}`);
              await sql.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
            }
          }
        } catch (rollbackErr) {
          console.error(`    ⚠️ Rollback statement ${j + 1} failed:`, rollbackErr.message);
        }
      }

      throw new Error(`Migration ${migrationFile} failed at statement ${i + 1}: ${err.message}`);
    }
  }
}

async function init() {
  try {
    // 执行所有迁移脚本
    console.log('🔧 Running database migrations...');

    for (const migrationFile of migrationFiles) {
      const sqlPath = path.join(migrationsDir, migrationFile);
      console.log(`  ⏳ Executing ${migrationFile}...`);

      const schemaSql = fs.readFileSync(sqlPath, 'utf8');

      // 使用改进的分割器
      const statements = splitSqlStatements(schemaSql);

      if (statements.length === 0) {
        console.log(`  ⚠️ No statements found in ${migrationFile}, skipping`);
        continue;
      }

      console.log(`  📝 Found ${statements.length} statement(s)`);

      // 执行带回滚的迁移
      await migrateWithRollback(migrationFile, statements);

      console.log(`  ✅ ${migrationFile} executed successfully`);
    }

    console.log('✅ All migrations completed successfully!');

    // 创建默认管理员用户
    const username = process.env.USERNAME || 'admin';
    const password = process.env.PASSWORD || '123456789';
    const passwordHash = hashPassword(password);

    console.log('👤 Creating default admin user...');
    await sql`
      INSERT INTO users (username, password_hash, role, created_at, playrecord_migrated, favorite_migrated, skip_migrated)
      VALUES (${username}, ${passwordHash}, 'owner', ${Date.now()}, 1, 1, 1)
      ON CONFLICT (username) DO NOTHING
    `;
    console.log(`✅ Default admin user created: ${username}`);

    console.log('');
    console.log('🎉 Vercel Postgres database initialized successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Set NEXT_PUBLIC_STORAGE_TYPE=postgres in .env');
    console.log('2. Set POSTGRES_URL environment variable');
    console.log('3. Run: npm run dev');
  } catch (err) {
    console.error('❌ Initialization failed:', err.message);
    console.error('💡 Please check your database connection and migration files.');
    process.exit(1);
  }
}

init();
