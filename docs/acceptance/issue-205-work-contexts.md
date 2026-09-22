# Issue #205：公司工作台与双身份切换

状态：2026-09-22，Issue #205 六项验收已逐项通过。正式 Client 0.4.0、独立检查及真实 Chrome 联调证据齐备；历史阻塞和失败记录保留，最终结论以文末为准。

## 实现范围

- 精确消费 npm 正式 `@crane199709/saas-forge-api-client@0.3.0`，来源为后端 `282f3b07c1348a57aef0d3f3cdd589c9e4a557a5`，`dirty=false`。锁文件只升级此 Client；仅对此已审阅精确版本增加既有发布时间例外。
- `/home` 为平台视图，`/workbench` 为公司视图；路由和菜单依照权威当前上下文，Platform Role 不生成 Membership。候选页面同页展示平台组和全部公司卡片，点击正式调用 `selectConsoleContext`，随后 refresh 恢复 Token。无权限、初始凭据和失败状态均不能进入工作台；重新检查出现唯一候选时仍经过正式选择。
- 切换开始清除旧快照与 Token；失败保持阻断，未知响应保留原目标与幂等键。切换成功仅接受新代次响应，并重建页面内容，避免旧请求或品牌预加载覆盖新上下文。
- Web Locks 串行化转换，BroadcastChannel 发送 switching/changed/logout/edited 通知。其他标签收到 switching 立即隐藏私有状态；完成后自行向服务端恢复。编辑通知不读取或广播字段值，确认期间的新编辑或代次变化使该次确认失效。
- 未保存保护采用保守策略：每次主动切换都按“无法确认全部标签页未保存状态”要求显式放弃或取消，不声称休眠页面无未保存内容，不自动保存表单。取消时保留当前可操作视图；这不是对各业务表单保存状态的精确检测。业务页面以后若引入非 DOM input/change 驱动的编辑，需要同步其编辑通知。
- 只读核验保持既有焦点/可见性及 30 秒检查，不定时续期。当前权限失效立即遮蔽并广播，不能自动降级到剩余平台/公司权限。
- 当前 Tenant 的完整品牌与 logo/favicon 全部校验、预加载成功才一并应用。拒绝外域、路径逃逸、重定向、非法 MIME、缺失素材和不满足白字对比度的色值；任一失败整体回退平台品牌。公司品牌不持久化，旧 blob URL 及时释放。
- 复用 Soybean Layout、菜单、主题和语言控件；新增文案有中英文，工作台标题在进入时取得焦点，公司卡片使用原生按钮语义。实际键盘与视觉表现仍待浏览器验证。

## 本地验证

2026-09-20：

- 正式 registry 安装及 frozen lockfile 安装通过，包内来源核对通过。
- 30 个 Node 测试通过，覆盖选择/刷新原键恢复、切换前遮蔽、取消确认、晚到响应、跨标签编辑使确认失效、失权不降级、唯一候选正式选择、ETag 大整数及品牌整体回退。
- 仓库标准 TypeScript 检查 `vue-tsc --noEmit --skipLibCheck` 通过。
- 本次涉及 TS/Vue 文件 ESLint 通过；`git diff --check` 通过。
- `vite build --mode prod` 通过。没有修改构建优化策略或关闭依赖校验；本机缺失的原生构建文件从锁定版本官方包恢复，恢复前核对锁文件 SHA-512。

以上测试使用受控响应验证前端状态与 HTTP 契约，不替代真实账号、后端权限、浏览器安全或真实品牌素材验收。

## 未执行与阻塞

- 真实桌面 Chrome 中单租户/双身份登录、初选与多公司切换、刷新/多标签恢复、后台休眠与未保存确认、当前权限撤销、品牌/语言/深浅色/键盘焦点/可访问性现场检查未执行。
- 开发者报告 Audit 定时任务缺表；后端只读确认本机 audit_db 为空、V1–V5 Pending。开发者明确暂不执行迁移。未操作数据库写入、启停后端、重建开发环境或伪造业务账号。
- 尚需开发者准备兼容后端及真实账号后继续联调；原生 Vite 可由应用目录 `pnpm run dev` 启动，浏览器仍经受信 HTTPS Console/Gateway，内部监听不作为替代入口。
- 未执行完整后端 CI、Fresh Compose 或完整浏览器业务验收。

