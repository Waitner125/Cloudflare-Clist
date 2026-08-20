import { createRequestHandler, type AppLoadContext } from "react-router";
import { handleWebdavRequest } from "../app/routes/dav.$storageId.$";

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

function getWebdavParams(request: Request): { storageId: string; "*": string } | null {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/dav\/([^/]+)\/?(.*)$/);
  if (!match) {
    return null;
  }
  return {
    storageId: match[1],
    "*": match[2] || "",
  };
}

export default {
  async fetch(request, env, ctx) {
    const webdavParams = getWebdavParams(request);
    if (webdavParams) {
      // 直接调用路由模块导出的纯处理函数，避免依赖构建产物内部结构
      return handleWebdavRequest(request, webdavParams, {
        cloudflare: { env, ctx },
      });
    }

    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
