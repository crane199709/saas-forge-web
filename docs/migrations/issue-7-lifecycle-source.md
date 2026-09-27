# Tenant 生命周期迁移来源

对应 saas-forge-web #7，父规格 saas-forge #201。保留 Soybean Admin Element Plus 固定底座 `7613bd206cd42001b40e3eafceeb895dcbc277a8` 和正式 API Client 0.4.0。

## 历史来源

后端迁出前基线 `b29a86390916619d79b709752467e3b3d691390f`：

- `consoles/platform-console/src/LifecycleSection.vue`：权威生命周期读取、冻结/解除冻结、恢复冻结、原操作继续及后果确认。
- `consoles/test/frontend-lifecycle.test.mjs`：生命周期前端边界检查。
- `consoles/shared/app-runtime/src/authentication-runtime.ts`：正式生命周期 operation 适配及访问失效处理的历史参考；当前统一会话仍由新仓已有 ConsoleSessionRuntime 承担。

[相关原始提交补丁](issue-7-lifecycle-history.patch) 通过 `git format-patch --no-signature --stdout --root b29a863 -- consoles/platform-console/src/LifecycleSection.vue consoles/test/frontend-lifecycle.test.mjs` 导出，保留作者、日期、提交说明和逐提交差异。补丁只用于追溯，不参与构建，不代表本轮验证结果。

## 当前适配边界

详情接入独立 LifecycleWorkspace 和 Element Plus 生命周期区块。动作以 `getTenantLifecycle` 的 `canSuspend`、`canResume`、`canRecoverSuspension`、`canContinue` 为准，提交前重新读取；不根据 Tenant 状态自行授权。冻结未完成不能解除冻结。

原操作继续使用权威 operationId；恢复冻结仍作用于后端原 workflow。网络未知时保留当前 Realm 的恢复幂等键；后台明确返回 `TENANT_SUSPENSION_RECOVERY_REQUIRED` 表示该恢复已耗尽，下一次显式恢复使用新恢复键，仍不新建冻结 workflow。切换 Identity 清除内存恢复键。

Web Locks 串行化同一浏览器对同一 Tenant 的变更。localStorage 仅保存 Tenant 范围的动作、原操作 ID 和状态作为跨标签/重载的未决标记，不保存身份、Token 或幂等键。标记只阻止新操作，不授予权限；存储不可用或记录无效时关闭操作。原快照或缺失记录不能证明未提交；只有权威新操作/进展或明确成功响应才解除该锁。

统一 Runtime 沿用前台 30 秒及重新聚焦/可见时的只读复核。复核期间已有 Layout 遮蔽并禁用受保护内容，失效清除凭据与快照。解除冻结只改变后台 Tenant 生命周期，不在前端恢复旧会话；成员仍须经过认证和权威 Membership 选择。

不增加第二套登录、客户端、布局或国际化运行时，不更改后端业务代码，不接管后端进程。Fresh 环境与 #183 同轮主链由聚合验收承接。