## 首次改密补齐

旧 Platform 登录在统一协议启用后返回 AUTH_PROTOCOL_RETIRED，不能作为新管理员首次改密入口。经确认扩展范围，Console 登录入口新增新密码与确认表单，使用发布 Client 的 changeConsoleInitialPassword。仅 PASSWORD_CHANGE_REQUIRED 会话可提交，提交与卸载清空字段；不持久化或广播密码。密码规则失败保留受限状态，未知结果先核查 Slot，不自动重发；成功提示重新登录并通知其他标签页复核。中英文文案与标题焦点一并接入。

后端提交 ebff4b3，Client 目标版本 0.4.0；本轮 Runtime 检查 33 项通过，定向 lint 通过。新增正式 Client HTTP 边界测试、类型检查、构建及真实 Chrome 改密尚待正式包发布与后端重新加载后验证，不能据此认定端到端通过。

## 2026-09-22 交付复核

- 修复 manifest 声明 0.4.0、锁文件及已安装包仍为 0.3.0 的不一致。修复前测试 34 通过、1 失败（首次改密 operation 缺失）；安装正式 0.4.0 后 35/35 通过，零跳过。
- `pnpm install --frozen-lockfile` 通过，保留供应链校验；锁文件仅变更 Client 版本及 registry SHA-512，不升级其他依赖。正式制品来源为后端 `ebff4b338d0c4b39e51488ac1e9b98885318d438`，`dirty=false`。
- 通过：`node --import tsx --test tests/*.test.ts`、`vue-tsc --noEmit --skipLibCheck`、全部改动 TS/Vue 文件 ESLint、`vite build --mode prod` 与 `git diff --check`。
- 初次入口检查时真实 HTTPS Console 返回 502，API readiness 返回 502 / `UPSTREAM_UNAVAILABLE`。等待开发者启动或重载兼容后端并提供单租户、双身份账号；前端未接管后端进程。
- 真实 Chrome 公司/平台切换、刷新与跨标签恢复、休眠与未保存确认、失权及越权拒绝、品牌原子应用、语言/主题/键盘/焦点和无障碍仍未执行，不能勾选为已通过。完整 CI 未执行。

开发者随后确认后端已启动并提供受限凭据目录；通过 `pnpm run dev` 启动独立前端，受信 HTTPS Console 恢复为 200。此入口恢复结果不代替账号业务验收。


## 2026-09-22 最终真实 Chrome 验收

环境：桌面 Google Chrome 153.0.8010.53，1440×1000，`https://console.saas.forge.test` → `https://api.saas.forge.test`；系统信任证书，未忽略 TLS 校验。Browser plugin not available，按用户明确授权使用独立 Playwright Chrome。前端原生 `pnpm run dev`，后端由开发者启动，未接管后端进程。正式 Client 0.4.0 的制品来源见上文。

开发者授权创建本机专用测试夹具：三类 Identity（单租户、双身份、无上下文）、两个 Tenant、三条 Membership，其中双身份有平台角色；密码由生产 PasswordVerifier 生成哈希，随机明文仅留在 Git 忽略的受限凭据文件中。夹具写入真实本机数据库，业务验收全部经过真实 Chrome、Gateway、IAM 与 Tenant Access，不模拟业务成功响应；本票不以夹具准备证明公司创建或邀请工作流完成。既有管理员原凭据过期，经授权使用受限 reset 入口重置，由开发者亲自首次改密；`password-changes` 204 后重新登录进入平台首页，其公司候选数仍为零。

