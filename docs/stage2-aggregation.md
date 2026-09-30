# 第 2 阶段同轮聚合入口

`scripts/verify-stage2.mjs` 对应后端 #189，顺序运行真实 Chrome 主链、安全和 OAuth 场景，再关联环境方只读 Audit/Runtime 报告。它不启动后端，也不读取后端源码。需要新的 handoff、受信 HTTPS、JDK 17 真实服务及部署引导；沿用 `docs/independent-verification.md` 的环境交接。

环境方启动本轮 Redis 和 OAuth 时间控制器。分别准备权限为 0600 的安全和 OAuth 配置，沿用现有 `verify-token-security.mjs`、`verify-oauth-lifecycle.mjs` 的字段；两者额外设置 `stage2: true`，共用 `handoff`、`passwordFile` 和 `otherActorFile`，安全配置设置 `auditInput`。`passwordFile` 是本轮首次改密后的专用密码。`auditInput` 和 `otherActorFile` 是受限中间文件，不属于可发布证据。

第二名操作者应为本轮经 Console 和邮件流程创建的真实身份，且平台权限准备已明确获准并完成，才能设置 OAuth 配置 `otherActorAuthorized: true`。该标志不会授予权限；未配置时“其他操作者恢复拒绝”为未执行，最终退出失败。

另行创建 0600 的聚合配置文件，包含 `securityConfig`、`oauthConfig`、`auditReport`、`runtimeReport` 四个绝对路径，然后执行：

```sh
SF_STAGE2_CONFIG=/absolute/private-config.json node scripts/verify-stage2.mjs /absolute/new-output
```

执行顺序不可调换：中文创建权益和 Tenant、真实邮件 Password Setup → 同一身份切换 Tenant 与刷新 → 页面切换英文、错误与正常登录、冻结及重新登录 → Token 与 Redis 场景 → OAuth 管理和服务消费、丢响应及时间状态恢复。资源由本轮真实页面创建，不能混入历史通过记录。

环境方在 `security/security.json`、`oauth/oauth.json` 完整生成后提供 Audit 和 Runtime 报告。入口最多等待这些文件 120 秒；任何子进程失败、缺失报告或判定失败都会使最终退出码非零，并保存 `execution.json`。不要覆盖已有输出或在失败后拼接旧轮结果。

`scripts/stage2-aggregate.mjs` 也可单独接收 manifest 路径和新的输出文件，用于复核已经完成的同轮产物。它验证 runId、handoff、代码/Client/Chrome 来源、驱动散列、各必需场景、Audit 观察文件与 Runtime 输入散列；单测的合成报告只证明判定行为，不是浏览器验收。

OAuth 到期结果必须标记为受保护时间状态注入；接收端仅证明非生产平台机制。完整 CI、实际浏览器结果、精确时间边界测试分别记录，不能相互替代。四项标准未全部通过时，不勾选开发计划或更新通过记录。

第二操作者通过页面选择平台身份，并核对正式 Token 的 `identityId` 与主操作者不同；无论恢复验证成功或失败，都尝试经页面退出。登录结果或退出未确认会使验收失败，环境方仍须独立核对临时角色恢复回执。OAuth 报告保留固定阶段标识，待处理响应体最多等待 30 秒；超时保存失败终态，不将等待超时当作成功。
