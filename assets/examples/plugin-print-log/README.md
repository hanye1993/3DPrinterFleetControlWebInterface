# 打印记录（print_log）

记录打印机任务：**时间、人员、来源、设备、文件、材料用量**。

## 能力

| 项 | 说明 |
|----|------|
| 系统发送 | 详情/控制台 `print_file`，记下当前登录用户 |
| 打印队列 | 提交/开始打印时关联操作人 |
| 批量打印 | 批量下发时按设备记一条 |
| 现场操作 | 机上开始的打印（无系统用户 → 记为「现场操作」） |
| 材料 | 尽量从设备状态 `filamentUsedGrams` 回填（品牌支持情况不一） |

## 入口

- **软件设置 → 打印记录**：勾选要记录的打印机、导航开关、保留策略（管理员）
- **侧栏「打印记录」**：查看列表（权限 `plugin.print_log.page`，可在用户权限里勾选）
- 设置里可关闭「显示侧栏导航」

## 安装

打 ZIP（根含 `plugin.json`）→ 软件设置 → 插件 / 应用市场 → 启用。

启用后请：

1. 软件设置 → 打印记录 → 保存要监控的设备  
2. 用户管理 → 给需要看记录的账号勾选 **打印记录** 权限  
3. 硬刷新页面

## API

- `GET /api/v1/print-log/config`
- `PUT /api/v1/print-log/config`（管理员）
- `GET /api/v1/print-log/records?q=&source=&status=&limit=`
- `DELETE /api/v1/print-log/records` body `{ id }` 或 `{ all: true }`（管理员）
