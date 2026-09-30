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

## 正式业务列表样式约定（2026-09-30）

用户确认以仓库内 `src/views/alova/user/` 保留的 Soybean 示例为参考，统一列表区域；保留 SaaS Forge 品牌色、导航与业务行为。线上参考地址 `https://elp.soybeanjs.cn/alova/user` 本轮暂不可访问，本地示例不等于已核对线上最新版本。

- 覆盖 Tenant、OAuth Client、Plan、Quota Definition 四个主列表，以及其恢复记录和 Tenant 订阅操作表（7 处实现、9 个用途）。示例页面本身不改动。
- 搜索独立使用 `card-wrapper` 卡片，默认折叠整组条件。展开、收起只改变可见性，不清空输入、不提交查询；标题上的“已应用 N 项筛选”只计入已提交的查询条件。重置清空条件并重新查询第一页；分页继续使用已提交条件。
- 所有表头居中。正文名称、描述、标识符与时间左对齐，数值右对齐，状态与操作居中；现有列中没有需新增格式化的数值列。保留长内容的表内滚动与固定操作列。
- 表格带边框，搜索、主列表、恢复区卡片间距为 16px；工具栏支持换行，新增和搜索使用品牌主色浅色按钮并带图标。分页靠右，保留每页 20 条的游标上下页，不虚构总数、页码跳转或条数选择。
- 行内按钮使用 `plain`、`small` 并保留文字：查看为中性色，继续与恢复为成功色；新增、查询、编辑用主色，警示操作用警告色，删除、撤销用危险色。按实际存在的动作应用，不新增操作、不扩大到详情生命周期的改造。恢复 Secret 的既有确认与权限校验保留。
- 不增加批删、导出、列设置、空搜索栏或空分页。表头居中、语义对齐和已应用筛选提示属于用户确认的适配，不宣称是原例已有行为。

验收清单：四个主列表默认折叠；键盘可展开和提交；未提交输入不改变计数；折叠保留输入且无额外请求；搜索和重置回到第一页；翻页保留已提交条件；嵌入表格与操作配色一致；中英文、浅深主题、1024/1440 桌面布局无遮挡；相关 axe、焦点回归、类型、Lint、语言资源及构建通过。UI 使用模拟 HTTP 时必须单独标明，不能当作真实 Chrome/Gateway/Fresh 验收。

这些是可逆的产品 UI 约定，没有新增领域概念或架构决策，因此不新建 `CONTEXT.md` 或 ADR。

## 本轮验证记录

2026-09-30 折叠菜单修复：先通过浏览器用例复现名称提示缺失和菜单图标不可见。叶子菜单的名称原先放在默认插槽，未满足 Element Plus 折叠提示要求的 `title` 插槽；图标使用的 `i-mdi-*` CSS 类也未出现在生产制品中。改用标题插槽与显式可访问名称，并沿用现有 `SvgIconVNode` 渲染图标。新增中英文五项菜单悬停名称、点击跳转与折叠图标可见性回归。类型检查、改动文件 ESLint、生产模式 UI 构建通过；macOS Chromium 不更新基线的 24 项回归通过，Linux 同制品相关 9 项只读比较通过。审阅并更新 4 张受图标恢复影响的截图。以上仍为模拟 HTTP 验证，未执行真实后端联调。

2026-09-30 列表样式调整：类型检查、改动文件只读 ESLint、734 个中英文语言 key 校验、语言消息与固定 Soybean 基线共 7 项 Node 检查、生产模式隔离 UI 构建通过。最终制品在 macOS Chromium 上不更新基线运行 21 项浏览器用例全部通过；其中新增 8 项覆盖四个主列表的英文浅色 1440px、中文深色 1024px，核查默认折叠、键盘展开、草稿保留、已应用数量、无额外折叠请求、带原条件翻页、重置、表头/正文对齐、按钮不越出单元格、页面不溢出及 axe。原 13 项继续覆盖语言、布局、抽屉焦点与错误监测。页面无空白或框架错误遮罩，正常场景无未预期网络和 Console/pageerror。

因默认折叠和卡片留白变化，审阅并更新 macOS 的 `tenants-en.png`、`tenant-create-en.png` 及 Linux 的 `tenants-en.png`，其余基线保留。现有 Playwright 1.63.0 Noble 镜像使用同一 `.ui-dist` 制品，在禁用外网、1GB 内存、2 CPU、单 worker 下运行 Tenant 列表/抽屉与详情两项；随后只读、不更新基线再次比较，2 项通过。Linux 未重跑完整 21 项。上述全部是正式前端路由 + 模拟 HTTP 的 Chromium 回归；未执行真实 Chrome/Gateway、后端联调或 Fresh 验收，也未宣称与线上参考站逐像素一致。

2026-09-29：前端正式 `verify` 通过（类型、只读 Lint、732 个语言 key、223 项 Node 测试、生产构建）；macOS Chromium 的 13 项浏览器用例以现有截图比较通过。Linux Noble 官方 Playwright 1.63.0 镜像使用同一生产制品（136 个文件逐一 SHA-256 一致），11 张首次基线经页面审阅保存，随后不更新基线的完整 13 项比较通过。错误探针额外验证现有页面和新建页面的 Console/pageerror 监听机制。后端授权提取由 `AuthenticationHttpIT` 66 项回归验证，0 跳过。

上述首次 Linux 本地验证使用 arm64，当时远程 GitHub CI 尚未运行；这不是真实 Gateway/Chrome/Fresh 同轮验收记录。

## 容器构建的 Git 来源读取

远程运行 `36533062643` 的普通 `verify` 已通过，但 UI 作业在生产构建的 `frontendProvenance` 读取 Git 时失败：`detected dubious ownership`，因此尚未进入浏览器测试。checkout Action 的临时 Git 信任配置不覆盖后续容器进程。

UI 验证步骤通过 `GIT_CONFIG_COUNT` 为本进程及子进程设置 `safe.directory=${{ github.workspace }}`；仅接受此次 checkout 的精确路径，不写全局 Git 配置、不使用通配目录，也不跳过制品来源校验。隔离容器中，原读取返回 128，应用此设置后成功，另一个异主仓库仍被拒绝。


针对性验证直接执行实际 `frontendProvenance`：异主 checkout 修复前被拒绝；读取本工作流的步骤环境后，成功校验提交、源码 SHA-256 和固定 Client 0.4.0。Lint 与 diff 检查通过。完整容器重建因本地 OOM 未完成，不能记为构建或 UI 测试通过；远程修复后的 CI 待推送验证。
