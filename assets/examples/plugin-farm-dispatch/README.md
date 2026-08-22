# 巡查派单（farm_dispatch）1.0.12

四个页面均在**监控台侧栏**打开。

| 侧栏 | 权限 / 用户组 |
|------|----------------|
| 巡查看板 | `plugin.farm_dispatch.patrol` / 巡查 |
| 派单审核 | `plugin.farm_dispatch.audit` / 审核 |
| 提交打印 | `plugin.farm_dispatch.submit` / 派单申请 |
| 派单日志 | `plugin.farm_dispatch.logs` |

## 1.0.12

- 巡查看板按**设备分组**展示与筛选（空分组 →「其他」）
- 仅显示当前用户 ACL 可查看的机器；无权限设备不可设状态/绑料

## 安装

1. 上传 ZIP → 启用（建议先停用再启用）
2. **软件设置 → 巡查派单 → 初始化用户组**
3. 用户加入对应组，并在用户管理中按分组/设备授权后刷新

## 打包

```bash
cd assets/examples/plugin-farm-dispatch
TMP=$(mktemp -d)
cp plugin.json main.js client.js theme.css install.js uninstall.js cover.png README.md "$TMP/"
cp -R modules static pages "$TMP/" 2>/dev/null || true
cd "$TMP" && zip -qr farm_dispatch-1.0.12.zip .
```
