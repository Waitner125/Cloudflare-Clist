# CList - Cloud Storage Aggregation Service

A cloud storage aggregation service deployed on Cloudflare Workers with D1 database support.

English | [简体中文](./README_zh-CN.md)

## Features

- File storage and management
- Cloudflare Workers deployment
- D1 database integration
- Responsive web interface
- File preview capabilities
- Multi-storage backend support
- **WebDAV server support** - Access your storages via WebDAV protocol

## Prerequisites

Before deploying this application, ensure you have the following:

- Node.js (v18 or higher)
- npm or yarn package manager
- Cloudflare account with Workers enabled
- Wrangler CLI installed globally: `npm install -g wrangler`

## Installation

1. Clone the repository:
```bash
git clone https://github.com/ooyyh/Cloudflare-Clist.git
cd Cloudflare-Clist
```

2. Install dependencies:
```bash
npm install
```

## Configuration

### Environment Setup

1. Log in to Cloudflare:
```bash
wrangler login
```

2. Create a D1 database:
```bash
wrangler d1 create clist
```

3. Update the `wrangler.jsonc` file with your specific database ID and environment variables:
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

### Database Migrations

Run the database migrations to set up the required tables:

```bash
wrangler d1 migrations apply clist
```

## Development

To run the application in development mode:

```bash
npm run dev
```

This will start the development server with hot reloading.

## Building

To build the application for production:

```bash
npm run build
```

This creates optimized builds for both client and server.

## Deployment

### Deploy to Cloudflare Workers

To deploy the application to Cloudflare Workers:

```bash
npm run deploy
```

This command will:
1. Build the application
2. Deploy it to Cloudflare Workers

### Manual Deployment

Alternatively, you can build and deploy separately:

```bash
npm run build
wrangler deploy
```

## Environment Variables

The application uses the following environment variables:

- `ADMIN_USERNAME`: Administrator username for accessing the service
- `ADMIN_PASSWORD`: Administrator password for accessing the service
- `SITE_TITLE`: Title displayed on the website
- `SITE_ANNOUNCEMENT`: Announcement text shown on the homepage
- `CHUNK_SIZE_MB`: Maximum file chunk size in MB for uploads
- `WEBDAV_ENABLED`: Set to "true" to enable WebDAV server
- `WEBDAV_USERNAME`: WebDAV access username (optional, defaults to admin username)
- `WEBDAV_PASSWORD`: WebDAV access password (optional, defaults to admin password)

## WebDAV Configuration

### Enabling WebDAV

Set the following in Cloudflare Workers environment variables:

```json
{
  "vars": {
    "WEBDAV_ENABLED": "true",
    "WEBDAV_USERNAME": "your_webdav_username",
    "WEBDAV_PASSWORD": "your_webdav_password"
  }
}
```

### WebDAV Access URLs

Once enabled, access your storages via:

- All storages root: `https://your-domain/dav/0/`
- Specific storage: `https://your-domain/dav/{storage_id}/`

### Client Connection

- **Windows**: Map network drive with WebDAV URL
- **macOS**: Finder → Go → Connect to Server
- **Linux**: Use davfs2 or file manager
- **Mobile**: Use any WebDAV-compatible file manager app

## Database Schema

The application uses a D1 database with migrations located in the `migrations/` directory. The schema is defined in `schema.sql`.

## Local Preview

To preview the production build locally:

```bash
npm run preview
```

## Type Checking

To run TypeScript type checking:

```bash
npm run typecheck
```

This will generate Cloudflare types and run TypeScript compilation.

## Project Structure

```
├── app/                    # React Router application source
│   ├── components/         # React components
│   ├── lib/                # Utility libraries
│   ├── routes/             # Route definitions
│   └── types/              # Type definitions
├── migrations/            # D1 database migrations
├── workers/               # Cloudflare Workers entry point
├── package.json           # Project dependencies and scripts
├── wrangler.jsonc         # Cloudflare Workers configuration
├── vite.config.ts         # Vite build configuration
└── tsconfig.json          # TypeScript configuration
```

## Technologies Used

- React Router v7
- Cloudflare Workers
- Cloudflare D1 Database
- Vite build tool
- TypeScript
- Tailwind CSS

## Support

For support, please contact:
- GitHub: [https://github.com/ooyyh](https://github.com/ooyyh)
- Email: laowan345@gmail.com

## License

This project is licensed under the terms specified in the repository.