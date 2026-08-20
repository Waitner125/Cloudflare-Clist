import type { Route } from "./+types/dav.$storageId.$";
import { getStorageById, getAllStorages, initDatabase } from "~/lib/storage";
import { createStorageClient, withClientState, moveOrCopyDelete } from "~/lib/client-factory";

// WebDAV server endpoint - provides WebDAV access to storages

function generatePropfindResponse(
  objects: Array<{ key: string; name: string; size: number; lastModified: string; isDirectory: boolean }>,
  requestPath: string,
  baseUrl: string
): string {
  const xmlResponses: string[] = [];
  const joinHref = (...parts: string[]) => {
    const path = parts
      .map((part, index) => index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, ""))
      .filter(Boolean)
      .join("/");
    return path || "/";
  };
  const collectionHref = (href: string) => href.endsWith("/") ? href : `${href}/`;

  // Add the current directory itself
  const currentHref = joinHref(baseUrl, requestPath);
  xmlResponses.push(`
    <D:response>
      <D:href>${escapeXml(collectionHref(currentHref))}</D:href>
      <D:propstat>
        <D:prop>
          <D:resourcetype><D:collection/></D:resourcetype>
          <D:displayname>${escapeXml(requestPath.split("/").pop() || "root")}</D:displayname>
          <D:getlastmodified>${new Date().toUTCString()}</D:getlastmodified>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`);

  for (const obj of objects) {
    const href = joinHref(baseUrl, obj.key || joinHref(requestPath, obj.name));
    
    if (obj.isDirectory) {
      xmlResponses.push(`
    <D:response>
      <D:href>${escapeXml(collectionHref(href))}</D:href>
      <D:propstat>
        <D:prop>
          <D:resourcetype><D:collection/></D:resourcetype>
          <D:displayname>${escapeXml(obj.name)}</D:displayname>
          <D:getlastmodified>${obj.lastModified ? new Date(obj.lastModified).toUTCString() : new Date().toUTCString()}</D:getlastmodified>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`);
    } else {
      xmlResponses.push(`
    <D:response>
      <D:href>${escapeXml(href)}</D:href>
      <D:propstat>
        <D:prop>
          <D:resourcetype/>
          <D:displayname>${escapeXml(obj.name)}</D:displayname>
          <D:getcontentlength>${obj.size}</D:getcontentlength>
          <D:getlastmodified>${obj.lastModified ? new Date(obj.lastModified).toUTCString() : new Date().toUTCString()}</D:getlastmodified>
          <D:getcontenttype>${getContentType(obj.name)}</D:getcontenttype>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`);
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">${xmlResponses.join("")}
</D:multistatus>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    xml: "application/xml",
    txt: "text/plain",
    md: "text/markdown",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * 从 WebDAV Destination 头解析出本存储内的目标路径。
 * - 只接受与当前请求同源、且路径前缀与本存储 (`/dav/{storageId}/`) 一致的地址，
 *   防止跨存储 / 绝对路径逃离当前存储。
 * - 返回的目标路径不含前导斜杠（与 CList 内部 key 约定一致）。
 */
function parseDavDestination(
  destinationHeader: string,
  request: Request,
  storageId: number
): string | null {
  let destUrl: URL;
  try {
    destUrl = new URL(destinationHeader);
  } catch {
    return null;
  }

  const reqUrl = new URL(request.url);
  // 主机必须一致（拒绝指向其它站点/内网的绝对地址）
  if (destUrl.origin !== reqUrl.origin) {
    return null;
  }

  const prefix = `/dav/${storageId}/`;
  if (!destUrl.pathname.startsWith(prefix)) {
    // 若目标不是当前存储的 URL（例如 /dav/其他id/ 或根路径），拒绝
    return null;
  }

  let destPath = decodeURIComponent(destUrl.pathname.slice(prefix.length));
  // 规范化：去掉前后斜杠，避免目标逃逸或产生 `//` 路径
  destPath = destPath.replace(/^\/+|\/+$/g, "");
  return destPath || null;
}

// Validate Basic Auth credentials
async function validateWebdavAuth(
  request: Request,
  env: { WEBDAV_USERNAME?: string; WEBDAV_PASSWORD?: string; ADMIN_USERNAME?: string; ADMIN_PASSWORD?: string }
): Promise<boolean> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  try {
    const credentials = atob(authHeader.slice(6));
    const [username, password] = credentials.split(":");

    // 优先用独立的 WebDAV 凭据；若未单独配置则回退到明确配置的 ADMIN 凭据。
    // 任何回退都必须是“显式配置”的值——绝不回退到硬编码弱口令。
    const webdavUsername = env.WEBDAV_USERNAME?.trim();
    const webdavPassword = env.WEBDAV_PASSWORD?.trim();
    if (webdavUsername && webdavPassword) {
      return username === webdavUsername && password === webdavPassword;
    }
    const adminUsername = env.ADMIN_USERNAME?.trim();
    const adminPassword = env.ADMIN_PASSWORD?.trim();
    if (adminUsername && adminPassword) {
      return username === adminUsername && password === adminPassword;
    }
    // 没有任何已配置凭据时，拒绝所有请求（fail-closed）
    return false;
  } catch {
    return false;
  }
}

function createUnauthorizedResponse(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="CList WebDAV"',
      "Content-Type": "text/plain",
    },
  });
}

