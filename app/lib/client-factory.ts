import { updateStorage } from "~/lib/storage";
import { S3Client } from "~/lib/s3-client";
import { WebdevClient } from "~/lib/webdev-client";
import { OneDriveClient } from "~/lib/onedrive-client";
import { GoogleDriveClient } from "~/lib/gdrive-client";
import { AliyunDriveClient } from "~/lib/alicloud-client";
import { BaiduYunClient } from "~/lib/baiduyun-client";

export type StorageClient =
  | S3Client
  | WebdevClient
  | OneDriveClient
  | GoogleDriveClient
  | AliyunDriveClient
  | BaiduYunClient;

export interface StatefulClient {
  getStateUpdates: () => { config?: Record<string, any>; saving?: Record<string, any> } | null;
}

export interface ClientInput {
  type: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  basePath: string;
  config?: Record<string, any>;
  saving?: Record<string, any>;
}

export function createStorageClient(storage: ClientInput): StorageClient {
  if (storage.type === "webdev") {
    return new WebdevClient({
      endpoint: storage.endpoint,
      username: storage.accessKeyId,
      password: storage.secretAccessKey,
      basePath: storage.basePath,
    });
  }
  if (storage.type === "onedrive") {
    return new OneDriveClient({ config: storage.config, saving: storage.saving });
  }
  if (storage.type === "gdrive") {
    return new GoogleDriveClient({ config: storage.config, saving: storage.saving });
  }
  if (storage.type === "alicloud") {
    return new AliyunDriveClient({ config: storage.config, saving: storage.saving });
  }
  if (storage.type === "baiduyun") {
    return new BaiduYunClient({ config: storage.config, saving: storage.saving });
  }
  return new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
    bucket: storage.bucket,
    basePath: storage.basePath,
  });
}

/** 是否具备任意后端的直接移动能力 */
export function canDirectMove(client: StorageClient): boolean {
  return typeof (client as { moveObject?: (path: string, destPath: string) => Promise<void> }).moveObject === "function";
}

/** 是否具备任意后端的直接重命名能力 */
export function canDirectRename(client: StorageClient): boolean {
  return typeof (client as { renameObject?: (path: string, name: string) => Promise<void> }).renameObject === "function";
}

async function persistClientState(
  client: StorageClient,
  db: D1Database,
  storageId: number
): Promise<void> {
  const stateful = client as unknown as StatefulClient;
  if (typeof stateful.getStateUpdates !== "function") {
    return;
  }
  const updates = stateful.getStateUpdates();
  if (!updates) {
    return;
  }
  const input: { config?: Record<string, any>; saving?: Record<string, any> } = {};
  if (updates.config) {
    input.config = updates.config;
  }
  if (updates.saving) {
    input.saving = updates.saving;
  }
  if (Object.keys(input).length === 0) {
    return;
  }
  await updateStorage(db, storageId, input);
}

/**
 * 执行动作并在此后把（可能被刷新/变更的）存储连接状态持久化回 D1。
 * 状态写入失败不阻断主操作结果，仅记录日志。
 */
export async function withClientState<T>(
  client: StorageClient,
  db: D1Database,
  storageId: number,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } finally {
    try {
      await persistClientState(client, db, storageId);
    } catch (error) {
      console.error("Failed to persist storage state:", error);
    }
  }
}

/**
 * 判断并执行移动：优先用后端的原生 moveObject；否则退化为 copy+delete（非原子，调用方已知晓）。
 */
export async function moveOrCopyDelete(
  client: StorageClient,
  db: D1Database,
  storageId: number,
  sourcePath: string,
  destPath: string
): Promise<void> {
  const mover = (client as { moveObject?: (p: string, d: string) => Promise<void> }).moveObject;
  if (typeof mover === "function") {
    await withClientState(client, db, storageId, () => mover(sourcePath, destPath));
    return;
  }
  await withClientState(client, db, storageId, () => client.copyObject(sourcePath, destPath));
  try {
    await withClientState(client, db, storageId, () => client.deleteObject(sourcePath));
  } catch (error) {
    console.error("MOVE fallback: copy succeeded but delete failed:", error);
    throw error;
  }
}
