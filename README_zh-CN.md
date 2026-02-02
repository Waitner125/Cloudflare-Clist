# CList - 云存储聚合服务

一个基于 Cloudflare Workers 和 D1 数据库部署的云存储聚合服务平台。

[English](./README.md) | 简体中文

## 功能介绍

CList 是一个强大的云存储管理平台，提供以下核心功能：

### 文件管理功能
- **文件上传与下载**：支持大文件分块上传，可自定义分块大小，确保稳定的文件传输
- **文件预览**：内置文件预览功能，支持多种文件格式的在线查看
- **目录管理**：完整的目录结构管理，支持创建、删除、移动文件和文件夹
- **文件搜索**：快速检索存储在各个后端的文件

### 多存储后端支持
- **S3 兼容存储**：支持任何兼容 S3 协议的存储服务（如 AWS S3、MinIO、阿里云 OSS、腾讯云 COS 等）
- **多存储管理**：可同时管理多个不同的存储后端，统一界面操作
- **存储配置**：灵活配置存储的访问密钥、区域、桶名称、基础路径等参数
- **存储类型标识**：为每个存储后端设置名称和类型，便于区分管理

### 访问控制与安全
- **管理员认证**：基于用户名和密码的管理员身份验证系统
- **会话管理**：安全的会话管理机制，支持会话过期控制
- **访客权限**：灵活的访客权限设置，可独立控制：
  - 访客是否可以浏览文件列表
  - 访客是否可以下载文件
  - 访客是否可以上传文件
- **公开/私有存储**：可设置存储后端为公开或私有，控制访问范围

### 文件分享功能
- **分享链接生成**：为文件或目录生成专属的分享链接
- **分享过期设置**：可设置分享链接的有效期，增强安全性
- **分享令牌管理**：每个分享链接都有唯一的令牌标识
- **目录分享**：支持分享整个目录，方便批量文件共享

### 响应式 Web 界面
- **现代化设计**：采用 Tailwind CSS 构建的美观现代界面
- **响应式布局**：完美适配桌面、平板和移动设备
- **直观操作**：简洁友好的用户界面，降低使用门槛
- **实时反馈**：操作状态实时显示，提升用户体验

### WebDAV 服务支持
- **对外提供 WebDAV**：将 CList 存储通过 WebDAV 协议对外提供服务
- **多端访问**：支持 Windows、macOS、Linux 及移动设备通过 WebDAV 客户端访问
- **灵活认证**：支持独立的 WebDAV 用户名密码，或使用管理员账号
- **存储访问**：可访问所有已配置的存储后端
- **设置界面**：在设置中查看 WebDAV 服务状态和访问地址

### Cloudflare 平台集成
- **Workers 部署**：基于 Cloudflare Workers 的无服务器架构，全球快速访问
- **D1 数据库**：使用 Cloudflare D1 SQLite 数据库存储元数据和配置
- **数据库迁移**：完善的数据库迁移机制，便于版本升级
- **边缘计算**：利用 Cloudflare 全球边缘网络，提供低延迟访问

### 技术特性
- **TypeScript 开发**：全程使用 TypeScript 编写，类型安全有保障
- **React Router v7**：采用最新的 React Router 框架构建单页应用
- **Vite 构建**：使用 Vite 作为构建工具，开发和构建速度快
- **代码高亮**：集成 highlight.js，支持代码文件语法高亮显示
- **Markdown 支持**：集成 marked 库，支持 Markdown 文件的渲染显示

## 前置要求

部署应用前，请确保具备以下条件：

- Node.js (v18 或更高版本)
- npm 或 yarn 包管理器
- 已启用 Workers 的 Cloudflare 账户
- 全局安装 Wrangler CLI：`npm install -g wrangler`

## 安装步骤

1. 克隆仓库：
```bash
git clone https://github.com/ooyyh/Cloudflare-Clist.git
cd Cloudflare-Clist
```

2. 安装依赖：
```bash
npm install
```

## 配置说明

### 环境设置

1. 登录 Cloudflare：
```bash
wrangler login
```

2. 创建 D1 数据库：
```bash
wrangler d1 create clist
```

