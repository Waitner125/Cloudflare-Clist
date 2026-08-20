import { createRequestHandler, type AppLoadContext } from "react-router";
import { handleWebdavRequest } from "../app/routes/dav.$storageId.$";
import { getWebdavConfig } from "../app/lib/webdav-config";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const getServerBuild = () => import("virtual:react-router/server-build");

const requestHandler = createRequestHandler(getServerBuild, import.meta.env.MODE);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 判断 URL 是否命中 WebDAV 端点前缀，提取 storageId 与剩余路径。
 * 形如 `/<prefix>/<storageId>(/<rest>)`，prefix 精确匹配（避免 /dav2 误命中 /dav）。
 */
function matchWebdavPath(
  pathname: string,
  prefix: string
): { storageId: string; "*": string } | null {
  const p = (prefix || "dav").replace(/^\/+|\/+$/g, "");
  if (!p) return null;
  const re = new RegExp(`^/${escapeRegExp(p)}/(\\d+?)(?:/(.*))?$`, "i");
  const m = re.exec(pathname);
  if (!m) return null;
  return {
    storageId: m[1],
    "*": m[2] ? decodeURIComponent(m[2]) : "",
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 形态过滤：仅当路径形如 `/<word>/<digits>`（WebDAV 端点形态）时才去读 DB 配置，
    // 避免对首页 / API / 静态资源 每次请求都额外读一次 D1。
    const looksWebdavShape = /^\/[A-Za-z0-9_\-.]+\/\d+\/?/.test(pathname);
    if (!looksWebdavShape) {
      return requestHandler(request, {
        cloudflare: { env, ctx },
      });
    }

    try {
      const db = env.DB;
      // 读取 WebDAV 配置（启用开关、前缀、base_url）。DB 不可用/未绑定时回退默认 dav。
      const config = db ? await getWebdavConfig(db) : null;
      const configuredPrefix = config?.pathPrefix || "dav";

      // 兼容多种前缀：默认 dav / webdav，以及配置的自定义前缀
      const candidates = [configuredPrefix];
      for (const c of ["dav", "webdav", "wd"]) {
        if (!candidates.includes(c)) candidates.push(c);
      }

      for (const prefix of candidates) {
        const params = matchWebdavPath(pathname, prefix);
        if (params) {
          return handleWebdavRequest(
            request,
            { storageId: params.storageId, "*": params["*"], prefix },
            { cloudflare: { env, ctx } }
          );
        }
      }
    } catch (e) {
      // 配置读取异常时不拦截，交给正常路由
      console.error("WebDAV dispatch config read failed:", e);
    }
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
