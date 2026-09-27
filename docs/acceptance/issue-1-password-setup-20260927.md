# Issue #1：首次改密与密码设置真实验收

日期：2026-09-27。轮次：`issue1-20260927-a29c7502`。

首次改密与 Challenge 建密的真实页面主链、相关拒绝及响应丢失恢复已通过。本轮补齐登录离页清密和无效链接替换后的焦点处理。未执行父 PRD 的完整迁移验收，不据此关闭父任务。

## 环境与准备

- 前端起点：`3a112f567cdc8e3d07248aa05361d8800dc3b99f`，本轮在其基础上修改。固定 Client `@crane199709/saas-forge-api-client` 0.4.0。
- 后端工作区：`da4567c859b200d375b4eed6d69e9d557cf60048`。IAM、Gateway 为开发者已启动的 IDE 进程，使用本机 Oracle JDK 17；没有重启或接管后端。源码提交不等于独立可追溯的运行制品摘要。
- Chrome `154.0.8037.57`，桌面 1280×900。Console 为 `https://console.saas.forge.test`，Gateway 为 `https://api.saas.forge.test`，证书校验开启。前端原生 Vite 监听既定 5174 端口。
- Browser 插件未提供，使用已有 Playwright 驱动独立 Chrome 上下文。没有引入浏览器依赖，也没有使用内部 HTTP 地址替代正式入口。
- 用户提供的既有账号已可直接进入工作台，只用于确认环境。经用户授权，在本机 `compose-postgres-1` 的 `iam_db` 新增 7 个专用账号，覆盖有效/过期初始凭据、有效/过期 Challenge、已有密码拒绝，以及两类响应丢失场景。仅两个主链账号有测试用平台角色。
- Bootstrap 在该环境已执行，不能再次初始化。本轮以数据库事务独立准备 Identity、凭据和 Challenge，不调用尚未迁移的管理员初始化页面，不修改既有账号、Bootstrap 事实、迁移文件或校验和。准备过程不是产品初始化验收。
- 随机密码和 Challenge 仅存于 Git 忽略目录的受限文件中；目录 0700，材料 0600。账号和材料保留供复核，未自动删除。存储中只有 Argon2id 密码散列和 Challenge 摘要。

## 本轮修改与回归

1. 登录页在 `pagehide` 和组件卸载时清空未提交密码，并注销事件监听。Chrome 中先复现 `pagehide` 后仍保留 25 个字符，再验证修复后长度为 0。该检查显式派发持久化 pagehide 事件，不冒充真实往返缓存命中。
2. 同标签从可用 Challenge 切换到无效链接时，表单卸载后将焦点移到状态提示。先复现焦点落到页面主体，再验证提示获得焦点、URL fragment 清除且密码输入消失。

## 真实 Chrome 与 Gateway 结果

| 场景 | 结果 |
| --- | --- |
| 初始凭据登录 | 返回 `PASSWORD_CHANGE_REQUIRED`，无 Access Token；直接访问 `/home` 仍回到 `/login` 的改密表单 |
| 首次改密 | 页面按 Enter 提交，正式 v2 operation 返回 204；显示重新登录提示，密码框为空；新密码登录返回 `AUTHENTICATED` 并进入工作台 |
| 初始凭据负例 | 错误密码、过期初始凭据和改密后重复使用旧凭据均返回 401 / `AUTHENTICATION_FAILED`，页面显示凭据错误 |
| Challenge 建密 | 正式 v1 operation 返回 204；请求不携带 Cookie/Authorization，浏览器自行提供 Origin/Fetch Metadata；fragment 和表单清除，随后新密码可登录 |
| Challenge 负例 | 过期、已消费、已有 Credential 的三类独立材料均返回 400 / `PASSWORD_SETUP_TOKEN_INVALID`；页面不再允许提交 |
| 受限退出 | 页面退出返回 204 并回到登录，随后可重新用尚未消费的初始凭据进入改密 |
| 首次改密响应丢失 | Chrome 响应阶段确认真实上游 204 后丢弃响应；页面恢复会话后提示结果未知，未再次提交改密；新密码可认证。该账号无工作上下文，正确停留在无权限状态 |
| Challenge 响应丢失 | 真实上游 204 被丢弃；输入清空，不同密码被本地阻止且未再次请求；相同密码沿用原操作键重放，真实上游再次返回 204 |
| 秘密与页面状态 | 所测流程的 localStorage/sessionStorage 未包含本轮密码或 Challenge；完成/失效后无密码表单，登录提交后密码输入清空；不记录请求体、Token 或 Cookie 值 |
| 语言、主题及界面 | 官方语言控件切换中英文、主题控件切换深色均可用；页面非空，无 Vite 错误覆盖层；独立界面检查 console error/warning 均为 0，主链与故障注入 pageerror 为 0 |

主链与拒绝响应见 [脱敏真实流程记录](assets/issue-1-20260927/real-flows.json)，响应丢失和退出见 [脱敏恢复记录](assets/issue-1-20260927/retry-flows.json)。Chrome DevTools 只拦截响应，不替代上游成功结果，不自行注入浏览器安全头。

截图不含秘密：[中文无效链接](assets/issue-1-20260927/invalid-zh.png)、[英文深色](assets/issue-1-20260927/invalid-en-dark.png)。

## 前后端独立检查

- 前端完整 Node 测试 39 项通过；类型检查、全仓 ESLint 和生产构建通过。
- 后端 `PasswordSetupServiceTest`：JDK 17.0.12，5 项通过，0 失败/错误/跳过。该测试使用替身，只作为独立服务逻辑检查；上表 HTTP 状态来自实际 Gateway 和运行中的服务。
- 本次不修改后端源码；后端已有 `.dockerignore` 改动保持原样。
- code-review 两轴独立审查：Standards 0 项、Spec 0 项可行动代码问题。Spec 明确保留本轮验收工具输出秘密的例外，不得声称全程零泄露；审查未独立重跑浏览器。

```sh
node --import tsx --test tests/*.test.ts
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --skipLibCheck
node node_modules/eslint/bin/eslint.js .
node node_modules/vite/bin/vite.js build --mode prod
```

后端检查在后端仓库执行：

```sh
mvn -o -pl saas-forge-services/iam-service -am \
  -Dtest=PasswordSetupServiceTest -Dsurefire.failIfNoSpecifiedTests=false test
```

## 验收工具问题与边界

- 最初的 `route.fetch` 故障注入遇到 CA 信任错误，工具异常输出包含专用测试会话 Cookie。已精确撤销该账号唯一未撤销的受限 Family 并解除 Slot 绑定，复核剩余未撤销数为 0、Access Issuance 数为 0；未触及既有账号。后续脚本屏蔽原始异常，提交证据不含这些值。不能把这次工具输出算作“全程秘密零泄露”。
- 配置正确的本机根 CA 后，代发请求被正式后端以 403 / `BROWSER_REQUEST_REJECTED` 拒绝；最终改用 Chrome 原生请求的响应阶段拦截完成验证，未绕过证书或来源校验。
- 未新增账号管理产品功能，未验收邮件投递、管理员初始化页面、真实浏览器往返缓存命中、完整跨标签矩阵、全系统日志审计或父 PRD 聚合/Fresh 验收。日期/金额格式化不在本次页面修改范围。
- 本轮证据证明所列本机组合与分支，不证明任意环境或全部历史版本兼容。Issue 的远端状态本轮不自动修改。
