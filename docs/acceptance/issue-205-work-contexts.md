# Issue #205：公司工作台与双身份切换

状态：2026-09-22，前端已安装正式 Client 0.4.0，35 项测试及类型、lint、构建检查通过；真实 Chrome 与后端联调仍未完成，不能据此关闭 Issue #205。早期记录保留历史事实，最新结果见文末。

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
