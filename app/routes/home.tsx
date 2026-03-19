import type { Route } from "./+types/home";
import { requireAuth } from "~/lib/auth";
import { getAllStorages, getPublicStorages, initDatabase } from "~/lib/storage";
import { useState, useEffect, useCallback } from "react";
import { FilePreview } from "~/components/FilePreview";
import { getFileType, isPreviewable } from "~/lib/file-utils";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.siteTitle || "CList";
  return [
    { title: `${title} - 存储聚合` },
    { name: "description", content: "S3 兼容存储聚合服务" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const siteTitle = context.cloudflare.env.SITE_TITLE || "CList";
  const siteAnnouncement = context.cloudflare.env.SITE_ANNOUNCEMENT || "";
  const chunkSizeMB = parseInt(context.cloudflare.env.CHUNK_SIZE_MB || "50", 10);
  const webdavEnabled = (context.cloudflare.env.WEBDAV_ENABLED as string) === "true";

  if (!db) {
    console.error("D1 Database not bound");
    return { isAdmin: false, storages: [], siteTitle, siteAnnouncement, chunkSizeMB, webdavEnabled: false };
  }

  await initDatabase(db);

  const { isAdmin } = await requireAuth(request, db);

  const storages = isAdmin
    ? await getAllStorages(db)
    : await getPublicStorages(db);

  return {
    isAdmin,
    siteTitle,
    siteAnnouncement,
    chunkSizeMB,
    webdavEnabled,
    storages: storages.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      endpoint: s.endpoint,
      region: s.region,
      accessKeyId: s.accessKeyId,
      bucket: s.bucket,
      basePath: s.basePath,
      config: isAdmin ? s.config : undefined,
      isPublic: s.isPublic,
      guestList: s.guestList,
      guestDownload: s.guestDownload,
      guestUpload: s.guestUpload,
    })),
  };
}

interface S3Object {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

interface StorageInfo {
  id: number;
  name: string;
  type?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  bucket?: string;
  basePath?: string;
  config?: Record<string, any>;
  isPublic: boolean;
  guestList: boolean;
  guestDownload: boolean;
  guestUpload: boolean;
}

type ConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "textarea" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
  show?: (values: Record<string, any>) => boolean;
  help?: string;
};

const driveConfigMap: Record<string, { name: string; supportsMultipart: boolean; fields: ConfigField[] }> = {
  onedrive: {
    name: "OneDrive",
    supportsMultipart: true,
    fields: [
      {
        key: "region",
        label: "区域",
        type: "select",
        required: true,
        options: [
          { value: "global", label: "全球版" },
          { value: "cn", label: "中国版（世纪互联）" },
          { value: "us", label: "美国政府版" },
          { value: "de", label: "德国版" },
        ],
        defaultValue: "global",
      },
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true, placeholder: "Microsoft OAuth 刷新令牌" },
      { key: "use_online_api", label: "使用在线API", type: "boolean", defaultValue: false },
      {
        key: "api_address",
        label: "在线API地址",
        type: "text",
        placeholder: "自建刷新接口地址",
        show: (values) => values.use_online_api === true,
      },
      {
        key: "client_id",
        label: "客户端ID",
        type: "text",
        placeholder: "本地客户端ID",
        show: (values) => values.use_online_api !== true,
      },
      {
        key: "client_secret",
        label: "客户端密钥",
        type: "password",
        placeholder: "本地客户端密钥",
        show: (values) => values.use_online_api !== true,
      },
      {
        key: "redirect_uri",
        label: "重定向URI",
        type: "text",
        placeholder: "http://localhost",
        defaultValue: "http://localhost",
        show: (values) => values.use_online_api !== true,
      },
      { key: "is_sharepoint", label: "SharePoint 模式", type: "boolean", defaultValue: false },
      {
        key: "site_id",
        label: "SharePoint 站点ID",
        type: "text",
        placeholder: "SharePoint 站点ID",
        show: (values) => values.is_sharepoint === true,
      },
      { key: "root_folder_path", label: "根文件夹路径", type: "text", defaultValue: "/" },
      { key: "chunk_size", label: "分块大小 (MB)", type: "text", defaultValue: "5" },
      { key: "custom_host", label: "自定义下载主机", type: "text", placeholder: "可选：自定义下载域名" },
    ],
  },
  gdrive: {
    name: "Google Drive",
    supportsMultipart: true,
    fields: [
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true, placeholder: "Google OAuth 刷新令牌" },
      { key: "client_id", label: "客户端ID", type: "text", required: true },
      { key: "client_secret", label: "客户端密钥", type: "password", required: true },
      { key: "root_folder_id", label: "根目录ID", type: "text", defaultValue: "root", placeholder: "默认 root" },
    ],
  },
  alicloud: {
    name: "阿里云盘",
    supportsMultipart: true,
    fields: [
      {
        key: "drive_type",
        label: "驱动类型",
        type: "select",
        required: true,
        options: [
          { value: "resource", label: "资源库" },
          { value: "backup", label: "备份盘" },
          { value: "default", label: "默认" },
        ],
        defaultValue: "resource",
      },
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true },
      { key: "root_folder_id", label: "根目录ID", type: "text", defaultValue: "root" },
      {
        key: "order_by",
        label: "排序方式",
        type: "select",
        options: [
          { value: "name", label: "文件名" },
          { value: "size", label: "文件大小" },
          { value: "updated_at", label: "修改时间" },
          { value: "created_at", label: "创建时间" },
        ],
        defaultValue: "name",
      },
      {
        key: "order_direction",
        label: "排序方向",
        type: "select",
        options: [
          { value: "ASC", label: "升序" },
          { value: "DESC", label: "降序" },
        ],
        defaultValue: "ASC",
      },
      { key: "use_online_api", label: "使用在线API", type: "boolean", defaultValue: false },
      {
        key: "api_address",
        label: "在线API地址",
        type: "text",
        placeholder: "自建刷新接口地址",
        show: (values) => values.use_online_api === true,
      },
      {
        key: "client_id",
        label: "客户端ID",
        type: "text",
        placeholder: "本地客户端ID",
        show: (values) => values.use_online_api !== true,
      },
      {
        key: "client_secret",
        label: "客户端密钥",
        type: "password",
        placeholder: "本地客户端密钥",
        show: (values) => values.use_online_api !== true,
      },
      {
        key: "remove_way",
        label: "删除方式",
        type: "select",
        options: [
          { value: "trash", label: "移到回收站" },
          { value: "delete", label: "直接删除" },
        ],
        defaultValue: "trash",
      },
      { key: "rapid_upload", label: "秒传", type: "boolean", defaultValue: false },
      { key: "internal_upload", label: "内网上传", type: "boolean", defaultValue: false },
      {
        key: "livp_download_format",
        label: "LIVP 下载格式",
        type: "select",
        options: [
          { value: "jpeg", label: "JPEG" },
          { value: "mov", label: "MOV" },
        ],
        defaultValue: "jpeg",
      },
      {
        key: "alipan_type",
        label: "云盘类型",
        type: "select",
        options: [
          { value: "default", label: "默认" },
          { value: "alipanTV", label: "阿里云盘TV" },
        ],
        defaultValue: "default",
      },
    ],
  },
  baiduyun: {
    name: "百度网盘",
    supportsMultipart: false,
    fields: [
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true },
      { key: "root_path", label: "根目录路径", type: "text", defaultValue: "/" },
      {
        key: "order_by",
        label: "排序方式",
        type: "select",
        options: [
          { value: "name", label: "文件名" },
          { value: "time", label: "修改时间" },
          { value: "size", label: "文件大小" },
        ],
        defaultValue: "name",
      },
      {
        key: "order_direction",
        label: "排序方向",
        type: "select",
        options: [
          { value: "asc", label: "升序" },
          { value: "desc", label: "降序" },
        ],
        defaultValue: "asc",
      },
      { key: "use_online_api", label: "使用在线API", type: "boolean", defaultValue: false },
      {
        key: "api_address",
        label: "在线API地址",
        type: "text",
        placeholder: "自建刷新接口地址",
        show: (values) => values.use_online_api === true,
      },
      {
        key: "client_id",
        label: "客户端ID",
        type: "text",
        placeholder: "本地客户端ID",
        show: (values) => values.use_online_api !== true,
      },
      {
        key: "client_secret",
        label: "客户端密钥",
        type: "password",
        placeholder: "本地客户端密钥",
        show: (values) => values.use_online_api !== true,
      },
    ],
  },
};

function supportsMultipart(type?: string): boolean {
  if (!type) {
    return true;
  }
  if (type === "webdev") {
    return false;
  }
  if (type === "s3") {
    return true;
  }
  const config = driveConfigMap[type];
  if (config) {
    return config.supportsMultipart;
  }
  return false;
}

interface AuditLog {
  id: number;
  action: string;
  storageId: number | null;
  path: string | null;
  userType: "guest" | "admin" | "share";
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
  createdAt: string;
}


