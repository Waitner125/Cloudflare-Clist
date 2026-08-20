export interface Share {
  id: string;
  storageId: number;
  filePath: string;
  isDirectory: boolean;
  shareToken: string;
  expiresAt: string | null;
  createdAt: string;
  passwordHash: string | null;
}

interface ShareRow {
  id: string;
  storage_id: number;
  file_path: string;
  is_directory: number;
  share_token: string;
  expires_at: string | null;
  created_at: string;
  password_hash: string | null;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 用 crypto 安全的随机数生成 url-safe/base64url 令牌 */
function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * 加盐分享访问密码：`sha256(password + ":" + salt)`，salt 以 `salt$` 前缀内嵌在存储值里。
 * Cloudflare Workers 无内置 bcrypt/scrypt，Web Crypto 提供的是 SHA 族，故用 SHA-256 + 随机盐。
 */
async function hashPassword(password: string, salt?: string): Promise<string> {
  const actualSalt = salt || bytesToHex(randomBytes(16));
  const data = new TextEncoder().encode(`${password}:${actualSalt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `${actualSalt}$${bytesToHex(new Uint8Array(digest))}`;
}

/** 旧版（无盐）SHA-256 hex，兼容历史分享密码 */
async function legacyHashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return bytesToHex(new Uint8Array(digest));
}

/** 恒定时间比较两个字符串（避免时序侧信道泄露逐字节差异） */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

function generateRandomToken(length: number = 32): string {
  // 用 crypto 安全随机字节生成 base64url 令牌（无 fill 字符）
  const bytes = randomBytes(length);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateShareId(): string {
  return `share_${Date.now().toString(36)}_${bytesToHex(randomBytes(9))}`;
}

function validateShareToken(shareToken: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shareToken)) {
    throw new Error("分享令牌只能包含字母、数字、下划线或短横线，长度 1-64 位");
  }
}

function rowToShare(row: ShareRow): Share | null {
  if (!row) return null;
  // 过期检查
  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at);
    if (expiresAt < new Date()) {
      return null;
    }
  }
  return {
    id: row.id,
    storageId: row.storage_id,
    filePath: row.file_path,
    isDirectory: row.is_directory === 1,
    shareToken: row.share_token,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

export async function shareTokenExists(db: D1Database, shareToken: string): Promise<boolean> {
  const result = await db
    .prepare(`SELECT id FROM shares WHERE share_token = ? LIMIT 1`)
    .bind(shareToken)
    .first<{ id: string }>();

  return result !== null;
}

export async function createShare(
  db: D1Database,
  storageId: number,
  filePath: string,
  isDirectory: boolean,
  expiresAt?: string,
  customShareToken?: string,
  password?: string
): Promise<Share> {
  const id = generateShareId();
  const shareToken = customShareToken?.trim() || generateRandomToken();
  const createdAt = new Date().toISOString();
  const passwordHash = password && password.trim() ? await hashPassword(password.trim()) : null;

  validateShareToken(shareToken);
  if (await shareTokenExists(db, shareToken)) {
    throw new Error("分享令牌已存在，请换一个");
  }

  const query = `
    INSERT INTO shares (id, storage_id, file_path, is_directory, share_token, expires_at, created_at, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await db.prepare(query).bind(id, storageId, filePath, isDirectory ? 1 : 0, shareToken, expiresAt || null, createdAt, passwordHash).run();

  return {
    id,
    storageId,
    filePath,
    isDirectory,
    shareToken,
    expiresAt: expiresAt || null,
    createdAt,
    passwordHash,
  };
}

export async function getShareByToken(db: D1Database, token: string): Promise<Share | null> {
  const result = await db.prepare(`SELECT * FROM shares WHERE share_token = ?`).bind(token).first<ShareRow>();
  if (!result) return null;
  return rowToShare(result);
}

export async function getShareById(db: D1Database, id: string): Promise<Share | null> {
  const result = await db.prepare(`SELECT * FROM shares WHERE id = ?`).bind(id).first<ShareRow>();
  if (!result) return null;
  return rowToShare(result);
}

export async function getAllShares(db: D1Database, storageId?: number): Promise<Share[]> {
  let query = `SELECT * FROM shares WHERE 1=1`;
  const bindings: (string | number)[] = [];

  if (storageId !== undefined) {
    query += ` AND storage_id = ?`;
    bindings.push(storageId);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await db.prepare(query).bind(...bindings).all<ShareRow>();

  return (result.results || []).map((row) => rowToShare(row)).filter((s): s is Share => s !== null);
}

/** 校验访问密码：分享未设密码时返回 true；否则恒定时间比对加盐哈希 */
export async function verifySharePassword(
  db: D1Database,
  token: string,
  password?: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT password_hash FROM shares WHERE share_token = ?`)
    .bind(token)
    .first<{ password_hash: string | null }>();

  if (!row) return false;
  if (!row.password_hash) return true; // 未设密码
  if (!password) return false;

  // 兼容旧版无盐哈希（不含 "$"），新存储值形如 "salt$digest"
  const stored = row.password_hash;
  const saltIndex = stored.lastIndexOf("$");
  if (saltIndex > 0) {
    // 新格式：加盐
    const salt = stored.slice(0, saltIndex);
    const expectedDigest = stored.slice(saltIndex + 1);
    const hash = await hashPassword(password, salt);
    const computedDigest = hash.slice(hash.indexOf("$") + 1);
    return timingSafeEqual(computedDigest, expectedDigest);
  }
  // 旧格式：无盐直接 SHA-256
  const legacy = await legacyHashPassword(password);
  return timingSafeEqual(legacy, stored);
}

export async function deleteShare(db: D1Database, id: string): Promise<void> {
  const query = `DELETE FROM shares WHERE id = ?`;
  await db.prepare(query).bind(id).run();
}

export async function cleanExpiredShares(db: D1Database): Promise<void> {
  const query = `DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < datetime('now')`;
  await db.prepare(query).run();
}
