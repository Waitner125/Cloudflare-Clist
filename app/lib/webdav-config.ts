/**
 * WebDAV 服务配置的持久化读取/写入与认证辅助。
 * 替代原先从环境变量读取 WEBDAV_ENABLED / WEBDAV_USERNAME / WEBDAV_PASSWORD
 * 的方式，改为在设置页面自定义、存取于 D1 `webdav_config` 表。
 */

export interface WebdavConfigRow {
  id: number;
  enabled: number;
  username: string;
  password_hash: string | null;
  path_prefix: string;
  base_url: string;
  updated_at: string;
}

export interface WebdavConfig {
  enabled: boolean;
  username: string;
  passwordHash: string | null;
  pathPrefix: string;
  baseUrl: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Wrangler/D1 环境中均有 crypto（Web Crypto）。 */
function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * SHA-256(password + ":" + salt) ，返回 `salt$digest`。salt 为 16 字节随机 hex。
 * Workers 无内置 bcrypt/scrypt，故用 SHA-256 + 随机盐。
 */
export async function hashWebdavPassword(password: string): Promise<string> {
  const salt = bytesToHex(randomBytes(16));
  const data = new TextEncoder().encode(`${password}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${salt}$${bytesToHex(new Uint8Array(digest))}`;
}

/** 恒定时间比较两个字符串。 */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/** 校验明文密码是否匹配存储的加盐哈希。 */
export async function verifyWebdavPassword(
  password: string,
  storedHash: string | null
): Promise<boolean> {
  if (!storedHash) return false;
  const idx = storedHash.lastIndexOf("$");
  if (idx <= 0) return false;
  const salt = storedHash.slice(0, idx);
  const expected = storedHash.slice(idx + 1);
  const hash = await hashWithSalt(password, salt);
  return timingSafeEqual(hash, expected);
}

async function hashWithSalt(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

const DDL = `
CREATE TABLE IF NOT EXISTS webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  path_prefix TEXT NOT NULL DEFAULT 'dav',
  base_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
)`;

/** 确保表存在并 seed 默认行（id=1）。 */
export async function initWebdavConfig(db: D1Database): Promise<void> {
  await db.prepare(DDL).run();

  // 若配置文件缺失或配置值为空（兼容旧 schema 未写入行），插入默认单行
  const row = await db.prepare("SELECT id FROM webdav_config WHERE id = 1").first<{ id: number }>();
  if (!row) {
    await db
      .prepare(
        "INSERT INTO webdav_config (id, enabled, username, password_hash, path_prefix, base_url) VALUES (1, 0, '', NULL, 'dav', '')"
      )
      .run();
  }
}

function normalizePrefix(prefix: string): string {
  return (prefix || "dav").replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9_\-.]/g, "") || "dav";
}

function rowToConfig(row: WebdavConfigRow): WebdavConfig {
  return {
    enabled: row.enabled === 1,
    username: row.username || "",
    passwordHash: row.password_hash || null,
    pathPrefix: normalizePrefix(row.path_prefix || "dav"),
    baseUrl: (row.base_url || "").replace(/\/+$/, ""),
  };
}

export async function getWebdavConfig(db: D1Database): Promise<WebdavConfig> {
  await initWebdavConfig(db);
  const row = await db
    .prepare(
      "SELECT id, enabled, username, password_hash, path_prefix, base_url, updated_at FROM webdav_config WHERE id = 1"
    )
    .first<WebdavConfigRow>();
  if (!row) {
    return {
      enabled: false,
      username: "",
      passwordHash: null,
      pathPrefix: "dav",
      baseUrl: "",
    };
  }
  return rowToConfig(row);
}

export interface WebdavConfigUpdate {
  enabled?: boolean;
  username?: string;
  password?: string; // 明文，写库前 hash
  pathPrefix?: string;
  baseUrl?: string;
}

/** 更新配置；提供 password 明文时先 hash。 */
export async function saveWebdavConfig(
  db: D1Database,
  update: WebdavConfigUpdate
): Promise<WebdavConfig> {
  await initWebdavConfig(db);
  const current = await getWebdavConfig(db);

  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (update.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(update.enabled ? 1 : 0);
  }
  if (update.username !== undefined) {
    sets.push("username = ?");
    values.push((update.username || "").trim());
  }
  if (update.password !== undefined && update.password !== "") {
    sets.push("password_hash = ?");
    values.push(await hashWebdavPassword(update.password));
  }
  if (update.pathPrefix !== undefined) {
    sets.push("path_prefix = ?");
    values.push(normalizePrefix(update.pathPrefix) || current.pathPrefix);
  }
  if (update.baseUrl !== undefined) {
    sets.push("base_url = ?");
    values.push((update.baseUrl || "").replace(/^\/+|\/+$/g, ""));
  }

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE webdav_config SET ${sets.join(", ")} WHERE id = 1`).bind(...values).run();

  return getWebdavConfig(db);
}

/** 计算展示用的根端点地址（基于自定义 base_url 或自动 origin）。 */
export function webdavRootPath(pathPrefix: string): string {
  const p = normalizePrefix(pathPrefix);
  return `/${p}/0/`;
}

export function webdavStoragePath(pathPrefix: string, storageId: number): string {
  const p = normalizePrefix(pathPrefix);
  return `/${p}/${storageId}/`;
}