// Unified WebDAV request handler
export async function handleWebdavRequest(
  request: Request,
  params: { storageId?: string; "*"?: string },
  context: any
): Promise<Response> {
  const method = request.method.toUpperCase();

  // Handle OPTIONS for WebDAV discovery
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        DAV: "1, 2",
        Allow: "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE",
        "MS-Author-Via": "DAV",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, Destination, Overwrite",
      },
    });
  }

  const db = context.cloudflare.env.DB;
  const env = context.cloudflare.env as {
    WEBDAV_ENABLED?: string;
    WEBDAV_USERNAME?: string;
    WEBDAV_PASSWORD?: string;
    ADMIN_USERNAME?: string;
    ADMIN_PASSWORD?: string;
  };

  // Check if WebDAV is enabled
  if (env.WEBDAV_ENABLED !== "true") {
    return new Response("WebDAV is disabled", { status: 403 });
  }

  // Validate authentication
  const isAuthenticated = await validateWebdavAuth(request, env);
  if (!isAuthenticated) {
    return createUnauthorizedResponse();
  }

  await initDatabase(db);

  const storageId = parseInt(params.storageId || "0", 10);
  const path = params["*"] || "";

  // Handle listing all storages at the root
  if (storageId === 0) {
    if (method === "PROPFIND") {
      const storages = await getAllStorages(db);
      const url = new URL(request.url);
      const baseUrl = url.pathname.replace(/\/$/, "");

      const xmlResponses: string[] = [];

      // Root collection
      xmlResponses.push(`
    <D:response>
      <D:href>${escapeXml(baseUrl + "/")}</D:href>
      <D:propstat>
        <D:prop>
          <D:resourcetype><D:collection/></D:resourcetype>
          <D:displayname>CList Storages</D:displayname>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`);

      // Each storage as a folder
      for (const storage of storages) {
        xmlResponses.push(`
    <D:response>
      <D:href>${escapeXml(baseUrl.replace(/\/0$/, "") + "/" + storage.id + "/")}</D:href>
      <D:propstat>
        <D:prop>
          <D:resourcetype><D:collection/></D:resourcetype>
          <D:displayname>${escapeXml(storage.name)}</D:displayname>
        </D:prop>
        <D:status>HTTP/1.1 200 OK</D:status>
      </D:propstat>
    </D:response>`);
      }

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">${xmlResponses.join("")}
</D:multistatus>`;

      return new Response(xml, {
        status: 207,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "DAV": "1, 2",
        },
      });
    }

    // Root doesn't support modification
    if (["PUT", "DELETE", "MKCOL", "COPY", "MOVE"].includes(method)) {
      return new Response("Cannot modify root", { status: 403 });
    }

    return new Response("Method not allowed", { status: 405 });
  }

  const storage = await getStorageById(db, storageId);
  if (!storage) {
    return new Response("Storage not found", { status: 404 });
  }

  const client = createStorageClient(storage);
  const url = new URL(request.url);
  const baseUrl = `/dav/${storageId}`;

  // Handle modification methods
  if (["PUT", "DELETE", "MKCOL", "COPY", "MOVE"].includes(method)) {
    // PUT - Upload file
    if (method === "PUT") {
      try {
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const bodyBuffer = await request.arrayBuffer();
        await withClientState(client, db, storageId, () => client.putObject(path, bodyBuffer, contentType));
        return new Response(null, { status: 201 });
      } catch (error) {
        console.error("PUT error:", error);
        return new Response("Failed to upload file", { status: 500 });
      }
    }

    // DELETE - Delete file or folder
    if (method === "DELETE") {
      try {
        await withClientState(client, db, storageId, () => client.deleteObject(path));
        return new Response(null, { status: 204 });
      } catch (error) {
        console.error("DELETE error:", error);
        return new Response("Failed to delete", { status: 500 });
      }
    }

    // MKCOL - Create directory
    if (method === "MKCOL") {
      try {
        await withClientState(client, db, storageId, () => client.createFolder(path));
        return new Response(null, { status: 201 });
      } catch (error) {
        console.error("MKCOL error:", error);
        try {
          await withClientState(client, db, storageId, () => client.listObjects(path));
          return new Response(null, { status: 204 });
        } catch {
          return new Response("Failed to create directory", { status: 500 });
        }
      }
    }

    // COPY - Copy file
    if (method === "COPY") {
      try {
        const destinationHeader = request.headers.get("Destination");
        if (!destinationHeader) {
          return new Response("Destination header required", { status: 400 });
        }

        const destUrlOk = parseDavDestination(destinationHeader, request, storageId);
        if (destUrlOk === null) {
          return new Response("Invalid or unsafe Destination header", { status: 400 });
        }
        const destPath = destUrlOk;

        await withClientState(client, db, storageId, () => client.copyObject(path, destPath));
        return new Response(null, { status: 201 });
      } catch (error) {
        console.error("COPY error:", error);
        return new Response("Failed to copy", { status: 500 });
      }
    }

    // MOVE - Move file
    if (method === "MOVE") {
      try {
        const destinationHeader = request.headers.get("Destination");
        if (!destinationHeader) {
          return new Response("Destination header required", { status: 400 });
        }

        const destUrlOk2 = parseDavDestination(destinationHeader, request, storageId);
        if (destUrlOk2 === null) {
          return new Response("Invalid or unsafe Destination header", { status: 400 });
        }
        const destPath = destUrlOk2;

        await moveOrCopyDelete(client, db, storageId, path, destPath);
        return new Response(null, { status: 201 });
      } catch (error) {
        console.error("MOVE error:", error);
        return new Response("Failed to move", { status: 500 });
      }
    }
  }

  // PROPFIND - List directory contents
  if (method === "PROPFIND") {
    try {
      const result = await withClientState(client, db, storageId, () => client.listObjects(path));
      const xml = generatePropfindResponse(result.objects, path, baseUrl);
      return new Response(xml, {
        status: 207,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "DAV": "1, 2",
        },
      });
    } catch (error) {
      console.error("PROPFIND error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // GET - Download file
  if (method === "GET" || method === "HEAD") {
    try {
      // Check if it's a directory
      if (path.endsWith("/") || path === "") {
        // Return a simple HTML directory listing for browser access
        const result = await withClientState(client, db, storageId, () => client.listObjects(path));
        const html = `<!DOCTYPE html>
<html>
<head><title>Index of ${path || "/"}</title></head>
<body>
<h1>Index of ${path || "/"}</h1>
<ul>
${path ? `<li><a href="../">../</a></li>` : ""}
${result.objects.map(obj => 
  obj.isDirectory 
    ? `<li><a href="${encodeURIComponent(obj.name)}/">${obj.name}/</a></li>`
    : `<li><a href="${encodeURIComponent(obj.name)}">${obj.name}</a> (${obj.size} bytes)</li>`
).join("\n")}
</ul>
</body>
</html>`;
        return new Response(html, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const response = await withClientState(client, db, storageId, () => client.getObject(path));
      const contentType = response.headers.get("content-type") || getContentType(path);
      const contentLength = response.headers.get("content-length");

      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            ...(contentLength ? { "Content-Length": contentLength } : {}),
          },
        });
      }

      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          ...(contentLength ? { "Content-Length": contentLength } : {}),
        },
      });
    } catch (error) {
      console.error("GET error:", error);
      return new Response("Not Found", { status: 404 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}

// Handle all WebDAV methods via loader for GET, PROPFIND, etc.
export async function loader({ request, params, context }: Route.LoaderArgs) {
  return handleWebdavRequest(request, params, context);
}

// Handle modification methods via action
export async function action({ request, params, context }: Route.ActionArgs) {
  return handleWebdavRequest(request, params, context);
}