| Issue 验收项 | 真实证据与结论 |
| --- | --- |
| 租户登录、选择、切换、刷新、无上下文失败关闭 | 单租户登录返回 AUTHENTICATED/TENANT；刷新维持同公司。双身份登录返回 CONTEXT_SELECTION_REQUIRED，显示平台和两家公司；初选、平台↔公司、公司↔公司均经 context-selections 204 与 refresh 200。无上下文账号返回 NO_AVAILABLE_CONTEXT，直达工作台仍回登录受限页。 |
| 服务端权威工作视图与 Membership 边界 | 双身份每次显式切换均调用正式 operation。单租户直接访问 `/home` 被导回 `/workbench`，正式 PlatformTenantsApi 返回 403 / PLATFORM_AUTHORIZATION_DENIED；提交他人的 Membership 返回 TARGET_CONTEXT_UNAVAILABLE。平台管理员没有自动取得 Membership。 |
| 切换中/失败遮蔽，晚到响应与多标签协调 | 暂停真实选择请求时两页均只显示会话确认状态。丢弃后端已返回的真实 204 响应，两页阻断旧身份；重试同一次操作恢复成功。旧 session 200 在另一页发起切换后才交付，不能覆盖新公司。取消确认不切换；真实冻结后台标签页后仍显示全标签未保存警告，恢复时按权威上下文同步。 |
| 失权及时遮蔽、路由与 API 拒绝 | 精确禁用专用双身份当前公司的一条 Membership，session 返回 403 / CURRENT_CONTEXT_REVOKED，两页隐藏旧身份，不降级到其仍有权限的平台或其他公司。旧 Token 返回 401 / ACCESS_TOKEN_INVALID。精确恢复该一条 Membership 后旧 Token 仍返回 401。 |
| 品牌、语言、主题、键盘与焦点 | 公司 1 的完整 logo/favicon/色值/名称一起应用；公司 2 无 Profile 时整体回退平台。中英文与深浅色在真实切换后正确显示；标题焦点、Enter 打开/确认、Escape 取消及焦点返回原按钮通过。深色品牌标题/菜单/平台按钮实测对比度约 12.91/11.95/9.11:1，键盘焦点显示 2px 正文色轮廓。 |
| 两仓独立交付 | 本仓 35 项测试、类型、改动文件 lint、生产构建及提交钩子通过；后端独立记录 JDK 17 定向 48 项检查。上述页面证据使用正式发布 Client 及开发者已启动后端。 |

### 验收发现的修复与回归

1. 跨标签连续公司切换复现 Vue `Cannot read properties of null (reading 'type')`，可能留下旧公司页面。错误栈定位菜单 Teleport 挂载目标尚未就绪；为五类 Soybean 菜单 Teleport 使用 `defer`，保留原布局与会话遮蔽。修复后连续四次公司切换，以及五种布局/菜单组合的真实双标签切换均通过，零 pageerror。移除 revision 页面键的排查尝试无效，已撤回，最终未改变页面键逻辑。
2. 深色品牌文字及 plain 平台按钮对比度不足。仅对 Tenant 品牌标题/选中菜单采用深色主题正文色，平台按钮使用原品牌实底白字，并补充工作区按钮可见键盘焦点。没有改写权威品牌色，也不持久化 Tenant 品牌。
3. 最终代码重跑真实响应丢失与恢复分支，零 pageerror、零框架错误遮罩；HttpOnly/Secure/SameSite=Strict Cookie 属性通过，`document.cookie` 为空，localStorage 不含测试身份或品牌。

长期证据：[浏览器检查与脱敏 HTTP 状态](assets/issue-205/browser-evidence.json)、[中文浅色工作台](assets/issue-205/light-zh.png)、[英文深色工作台](assets/issue-205/dark-en.png)。截图只包含专用测试身份，不包含个人密码或 Token。

范围限制：未执行完整 CI、Fresh Compose、所有直达服务实例或其他 Issue 的完整安全矩阵；没有把这些检查记为通过。后台冻结验证覆盖 Chrome 生命周期冻结，不宣称覆盖操作系统所有休眠策略。测试夹具准备不属于生产业务创建流程验收。
