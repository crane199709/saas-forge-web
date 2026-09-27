# Issue #8：OAuth Client 管理

日期：2026-09-27。状态：前端实现、模拟验证与真实凭据消费链路通过；到期注入及父 PRD 完整验收未执行。

## 实现

平台菜单提供 `/oauth-clients` 列表与独立详情，支持名称、类型、状态筛选、游标分页及重置。创建使用 Element Plus 抽屉，仅可选择后端允许的 `runtime:read`、`runtime:quota:write`。查询、创建、轮换、吊销均使用固定 `@crane199709/saas-forge-api-client@0.4.0` operation，共用统一 Console 内存鉴权边界；页面不接收或设置 Token、Cookie、Origin、Fetch Metadata。

轮换、吊销提交前重新读取详情与 credential-status，服务端决定许可和重叠截止时间；本机时间不会放行操作。吊销提供明确确认。保留中英文、主题、带时区时间、脏表单确认、键盘焦点及表单错误关联。

创建仅接受 201，轮换仅接受 200，且校验结果身份、状态和字段后才展示一次性 Secret。Secret 只留在内存展示状态，关闭、离页、刷新、退出或身份变更时清除；晚到响应不会恢复展示。复制使用浏览器剪贴板，页面不持久化、记录或拼入 URL。用户已复制到系统剪贴板的内容由用户管理。

未知结果保留原请求键、动作、目标、名称与发起时间，创建不能通过修改名称重新发送，轮换不能替代未知请求。非敏感恢复记录使用按身份隔离的 sessionStorage，刷新及同一标签退出后重新登录继续锁定；其他身份不显示该记录。退出清当前展示，Secret 和响应始终不进入存储。完整读取原操作者操作记录后才放行写入口；错误分页、循环游标或缺失记录字段失败关闭。恢复区域显示原操作 ID、Client ID、动作、服务端时间和恢复许可，不调用替代签发 operation。关闭整个标签后的私有恢复依赖后端操作记录，本票不实现后续恢复票的签发能力。

## 本轮验证

- 前端起点：`43b0b99f8d3c3e51d64935176abc8d1958fae4cb`，当前分支 main。固定 Soybean 底座与 Client 版本保持不变。
- 全量 Node 测试 104 项通过，其中 OAuth 新增 11 项；覆盖 HTTP 边界、未知锁、刷新/重新登录、晚到响应、服务端许可、异常状态码及后续独立轮换。
- `vue-tsc --noEmit --skipLibCheck`、全仓 ESLint、生产 Vite 构建通过。路由生成配置已登记新路由，构建后再次检查类型。
- Chrome 154.0.8037.57，受控入口 `https://console.saas.forge.test`，1440×1000、1100×800。Browser 插件不可用，使用已有 Playwright 驱动临时真实 Chrome；不关闭证书校验、不接管后端。
- Chrome 中拦截 API 为模拟响应，验证创建、复制、Secret 不进入存储、关闭清除、轮换、权威重叠状态、吊销、中英文、暗色、脏表单取消、Tab 焦点约束和未知请求刷新后的锁。未将模拟结果计为真实业务通过。
- 页面身份与有效内容、无框架错误覆盖层、无 pageerror/警告及操作后状态均检查。初次自动化点击 Element Plus 隐藏 checkbox 输入超时，改用用户可见标签后通过；截图等待动画结束，避免把过渡帧当成最终视觉证据。
- Standards 与 Spec 两路审查发现的不同轮换共用确认标记、退出后未知锁丢失均修复，并补充回归。

## 真实环境验证

用户确认后，在已运行的原生本地服务与 Compose 基础设施上验证。后端提交 `da4567c859b200d375b4eed6d69e9d557cf60048`；前端基于 `8bfd972`，另含本轮 OAuth JSON 请求头修复。Chrome 154.0.8037.57、Oracle JDK 17.0.12、固定 API Client 0.4.0。平台身份从已有受限凭据文件读取，凭据不进入交付记录。

既有测试接收端制品 `platform-mechanism-receiver-0.1.0-SNAPSHOT.jar`，SHA-256 `0518ed2d39665c6564cd81ff450a0c16370168f80d26c0b34a6b290ceabcae61`，临时监听 `127.0.0.1:8096`。使用 Nacos 发现 IAM、正式 Starter 验签与 Redis 撤销检查。现有发现身份没有接收端注册权限，本次关闭接收端自身注册并直连其测试接口；未修改 ACL，未将其认定为 Gateway 转发或服务注册通过。

- 正式页面登录、创建、一次性 Secret 展示及关闭清除通过；Secret 未进入页面存储。
- `runtime:read` 的实际服务 Token 消费返回 200；仅 `runtime:quota:write` 消费要求 read 的接口返回 403 / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`。
- 申请未授予的 `iam:identity:write` 返回 403 / `CLIENT_CREDENTIALS_SCOPE_REJECTED`。
- 页面轮换后，新 Secret 取得 Token 并消费成功；旧 Secret 在服务器重叠期内仍可取得 Token 并消费。页面按服务器状态禁用再次轮换。
- 页面吊销后，旧、新已签发 Token 消费均返回 401；旧、新 Secret 获取 Token 均返回 401。
- 真实联调发现无请求体的轮换、吊销 POST 缺少 JSON Content-Type，被 Gateway 浏览器安全过滤器拒绝。已在共享 HTTP 边界的 OAuth 配置补齐请求头，新增回归先失败后通过；未修改后端安全规则。

- 使用 Chrome CDP 在真实创建已返回 201、响应交付页面前中断响应，确认仅发出一次创建请求；页面锁定替代请求，刷新原操作记录及重载页面后仍锁定。该测试 Client 随后经正式页面吊销。
- 最终运行创建的两个 Client 已吊销，测试浏览器会话通过正式接口退出；前次失败运行创建的 Client 也已吊销。
- 自动化第一次丢响应注入因 TLS 请求错误失败，Playwright 未捕获异常意外将测试会话凭据写入本聊天工具日志。后续改用 CDP 并捕获异步错误，不记录请求头。经用户专项授权，仅从该异常恢复指定测试会话并通过正式 bootstrap/logout 注销，原 Access Token 返回 401。未处理其他会话，交付物不包含原异常日志或凭据。

脱敏结果：[真实验证 JSON](assets/issue-8/real-validation.json)、[指定测试会话清理](assets/issue-8/test-session-cleanup.json)、[真实重叠状态截图](assets/issue-8/real-overlap.png)。截图已遮盖账号，不含 Secret。Standards、Spec 增量复审均为 0 项问题。

## 验证边界

未在共享环境修改时钟或注入重叠到期数据。24 小时重叠到期后的消费拒绝未实测；服务端许可的前端处理有自动化覆盖。未执行接收端自身注册与 Gateway 转发、Fresh 环境或父 PRD 的完整验收。本记录不将直接接收端消费扩大为上述边界通过。
