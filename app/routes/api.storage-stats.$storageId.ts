import type { Route } from "./+types/api.storage-stats.$storageId";
import { requireAuth } from "~/lib/auth";
import { getStorageById, initDatabase } from "~/lib/storage";
import { S3Client } from "~/lib/s3-client";
import { WebdevClient } from "~/lib/webdev-client";
import { getFileExtension } from "~/lib/file-utils";

interface StorageStats {
  totalSize: number;
  fileCount: number;
  folderCount: number;
  typeDistribution: Record<string, { count: number; size: number }>;
}

async function collectS3Stats(
  client: S3Client,
  prefix: string = ""
): Promise<StorageStats> {
  const stats: StorageStats = {
    totalSize: 0,
    fileCount: 0,
    folderCount: 0,
    typeDistribution: {},
  };

  const queue: string[] = [prefix];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentPrefix = queue.shift()!;

    if (visited.has(currentPrefix)) {
      continue;
    }
    visited.add(currentPrefix);

    try {
      const result = await client.listObjects(currentPrefix, "/", 1000);

      // Process files
      for (const obj of result.objects) {
        if (!obj.isDirectory) {
          stats.fileCount++;
          stats.totalSize += obj.size;

          const ext = getFileExtension(obj.name).toLowerCase() || "no-extension";
          if (!stats.typeDistribution[ext]) {
            stats.typeDistribution[ext] = { count: 0, size: 0 };
          }
          stats.typeDistribution[ext].count++;
          stats.typeDistribution[ext].size += obj.size;
        }
      }

      // Process directories
      for (const prefixPath of result.prefixes) {
        stats.folderCount++;
        queue.push(prefixPath);
      }

      // Handle pagination
      if (result.isTruncated && result.nextContinuationToken) {
        let continuationToken = result.nextContinuationToken;
        while (continuationToken) {
          const nextResult = await client.listObjects(
            currentPrefix,
            "/",
            1000,
            continuationToken
          );

          for (const obj of nextResult.objects) {
            if (!obj.isDirectory) {
              stats.fileCount++;
              stats.totalSize += obj.size;

              const ext = getFileExtension(obj.name).toLowerCase() || "no-extension";
              if (!stats.typeDistribution[ext]) {
                stats.typeDistribution[ext] = { count: 0, size: 0 };
              }
              stats.typeDistribution[ext].count++;
              stats.typeDistribution[ext].size += obj.size;
            }
          }

          for (const prefixPath of nextResult.prefixes) {
            stats.folderCount++;
            queue.push(prefixPath);
          }

          continuationToken = nextResult.isTruncated
            ? nextResult.nextContinuationToken
            : undefined;
        }
      }
    } catch (error) {
      console.error(`Error listing objects at ${currentPrefix}:`, error);
      throw error;
    }
  }

  return stats;
}

async function collectWebDAVStats(
  client: WebdevClient,
  prefix: string = ""
): Promise<StorageStats> {
  const stats: StorageStats = {
    totalSize: 0,
    fileCount: 0,
    folderCount: 0,
    typeDistribution: {},
  };

  const queue: string[] = [prefix];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentPrefix = queue.shift()!;

    if (visited.has(currentPrefix)) {
      continue;
    }
    visited.add(currentPrefix);

    try {
      const result = await client.listObjects(currentPrefix, "/", 1000);

      // Process files
      for (const obj of result.objects) {
        if (!obj.isDirectory) {
          stats.fileCount++;
          stats.totalSize += obj.size;

          const ext = getFileExtension(obj.name).toLowerCase() || "no-extension";
          if (!stats.typeDistribution[ext]) {
            stats.typeDistribution[ext] = { count: 0, size: 0 };
          }
          stats.typeDistribution[ext].count++;
          stats.typeDistribution[ext].size += obj.size;
        }
      }

      // Process directories
      for (const prefixPath of result.prefixes) {
        stats.folderCount++;
        queue.push(prefixPath);
      }

      // Handle pagination
      if (result.isTruncated && result.nextContinuationToken) {
        let continuationToken = result.nextContinuationToken;
        while (continuationToken) {
          const nextResult = await client.listObjects(
            currentPrefix,
            "/",
            1000,
            continuationToken
          );

          for (const obj of nextResult.objects) {
            if (!obj.isDirectory) {
              stats.fileCount++;
              stats.totalSize += obj.size;

              const ext = getFileExtension(obj.name).toLowerCase() || "no-extension";
              if (!stats.typeDistribution[ext]) {
                stats.typeDistribution[ext] = { count: 0, size: 0 };
              }
              stats.typeDistribution[ext].count++;
              stats.typeDistribution[ext].size += obj.size;
            }
          }

          for (const prefixPath of nextResult.prefixes) {
            stats.folderCount++;
            queue.push(prefixPath);
          }

          continuationToken = nextResult.isTruncated
            ? nextResult.nextContinuationToken
            : undefined;
        }
      }
    } catch (error) {
      console.error(`Error listing objects at ${currentPrefix}:`, error);
      throw error;
    }
  }

  return stats;
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  await initDatabase(db);

  // Require admin authentication
  const { isAdmin } = await requireAuth(request, db, "admin");
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const storageId = parseInt(params.storageId, 10);
  if (!storageId) {
    return Response.json({ error: "Invalid storage ID" }, { status: 400 });
  }

  try {
    const storage = await getStorageById(db, storageId);
    if (!storage) {
      return Response.json({ error: "Storage not found" }, { status: 404 });
    }

    let stats: StorageStats;

    if (storage.type === "webdev") {
      const client = new WebdevClient({
        endpoint: storage.endpoint,
        username: storage.accessKeyId,
        password: storage.secretAccessKey,
        basePath: storage.basePath,
      });
      stats = await collectWebDAVStats(client);
    } else {
      // Default to S3
      const client = new S3Client({
        endpoint: storage.endpoint,
        region: storage.region,
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        bucket: storage.bucket,
        basePath: storage.basePath,
      });
      stats = await collectS3Stats(client);
    }

    return Response.json({ stats });
  } catch (error) {
    console.error("Error collecting storage stats:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to collect storage statistics",
      },
      { status: 500 }
    );
  }
}
