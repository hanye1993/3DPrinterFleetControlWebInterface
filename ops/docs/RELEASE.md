# 三仓库发版说明

GitHub / Gitee / GitCode **只同步源码、Markdown 与版本标签**。  
**不要**把一键安装包（exe / dmg / deb / rpm / fpk / spk）或 `installer-src-*.zip` 上传到 Release 附件。

## 流程

1. 提升 `package.json` 版本，同步 README、`ops/docs/INSTALL.md`、`packages-src/*/README.md` 中的版本号  
2. 提交源码与文档，打标签 `vX.Y.Z`  
3. `npm run push:mirrors` — 推送到三端（含 tags）  
4. `npm run publish:release` — **仅初始化** Release 文案（不挂附件）

平台会自动附带源码归档（`vX.Y.Z.zip` / tar），可保留。

## 一键包（仅本地）

```bash
npm run pack:win
npm run pack:mac
npm run pack:linux
npm run pack:fnos
npm run pack:syno:all
npm run pack:installer-src
```

产物在 `packages/`（已被 gitignore）。分发一键包请用网盘 / 私有渠道，勿再往三端 Release 挂包。
