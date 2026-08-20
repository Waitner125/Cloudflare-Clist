# WebDAV 快速配置

## 启用 WebDAV

WebDAV 服务在**项目设置页面**中启用并配置，**无需环境变量**：

1. 登录管理员账号，打开「设置」弹窗
2. 切换到「WebDAV 服务」选项
3. 打开 **启用开关**
4. 设置 **用户名** 与 **密码**（保存时加密存储）
5. 点击 **保存**

> 配置加密存储于 D1 数据库（`webdav_config` 表），不通过 `wrangler.jsonc` 的 `vars` 或环境变量推送。启用后，访问需使用设置页面中配置的用户名 / 密码进行 HTTP Basic Auth 认证。

## WebDAV 访问 URL

启用后，通过以下方式访问存储：

- 所有存储根目录: `https://your-domain/dav/0/`
- 特定存储: `https://your-domain/dav/{storage_id}/`

⚠️ **重要**: URL 必须以斜杠 `/` 结尾！

例如：
- ✅ 正确：`https://your-domain/dav/11/`
- ❌ 错误：`https://your-domain/dav/11`

## 客户端连接

### Windows

映射网络驱动器，使用 WebDAV URL。

**推荐第三方客户端**：
- RaiDrive
- NetDrive
- Cyberduck

### macOS

Finder → 前往 → 连接到服务器，输入 WebDAV URL。

### Linux

使用 `davfs2` 或文件管理器的内置 WebDAV 支持。

### 移动设备

使用任何支持 WebDAV 的文件管理器应用（例如：Documents、FE File Explorer）。

## 故障排查

### 错误 405 Method Not Allowed

**原因**：
1. 直接用浏览器 GET 访问了不支持的方法（浏览器访问 `/dav/0/` 已支持返回 HTML 目录列表；若仍 405 请确认 URL 与尾斜杠）
2. URL 格式不正确（缺少尾部斜杠）

**解决方案**：
1. 确保 URL 以 `/` 结尾
2. 在设置页面确认 WebDAV 已启用、用户名与密码已配置

### 访问返回 401 / 403

- **401**：认证失败，请使用设置页面中配置的用户名 / 密码
- **403 WebDAV is disabled**：设置页面中的「启用开关」未打开

### 测试连接

```bash
# 测试 WebDAV 是否启用
curl -i -X OPTIONS https://your-domain/dav/11/

# 应该返回：
# DAV: 1, 2
# Allow: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE

# 测试认证和列表
curl -i -X PROPFIND \
  -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  -H "Depth: 1" \
  https://your-domain/dav/11/
```

## 完整文档

更多配置选项、客户端设置和故障排查，请参阅 [完整 WebDAV 配置指南](./WEBDAV_SETUP.md)。
