# 语言与页面回归检查（#201 修复）

## 已确认的决定

2026-09-29：英文产品 Locale 统一为 `en`，中文为 `zh-CN`。`en-US` 等历史值不作为兼容别名；读取旧偏好后回到默认中文并写回，语言资源、类型、选择器、Element Plus、Dayjs、Remote 宿主和精确格式化使用同一标识。历史验收文件保持原记录，不批量改写历史语言标识。

沿用 Vue i18n 一个运行时及其 resolver/missing 扩展点：当前文案缺失或损坏时尝试英文；双方均不可用则显示安全恢复文案，不显示内部 key、资源原文或编译异常。连接诊断页也使用同一目录。日期、时间点、精确十进制与金额仍沿用原公开格式化函数及输出回归。

这属于产品语言和验证规则，不新增领域概念，也不为可逆配置另建 ADR 或通用翻译框架。

## 可执行入口

- `corepack pnpm run verify:locales`：检查两套资源 key 完整性、非空、纯文本、Vue i18n 消息语法及 named/list 参数签名。Node 回归另覆盖缺失、格式错误、plural 语义和精确格式化。现有资源使用 Vue i18n 语法；需要迁入 ICU plural/select 时应转换成等效底座表达，不能把 ICU 原文直接当作已支持。
- `corepack pnpm run verify`：类型、只读 Lint、资源检查、全部 Node 测试和正常生产构建。
- `corepack pnpm exec playwright install chromium` 后运行 `corepack pnpm run verify:ui`：单独构建 `.ui-dist/`，正式路由与组件运行在生产模式，通过模拟 HTTP 覆盖页面、视觉、axe、语言持久化、键盘、焦点和脏表单。只启动回环静态前端服务器；不调用 Maven/Docker、不连接或启动后端、不读取个人 API 目标。模拟 Origin 使用保留的 `.test` 域名，API 与图标响应在浏览器内拦截。
- 原 `verify:browser` 继续连接已准备的真实受信 HTTPS/Gateway。这里新增的 UI 门禁不能代替该真实入口或 Fresh、安全注入、OAuth 消费与 Audit 同轮验收。

CI 的 `verify` 和 `ui` 两个作业独立失败传播；没有 skip/continue-on-error。UI 作业固定 Playwright 1.63.0 Ubuntu Noble 镜像，Node 24.14.1，锁文件安装，截图缺失或偏差、axe 违规、未知网络与 Console/pageerror 都使检查失败。页面恢复测试仅允许明确注入的 503 资源错误，不全局忽略异常。

## 场景与旧检查来源

| 原检查 | 新入口 |
| --- | --- |
| 旧 `browser-test/admin.browser.test.ts` 登录/恢复中英文、布局 1440/1024 浅深及 axe | `tests/browser/console.spec.ts` 生产模式正式页面和按平台 PNG；深色通过用户切换并断言 HTML class |
| 旧 `platform-soybean.test.mjs` 语言、键盘、焦点、布局 | 同一浏览器文件；旧语言值归中文、选 en 后重载、抽屉 Enter/Escape/取消丢弃及焦点返回 |
| 旧 `validate-i18n-resources.mjs` / `i18n-resources.test.mjs` | `scripts/check-locales.ts` / `tests/locale-messages.test.ts`；TS 资源重复属性由既有类型检查拒绝 |
| 旧 `shared/i18n/test/index.test.ts` | `locale-messages.test.ts` 和既有 `locale-format.test.ts`；安全回退、参数、plural、精确金额/时间分工验证 |

axe 保留 WCAG 2 A/AA、2.1 AA 适用规则。正常页面检查整个 document；模态抽屉打开时，先断言 `aria-modal=true`，再检查当前可操作的 dialog，避免将遮罩后背景的变暗误判成可操作内容对比度。该检查不等于完整 WCAG 认证。

## 固定上游与截图审阅

`tests/browser/soybean-baseline.json` 的主题、样式与 materials 哈希来自固定上游 `7613bd206cd42001b40e3eafceeb895dcbc277a8`；Node 门禁验证本仓对应文件。上游未提供完整 PNG 金图；原双 Console 截图只作历史参考，不能直接充当统一 Console 基线。

允许的业务差异：SaaS Forge 品牌；正式邮箱/密码与恢复状态；平台工作上下文；Tenant 列表、抽屉、详情。复用上游布局尺寸、主题和组件；必要可访问性适配包含语言菜单单一按钮、正确 document language 与装饰进度条语义。

首次截图必须检查实际页面与这些差异、保存对应平台基线；后续默认比较，CI 不执行 `--update-snapshots`。只在确认产品变化及其原因后更新指定截图；不能通过重录绕过 axe、资源、键盘或错误断言。新基线截图是此轮模拟产品数据的回归基线，不是旧 #208 真环境截图。

## 本轮验证记录

2026-09-29：前端正式 `verify` 通过（类型、只读 Lint、732 个语言 key、223 项 Node 测试、生产构建）；macOS Chromium 的 13 项浏览器用例以现有截图比较通过。Linux Noble 官方 Playwright 1.63.0 镜像使用同一生产制品（136 个文件逐一 SHA-256 一致），11 张首次基线经页面审阅保存，随后不更新基线的完整 13 项比较通过。错误探针额外验证现有页面和新建页面的 Console/pageerror 监听机制。后端授权提取由 `AuthenticationHttpIT` 66 项回归验证，0 跳过。

本轮 Linux 本地执行架构为 arm64，远程 GitHub CI 尚未运行；这不是真实 Gateway/Chrome/Fresh 同轮验收记录。
