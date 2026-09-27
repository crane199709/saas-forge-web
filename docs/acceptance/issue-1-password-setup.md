# Issue #1：首次改密与密码设置

最新验证：见 [2026-09-27 真实 Chrome 验收](issue-1-password-setup-20260927.md)。下文保留 2026-09-22 的历史结果，不代表当前缺口。

历史状态：2026-09-22，代码与有界验证完成；真实初始凭据和 Password Setup Challenge 验收未执行，Issue 保持开放。

## 实现边界

- 沿用现有受限登录与首次改密 Runtime；只有 `PASSWORD_CHANGE_REQUIRED` 显示首次改密，成功后回到登录，不自动进入管理视图。
- `/password-setup` 复用 Soybean 登录组件、主题、语言及共用密码表单。正式 Client 保持固定 `@crane199709/saas-forge-api-client` 0.4.0，以 `establishPassword` 调用匿名 `/api/v1/auth/password-setups`，不携带会话 Cookie 或 Authorization，也不接受邮箱、Identity 或 Tenant 参数。
- 邮件 fragment 在 Router 创建前移出 URL；同文档打开新链接也先清理，再销毁旧操作。Challenge 只在页面内存中持有，提交密码立即从表单清除，完成、失效、离开和 pagehide 清理操作材料。
- 未知结果不自动重发，用户重输相同密码后沿用原 UUIDv7 操作键；本页面保留加盐的 NFC 密码摘要，拒绝将不同重试密码误报为已建立。明确密码策略拒绝后可修正输入。刷新后不从持久存储恢复 Challenge。
- 单次、限时、不替换既有 Credential 仍由后端权威校验；此页面不增加密码找回、注册或自动登录。

## 本轮验证

前端基线 `6caa885fdb68ebb48c2ba8f4492a2e5084817358` 加本票修改；后端工作树基线 `da4567c859b200d375b4eed6d69e9d557cf60048`，不是运行制品证明。本票没有后端代码改动。

| 检查 | 结果与限制 |
| --- | --- |
| 前端 Node 完整测试 | 39 项通过，包括现有首次改密/会话测试及新增 Challenge 的 HTTP 故障测试 |
| 类型、全仓 ESLint、生产构建 | 通过；最初 pnpm registry 校验受网络限制，先直接使用已安装工具；随后授权网络后固定 pnpm 11.22.0 可用 |
| 后端 `PasswordSetupServiceTest` | JDK 17.0.12，5 项通过，无失败/跳过；使用内存替身，不是真实 API/数据库验收 |
| Chrome 界面与故障模拟 | Chrome 153.0.8010.53，1280×1000，合成 Challenge/密码，拦截 HTTP；URL 清理、键盘 Enter、未知结果清空输入、不同密码拦截、同键成功、完成后清表单、返回登录、无效链接焦点、同标签新链接、双语和主题通过；无 pageerror |
| code-review | Standards 原 1 项、Spec 原 2 项发现均修复并复核，无剩余发现 |

浏览器插件未提供，按 frontend-testing-debugging 技能使用独立 Playwright Chrome。该界面验证使用本机 Vite 内部地址，只证明渲染与模拟交互，不作为受控 HTTPS、Cookie/CORS/CSRF 或真实业务验收。没有启动、替换或接管后端进程。

截图均为合成场景的空表单，不包含秘密：[中文浅色](assets/issue-1/light-zh.png)、[英文深色](assets/issue-1/dark-en.png)。

执行命令：

```sh
node --import tsx --test tests/*.test.ts
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --skipLibCheck
node node_modules/eslint/bin/eslint.js .
node node_modules/vite/bin/vite.js build --mode prod
```

后端独立检查（在后端仓库运行）：

```sh
mvn -o -pl saas-forge-services/iam-service -am \
  -Dtest=PasswordSetupServiceTest -Dsurefire.failIfNoSpecifiedTests=false test
```

## 未执行及闭环条件

用户确认尚未准备验收环境及独立初始凭据/Challenge；当前配置 `https://console.saas.forge.test` 的 443 端口连接失败，解除沙箱网络限制后亦失败。以下均未记为通过：

1. 在受控 HTTPS Chrome 入口完成真实初始平台凭据受限登录、首次改密、新密码登录，以及错误、过期、重复初始凭据拒绝。
2. 独立准备有效 Challenge，真实页面首次建密和随后登录；真实过期、已消费、已有 Credential、重复消费和提交结果丢失验证。
3. 分别记录相关后端正式 API 拒绝证据与前端真实页面证据，包括 Cookie/CORS/CSRF、秘密存储与日志检查；声明实际运行后端制品、Client、Chrome 和环境标识。
4. 实际浏览器往返缓存恢复、跨标签/账号变更与真实受限会话组合。当前 dispose/generation 测试和模拟页面结果不冒充完整真实矩阵。

准备材料应通过受限本机文件交接，不写进 Issue、仓库或截图。本票缺口闭环前不关闭 Issue。
