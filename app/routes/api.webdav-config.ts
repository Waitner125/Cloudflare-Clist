import type { Route } from "./+types/api.webdav-config";
import { requireAuth } from "~/lib/auth";
import { getWebdavConfig, saveWebdavConfig, initWebdavConfig } from "~/lib/webdav-config";
import { getRequestMeta, logAudit } from "~/lib/audit";

/**
 * WebDAV 服务配置 API（仅管理员）。
 * GET  - 读取启用状态 / 用户名（密码不回显）
 * PUT  - 保存配置：启用开关 + 用户名 + 密码（明文，写库前加盐哈希）
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  await initWebdavConfig(db);
  const { isAdmin } = await requireAuth(request, db);
  const config = await getWebdavConfig(db);

  if (!isAdmin) {
    // 非管理员只返回是否启用
    return Response.json({ enabled: config.enabled });
  }
  return Response.json({
    enabled: config.enabled,
    username: config.username,
    hasPassword: !!config.passwordHash,
  });
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  await initWebdavConfig(db);
  const meta = getRequestMeta(request);

  if (request.method !== "PUT") {
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
  } = {};

  if (typeof body.enabled === "boolean") update.enabled = body.enabled;
  if (typeof body.username === "string") update.username = body.username;
  if (typeof body.password === "string") update.password = body.password;

  try {
    const result = await saveWebdavConfig(db, update);

    await logAudit(db, {
      action: "webdav.save",
      userType: "admin",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        enabled: result.enabled,
        username: result.username,
        hasCustomCreds: !!result.username && !!result.passwordHash,
      },
    });

    return Response.json({
      enabled: result.enabled,
      username: result.username,
      hasPassword: !!result.passwordHash,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save WebDAV config" },
      { status: 500 }
    );
  }
}
