# Issue #10：Remote 消费与静态交付

2026-09-28，本轮范围内实现与本地验收通过；未执行远端 CI、发布或 Fresh Compose。基线：前端 `436fa85bf920d8bd7e474a794aca7b65895c7f58`，后端工作区 `da4567c859b200d375b4eed6d69e9d557cf60048`，固定 npm Client `0.4.0`。后端由开发者预先启动，本轮未重启业务服务；工作区版本不冒充运行中 JAR 的制品证明。

## 实现与迁移

- 开发模式或显式 `static-acceptance` 构建，在真实 Tenant `/workbench` 显示 Remote 验收区。默认生产构建不加载夹具组件；不添加产品菜单、动态 Manifest 或业务 Remote。
- 旧消费夹具保留名称输入、键盘提交和反馈；只接收展示能力，不导入认证 Runtime、API Client 或凭据。语言来自现有 vue-i18n，主题和品牌色来自现有 Element Plus/宿主主题，品牌名称由权威宿主状态即时读取。
- 原夹具实际使用的 ICU `{name}` 插值保持文本语义，输入 `<script>` 按文本显示。精确数字/金额不转浮点、不舍入、不丢尾随零；日历日期按 UTC 格式化避免跨天，时间点保留本地时区语义，非法数据返回安全文案。
- 静态 v1/v2 的六个文件逐一匹配历史冻结 SHA-256；来源和不可变约束见 [夹具说明](../../fixtures/static-remote/README.md)。下载由固定路径和 `credentials: omit`、`redirect: error` 限制，校验 MIME 后交由临时 Blob URL 执行/加载。
- 普通会话核验 `checking` 保留同一上下文内容并禁用控件；切换 session/revision、失去上下文或卸载时清理。十秒超时、加载取消、失败重试和晚到结果防挂载都有明确处理。
- 后端现有静态 handler 已只许可统一 Console；本轮未扩展来源白名单。后端原有 `.dockerignore` 修改未触碰。

## 验收对照

真实环境：桌面 Google Chrome `154.0.8037.57`，1440×1050 与 1000×800；系统受信 HTTPS Console → Gateway → 独立 Remote 域。Browser plugin not available，使用已安装 Playwright 驱动 Chrome，无 TLS 忽略参数。

| 标准 | 证据与结果 |
| --- | --- |
| 统一宿主消费、语言/主题/Tenant 品牌 | 真账号经登录与工作区切换进入 `/workbench`。中英文即时切换，反馈字符串随语言变化；暗色主题正常；公司 1 显示权威品牌并使用 `rgb(22, 78, 99)`，公司 2 无 Profile 回退平台色 `rgb(100, 108, 255)`。 |
| Remote 不创建认证 Runtime、不读取凭据 | 消费组件只导入 Vue 和展示能力类型；冻结模块仅创建文本 DOM。未引入旧 UI/认证包；现有正式 Client 版本不变。源码检查补充真实网络证据，不将静态检查当作浏览器隔离沙箱证明。 |
| 脚本、样式、图片执行及清理 | 两版本模块执行，实测边框 7px/11px，图片解码尺寸 24×16/32×20。卸载、取消重载、Tenant 切换后无残留 Remote DOM/CSS；同一会话核验保留表单及已加载版本。 |
| 匿名交付与精确来源策略 | Remote 域预置非敏感测试 Cookie 后，CDP request/ExtraInfo 均确认六类资源无 Cookie、Authorization、X-SF-CSRF，200 响应仅允许统一 Console 且无 Allow-Credentials。API、旧 Platform/Tenant、攻击域、opaque/null 无 Remote CORS 读取许可；Remote/攻击域访问真实 Gateway JWKS 均 403 且无 CORS 许可。每个拒绝响应按目标 URL/requestId 关联。 |
| 格式化、键盘、焦点与视觉 | 30 位整数与 `.0012300`、大金额 `.400` 精度保留；中文日期和英文 Jan 2, 2026、当地时间正确。Tab/Enter 完成反馈，焦点轮廓可见，实际 `<script>` 字符串不执行。Remote 深色正文使用宿主语义文字色；无 pageerror、框架错误遮罩或空白页。 |
| 静态交付与独立消费 | 前端独立 `build:static-remote` 校验/复制成功；现有后端独立静态交付 3 项测试通过，无后端读取前端源码。完整前端 Node 测试 210/210、类型检查、lint、生产构建通过。 |

来源探针仅替换起始空白文档以建立 API、Remote、旧入口、攻击及 opaque 来源；目标 Remote/Gateway 的响应未模拟。网络失败测试单独注入一次 CSS 请求失败，断言错误与清理后解除注入，使用真实资源验证同版本重试成功；它不是正常链路证据。

持久结果：[展示与交互](assets/issue-10/ui.json)、[资源与来源隔离](assets/issue-10/static.json)、[英文深色](assets/issue-10/dark-en.png)、[v2 实际呈现](assets/issue-10/static-v2.png)。截图遮蔽账号，JSON 只包含状态和凭据存在性，不保存原始 headers、Cookie、密码或 Token。被取消请求可能无响应状态，不能将缺失状态记成 200。

## 环境准备与复现

1. 在独立前端执行 `pnpm run dev`，连接开发者已启动的后端；登录已有 Tenant 测试账号，打开 `/workbench`。正式入口仍为受信 HTTPS。
2. 先构建 Console（如需），再执行 `pnpm build:static-remote`，避免 Console build 清空 `dist` 后丢失静态制品。环境维护者把 `dist/static-remote-acceptance` 只读挂载到其 Remote 静态服务，映射 `/static-acceptance/v1|v2/`。本轮经用户明确授权，仅重建现有 Edge 加入 `/app/remote-artifacts` 只读挂载；API target、证书、白名单及业务服务保持不变。
3. 品牌验收复用已有真实 Profile。该 Profile 的 logo/favicon 原先缺失，导致正确回退；本轮在其 `/brands/issue205/` 路径临时提供两份现有公开 `public/favicon.svg`，通过真实 Vite HTTP 下载验证品牌完整加载。测试结束移除这两份临时文件，不修改数据库 Profile；在其他环境使用其自己的完整品牌和匿名素材。
4. `scripts/remote-browser-checks.mjs` 导出 `observeRemoteRequests`、`verifyRemoteRendering`、`verifyRemoteLifecycle`、`verifyRemoteRetry`、`verifyRemoteIsolation`，接收调用方已登录的 Chrome Page/Context。先开启观测，再渲染两版本，最后 `finish()`；生命周期/会话核验 helper 通过 Dev 模式公开模块入口运行，不能直接用于生产构建。账号登录由受限本机脚本提供，不提交凭据或会话缓存。
5. 本仓 `pnpm test`、`pnpm typecheck`、`pnpm build`；后端在其自身仓库执行 `node --test scripts/test/remote-static-delivery.test.mjs`。两仓检查分别运行，不恢复旧 `consoles/` 依赖。

## 审查与边界

Standards 审查发现普通会话核验误清空夹具，以及来源探针未关联目标响应，均已修复并重跑真实检查。Spec 审查要求补齐真实匿名交付、来源拒绝和持久证据，已按上表补齐。没有新增依赖、改认证协议、权限、数据库或部署安全策略。

未执行完整 CI、Fresh Compose、其他业务流程或旧浏览器矩阵；本记录不代替父 PRD、#206 或完整安全验收。当前夹具是可信同 Realm 代码，其受限展示能力约束不是恶意 JavaScript 的安全沙箱。
