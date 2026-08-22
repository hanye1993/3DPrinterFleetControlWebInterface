# 巡查派单（farm_dispatch）1.0.9

## 修复

- **一直加载中**：宿主 CSP 禁内联脚本 → 改为外链 `static/*.js`
- **pageHtml is not a function**：升级后 Node 缓存旧 `_shell` → 加载前清缓存 + 兜底拼页

## 安装（可上传应用市场）

1. 上传 `farm_dispatch-1.0.9.zip` 并启用（**先停用再启用**，或重启监控台）
2. 软件设置 → 巡查派单 → 初始化用户组
3. 浏览器强制刷新后再开侧栏

根目录包：`farm_dispatch-1.0.9.zip`
