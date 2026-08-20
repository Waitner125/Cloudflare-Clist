# Configuration Reference

## Environment Variables

The application uses the following environment variables:

| Variable | Description |
| --- | --- |
| `ADMIN_USERNAME` | Administrator username for accessing the service |
| `ADMIN_PASSWORD` | Administrator password for accessing the service |
| `SITE_TITLE` | Title displayed on the website |
| `SITE_ANNOUNCEMENT` | Announcement text shown on the homepage |
| `CHUNK_SIZE_MB` | Maximum file chunk size in MB for uploads |

> **注意**：WebDAV 服务不再使用环境变量配置。启用状态、用户名与密码在项目的「设置 → WebDAV 服务」页面中配置，并加密存储于 D1 数据库（`webdav_config` 表）。

## Wrangler Configuration

Create or update the `wrangler.jsonc` file with your specific database ID and environment variables:

```json
{
  "vars": {
    "VALUE_FROM_CLOUDFLARE": "Hello from Cloudflare",
    "ADMIN_USERNAME": "your_admin_username",
    "ADMIN_PASSWORD": "your_secure_password",
    "SITE_TITLE": "Your Site Title",
    "SITE_ANNOUNCEMENT": "Welcome to CList storage service!",
    "CHUNK_SIZE_MB": "10"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "clist",
      "database_id": "your_database_id_here"
    }
  ]
}
```

## Database Migrations

Run the database migrations to set up the required tables:

```bash
wrangler d1 migrations apply clist
```

## Database Schema

The application uses a D1 database with migrations located in the `migrations/` directory. The schema includes:

- **storages** - Storage backend configuration (S3-compatible)
- **sessions** - User session management
- **shares** - File sharing link management

## Project Structure

```
├── app/                    # React Router application source
│   ├── components/         # React components
│   ├── lib/                # Utility libraries
│   ├── routes/             # Route definitions
│   └── types/              # Type definitions
├── docs/                  # Project documentation
├── migrations/            # D1 database migrations
├── workers/               # Cloudflare Workers entry point
├── package.json           # Project dependencies and scripts
├── wrangler.jsonc         # Cloudflare Workers configuration
├── vite.config.ts         # Vite build configuration
└── tsconfig.json          # TypeScript configuration
```
