# 公司聊天插件

登录后顶栏出现 **聊天** 按钮，侧栏可开闭。

## 功能

- **在线成员**：插件心跳维护（宿主无公开 presence API）
- **全员聊天室**：全员可见，消息持久化
- **私聊**：点击在线/最近成员；可设 `all`（全员可私聊）或 `admin_only`（仅管理员发起）
- **发文件**：聊天室/私聊均可；图片可预览；登录用户可下载  
- **查询**：设置页管理员按关键词查聊天室/私聊  
- **清理**：`retain_days` + 每小时 cron / 手动立即清理（含过期文件）

## 存储

- `USE_MYSQL=1`：表 `plugin_company_chat_room_msg` / `plugin_company_chat_dm_msg`
- 否则：插件私有 JSON（`room_messages.json` / `dm_messages.json`）
- 文件本体：`plugin-data/company_chat/files/`（Base64 经插件 API 上传）

## 安装

上传 ZIP（根目录含 `plugin.json`）后启用。（本插件不内置）

配置：**软件设置 → 公司聊天**。