3. 在 `wrangler.jsonc` 文件中更新您的数据库 ID 和环境变量：
```json
{
  "vars": {
    "VALUE_FROM_CLOUDFLARE": "来自 Cloudflare 的问候",
    "ADMIN_USERNAME": "您的管理员用户名",
    "ADMIN_PASSWORD": "您的安全密码",
    "SITE_TITLE": "您的网站标题",
    "SITE_ANNOUNCEMENT": "欢迎使用 CList 云存储服务！",
    "CHUNK_SIZE_MB": "10"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "clist",
      "database_id": "您的数据库_ID"
    }
  ]
}
```

### 数据库迁移

运行数据库迁移以创建所需的表结构：

```bash
wrangler d1 migrations apply clist
```

## 开发

在开发模式下运行应用：

```bash
npm run dev
```

这将启动支持热重载的开发服务器。

## 构建

构建生产环境应用：

```bash
npm run build
```

此命令会为客户端和服务器创建优化后的构建版本。

## 部署

### 部署到 Cloudflare Workers

将应用部署到 Cloudflare Workers：

```bash
npm run deploy
```

此命令将：
1. 构建应用
2. 部署到 Cloudflare Workers

### 手动部署

或者，您可以分别构建和部署：

```bash
npm run build
wrangler deploy
```

## 环境变量说明

应用使用以下环境变量：

- `ADMIN_USERNAME`：访问服务的管理员用户名
- `ADMIN_PASSWORD`：访问服务的管理员密码
- `SITE_TITLE`：网站上显示的标题
- `SITE_ANNOUNCEMENT`：主页显示的公告文本
- `CHUNK_SIZE_MB`：文件上传的最大分块大小（单位：MB）
- `WEBDAV_ENABLED`：是否启用 WebDAV 服务（设为 "true" 启用）
- `WEBDAV_USERNAME`：WebDAV 访问用户名（可选，默认使用管理员用户名）
- `WEBDAV_PASSWORD`：WebDAV 访问密码（可选，默认使用管理员密码）

## WebDAV 配置

### 启用 WebDAV

在 Cloudflare Workers 环境变量中设置：

```json
{
  "vars": {
    "WEBDAV_ENABLED": "true",
    "WEBDAV_USERNAME": "your_webdav_username",  // 可选
    "WEBDAV_PASSWORD": "your_webdav_password"   // 可选
  }
}
```

### WebDAV 访问地址

启用后，可通过以下地址访问：

- 所有存储根目录：`https://your-domain/dav/0/`
- 指定存储：`https://your-domain/dav/{storage_id}/`

### 客户端连接

- **Windows**：映射网络驱动器，输入 WebDAV 地址
- **macOS**：Finder → 前往 → 连接服务器
- **Linux**：使用 davfs2 或文件管理器
- **移动端**：使用支持 WebDAV 的文件管理 App

## 数据库架构

应用使用 D1 数据库，迁移文件位于 `migrations/` 目录。数据库架构在 `schema.sql` 中定义，包含以下表：

- **storages**：存储后端配置信息（S3 兼容存储）
- **sessions**：用户会话管理
- **shares**：文件分享链接管理

## 本地预览

本地预览生产构建版本：

```bash
npm run preview
```

## 类型检查

运行 TypeScript 类型检查：

```bash
npm run typecheck
```

此命令将生成 Cloudflare 类型并运行 TypeScript 编译。

## 项目结构

```
├── app/                    # React Router 应用源码
│   ├── components/         # React 组件
│   ├── lib/                # 工具库
│   ├── routes/             # 路由定义
│   └── types/              # 类型定义
├── migrations/            # D1 数据库迁移文件
├── workers/               # Cloudflare Workers 入口
├── package.json           # 项目依赖和脚本
├── wrangler.jsonc         # Cloudflare Workers 配置
├── vite.config.ts         # Vite 构建配置
└── tsconfig.json          # TypeScript 配置
```

## 使用的技术

- React Router v7 - 现代 React 框架
- Cloudflare Workers - 边缘计算平台
- Cloudflare D1 Database - SQLite 数据库
- Vite - 构建工具
- TypeScript - 类型安全的 JavaScript
- Tailwind CSS - 实用优先的 CSS 框架

## 支持与联系

如需帮助，请联系：
- GitHub: [https://github.com/ooyyh](https://github.com/ooyyh)
- Email: laowan345@gmail.com

## 许可证

本项目按照仓库中指定的条款进行许可。
