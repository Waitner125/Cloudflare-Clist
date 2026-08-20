-- WebDAV 服务配置（启用开关 / 用户名 / 密码），替代环境变量 WEBDAV_ENABLED/USERNAME/PASSWORD
CREATE TABLE IF NOT EXISTS webdav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  username TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 默认单行（默认关闭、未配置凭据）
INSERT OR IGNORE INTO webdav_config
  (id, enabled, username, password_hash)
VALUES
  (1, 0, '', NULL);
