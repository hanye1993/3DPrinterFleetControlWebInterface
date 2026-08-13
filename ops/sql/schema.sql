-- hanye 3D printer monitor — MySQL schema
-- Charset: utf8mb4

CREATE TABLE IF NOT EXISTS app_config (
  `key` VARCHAR(64) PRIMARY KEY,
  `value` TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL DEFAULT '',
  level VARCHAR(16) NOT NULL DEFAULT 'viewer',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  password_hash VARCHAR(128) NOT NULL,
  password_salt VARCHAR(64) NOT NULL,
  permissions JSON NOT NULL,
  device_acl JSON NOT NULL,
  plugin_data JSON NULL,
  sso_provider VARCHAR(16) NOT NULL DEFAULT 'none',
  sso_external_id VARCHAR(256) NOT NULL DEFAULT '',
  banned_at DATETIME(3) NULL,
  ban_reason VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uk_username (username),
  KEY idx_sso (sso_provider, sso_external_id(64))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devices (
  id CHAR(36) PRIMARY KEY,
  data JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_secrets (
  secret_key VARCHAR(128) PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS filament_spools (
  id CHAR(36) PRIMARY KEY,
  data JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS monitor_zones (
  id CHAR(36) PRIMARY KEY,
  data JSON NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  data JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS print_requests (
  id CHAR(36) PRIMARY KEY,
  data JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  device_id CHAR(36) NOT NULL,
  requester_id CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_status (status),
  KEY idx_device (device_id),
  KEY idx_requester (requester_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote_schemes (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  data JSON NOT NULL,
  gcode MEDIUMTEXT NULL,
  gcode_file_name VARCHAR(256) NULL,
  updated_at DATETIME(3) NOT NULL,
  KEY idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS quote_history (
  id CHAR(36) PRIMARY KEY,
  data JSON NOT NULL,
  user_id VARCHAR(64) NULL,
  username VARCHAR(64) NULL,
  action VARCHAR(16) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_created (created_at),
  KEY idx_user (user_id),
  KEY idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS operation_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  data JSON NOT NULL,
  device_id VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_device_time (device_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Custom navigation tree
CREATE TABLE IF NOT EXISTS nav_config (
  id TINYINT PRIMARY KEY DEFAULT 1,
  data JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Installed plugins registry (enabled / vars / modules)
CREATE TABLE IF NOT EXISTS plugins_state (
  id TINYINT PRIMARY KEY DEFAULT 1,
  data JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Installed themes registry
CREATE TABLE IF NOT EXISTS themes_state (
  id TINYINT PRIMARY KEY DEFAULT 1,
  data JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-plugin JSON KV (api.readJson / writeJson) — package files stay on disk under data/plugins/
CREATE TABLE IF NOT EXISTS plugin_data (
  plugin_id VARCHAR(64) NOT NULL,
  rel_path VARCHAR(255) NOT NULL,
  data JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (plugin_id, rel_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Registry of tables created by plugins / themes via api.db.ensureTable
CREATE TABLE IF NOT EXISTS extension_schema (
  table_name VARCHAR(128) PRIMARY KEY,
  owner_kind VARCHAR(16) NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_owner (owner_kind, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