function formatBytes(bytes: number): string {
  if (bytes === 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN");
}

function LoginModal({ onLogin, onClose }: { onLogin: () => void; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/storages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username, password }),
      });

      if (res.ok) {
        onLogin();
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "登录失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm">管理员登录</span>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1 font-mono">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1 font-mono">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
              required
            />
          </div>
          {error && <div className="text-red-500 dark:text-red-400 text-xs font-mono">{error}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 text-sm font-mono transition rounded"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono disabled:opacity-50 transition rounded"
            >
              {loading ? "..." : "登录"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StorageModal({
  storage,
  onSave,
  onCancel,
}: {
  storage?: StorageInfo;
  onSave: () => void;
  onCancel: () => void;
}) {
  const initConfig = (type: string, existing?: Record<string, any>) => {
    const fields = driveConfigMap[type]?.fields || [];
    const base = { ...(existing || {}) };
    for (const field of fields) {
      if (base[field.key] === undefined && field.defaultValue !== undefined) {
        base[field.key] = field.defaultValue;
      }
    }
    return base;
  };

  const [formData, setFormData] = useState({
    name: storage?.name || "",
    type: storage?.type || "s3",
    endpoint: storage?.endpoint || "",
    region: storage?.region || "auto",
    accessKeyId: storage?.accessKeyId || "",
    secretAccessKey: "",
    bucket: storage?.bucket || "",
    basePath: storage?.basePath || "",
    config: initConfig(storage?.type || "s3", storage?.config),
    isPublic: storage?.isPublic ?? false,
    guestList: storage?.guestList ?? false,
    guestDownload: storage?.guestDownload ?? false,
    guestUpload: storage?.guestUpload ?? false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const driveConfig = driveConfigMap[formData.type || ""];
  const isS3 = formData.type === "s3";
  const isWebdav = formData.type === "webdev";

  const handleTypeChange = (nextType: string) => {
    setFormData({
      ...formData,
      type: nextType,
      endpoint: nextType === "s3" || nextType === "webdev" ? formData.endpoint : "",
      region: nextType === "s3" ? formData.region : "auto",
      accessKeyId: nextType === "s3" || nextType === "webdev" ? formData.accessKeyId : "",
      secretAccessKey: "",
      bucket: nextType === "s3" ? formData.bucket : "",
      basePath: nextType === "s3" || nextType === "webdev" ? formData.basePath : "",
      config: initConfig(nextType, {}),
    });
  };

  const updateConfigValue = (key: string, value: string | number | boolean) => {
    setFormData({
      ...formData,
      config: { ...(formData.config || {}), [key]: value },
    });
  };

  const renderConfigField = (field: ConfigField) => {
    const values = formData.config || {};
    if (field.show && !field.show(values)) {
      return null;
    }

    const commonClasses = "w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded";
    const value = values[field.key] ?? "";

    if (field.type === "boolean") {
      return (
        <label key={field.key} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => updateConfigValue(field.key, e.target.checked)}
            className="w-4 h-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">{field.label}</span>
          {field.help && <span className="text-xs text-zinc-500">{field.help}</span>}
        </label>
      );
    }

    if (field.type === "select") {
      return (
        <div key={field.key}>
          <label className="block text-xs text-zinc-500 mb-1 font-mono">{field.label}{field.required ? " *" : ""}</label>
          <select
            value={String(value)}
            onChange={(e) => updateConfigValue(field.key, e.target.value)}
            className={commonClasses}
            required={field.required}
          >
            {(field.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === "textarea") {
      return (
        <div key={field.key}>
          <label className="block text-xs text-zinc-500 mb-1 font-mono">{field.label}{field.required ? " *" : ""}</label>
          <textarea
            value={String(value)}
            onChange={(e) => updateConfigValue(field.key, e.target.value)}
            className={`${commonClasses} h-24`}
            placeholder={field.placeholder || ""}
            required={field.required}
          />
        </div>
      );
    }

    return (
      <div key={field.key}>
        <label className="block text-xs text-zinc-500 mb-1 font-mono">{field.label}{field.required ? " *" : ""}</label>
        <input
          type={field.type}
          value={String(value)}
          onChange={(e) => updateConfigValue(field.key, e.target.value)}
          className={commonClasses}
          placeholder={field.placeholder || ""}
          required={field.required}
        />
      </div>
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const method = storage ? "PUT" : "POST";
      const configToSend = { ...(formData.config || {}) };
      if (driveConfig) {
        for (const field of driveConfig.fields) {
          if (field.type === "password" && !configToSend[field.key]) {
            delete configToSend[field.key];
          }
        }
      }
      const body = storage
        ? { id: storage.id, ...formData, config: configToSend }
        : { ...formData, config: configToSend };

      if (storage && !formData.secretAccessKey && (isS3 || isWebdav)) {
        delete (body as Record<string, unknown>).secretAccessKey;
      }

      const res = await fetch("/api/storages", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSave();
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "保存失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between sticky top-0 bg-white dark:bg-zinc-900 rounded-t-lg">
          <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm">{storage ? "编辑存储" : "添加存储"}</span>
          <button onClick={onCancel} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-zinc-500 mb-1 font-mono">名称 *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                placeholder="My Storage"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-500 mb-1 font-mono">存储类型 *</label>
              <select
                value={formData.type}
                onChange={(e) => handleTypeChange(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                required
              >
                <option value="s3">S3 兼容服务</option>
                <option value="webdev">WebDAV</option>
                <option value="onedrive">OneDrive</option>
                <option value="gdrive">Google Drive</option>
                <option value="alicloud">阿里云盘</option>
                <option value="baiduyun">百度网盘</option>
              </select>
            </div>
            {(isS3 || isWebdav) && (
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1 font-mono">
                  {isWebdav ? "WebDAV 服务器地址" : "Endpoint"} *
                </label>
                <input
                  type="url"
                  value={formData.endpoint}
                  onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                  placeholder={isWebdav ? "https://example.com/webdav" : "https://s3.us-east-1.amazonaws.com"}
                  required
                />
              </div>
            )}
            {isS3 && (
              <div>
                <label className="block text-xs text-zinc-500 mb-1 font-mono">Region</label>
                <input
                  type="text"
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                  placeholder="auto"
                />
              </div>
            )}
            {isS3 && (
              <div>
                <label className="block text-xs text-zinc-500 mb-1 font-mono">Bucket *</label>
                <input
                  type="text"
                  value={formData.bucket}
                  onChange={(e) => setFormData({ ...formData, bucket: e.target.value })}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                  placeholder="my-bucket"
                  required={isS3}
                />
              </div>
            )}
            {(isS3 || isWebdav) && (
              <>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1 font-mono">
                    {isWebdav ? "用户名" : "Access Key"} *
                  </label>
                  <input
                    type="text"
                    value={formData.accessKeyId}
                    onChange={(e) => setFormData({ ...formData, accessKeyId: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                    required={!storage && (isS3 || isWebdav)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1 font-mono">
                    {isWebdav ? "密码" : "Secret Key"} {storage && "(留空保持)"}
                  </label>
                  <input
                    type="password"
                    value={formData.secretAccessKey}
                    onChange={(e) => setFormData({ ...formData, secretAccessKey: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                    required={!storage && (isS3 || isWebdav)}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-zinc-500 mb-1 font-mono">根路径</label>
                  <input
                    type="text"
                    value={formData.basePath}
                    onChange={(e) => setFormData({ ...formData, basePath: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                    placeholder="/path/to/folder"
                  />
                </div>
              </>
            )}
            {driveConfig && (
              <div className="col-span-2 border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">
                <div className="text-xs text-zinc-500 mb-2 font-mono">驱动配置 - {driveConfig.name}</div>
                <div className="space-y-3">
                  {driveConfig.fields.map(renderConfigField)}
                </div>
              </div>
            )}
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isPublic}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setFormData({
                      ...formData,
                      isPublic: checked,
                      guestList: checked,
                      guestDownload: checked,
                    });
                  }}
                  className="w-4 h-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded"
                />
                <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">公开访问</span>
                <span className="text-xs text-zinc-500">(快速开启浏览和下载)</span>
              </label>
            </div>
            <div className="col-span-2 border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">
              <div className="text-xs text-zinc-500 mb-2 font-mono">游客权限设置</div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.guestList}
                    onChange={(e) => setFormData({ ...formData, guestList: e.target.checked })}
                    className="w-4 h-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">允许浏览</span>
                  <span className="text-xs text-zinc-500">(查看文件列表)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.guestDownload}
                    onChange={(e) => setFormData({ ...formData, guestDownload: e.target.checked })}
                    className="w-4 h-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">允许下载</span>
                  <span className="text-xs text-zinc-500">(下载和预览文件)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.guestUpload}
                    onChange={(e) => setFormData({ ...formData, guestUpload: e.target.checked })}
                    className="w-4 h-4 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">允许上传</span>
                  <span className="text-xs text-zinc-500">(上传新文件)</span>
                </label>
              </div>
            </div>
          </div>
          {error && <div className="text-red-500 dark:text-red-400 text-xs font-mono">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 px-4 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-400 dark:hover:border-zinc-500 text-sm font-mono transition rounded"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono disabled:opacity-50 transition rounded"
            >
              {loading ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsModal({
  onClose,
  siteTitle,
  siteAnnouncement,
  isDark,
  onToggleTheme,
  isAdmin,
  onRefreshStorages,
  webdavEnabled,
  storages,
}: {
  onClose: () => void;
  siteTitle: string;
  siteAnnouncement: string;
  isDark: boolean;
  onToggleTheme: (e: React.MouseEvent) => void;
  isAdmin: boolean;
  onRefreshStorages: () => void;
  webdavEnabled: boolean;
  storages: StorageInfo[];
}) {
  const [activeTab, setActiveTab] = useState<'general' | 'webdav' | 'backup' | 'audit' | 'about'>('general');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");

  const handleExportBackup = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/storages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export-backup" }),
      });

      if (res.ok) {
        const data = await res.json() as { backup: unknown };
        const blob = new Blob([JSON.stringify(data.backup, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `clist-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const data = await res.json() as { error?: string };
        alert(data.error || "导出失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setExporting(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const backup = JSON.parse(text);

      if (!backup.storages || !Array.isArray(backup.storages)) {
        setImportResult({ success: false, message: "无效的备份文件格式" });
        return;
      }

      const res = await fetch("/api/storages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-backup", backup, mode: importMode }),
      });

      const data = await res.json() as { success?: boolean; imported?: number; skipped?: number; errors?: string[]; error?: string };

      if (res.ok && data.success) {
        let message = `成功导入 ${data.imported} 个存储`;
        if (data.skipped && data.skipped > 0) {
          message += `，跳过 ${data.skipped} 个已存在的存储`;
        }
        if (data.errors && data.errors.length > 0) {
          message += `\n\n错误:\n${data.errors.join("\n")}`;
        }
        setImportResult({ success: true, message });
        onRefreshStorages();
      } else {
        setImportResult({ success: false, message: data.error || "导入失败" });
      }
    } catch (err) {
      setImportResult({ success: false, message: err instanceof Error ? err.message : "解析备份文件失败" });
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  const fetchAuditLogs = async () => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const res = await fetch("/api/audit?limit=200");
      if (res.ok) {
        const data = await res.json() as { logs?: AuditLog[] };
        setAuditLogs(data.logs || []);
      } else {
        const data = await res.json() as { error?: string };
        setAuditError(data.error || "加载审计日志失败");
      }
    } catch {
      setAuditError("网络错误");
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "audit" && isAdmin) {
      fetchAuditLogs();
    }
  }, [activeTab, isAdmin]);

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-md rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm">设置</span>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-700">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 px-4 py-2 text-xs font-mono transition ${
              activeTab === 'general'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            常规
          </button>
          {isAdmin && (
            <button
              onClick={() => setActiveTab('webdav')}
              className={`flex-1 px-4 py-2 text-xs font-mono transition ${
                activeTab === 'webdav'
                  ? 'text-blue-500 border-b-2 border-blue-500'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              WebDAV
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('backup')}
              className={`flex-1 px-4 py-2 text-xs font-mono transition ${
                activeTab === 'backup'
                  ? 'text-blue-500 border-b-2 border-blue-500'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              备份
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setActiveTab('audit')}
              className={activeTab === 'audit' ? 'flex-1 px-4 py-2 text-xs font-mono transition text-blue-500 border-b-2 border-blue-500' : 'flex-1 px-4 py-2 text-xs font-mono transition text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}
            >
              审计
            </button>
          )}
          <button
            onClick={() => setActiveTab('about')}
            className={`flex-1 px-4 py-2 text-xs font-mono transition ${
              activeTab === 'about'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            关于
          </button>
        </div>

        <div className="p-4">
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* Theme Setting */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono">主题模式</div>
                  <div className="text-xs text-zinc-500">切换亮色或暗色主题</div>
                </div>
                <button
                  onClick={onToggleTheme}
                  className="px-3 py-1.5 text-xs font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition"
                >
                  {isDark ? '☀ 亮色' : '☾ 暗色'}
                </button>
              </div>

              {/* Announcement */}
              {siteAnnouncement && (
                <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                  <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2 flex items-center gap-2">
                    <span className="text-yellow-500">📢</span> 公告
                  </div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono whitespace-pre-wrap bg-zinc-50 dark:bg-zinc-800 p-3 rounded border border-zinc-200 dark:border-zinc-700 max-h-32 overflow-y-auto">
                    {siteAnnouncement}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'webdav' && isAdmin && (
            <div className="space-y-4">
              {/* WebDAV Status */}
              <div className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono">WebDAV 服务</div>
                  <div className="text-xs text-zinc-500">通过 WebDAV 协议访问存储</div>
                </div>
                <span className={`px-2 py-1 text-xs font-mono rounded ${
                  webdavEnabled 
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                }`}>
                  {webdavEnabled ? '已启用' : '未启用'}
                </span>
              </div>

              {webdavEnabled ? (
                <>
                  {/* WebDAV URL */}
                  <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                    <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2">访问地址</div>
                    <div className="text-xs text-zinc-500 mb-3">
                      使用 WebDAV 客户端连接以下地址访问存储
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800 p-3 rounded border border-zinc-200 dark:border-zinc-700">
                      <div className="text-xs text-zinc-500 mb-1 font-mono">根目录 (所有存储):</div>
                      <code className="text-sm text-blue-600 dark:text-blue-400 font-mono break-all">
                        {typeof window !== 'undefined' ? `${window.location.origin}/dav/0/` : '/dav/0/'}
                      </code>
                    </div>
                  </div>

                  {/* Storage List with WebDAV URLs */}
                  {storages.length > 0 && (
                    <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                      <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2">存储访问地址</div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {storages.map((storage) => (
                          <div key={storage.id} className="bg-zinc-50 dark:bg-zinc-800 p-2 rounded border border-zinc-200 dark:border-zinc-700">
                            <div className="text-xs text-zinc-700 dark:text-zinc-300 font-mono mb-1">{storage.name}</div>
                            <code className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all">
                              {typeof window !== 'undefined' ? `${window.location.origin}/dav/${storage.id}/` : `/dav/${storage.id}/`}
                            </code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Authentication Info */}
                  <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                    <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2">认证方式</div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono space-y-1">
                      <p>• 协议: HTTP Basic Authentication</p>
                      <p>• 用户名/密码: 使用 WEBDAV_USERNAME/WEBDAV_PASSWORD 环境变量配置</p>
                      <p>• 默认: 使用管理员账号密码 (ADMIN_USERNAME/ADMIN_PASSWORD)</p>
                    </div>
                  </div>

                  {/* Usage Tips */}
                  <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                    <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2 flex items-center gap-2">
                      <span className="text-blue-500">💡</span> 使用提示
                    </div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono space-y-1">
                      <p>• Windows: 映射网络驱动器，输入 WebDAV 地址</p>
                      <p>• macOS: Finder → 前往 → 连接服务器</p>
                      <p>• Linux: 使用 davfs2 或文件管理器</p>
                      <p>• 移动端: 使用支持 WebDAV 的文件管理 App</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                  <div className="text-xs text-zinc-500 font-mono space-y-2">
                    <p>WebDAV 服务未启用。要启用 WebDAV，请在 Cloudflare Workers 环境变量中设置:</p>
                    <div className="bg-zinc-50 dark:bg-zinc-800 p-3 rounded border border-zinc-200 dark:border-zinc-700 mt-2">
                      <code className="text-xs text-zinc-700 dark:text-zinc-300">WEBDAV_ENABLED = "true"</code>
                    </div>
                    <p className="mt-2">可选配置:</p>
                    <div className="bg-zinc-50 dark:bg-zinc-800 p-3 rounded border border-zinc-200 dark:border-zinc-700">
                      <code className="text-xs text-zinc-700 dark:text-zinc-300 block">WEBDAV_USERNAME = "your_username"</code>
                      <code className="text-xs text-zinc-700 dark:text-zinc-300 block">WEBDAV_PASSWORD = "your_password"</code>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'backup' && isAdmin && (
            <div className="space-y-4">
              {/* Export Section */}
              <div>
                <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2">导出备份</div>
                <div className="text-xs text-zinc-500 mb-3">
                  导出所有存储配置到 JSON 文件，包含连接凭证信息。
                </div>
                <button
                  onClick={handleExportBackup}
                  disabled={exporting}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono disabled:opacity-50 transition rounded"
                >
                  {exporting ? "导出中..." : "导出备份文件"}
                </button>
              </div>

              {/* Import Section */}
              <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-2">恢复备份</div>
                <div className="text-xs text-zinc-500 mb-3">
                  从备份文件恢复存储配置。
                </div>

                {/* Import Mode Selection */}
                <div className="mb-3">
                  <div className="text-xs text-zinc-500 mb-2 font-mono">导入模式:</div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="merge"
                        checked={importMode === 'merge'}
                        onChange={() => setImportMode('merge')}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">合并</span>
                      <span className="text-xs text-zinc-500">(保留现有)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="replace"
                        checked={importMode === 'replace'}
                        onChange={() => setImportMode('replace')}
                        className="w-4 h-4"
                      />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">替换</span>
                      <span className="text-xs text-zinc-500">(清空现有)</span>
                    </label>
                  </div>
                </div>

                <label className={`block w-full py-2 px-4 text-center border-2 border-dashed border-zinc-300 dark:border-zinc-600 hover:border-blue-500 dark:hover:border-blue-500 text-sm font-mono cursor-pointer transition rounded ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
                  {importing ? "导入中..." : "选择备份文件"}
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    className="hidden"
                    disabled={importing}
                  />
                </label>

                {/* Import Result */}
                {importResult && (
                  <div className={`mt-3 p-3 rounded text-xs font-mono whitespace-pre-wrap ${
                    importResult.success
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                  }`}>
                    {importResult.message}
                  </div>
                )}
              </div>

              {/* Warning */}
              <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                <div className="text-xs text-yellow-600 dark:text-yellow-500 font-mono flex items-start gap-2">
                  <span>⚠</span>
                  <span>备份文件包含敏感凭证信息，请妥善保管。</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audit' && isAdmin && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono">审计日志</div>
                <button
                  onClick={fetchAuditLogs}
                  disabled={auditLoading}
                  className="px-3 py-1 text-xs font-mono rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50 transition"
                >
                  {auditLoading ? '加载中...' : '刷新'}
                </button>
              </div>
              {auditError && (
                <div className="text-xs text-red-500 dark:text-red-400 font-mono">{auditError}</div>
              )}
              {!auditError && auditLogs.length === 0 && !auditLoading && (
                <div className="text-xs text-zinc-500 font-mono">暂无日志</div>
              )}
              {auditLogs.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="border border-zinc-200 dark:border-zinc-700 rounded p-2 bg-zinc-50 dark:bg-zinc-800/50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500 font-mono">{formatDate(log.createdAt)}</span>
                        <span className="text-[11px] text-zinc-400 font-mono">{log.userType}</span>
                      </div>
                      <div className="text-xs text-zinc-800 dark:text-zinc-200 font-mono">{log.action}</div>
                      <div className="text-[11px] text-zinc-500 font-mono">
                        {log.storageId ? `storage #${log.storageId}` : 'storage -'}
                        {log.path ? ` / ${log.path}` : ''}
                      </div>
                      {log.detail && (
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono mt-1 break-all">{log.detail}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'about' && (
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 font-mono mb-1">{siteTitle}</div>
                <div className="text-xs text-zinc-500 font-mono">v1.2.0</div>
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400 font-mono space-y-2">
                <p>S3 兼容存储聚合服务</p>
                <p className="text-zinc-500">支持: AWS S3 / Cloudflare R2 / 阿里云 OSS / 腾讯云 COS / MinIO / WebDAV / OneDrive / Google Drive / 阿里云盘 / 百度网盘</p>
                <p>作者: ooyyh</p>
                <p>联系方式: 3266940347@qq.com</p>
              </div>
              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4 text-xs text-zinc-500 font-mono">
                <p>Powered by Cloudflare Workers && ooyyh</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnnouncementModal({ announcement, onClose }: { announcement: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-lg rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm flex items-center gap-2">
            <span className="text-yellow-500">📢</span> 公告
          </span>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
        </div>
        <div className="p-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed">
            {announcement}
          </p>
        </div>
        <div className="px-4 pb-4">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono transition rounded"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}

interface StorageStats {
  totalSize: number;
  fileCount: number;
  folderCount: number;
  typeDistribution: Record<string, { count: number; size: number }>;
}

function StorageStatsModal({ storage, onClose }: { storage: StorageInfo; onClose: () => void }) {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/storage-stats/${storage.id}`);
        if (res.ok) {
          const data = (await res.json()) as { stats: StorageStats };
          setStats(data.stats);
        } else {
          const data = (await res.json()) as { error?: string };
          setError(data.error || "获取统计信息失败");
        }
      } catch {
        setError("网络错误");
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [storage.id]);

  const sortedTypes = stats
    ? Object.entries(stats.typeDistribution)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 10)
    : [];

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[80vh] rounded-lg shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0">
          <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm flex items-center gap-2">
            <span className="text-blue-500">📊</span> 存储统计 - {storage.name}
          </span>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-zinc-400 dark:text-zinc-500 font-mono text-sm">正在统计中，请稍候...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-red-500 font-mono text-sm">{error}</span>
            </div>
          ) : stats ? (
            <div className="space-y-6">
              {/* Overview Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-zinc-50 dark:bg-zinc-800 p-4 rounded border border-zinc-200 dark:border-zinc-700">
                  <div className="text-xs text-zinc-500 font-mono mb-1">总大小</div>
                  <div className="text-2xl font-mono text-zinc-900 dark:text-zinc-100">{formatBytes(stats.totalSize)}</div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 p-4 rounded border border-zinc-200 dark:border-zinc-700">
                  <div className="text-xs text-zinc-500 font-mono mb-1">文件数量</div>
                  <div className="text-2xl font-mono text-zinc-900 dark:text-zinc-100">{stats.fileCount.toLocaleString()}</div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800 p-4 rounded border border-zinc-200 dark:border-zinc-700">
                  <div className="text-xs text-zinc-500 font-mono mb-1">文件夹数量</div>
                  <div className="text-2xl font-mono text-zinc-900 dark:text-zinc-100">{stats.folderCount.toLocaleString()}</div>
                </div>
              </div>

              {/* Type Distribution */}
              {sortedTypes.length > 0 && (
                <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
                  <div className="text-sm text-zinc-900 dark:text-zinc-100 font-mono mb-3">文件类型分布 (前10)</div>
                  <div className="space-y-2">
                    {sortedTypes.map(([ext, data]) => {
                      const percentage = stats.totalSize > 0 ? (data.size / stats.totalSize) * 100 : 0;
                      return (
                        <div key={ext} className="space-y-1">
                          <div className="flex items-center justify-between text-xs font-mono">
                            <span className="text-zinc-700 dark:text-zinc-300">
                              .{ext} ({data.count.toLocaleString()} 个文件)
                            </span>
                            <span className="text-zinc-500">
                              {formatBytes(data.size)} ({percentage.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-blue-500 h-full rounded-full transition-all"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {stats.fileCount === 0 && (
                <div className="text-center py-8">
                  <span className="text-zinc-400 dark:text-zinc-500 font-mono text-sm">此存储为空</span>
                </div>
              )}
            </div>
          ) : null}
        </div>
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono transition rounded"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

interface ReleaseItem {
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
  isPrerelease: boolean;
  author: string;
}

function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchReleases = async () => {
      try {
        const res = await fetch("/api/changelog");
        if (res.ok) {
          const data = await res.json() as { releases: ReleaseItem[] };
          setReleases(data.releases);
        } else {
          setError("获取更新日志失败");
        }
      } catch {
        setError("网络错误");
      } finally {
        setLoading(false);
      }
    };
    fetchReleases();
  }, []);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  };

  const parseBody = (body: string) => {
    // Parse the changelog body and highlight different types
    return body.split("\n").map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return null;

      let colorClass = "text-zinc-600 dark:text-zinc-400";
      if (trimmed.toLowerCase().startsWith("#update") || trimmed.toLowerCase().startsWith("update")) {
        colorClass = "text-blue-600 dark:text-blue-400";
      } else if (trimmed.toLowerCase().startsWith("#fix") || trimmed.toLowerCase().startsWith("fix")) {
        colorClass = "text-green-600 dark:text-green-400";
      } else if (trimmed.toLowerCase().startsWith("#breaking") || trimmed.toLowerCase().startsWith("breaking")) {
        colorClass = "text-red-600 dark:text-red-400";
      } else if (trimmed.toLowerCase().startsWith("#new") || trimmed.toLowerCase().startsWith("new")) {
        colorClass = "text-purple-600 dark:text-purple-400";
      }

      return (
        <div key={i} className={`${colorClass} text-sm font-mono`}>
          {trimmed}
        </div>
      );
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[80vh] rounded-lg shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between shrink-0">
          <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm flex items-center gap-2">
            <span className="text-blue-500">📋</span> 更新日志
          </span>
          <button onClick={onClose} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-zinc-400 dark:text-zinc-500 font-mono text-sm">加载中...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-red-500 font-mono text-sm">{error}</span>
            </div>
          ) : releases.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-zinc-400 dark:text-zinc-500 font-mono text-sm">暂无更新日志</span>
            </div>
          ) : (
            <div className="space-y-6">
              {releases.map((release, idx) => (
                <div key={release.version} className="relative">
                  {idx > 0 && <div className="absolute -top-3 left-0 right-0 border-t border-zinc-200 dark:border-zinc-700" />}
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2 py-0.5 text-xs font-mono rounded ${
                      idx === 0
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                    }`}>
                      {release.version}
                    </span>
                    {idx === 0 && (
                      <span className="px-2 py-0.5 text-xs font-mono rounded bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                        Latest
                      </span>
                    )}
                    {release.isPrerelease && (
                      <span className="px-2 py-0.5 text-xs font-mono rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400">
                        Pre-release
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                      {formatDate(release.publishedAt)}
                    </span>
                  </div>
                  {release.name && release.name !== release.version && (
                    <h3 className="text-sm font-mono text-zinc-800 dark:text-zinc-200 mb-2">{release.name}</h3>
                  )}
                  <div className="space-y-1 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700">
                    {parseBody(release.body)}
                  </div>
                  <a
                    href={release.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs text-blue-500 hover:text-blue-400 font-mono"
                  >
                    查看详情 →
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm font-mono transition rounded"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

function FileBrowser({ storage, isAdmin, isDark, chunkSizeMB }: { storage: StorageInfo; isAdmin: boolean; isDark: boolean; chunkSizeMB: number }) {
  // Permission checks
  const canList = isAdmin || storage.guestList;
  const canDownload = isAdmin || storage.guestDownload;
  const canUpload = isAdmin || storage.guestUpload;

  const [path, setPath] = useState("");
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{
    name: string;
    progress: number;
    currentPart?: number;
    totalParts?: number;
    speed?: number; // bytes per second
    loaded?: number;
    total?: number;
  } | null>(null);
  const [previewFile, setPreviewFile] = useState<S3Object | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showOfflineDownload, setShowOfflineDownload] = useState(false);
  const [offlineUrl, setOfflineUrl] = useState("");
  const [offlineFilename, setOfflineFilename] = useState("");
  const [offlineDownloading, setOfflineDownloading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<S3Object | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [moveTarget, setMoveTarget] = useState<S3Object | null>(null);
  const [moveDestPath, setMoveDestPath] = useState("");
  const [moving, setMoving] = useState(false);
  const [allFolders, setAllFolders] = useState<string[]>([]);
  const [shareTarget, setShareTarget] = useState<S3Object | null>(null);
  const [shareToken, setShareToken] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpireHours, setShareExpireHours] = useState(0);
  const [creatingShare, setCreatingShare] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setPath("");
    setSearchQuery("");
  }, [storage.id]);

  useEffect(() => {
    loadFiles();
    setSelectedKeys(new Set()); // Clear selection on path change
  }, [storage.id, path]);

  const loadFiles = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`/api/files/${storage.id}/${path}?action=list`);
      if (res.ok) {
        const data = (await res.json()) as { objects?: S3Object[] };
        setObjects(data.objects || []);
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "加载失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (newPath: string) => {
    setPath(newPath.replace(/^\//, "").replace(/\/$/, ""));
  };

  const goUp = () => {
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    setPath(parts.join("/"));
  };

  const downloadFile = (key: string) => {
    window.open(`/api/files/${storage.id}/${key}?action=download`, "_blank");
  };

  const deleteFile = async (key: string) => {
    if (!confirm(`确定删除 ${key}?`)) return;
    try {
      const res = await fetch(`/api/files/${storage.id}/${key}`, { method: "DELETE" });
      if (res.ok) {
        loadFiles();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "删除失败");
      }
    } catch {
      alert("网络错误");
    }
  };

  const deleteFolder = async (key: string, name: string) => {
    if (!confirm(`确定删除文件夹 "${name}" 及其所有内容?`)) return;
    try {
      const res = await fetch(`/api/files/${storage.id}/${key}?action=rmdir`, { method: "DELETE" });
      if (res.ok) {
        loadFiles();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "删除失败");
      }
    } catch {
      alert("网络错误");
    }
  };

  const startRename = (obj: S3Object) => {
    setRenameTarget(obj);
    setRenameValue(obj.name);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    if (renameValue.includes("/")) {
      alert("名称不能包含 /");
      return;
    }
    if (renameValue === renameTarget.name) {
      setRenameTarget(null);
      return;
    }

    setRenaming(true);
    try {
      const key = renameTarget.isDirectory ? renameTarget.key : renameTarget.key;
      const res = await fetch(`/api/files/${storage.id}/${key}?action=rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName: renameValue.trim() }),
      });
      if (res.ok) {
        setRenameTarget(null);
        loadFiles();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "重命名失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setRenaming(false);
    }
  };

  const loadAllFolders = async () => {
    const folders: string[] = [""];
    const listRecursive = async (prefix: string) => {
      try {
        const res = await fetch(`/api/files/${storage.id}/${prefix}?action=list`);
        if (res.ok) {
          const data = (await res.json()) as { objects?: S3Object[] };
          for (const obj of data.objects || []) {
            if (obj.isDirectory) {
              folders.push(obj.key);
              await listRecursive(obj.key);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    };
    await listRecursive("");
    setAllFolders(folders);
  };

  const startMove = async (obj: S3Object) => {
    setMoveTarget(obj);
    setMoveDestPath("");
    await loadAllFolders();
  };

  const handleMove = async () => {
    if (!moveTarget) return;

    setMoving(true);
    try {
      const key = moveTarget.isDirectory ? moveTarget.key : moveTarget.key;
      const res = await fetch(`/api/files/${storage.id}/${key}?action=move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destPath: moveDestPath }),
      });
      if (res.ok) {
        setMoveTarget(null);
        loadFiles();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "移动失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setMoving(false);
    }
  };

  const startShare = (obj: S3Object) => {
    setShareTarget(obj);
    setShareToken("");
    setShareUrl("");
    setShareExpireHours(0);
  };

  const handleCreateShare = async () => {
    if (!shareTarget) return;

    setCreatingShare(true);
    try {
      let expiresAt: string | undefined;
      if (shareExpireHours > 0) {
        const expireDate = new Date();
        expireDate.setHours(expireDate.getHours() + shareExpireHours);
        expiresAt = expireDate.toISOString();
      }

      const res = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageId: storage.id,
          filePath: shareTarget.key,
          isDirectory: shareTarget.isDirectory,
          expiresAt,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { share: { shareToken: string }; shareUrl: string };
        setShareToken(data.share.shareToken);
        setShareUrl(data.shareUrl);
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "创建分享链接失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setCreatingShare(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert("已复制到剪贴板");
    }).catch(() => {
      alert("复制失败，请手动复制");
    });
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const obj of visibleObjects) {
          next.delete(obj.key);
        }
      } else {
        for (const obj of visibleObjects) {
          next.add(obj.key);
        }
      }
      return next;
    });
  };

  const handleBatchDelete = async () => {
    if (selectedKeys.size === 0) return;

    const folders = objects.filter((obj) => obj.isDirectory && selectedKeys.has(obj.key));
    const files = objects.filter((obj) => !obj.isDirectory && selectedKeys.has(obj.key));

    const msg = folders.length > 0
      ? `确定删除 ${files.length} 个文件和 ${folders.length} 个文件夹（含其中所有内容）?`
      : `确定删除 ${files.length} 个文件?`;

    if (!confirm(msg)) return;

    setDeleting(true);
    let failed = 0;

    try {
      // Delete folders first (recursive)
      for (const folder of folders) {
        try {
          const res = await fetch(`/api/files/${storage.id}/${folder.key}?action=rmdir`, { method: "DELETE" });
          if (!res.ok) failed++;
        } catch {
          failed++;
        }
      }

      // Delete files
      for (const file of files) {
        try {
          const res = await fetch(`/api/files/${storage.id}/${file.key}`, { method: "DELETE" });
          if (!res.ok) failed++;
        } catch {
          failed++;
        }
      }

      if (failed > 0) {
        alert(`删除完成，${failed} 个项目删除失败`);
      }

      setSelectedKeys(new Set());
      loadFiles();
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const CHUNK_SIZE = chunkSizeMB * 1024 * 1024;

    for (const file of Array.from(files)) {
      try {
        const uploadPath = path ? `${path}/${file.name}` : file.name;

        const canMultipart = supportsMultipart(storage.type);
        if (file.size >= CHUNK_SIZE && canMultipart) {
          await uploadMultipart(file, uploadPath, CHUNK_SIZE);
        } else {
          await uploadSingle(file, uploadPath);
        }
      } catch (err) {
        alert(`上传 ${file.name} 失败: ${err instanceof Error ? err.message : "未知错误"}`);
      }
    }
    setUploadProgress(null);
    loadFiles();
    e.target.value = "";
  };

  const uploadSingle = async (file: File, uploadPath: string) => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress({ name: file.name, progress: percent });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            reject(new Error(data.error || "上传失败"));
          } catch {
            reject(new Error("上传失败"));
          }
        }
      };

      xhr.onerror = () => reject(new Error("网络错误"));

      xhr.open("PUT", `/api/files/${storage.id}/${uploadPath}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.send(file);
    });
  };

  const uploadMultipart = async (file: File, uploadPath: string, chunkSize: number) => {
    const totalParts = Math.ceil(file.size / chunkSize);
    const contentType = file.type || "application/octet-stream";
    const CONCURRENT_UPLOADS = 5;

    // Check for existing upload in localStorage (resume support)
    const storageKey = `multipart_${storage.id}_${uploadPath}_${file.size}`;
    const savedState = localStorage.getItem(storageKey);
    let uploadId: string;
    let completedParts: { partNumber: number; etag: string }[] = [];
    let startPart = 0;
    let useDirectUpload = true; // Try direct S3 upload first

    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.uploadId && parsed.parts && parsed.fileName === file.name) {
          const shouldResume = confirm(`检测到未完成的上传 "${file.name}"，是否继续？\n已完成 ${parsed.parts.length}/${totalParts} 分片`);
          if (shouldResume) {
            uploadId = parsed.uploadId;
            completedParts = parsed.parts;
            startPart = completedParts.length;
            useDirectUpload = parsed.useDirectUpload ?? true;
          } else {
            try {
              await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-abort`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uploadId: parsed.uploadId }),
              });
            } catch { /* ignore */ }
            localStorage.removeItem(storageKey);
          }
        }
      } catch { /* ignore invalid state */ }
    }

    // Initialize new upload if needed
    if (!uploadId!) {
      setUploadProgress({ name: file.name, progress: 0, currentPart: 0, totalParts, speed: 0, loaded: 0, total: file.size });

      const initRes = await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, size: file.size, chunkSize }),
      });

      if (!initRes.ok) {
        const data = await initRes.json() as { error?: string };
        throw new Error(data.error || "初始化分片上传失败");
      }

      const initData = await initRes.json() as { uploadId: string };
      uploadId = initData.uploadId;

      localStorage.setItem(storageKey, JSON.stringify({
        uploadId,
        fileName: file.name,
        parts: [],
        useDirectUpload: true,
      }));
    }

    // Speed calculation
    let totalBytesUploaded = startPart * chunkSize;
    const startTime = Date.now();
    const partProgress: Record<number, number> = {};

    const updateProgress = () => {
      const currentBytes = totalBytesUploaded + Object.values(partProgress).reduce((a, b) => a + b, 0);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? currentBytes / elapsed : 0;
      const progress = Math.round((currentBytes / file.size) * 100);

      setUploadProgress({
        name: file.name,
        progress: Math.min(progress, 100),
        currentPart: completedParts.length,
        totalParts,
        speed,
        loaded: currentBytes,
        total: file.size,
      });
    };

    updateProgress();

    try {
      const remainingParts = Array.from({ length: totalParts - startPart }, (_, i) => startPart + i + 1);

      // Get signed URLs for direct upload
      let signedUrls: Record<number, string> = {};
      if (useDirectUpload) {
        try {
          const urlsRes = await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-urls`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId, partNumbers: remainingParts }),
          });
          if (urlsRes.ok) {
            const data = await urlsRes.json() as { urls: Record<number, string> };
            signedUrls = data.urls;
          }
        } catch { /* will fallback to proxy */ }
      }

      const uploadQueue = remainingParts.map((partNumber) => ({
        partNumber,
        start: (partNumber - 1) * chunkSize,
        end: Math.min(partNumber * chunkSize, file.size),
      }));

      // Upload part - tries direct S3 first, falls back to Workers proxy
      const uploadPart = async (item: { partNumber: number; start: number; end: number }): Promise<{ partNumber: number; etag: string }> => {
        const chunk = file.slice(item.start, item.end);

        // Try direct S3 upload first
        if (useDirectUpload && signedUrls[item.partNumber]) {
          try {
            const result = await uploadPartDirect(chunk, signedUrls[item.partNumber], item.partNumber);
            return result;
          } catch (e) {
            // CORS or network error - switch to proxy mode
            console.log("Direct upload failed, switching to proxy mode");
            useDirectUpload = false;
            // Update saved state
            localStorage.setItem(storageKey, JSON.stringify({
              uploadId,
              fileName: file.name,
              parts: completedParts,
              useDirectUpload: false,
            }));
          }
        }

        // Fallback: upload through Workers proxy
        return uploadPartProxy(chunk, uploadPath, uploadId, item.partNumber);
      };

      const uploadPartDirect = (chunk: Blob, url: string, partNumber: number): Promise<{ partNumber: number; etag: string }> => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              partProgress[partNumber] = event.loaded;
              updateProgress();
            }
          };

          xhr.onload = () => {
            delete partProgress[partNumber];
            if (xhr.status >= 200 && xhr.status < 300) {
              const etag = xhr.getResponseHeader("ETag")?.replace(/"/g, "") || "";
              totalBytesUploaded += chunk.size;
              resolve({ partNumber, etag });
            } else {
              reject(new Error(`Direct upload failed: ${xhr.status}`));
            }
          };

          xhr.onerror = () => {
            delete partProgress[partNumber];
            reject(new Error("Direct upload network error"));
          };

          xhr.open("PUT", url);
          xhr.send(chunk);
        });
      };

      const uploadPartProxy = (chunk: Blob, path: string, upId: string, partNumber: number): Promise<{ partNumber: number; etag: string }> => {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              partProgress[partNumber] = event.loaded;
              updateProgress();
            }
          };

          xhr.onload = () => {
            delete partProgress[partNumber];
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                totalBytesUploaded += chunk.size;
                resolve({ partNumber, etag: data.etag });
              } catch {
                reject(new Error(`解析响应失败: 分片 ${partNumber}`));
              }
            } else {
              try {
                const data = JSON.parse(xhr.responseText);
                reject(new Error(data.error || `分片 ${partNumber} 失败`));
              } catch {
                reject(new Error(`分片 ${partNumber} 失败: ${xhr.status}`));
              }
            }
          };

          xhr.onerror = () => {
            delete partProgress[partNumber];
            reject(new Error(`网络错误: 分片 ${partNumber}`));
          };

          const url = `/api/files/${storage.id}/${path}?action=multipart-upload&uploadId=${encodeURIComponent(upId)}&partNumber=${partNumber}`;
          xhr.open("PUT", url);
          xhr.send(chunk);
        });
      };

      // Process queue with concurrency limit
      let index = 0;

      const runNext = async (): Promise<void> => {
        while (index < uploadQueue.length) {
          const currentIndex = index++;
          const item = uploadQueue[currentIndex];
          const result = await uploadPart(item);
          completedParts.push(result);

          localStorage.setItem(storageKey, JSON.stringify({
            uploadId,
            fileName: file.name,
            parts: completedParts,
            useDirectUpload,
          }));

          updateProgress();
        }
      };

      // Start concurrent uploads (reduce concurrency for proxy mode)
      const concurrency = useDirectUpload ? CONCURRENT_UPLOADS : 3;
      const workers = Array(Math.min(concurrency, uploadQueue.length))
        .fill(null)
        .map(() => runNext());

      await Promise.all(workers);

      // Complete multipart upload
      const completeRes = await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId, parts: completedParts }),
      });

      if (!completeRes.ok) {
        const data = await completeRes.json() as { error?: string };
        throw new Error(data.error || "完成分片上传失败");
      }

      localStorage.removeItem(storageKey);
    } catch (err) {
      throw err;
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    setCreatingFolder(true);
    try {
      const folderPath = path ? `${path}/${newFolderName.trim()}` : newFolderName.trim();
      const res = await fetch(`/api/files/${storage.id}/${folderPath}?action=mkdir`, {
        method: "POST",
      });

      if (res.ok) {
        setNewFolderName("");
        setShowNewFolderInput(false);
        loadFiles();
      } else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "创建文件夹失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleOfflineDownload = async () => {
    if (!offlineUrl.trim()) return;

    setOfflineDownloading(true);
    try {
      const res = await fetch(`/api/files/${storage.id}/${path}?action=fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: offlineUrl.trim(),
          filename: offlineFilename.trim() || undefined,
        }),
      });

      const data = await res.json() as { success?: boolean; filename?: string; size?: number; error?: string };

      if (res.ok && data.success) {
        const sizeStr = data.size ? ` (${formatBytes(data.size)})` : "";
        alert(`下载成功: ${data.filename}${sizeStr}`);
        setOfflineUrl("");
        setOfflineFilename("");
        setShowOfflineDownload(false);
        loadFiles();
      } else {
        alert(data.error || "下载失败");
      }
    } catch {
      alert("网络错误");
    } finally {
      setOfflineDownloading(false);
    }
  };

  const breadcrumbs = path ? path.split("/").filter(Boolean) : [];

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleObjects = normalizedQuery
    ? objects.filter((obj) => obj.name.toLowerCase().includes(normalizedQuery))
    : objects;
  const allVisibleSelected = visibleObjects.length > 0 && visibleObjects.every((obj) => selectedKeys.has(obj.key));

  // Get previewable files for navigation
  const previewableFiles = visibleObjects.filter((obj) => !obj.isDirectory && isPreviewable(obj.name));
  const currentPreviewIndex = previewFile ? previewableFiles.findIndex((f) => f.key === previewFile.key) : -1;

  const handlePreview = (obj: S3Object) => {
    if (isPreviewable(obj.name)) {
      setPreviewFile(obj);
    }
  };

  const handlePrevPreview = () => {
    if (currentPreviewIndex > 0) {
      setPreviewFile(previewableFiles[currentPreviewIndex - 1]);
    }
  };

  const handleNextPreview = () => {
    if (currentPreviewIndex < previewableFiles.length - 1) {
      setPreviewFile(previewableFiles[currentPreviewIndex + 1]);
    }
  };

  // Get file icon based on type
  const getFileIcon = (fileName: string) => {
    const type = getFileType(fileName);
    switch (type) {
      case 'video': return '🎬';
      case 'audio': return '🎵';
      case 'image': return '🖼️';
      case 'pdf': return '📕';
      case 'code': return '📝';
      case 'markdown': return '📑';
      case 'text': return '📄';
      default: return '📄';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between py-2 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-1 text-sm font-mono overflow-x-auto min-w-0">
          <button onClick={() => setPath("")} className="text-blue-500 hover:text-blue-400 shrink-0">
            {storage.name}
          </button>
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center shrink-0">
              <span className="text-zinc-400 dark:text-zinc-600 mx-1">/</span>
              <button
                onClick={() => navigateTo(breadcrumbs.slice(0, i + 1).join("/"))}
                className="text-blue-500 hover:text-blue-400"
              >
                {part}
              </button>
            </span>
          ))}
          {/* Selection info */}
          {selectedKeys.size > 0 && (
            <span className="ml-2 text-xs text-zinc-500 font-mono">
              (已选 {selectedKeys.size} 项)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文件..."
              className="w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 px-2 py-1 text-xs font-mono text-zinc-700 dark:text-zinc-200 rounded focus:border-blue-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-xs"
                title="清空搜索"
              >
                ×
              </button>
            )}
          </div>
          {/* Batch delete button */}
          {isAdmin && selectedKeys.size > 0 && (
            <button
              onClick={handleBatchDelete}
              disabled={deleting}
              className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white px-3 py-1 font-mono rounded"
            >
              {deleting ? "删除中..." : `删除 (${selectedKeys.size})`}
            </button>
          )}
          {path && (
            <button onClick={goUp} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1">
              ← 上级
            </button>
          )}
          <button onClick={loadFiles} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1">
            刷新
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setShowNewFolderInput(true)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1"
              >
                + 文件夹
              </button>
              <button
                onClick={() => setShowOfflineDownload(true)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1"
              >
                离线下载
              </button>
            </>
          )}
          {canUpload && (
            <label className={`text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 font-mono cursor-pointer rounded ${uploadProgress ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploadProgress ? '上传中...' : '上传'}
              <input type="file" multiple onChange={handleUpload} className="hidden" disabled={!!uploadProgress} />
            </label>
          )}
        </div>
      </div>

      {/* New Folder Input */}
      {showNewFolderInput && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 font-mono">新建文件夹:</span>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setShowNewFolderInput(false);
                  setNewFolderName("");
                }
              }}
              placeholder="输入文件夹名称"
              className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm font-mono text-zinc-900 dark:text-zinc-100 rounded focus:border-blue-500 focus:outline-none"
              autoFocus
              disabled={creatingFolder}
            />
            <button
              onClick={handleCreateFolder}
              disabled={creatingFolder || !newFolderName.trim()}
              className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 font-mono rounded"
            >
              {creatingFolder ? "创建中..." : "创建"}
            </button>
            <button
              onClick={() => {
                setShowNewFolderInput(false);
                setNewFolderName("");
              }}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Offline Download Input */}
      {showOfflineDownload && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 font-mono shrink-0">链接地址:</span>
              <input
                type="url"
                value={offlineUrl}
                onChange={(e) => setOfflineUrl(e.target.value)}
                placeholder="https://example.com/file.zip"
                className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm font-mono text-zinc-900 dark:text-zinc-100 rounded focus:border-blue-500 focus:outline-none"
                autoFocus
                disabled={offlineDownloading}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 font-mono shrink-0">文件名称:</span>
              <input
                type="text"
                value={offlineFilename}
                onChange={(e) => setOfflineFilename(e.target.value)}
                placeholder="可选，留空自动识别"
                className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm font-mono text-zinc-900 dark:text-zinc-100 rounded focus:border-blue-500 focus:outline-none"
                disabled={offlineDownloading}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleOfflineDownload();
                  if (e.key === "Escape") {
                    setShowOfflineDownload(false);
                    setOfflineUrl("");
                    setOfflineFilename("");
                  }
                }}
              />
              <button
                onClick={handleOfflineDownload}
                disabled={offlineDownloading || !offlineUrl.trim()}
                className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 font-mono rounded whitespace-nowrap"
              >
                {offlineDownloading ? "下载中..." : "开始下载"}
              </button>
              <button
                onClick={() => {
                  setShowOfflineDownload(false);
                  setOfflineUrl("");
                  setOfflineFilename("");
                }}
                disabled={offlineDownloading}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1"
              >
                取消
              </button>
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-600 font-mono">
              提示: 文件将下载到当前目录，大文件可能需要较长时间
            </p>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono truncate flex-1">
              正在上传: {uploadProgress.name}
              {uploadProgress.totalParts && (
                <span className="text-zinc-400 dark:text-zinc-500 ml-1">
                  ({uploadProgress.currentPart}/{uploadProgress.totalParts} 分片)
                </span>
              )}
            </span>
            {uploadProgress.speed !== undefined && uploadProgress.speed > 0 && (
              <span className="text-xs text-blue-500 font-mono shrink-0">
                {formatSpeed(uploadProgress.speed)}
              </span>
            )}
            <span className="text-xs text-zinc-500 font-mono w-12 text-right">
              {uploadProgress.progress}%
            </span>
          </div>
          <div className="mt-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-150"
              style={{ width: `${uploadProgress.progress}%` }}
            />
          </div>
          {uploadProgress.loaded !== undefined && uploadProgress.total !== undefined && (
            <div className="mt-1 text-xs text-zinc-400 dark:text-zinc-500 font-mono">
              {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadProgress.total)}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 font-mono text-sm">
            加载中...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-500 dark:text-red-400 font-mono text-sm">
            {error}
          </div>
        ) : objects.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-400 dark:text-zinc-600 font-mono text-sm">
            空目录
          </div>
        ) : (
          <table className="w-full text-sm font-mono">
            <thead className="text-xs text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-zinc-50 dark:bg-zinc-900">
              <tr>
                {isAdmin && (
                  <th className="py-2 px-2 w-8">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                    />
                  </th>
                )}
                <th className="text-left py-2 px-4 font-normal">名称</th>
                <th className="text-right py-2 px-4 font-normal w-24">大小</th>
                <th className="text-right py-2 px-4 font-normal w-44">修改时间</th>
                <th className="text-right py-2 px-4 font-normal w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleObjects.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAdmin ? 5 : 4}
                    className="py-6 text-center text-zinc-400 dark:text-zinc-600"
                  >
                    没有匹配的文件
                  </td>
                </tr>
              ) : visibleObjects.map((obj) => (
                <tr
                  key={obj.key}
                  className={`border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 ${
                    selectedKeys.has(obj.key) ? "bg-blue-50 dark:bg-blue-900/20" : ""
                  }`}
                >
                  {isAdmin && (
                    <td className="py-2 px-2">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(obj.key)}
                        onChange={() => toggleSelect(obj.key)}
                        className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800"
                      />
                    </td>
                  )}
                  <td className="py-2 px-4">
                    {obj.isDirectory ? (
                      <button
                        onClick={() => navigateTo(obj.key)}
                        className="flex items-center gap-2 text-blue-500 hover:text-blue-400"
                      >
                        <span className="text-yellow-500">📁</span>
                        {obj.name}
                      </button>
                    ) : isPreviewable(obj.name) ? (
                      <button
                        onClick={() => handlePreview(obj)}
                        className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 hover:text-blue-500 dark:hover:text-blue-400"
                      >
                        <span>{getFileIcon(obj.name)}</span>
                        {obj.name}
                      </button>
                    ) : (
                      <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                        <span className="text-zinc-400 dark:text-zinc-500">{getFileIcon(obj.name)}</span>
                        {obj.name}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-4 text-right text-zinc-500">
                    {obj.isDirectory ? "-" : formatBytes(obj.size)}
                  </td>
                  <td className="py-2 px-4 text-right text-zinc-500">
                    {formatDate(obj.lastModified)}
                  </td>
                  <td className="py-2 px-4 text-right">
                    {obj.isDirectory ? (
                      isAdmin && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startShare(obj)}
                            className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                            title="分享"
                          >
                            🡭
                          </button>
                          <button
                            onClick={() => startRename(obj)}
                            className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                            title="重命名"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => startMove(obj)}
                            className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                            title="移动"
                          >
                            ⤷
                          </button>
                          <button
                            onClick={() => deleteFolder(obj.key, obj.name)}
                            className="text-zinc-400 dark:text-zinc-500 hover:text-red-500"
                            title="删除文件夹"
                          >
                            ×
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {canDownload && isPreviewable(obj.name) && (
                          <button
                            onClick={() => handlePreview(obj)}
                            className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                            title="预览"
                          >
                            ▶
                          </button>
                        )}
                        {canDownload && (
                          <button
                            onClick={() => downloadFile(obj.key)}
                            className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                            title="下载"
                          >
                            ↓
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => startShare(obj)}
                              className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                              title="分享"
                            >
                              🡭
                            </button>
                            <button
                              onClick={() => startRename(obj)}
                              className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                              title="重命名"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => startMove(obj)}
                              className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                              title="移动"
                            >
                              ⤷
                            </button>
                            <button
                              onClick={() => deleteFile(obj.key)}
                              className="text-zinc-400 dark:text-zinc-500 hover:text-red-500"
                              title="删除"
                            >
                              ×
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreview
          storageId={storage.id}
          fileKey={previewFile.key}
          fileName={previewFile.name}
          onClose={() => setPreviewFile(null)}
          onPrev={handlePrevPreview}
          onNext={handleNextPreview}
          hasPrev={currentPreviewIndex > 0}
          hasNext={currentPreviewIndex < previewableFiles.length - 1}
        />
      )}

      {/* Rename Modal */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setRenameTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm">重命名</span>
              <button onClick={() => setRenameTarget(null)} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1 font-mono">新名称</label>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename()}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setRenameTarget(null)}
                  className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleRename}
                  disabled={renaming || !renameValue.trim()}
                  className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50 rounded"
                >
                  {renaming ? "处理中..." : "确定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareTarget && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShareTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm">生成分享链接</span>
              <button onClick={() => setShareTarget(null)} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-xs text-zinc-500 mb-2 font-mono">
                分享: {shareTarget.name}
              </div>

              {!shareUrl ? (
                <>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1 font-mono">过期时间</label>
                    <select
                      value={shareExpireHours}
                      onChange={(e) => setShareExpireHours(parseInt(e.target.value, 10))}
                      className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                    >
                      <option value={0}>永不过期</option>
                      <option value={1}>1 小时</option>
                      <option value={24}>1 天</option>
                      <option value={168}>1 周</option>
                      <option value={720}>1 月</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShareTarget(null)}
                      className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleCreateShare}
                      disabled={creatingShare}
                      className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50 rounded"
                    >
                      {creatingShare ? "生成中..." : "生成链接"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1 font-mono">分享令牌</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={shareToken}
                          readOnly
                          className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-xs rounded"
                        />
                        <button
                          onClick={() => copyToClipboard(shareToken)}
                          className="px-3 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-sm rounded text-zinc-900 dark:text-zinc-100"
                        >
                          复制
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1 font-mono">分享链接</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={shareUrl}
                          readOnly
                          className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-xs rounded overflow-hidden"
                        />
                        <button
                          onClick={() => copyToClipboard(shareUrl)}
                          className="px-3 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-sm rounded text-zinc-900 dark:text-zinc-100"
                        >
                          复制
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShareTarget(null)}
                      className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm hover:bg-blue-600 rounded"
                    >
                      完成
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {moveTarget && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setMoveTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
              <span className="text-zinc-900 dark:text-zinc-100 font-mono text-sm">移动到</span>
              <button onClick={() => setMoveTarget(null)} className="text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">×</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="text-xs text-zinc-500 mb-2 font-mono">
                移动: {moveTarget.name}
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1 font-mono">目标文件夹</label>
                <select
                  value={moveDestPath}
                  onChange={(e) => setMoveDestPath(e.target.value)}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:border-blue-500 focus:outline-none rounded"
                >
                  {allFolders.map((folder) => (
                    <option key={folder} value={folder}>
                      {folder === "" ? "/ (根目录)" : "/" + folder}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setMoveTarget(null)}
                  className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                >
                  取消
                </button>
                <button
                  onClick={handleMove}
                  disabled={moving}
                  className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50 rounded"
                >
                  {moving ? "处理中..." : "确定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [isAdmin, setIsAdmin] = useState(loaderData.isAdmin);
  const [storages, setStorages] = useState<StorageInfo[]>(loaderData.storages);
  const [selectedStorage, setSelectedStorage] = useState<StorageInfo | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showStorageForm, setShowStorageForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsStorage, setStatsStorage] = useState<StorageInfo | null>(null);
  const [editingStorage, setEditingStorage] = useState<StorageInfo | null>(null);
  const [isDark, setIsDark] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const siteTitle = loaderData.siteTitle || "CList";
  const siteAnnouncement = loaderData.siteAnnouncement || "";
  const chunkSizeMB = loaderData.chunkSizeMB || 50;
  const webdavEnabled = loaderData.webdavEnabled || false;

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }

    // Show announcement on first visit (per session)
    if (siteAnnouncement) {
      const announcementShown = sessionStorage.getItem("announcement_shown");
      if (!announcementShown) {
        setShowAnnouncement(true);
        sessionStorage.setItem("announcement_shown", "true");
      }
    }
  }, [siteAnnouncement]);

  const toggleTheme = useCallback((event: React.MouseEvent) => {
    const newIsDark = !isDark;

    const changeTheme = () => {
      setIsDark(newIsDark);
      if (newIsDark) {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      }
    };

    if (!document.startViewTransition) {
      changeTheme();
      return;
    }

    const x = event.clientX;
    const y = event.clientY;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = document.startViewTransition(() => {
      changeTheme();
    });

    transition.ready.then(() => {
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${endRadius}px at ${x}px ${y}px)`,
      ];
      document.documentElement.animate(
        { clipPath: isDark ? clipPath : clipPath.reverse() },
        {
          duration: 400,
          easing: "ease-in-out",
          pseudoElement: isDark
            ? "::view-transition-new(root)"
            : "::view-transition-old(root)",
        }
      );
    });
  }, [isDark]);

  const refreshStorages = async () => {
    try {
      const res = await fetch("/api/storages");
      if (res.ok) {
        const data = (await res.json()) as { storages: StorageInfo[]; isAdmin: boolean };
        setStorages(data.storages);
        setIsAdmin(data.isAdmin);
      }
    } catch { /* ignore */ }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/storages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      setIsAdmin(false);
      setSelectedStorage(null);
      refreshStorages();
    } catch { /* ignore */ }
  };

  const handleDeleteStorage = async (s: StorageInfo) => {
    if (!confirm(`删除存储 "${s.name}"?`)) return;
    try {
      const res = await fetch(`/api/storages?id=${s.id}`, { method: "DELETE" });
      if (res.ok) {
        if (selectedStorage?.id === s.id) setSelectedStorage(null);
        refreshStorages();
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="h-screen overflow-hidden bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xl font-bold font-mono tracking-tight">CList</span>
          </div>
          <div className="flex-1 text-center min-w-0">
            <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400 truncate block">{siteTitle}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={toggleTheme}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1 whitespace-nowrap"
            >
              {isDark ? "☀ 亮色" : "☾ 暗色"}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono px-2 py-1 whitespace-nowrap"
            >
              ⚙ 设置
            </button>
            {isAdmin ? (
              <>
                <span className="text-xs text-green-600 dark:text-green-500 font-mono whitespace-nowrap">● 管理员</span>
                <button
                  onClick={handleLogout}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono whitespace-nowrap"
                >
                  登出
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowLogin(true)}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 font-mono whitespace-nowrap"
              >
                登录
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? "w-0" : "w-64"} border-r border-zinc-200 dark:border-zinc-800 shrink-0 bg-white dark:bg-zinc-900/50 flex flex-col transition-all duration-300 overflow-hidden relative`}>
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
            <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider whitespace-nowrap">存储列表</span>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  onClick={() => { setEditingStorage(null); setShowStorageForm(true); }}
                  className="text-xs text-blue-500 hover:text-blue-400 font-mono whitespace-nowrap"
                >
                  + 添加
                </button>
              )}
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-sm"
                title="收起侧边栏"
              >
                ‹
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {storages.length === 0 ? (
              <div className="p-4 text-center text-zinc-400 dark:text-zinc-600 text-xs font-mono whitespace-nowrap">
                暂无存储
              </div>
            ) : (
              storages.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center justify-between px-3 py-2 cursor-pointer border-l-2 transition ${
                    selectedStorage?.id === s.id
                      ? "border-blue-500 bg-blue-50 dark:bg-zinc-800/50"
                      : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  }`}
                  onClick={() => setSelectedStorage(s)}
                  onTouchStart={() => setSelectedStorage(s)}
                >
                  <div className="min-w-0">
                    <div className={`text-sm font-mono truncate ${selectedStorage?.id === s.id ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"}`}>
                      {s.name}
                    </div>
                    <div className="text-xs text-zinc-400 dark:text-zinc-600 font-mono whitespace-nowrap">
                      {s.isPublic ? "公开" : "私有"}
                    </div>
                  </div>
                  {isAdmin && (
                    <div 
                        className={`${
                          true ? "flex" : "hidden"
                        } items-center gap-1`}
                        onClick={(e) => e.stopPropagation()}
                     >
                      <button
                        onClick={() => { setStatsStorage(s); setShowStats(true); }}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-blue-500 dark:hover:text-blue-400 text-xs px-1"
                        title="统计"
                      >
                        📊
                      </button>
                      <button
                        onClick={() => { setEditingStorage(s); setShowStorageForm(true); }}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 text-xs px-1"
                        title="编辑"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDeleteStorage(s)}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 text-xs px-1"
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Sidebar Expand Button - only show when collapsed */}
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-4 h-8 flex items-center justify-center bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-500 dark:text-zinc-400 rounded-r text-xs shadow-sm transition-colors"
            title="展开侧边栏"
          >
            ›
          </button>
        )}

        {/* Main */}
        <main className="flex-1 bg-zinc-50 dark:bg-zinc-900 min-w-0 overflow-hidden">
          {selectedStorage ? (
            <FileBrowser storage={selectedStorage} isAdmin={isAdmin} isDark={isDark} chunkSizeMB={chunkSizeMB} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-600 font-mono text-sm">
              ← 选择存储以浏览文件
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2">
        <div className="flex items-center justify-center gap-4 text-xs text-zinc-500 dark:text-zinc-500 font-mono">
          <a
            href="https://github.com/ooyyh/Cloudflare-Clist"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-zinc-700 dark:hover:text-zinc-300 transition"
          >
            GitHub
          </a>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <button
            onClick={() => setShowChangelog(true)}
            className="hover:text-zinc-700 dark:hover:text-zinc-300 transition"
          >
            更新日志
          </button>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <span>Made by <span className="text-zinc-600 dark:text-zinc-400">ooyyh</span></span>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <span className="flex items-center gap-1">
            Powered by
            <a
              href="https://www.cloudflare.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-orange-500 hover:text-orange-400 transition"
            >
              Cloudflare
            </a>
          </span>
        </div>
      </footer>

      {/* Modals */}
      {showLogin && (
        <LoginModal
          onLogin={() => { setShowLogin(false); refreshStorages(); setIsAdmin(true); }}
          onClose={() => setShowLogin(false)}
        />
      )}
      {showStorageForm && (
        <StorageModal
          storage={editingStorage || undefined}
          onSave={() => { setShowStorageForm(false); setEditingStorage(null); refreshStorages(); }}
          onCancel={() => { setShowStorageForm(false); setEditingStorage(null); }}
        />
      )}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          siteTitle={siteTitle}
          siteAnnouncement={siteAnnouncement}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          isAdmin={isAdmin}
          onRefreshStorages={refreshStorages}
          webdavEnabled={webdavEnabled}
          storages={storages}
        />
      )}
      {showAnnouncement && siteAnnouncement && (
        <AnnouncementModal
          announcement={siteAnnouncement}
          onClose={() => setShowAnnouncement(false)}
        />
      )}
      {showChangelog && (
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      )}
      {showStats && statsStorage && (
        <StorageStatsModal
          storage={statsStorage}
          onClose={() => { setShowStats(false); setStatsStorage(null); }}
        />
      )}
    </div>
  );
}
