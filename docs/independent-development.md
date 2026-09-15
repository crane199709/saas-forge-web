# 独立前端开发

本仓库保留完整 Soybean Admin Element Plus 底座与 MIT 许可证，上游固定提交为 `7613bd206cd42001b40e3eafceeb895dcbc277a8`。不需要取得 saas-forge 后端源码。使用 Node.js 24.14.1、pnpm 11.22.0；产品浏览器为桌面 Chrome 当前稳定版。

## 安装与构建

运行 `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run test`、`pnpm run build`。Client 使用 npm 官方公开包 `@crane199709/saas-forge-api-client`，精确版本与完整性见 `package.json`、`pnpm-lock.yaml`；构建不调用 Maven/JDK，也不要求后端在线。缺少 API 配置时仍可构建，页面连接检查会明确提示。

既有底座的 workspace 包属于本仓库自身，并非后端兄弟目录依赖。保留底座的安装、主题、国际化、组件和构建能力；本票正式入口仅为匿名连接检查，不启用演示登录或演示管理路由。受保护业务由后续票接入正式统一认证。

## 原生开发与 HTTPS

开发者自行维护被 Git 忽略的 `.env.local`，不提交个人配置模板。需要的非敏感配置为：`VITE_API_ORIGIN`（已启动 Gateway 的受信 HTTPS Origin）和 `SF_CONSOLE_ORIGIN`（本应用的受信 HTTPS 浏览器 Origin）。地址不得包含用户名、密码、路径、查询或片段；不要把服务端密钥放入任何 `VITE_` 变量。

`pnpm run dev` 仅启动 Vite，监听 `127.0.0.1:5174`，端口冲突直接失败。`SF_CONSOLE_ORIGIN` 缺失时拒绝开发启动。环境准备应先使受信 HTTPS 入口转发该前端监听端口及 WebSocket；浏览器打开配置的 HTTPS Console Origin，不能使用 Vite 内部 HTTP 地址替代。

HTTPS 入口和已启动 Gateway 由开发者管理，前端不启动、替换、重启或销毁它们。API 请求由浏览器直接发往唯一配置的 Gateway，无任意目标代理，不伪造 Cookie、Origin 或 Fetch Metadata。Gateway 必须允许当前 Console Origin；需要更换域名时同步环境的证书、域名和受控来源配置，不在前端绕过校验。

当前后端受控域名规则来自 `browser.rootDomain`，支持无端口的 `https://console.<rootDomain>`。本机验收使用已有 HTTPS Edge，将该域名转发至 Vite 的 5174 端口。其他环境须由其维护者准备同等拓扑；不要求克隆后端仓库运行开发命令。

## 连接与故障

连接页面复用 Soybean 的 Element Plus、主题和 vue-i18n。点击“检查连接”通过正式类型化 `getJwks` 读取匿名公钥，不发送登录凭据；10 秒超时，可手动重试。成功只证明公开读取，不表示登录或 Cookie 会话成功。

缺少或非法配置、非 HTTPS 浏览器入口、HTTP 403、服务错误、网络/CORS/证书错误分别提供明确提示。浏览器会隐藏被 CORS 拒绝的响应，因此无法可靠区分网络故障和来源被拒；提示同时列出原因，真实验收需结合网络面板和 Gateway 响应确定，不能误报为密码错误。

## 显式升级

使用 `pnpm add --save-exact @crane199709/saas-forge-api-client@<版本>` 升级（自有 scope 已在 `.npmrc` 固定到 npm 官方 registry），审查并提交 manifest 和 lockfile。先有兼容后端和可消费包，再升级前端；每次记录后端、Client 和前端的可复现基线。页面发布可以独立于后端发布；破坏性协议变更必须显式版本化，不覆盖既有发布版本。

验证结果记录到 `docs/acceptance/`，区分构建、模拟与真实 Chrome/Gateway 结果。
