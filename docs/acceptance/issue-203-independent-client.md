# Issue #203：独立前端交付记录

初验：2026-09-15；补验：2026-09-16。实现提交：`12eaf58`。**本票本机验收通过，真实 Gateway 读取的 CORS 阻塞已解除**；源码提交尚未推送。

## 基线

- Soybean 上游：`7613bd206cd42001b40e3eafceeb895dcbc277a8`，保持提交祖先关系与 MIT 许可证；本票起点 `f9cd9eed203a71d620521e7a398b37cee1f2e60f`。
- 真实公开 npm Client：`@crane199709/saas-forge-api-client`，由 0.1.0 显式升级到 0.1.1。scope registry 固定为 `https://registry.npmjs.org/`，最终精确版本和安装完整性见 `package.json`、`pnpm-lock.yaml`。
- 0.1.0 来源：后端 `68a8a74a769ae8c3110042176d9a3581895aedad`；0.1.1 来源：`6bf26865521dfdbd5cca4ab5635cf590c6610262`。两包的 `contract-source.json` 均为 `dirty: false`。0.1.1 只补齐构建输入来源摘要，正式 v1 契约不变。
- Node 24.14.1、pnpm 11.22.0；实际 Chrome 153.0.8010.37。前端验证不使用 JDK/Maven。
- 本次源码提交尚未推送；不要假定远端已能解析新增提交。

## 通过

| 验证 | 结果 |
| --- | --- |
| 真实 0.1.0 安装、类型检查、构建 | 通过 |
| 显式升级 0.1.1、frozen install | 通过；锁文件只新增 Client 项，没有无关底座依赖升级 |
| 独立副本匿名干净安装 | 通过；副本无后端源码或已有 node_modules，npm 用户配置为空 |
| 独立副本类型、7 项测试、构建、dev | 通过；Java/Maven 同名命令被设置为调用即失败，验证全程未调用 |
| 前端进程边界 | `pnpm run dev` 只启动 Vite 127.0.0.1:5174；显示 HTTPS 浏览器入口，不启停后端 |
| ESLint、类型检查及提交钩子 | 通过 |
| 可信 HTTPS Chrome 页面 | `https://console.saas.forge.test/connection`，secure context 为 true，未忽略证书错误 |
| 键盘、双语及焦点 | Enter 切换语言，Tab 到连接按钮，Enter 执行；失败状态可即时翻译 |
| 无配置的构建产物 | 经 HTTPS 打开后明确提示 VITE_API_ORIGIN 配置错误，未发送 JWKS 请求 |
| 内部 HTTP 入口 | 禁止公开读取，提示使用受信 HTTPS Console |
| 模拟失败状态 | HTTP 403、连接拒绝、10 秒超时与手动重试通过；不代表真实后端业务成功 |
| 演示路由 | `/login` 跳转匿名连接页，未启用 Soybean 演示认证 |
| 静态 Standards / Spec 审查 | 初轮均 0 项需修复发现；当时待验收的真实链路已于下文补验 |

干净安装证明初始工作区已有的 allowBuilds 选择是安装必要条件，因此保持原值并纳入交付。自有包的发布年龄例外只覆盖 0.1.0 / 0.1.1；其余供应链策略保留。禁用 global virtual store 使本机与 CI 使用一致的仓库内依赖布局。

## 历史阻塞与补验

2026-09-15 初验时，真实 Chrome 通过正式 Client 向 `https://api.saas.forge.test/.well-known/jwks.json` 发起 GET，但运行中的 Gateway 没有返回 `Access-Control-Allow-Origin`，浏览器实际阻止读取。页面正确显示网络、CORS、证书排查提示，不能将此当作成功连通。

用户已恢复 HTTPS 443。对照 Edge 与内部 Gateway 响应后，确认两者均缺少 CORS 头。后端已提交仅开放受控来源的 JWKS CORS 修改并通过对应测试，当时等待用户在 IDE 重新运行 Gateway；该步骤已于 2026-09-16 完成。本任务没有接管后端进程。

2026-09-16 北京时间 09:04，用户重新运行 Gateway 后，独立临时 Chrome `153.0.8010.48` 补验通过：

- 真实受信 HTTPS Console 页面使用正式 Client `0.1.1` 读取真实 Gateway，HTTP 200，页面明确显示公开验证密钥读取成功且不代表已登录；页面 JavaScript 错误为 0。
- 实际请求 Origin 为 `https://console.saas.forge.test`，完整请求头没有 Cookie 或 Authorization；响应允许来源精确匹配，未允许跨域凭据；未忽略证书错误。
- 空白 Remote Origin 页面夹具的浏览器请求被真实 Gateway 以 403 拒绝，未返回允许来源头，浏览器不可读取。仅发起文档为夹具，未模拟 API 响应；Chrome 网络协议记录了实际 403。独立 HTTPS 请求也确认错误码为 `BROWSER_REQUEST_REJECTED`。
- 源基线：前端 `74ffbac`（实现 `12eaf58`）、后端 `c100bce`（CORS 实现 `68a8a74`）；这记录的是源工作区基线，并非服务公开返回的构建提交号。只启动并停止本任务前端进程，没有接管后端服务。

公开读取组合的实际兼容性已验证；2026-09-15 的失败记录保留为历史事实。Remote 根路径返回 404 的初次补验未产生有效 API 拒绝证据，不计为通过。

## 未执行与范围

未执行登录、受保护业务、跨标签 Cookie 会话或完整 Fresh Compose；未声称新 CI 已远端通过。页面没有精确金额等业务展示，本票未修改既有数字格式化能力。

开发及独立升级方式见 [独立前端开发](../independent-development.md)。完整后端发布与测试结果保存在 saas-forge 的 `docs/acceptance/issue-203-versioned-client.md`；这里的文档路径说明不构成任何构建依赖。
