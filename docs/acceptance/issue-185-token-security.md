# Token、Tenant 越权和 Redis 专项入口（后端 #185）

`pnpm run verify:security -- <新的输出目录>` 使用真实 Chrome 连接环境方提供的隔离 Fresh 环境。
设置 `SF_SECURITY_CONFIG` 为权限 0600 的本机配置文件路径；字段及后端 Redis 控制器说明见
[后端专项说明](https://github.com/crane199709/saas-forge/blob/master/docs/acceptance/issue-185-token-security.md)。
此入口不启动任何应用、不运行 Docker/Maven、不写数据库、不接管开发者服务。

前置业务全部通过 Console：初始管理员改密、Quota/Plan、两个 Tenant、不同管理员初始化、真实邮件 Password Setup、登录和 Tenant 选择。
产品外探针只在内存读取 Cookie/Token，验证真实他人 Membership 的 Tenant 越权、错误 Token、Refresh 重放及未过期 Token 撤销。
独立环境控制器按同轮 runId 响应 Redis 故障/恢复请求，页面失败关闭和恢复结果属于同一次 Chrome 运行。

`security.json` 保留前端/Client 来源、Chrome、handoff SHA-256、逐场景结果和脱敏请求；未知错误阻断通过。
不采集截图、录像、HAR、trace 或原始响应正文，避免 Password Setup 与凭据进入证据。
该专项不替代父 #183/#189 的完整聚合，模拟 HTTP 的 UI 回归和完整 CI 必须分别记录。
