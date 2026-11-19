import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let pool;

function config(includeDatabase = true) {
  const dbName = process.env.DB_NAME || 'codesync';
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error('DB_NAME may contain only letters, numbers, and underscores');
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ...(includeDatabase ? { database: dbName } : {})
  };
}

export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config(),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: false,
      charset: 'utf8mb4'
    });
  }
  return pool;
}

export function query(sql, values = []) {
  return getPool().query(sql, values);
}

export async function transaction(run) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await run(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function initSchema() {
  const dbName = process.env.DB_NAME || 'codesync';
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error('DB_NAME may contain only letters, numbers, and underscores');
  const admin = await mysql.createConnection({ ...config(false), multipleStatements: false });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await admin.end();
  }
  const schemaPath = fileURLToPath(new URL('../sql/schema.sql', import.meta.url));
  const source = await readFile(schemaPath, 'utf8');
  for (const statement of source.split(';').map((part) => part.trim()).filter(Boolean)) {
    await query(statement);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--init')) {
  try {
    await initSchema();
    console.log('Database schema initialized.');
  } catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await getPool().end().catch(() => {});
  }
}
