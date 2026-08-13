-- Demo plugin install schema (USE_MYSQL=1)
-- Tables must use prefix plugin_demo_kernel_v2_ via ensureTable preferably;
-- raw SQL here is optional for Discuz-parity packs.
CREATE TABLE IF NOT EXISTS plugin_demo_kernel_v2_meta (
  k VARCHAR(64) PRIMARY KEY,
  v TEXT NULL
);
