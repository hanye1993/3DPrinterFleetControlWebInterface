# QQ / 微信登录插件

对接 **QQ 互联**（网站应用）与 **微信开放平台**（网站应用扫码登录）。纯插件实现，不改宿主源码。

## 能力

| 能力 | 说明 |
|------|------|
| QQ / 微信登录 | OAuth2 授权码 → 换宿主 `grantToken` → JWT |
| 收集资料 | openid / unionid / 昵称 / 头像，写入插件绑定表，用户列表可见 |
| 手动解绑 | 用户管理行操作「解绑QQ / 解绑微信」 |
| `force_bind` | 密码登录后必须绑定 QQ 或微信 |
| `login_mode=all` | 密码 + QQ + 微信 |
| `login_mode=oauth_only` | 仅 QQ / 微信（拦截密码登录） |
| `login_mode=password_only` | 仅密码 |
| 自动建用户 | `auto_create=1` 时首次第三方登录创建本地用户 |

## 申请与回调

1. [QQ 互联](https://connect.qq.com/) 网站应用  
   - 回调：`https://你的域名/api/v1/qq-wx/callback/qq`
2. [微信开放平台](https://open.weixin.qq.com/) 网站应用  
   - 授权回调域填域名；完整回调：`https://你的域名/api/v1/qq-wx/callback/wechat`

安装启用后，在 **软件设置 → QQ/微信登录** 直接填写 AppID / Secret、登录方式、强制绑定等并保存（与插件 vars 同一套配置）。

## 安装

ZIP 根目录含 `plugin.json`，**软件设置 → 插件 → 上传 → 启用**。（本插件不内置）

## 说明

- 宿主内置 SSO 仅企微/钉钉/AD；本插件用私有 `bindings.json` 存 QQ/微信映射。
- 卡片/用户 `pluginData.qq_wx` 由 `users_list` 钩子附带展示。
- 生产环境请使用 HTTPS，并保证服务器能访问 `graph.qq.com` / `api.weixin.qq.com`。
