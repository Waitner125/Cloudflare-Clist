/**
 * WebDAV 服务配置（启用开关 / 用户名 / 密码）的持久化读写。
 * 替代原先从环境变量读取 WEBDAV_ENABLED / WEBDAV_USERNAME / WEBDAV_PASSWORD，
 * 让管理员在项目“设置 → WebDAV 服务”页面自定义，存于 D1 `webdav_config` 表。
 */

export interface WebdavConfigRow {
  id: number;
  enabled: number;
  username: string;
  password_hash: string | null;
  updated_at: string;
}

export interface WebdavConfig {
  enabled: boolean;
  username: string;
  passwordHash: string | null;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * SHA-256(password + ":" + salt) ，返回 `salt$digest`（16 字节随机盐）。
 * Workers 无内置 bcrypt/scrypt，故用 SHA-256 + 随机盐。
 */
export async function hashWebdavPassword(password: string): Promise<string> {
  const salt = bytesToHex(randomBytes(16));
  const data = new TextEncoder().encode(`${password}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${salt}$${bytesToHex(new Uint8Array(digest))}`;
}

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
  const data = new TextEncoder().encode(`${password}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const computed = bytesToHex(new Uint8Array(digest));
  return timingSafeEqual(computed, expected);
}

const DDL = `
CREATE TABLE IF NOT EXISTS webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
)`;

/** 确保表存在并 seed 默认单行（id=1，默认关闭）。 */
export async function initWebdavConfig(db: D1Database): Promise<void> {
  const g = globalThis as unknown as { __clist_wd_ready?: boolean };
  if (g.__clist_wd_ready) {
    return;
  }
  await db.prepare(DDL).run();
  const row = await db.prepare("SELECT id FROM webdav_config WHERE id = 1").first<{ id: number }>();
  if (!row) {
    await db
      .prepare(
        "INSERT INTO webdav_config (id, enabled, username, password_hash) VALUES (1, 0, '', NULL)"
      )
      .run();
  }
  g.__clist_wd_ready = true;
}

export async function getWebdavConfig(db: D1Database): Promise<WebdavConfig> {
  await initWebdavConfig(db);
  const row = await db
    .prepare("SELECT id, enabled, username, password_hash, updated_at FROM webdav_config WHERE id = 1")
    .first<WebdavConfigRow>();
  if (!row) {
    return { enabled: false, username: "", passwordHash: null };
  }
  return {
    enabled: row.enabled === 1,
    username: row.username || "",
    passwordHash: row.password_hash || null,
  };
}

export interface WebdavConfigUpdate {
  enabled?: boolean;
  username?: string;
  password?: string; // 明文，写库前 hash；空串表示不修改密码
}

export async function saveWebdavConfig(
  db: D1Database,
  update: WebdavConfigUpdate
): Promise<WebdavConfig> {
  await initWebdavConfig(db);

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

  sets.push("updated_at = datetime('now')");
  await db.prepare(`UPDATE webdav_config SET ${sets.join(", ")} WHERE id = 1`).bind(...values).run();

  return getWebdavConfig(db);
}
