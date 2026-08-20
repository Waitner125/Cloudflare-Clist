-- WebDAV 服务配置（由设置页面自定义，替代环境变量）
-- 单行表 (id 固定为 1)，内容：启用状态、自定义认证、自定义端点前缀、自定义访问地址
CREATE TABLE IF NOT EXISTS webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  path_prefix TEXT NOT NULL DEFAULT 'dav',
  base_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 插入默认单行，保证 getWebdavConfig 有数据
INSERT OR IGNORE INTO webdav_config
  (id, enabled, username, password_hash, path_prefix, base_url)
VALUES
  (1, 0, '', NULL, 'dav', '');
