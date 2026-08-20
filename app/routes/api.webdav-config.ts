import type { Route } from "./+types/api.webdav-config";
import { requireAuth } from "~/lib/auth";
import { getWebdavConfig, saveWebdavConfig, initWebdavConfig } from "~/lib/webdav-config";
import { getRequestMeta, logAudit } from "~/lib/audit";
import { getAllStorages } from "~/lib/storage";

/**
 * WebDAV 服务配置 API（仅管理员）。
 * GET  - 读取当前配置
 * PUT  - 保存配置（启用开关 / 用户名 / 密码 / 自定义端点前缀 / 自定义访问地址）
 */

function publicConfig(config: {
  enabled: boolean;
  username: string;
  passwordHash: string | null;
  pathPrefix: string;
  baseUrl: string;
}) {
  return {
    enabled: config.enabled,
    username: config.username,
    // 密码不回显明文，仅返回是否已设置
    hasPassword: !!config.passwordHash,
    pathPrefix: config.pathPrefix,
    baseUrl: config.baseUrl,
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  await initWebdavConfig(db);
  const { isAdmin } = await requireAuth(request, db);

  // 非管理员只返回脱敏信息（是否启用 + 前缀），用于前台展示访问地址
  const config = await getWebdavConfig(db);

  if (!isAdmin) {
    return Response.json({
      enabled: config.enabled,
      pathPrefix: config.pathPrefix,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    });
  }

  return Response.json({ ...publicConfig(config) });
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  await initWebdavConfig(db);
  const meta = getRequestMeta(request);

  const method = request.method;
  if (method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { isAdmin } = await requireAuth(request, db);
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: {
    enabled?: boolean;
    username?: string;
    password?: string;
    pathPrefix?: string;
    baseUrl?: string;
  } = {};

  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.username === "string") update.username = body.username;
  if (typeof body.password === "string") update.password = body.password;
  if (typeof body.pathPrefix === "string") update.pathPrefix = body.pathPrefix;
  if (typeof body.baseUrl === "string") update.baseUrl = body.baseUrl;

  try {
    const result = await saveWebdavConfig(db, update);

    // 记录审计
    await logAudit(db, {
      action: "webdav.save",
      userType: "admin",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        enabled: result.enabled,
        pathPrefix: result.pathPrefix,
        baseUrl: result.baseUrl,
        hasCustomCreds: !!result.username,
      },
    });

    // 附带一份存储列表的访问地址（前端展示用）
    const storages = await getAllStorages(db);

    return Response.json({
      ...publicConfig(result),
      storageUrl: storages.map((s) => ({
        id: s.id,
        name: s.name,
        path: `/${result.pathPrefix}/${s.id}/`,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save WebDAV config" },
      { status: 500 }
    );
  }
}
