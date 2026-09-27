# Issue #3：Quota Definition 与 Plan

日期：2026-09-27。状态：实现、自动化检查和模拟 API 的 Chrome 页面回归完成；真实后端额度到套餐激活链路尚未执行，不能认定本票全部验收通过。

## 实现范围

平台菜单提供 `/quota-definitions`、`/plans` 查询、编码/状态筛选、游标分页与重置；创建采用 Element Plus 抽屉，详情为独立路由。均通过固定 Client 0.4.0 的正式权益 operation 访问 Gateway，继续使用统一 Console 的内存鉴权。

额度准备完整读取查询结果并精确识别、复用 max_users；套餐创建要求 ACTIVE 定义与 1–2147483647 的整数。详情按定义 ID 查找人数额度，历史零额度只读，缺失或无法确认正额度不放行激活，RETIRED 记录保留查询展示。

操作记录必须完整分页，重复游标、缺失字段、重复记录及中途失败均关闭写入口。创建按套餐编码、激活按对象 ID 隔离未决状态。未知请求保留原键，不能重新创建替代；恢复前重新获取原记录、校验服务端许可及原键，只调用原 recovery operation。退出或更换账号清除材料，暂时失联和同账号工作区切换保留未知锁。服务端仍负责最终授权与原操作者限制。

保留中英文、带时区的时间点、精确整数、键盘焦点、表单错误关联和脏表单确认。普通查看历史记录也必须先确认离开未保存表单。

[迁移来源与相关提交](../migrations/issue-3-entitlement-source.md) 仅用于追溯，不作为本轮通过依据。

## 环境

- 前端起点：`4ec345bb947d2359b98bd17e0f1b02ae5377bb25`，当前分支 main；实现由包含本文的提交确定。
- 固定底座：`7613bd206cd42001b40e3eafceeb895dcbc277a8`；Client：`@crane199709/saas-forge-api-client@0.4.0`，未改变依赖与锁文件。
- Node.js 24.14.1；桌面 Google Chrome 154.0.8037.57；1440×1000、1100×800。
- 浏览器入口 `https://console.saas.forge.test`，配置 Gateway `https://api.saas.forge.test`。Browser 插件不可用，使用已安装 Playwright 驱动临时真实 Chrome，不关闭证书校验。沙箱内 Chrome 启动失败后，经工具审批在沙箱外运行。
- 复用已启动的 Vite；未启动、重启、替换或接管后端。匿名登录页实际加载通过；其后的业务回归拦截全部认证与权益 API，不能作为已连接真实后端的版本组合证明。

## 验证结果

| 检查 | 状态 | 证据与限制 |
| --- | --- | --- |
| 全量 Node 测试 | 通过 | 93 项、0 失败、0 跳过；其中权益 37 项，在正式 Client HTTP 边界模拟 |
| TypeScript | 通过 | `vue-tsc --noEmit --skipLibCheck` |
| 全仓 ESLint | 通过 | `eslint .`，没有跳过规则或提交钩子 |
| 生产构建 | 通过 | `vite build --mode prod`；不要求后端源码或 Maven |
| 页面身份/内容/运行健康 | 通过 | 真实 Chrome 中页面 URL、详情标题、非空内容、无 Vite 覆盖层和 pageerror；业务 API 为模拟 |
| 额度复用页面 | 通过（模拟） | 菜单进入额度列表、准备抽屉复用 max_users、进入权威模拟详情 |
| 创建、精确整数与恢复 | 通过（模拟） | 0 不发送请求；2147483647 显示为 2,147,483,647；创建失败后按钮锁定；不完整记录不能恢复；原记录重新授权后使用相同键 recovery，仅 create 1 次、recovery 1 次 |
| 激活未知结果 | 通过（模拟） | activation 1 次，未知结果不能再次激活；核查 COMMITTED 后刷新显示 ACTIVE |
| 零额度与缺失额度 | 通过（模拟） | 历史 0 明确只读，无激活动作；缺失正额度关闭写入口 |
| 焦点/脏表单/国际化 | 通过（模拟） | 抽屉 Tab 约束，关闭回到创建按钮；查看历史记录先确认，取消保留输入；英文暗色、两种桌面宽度、刷新保持详情深链接 |
| 操作记录与主体隔离 | 通过（HTTP/会话模拟） | 完整分页、循环/缺失游标、中途失败、跨对象隔离、原键和许可变化、换账号晚响应、同主体暂时失联与工作区切换未知锁 |
| 真实额度至套餐激活 | 未执行 | 已获测试数据写入许可，但尚未取得本次平台管理员凭据文件/沿用凭据确认；没有新增真实套餐，也没有将模拟结果标成真实通过 |
| 第二真实操作者拒绝 | 未执行 | 没有第二个获授权真实账号；只完成前端私有材料清理与权限拒绝模拟 |
| Fresh Compose/父 PRD 全量 | 未执行 | 不属于本次日常局部前端门禁，不据此关闭父任务或旧专项验收 |

命令使用已安装 Node 直接执行仓库 CLI：`node --import tsx --test tests/*.test.ts`、`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit --skipLibCheck`、`node node_modules/eslint/bin/eslint.js .`、`node node_modules/vite/bin/vite.js build --mode prod`。

脱敏页面证据均来自模拟 API，不证明真实业务写入：[回归结果](assets/issue-3/mock-result.json)、[中文未知结果](assets/issue-3/unknown-zh.png)、[英文暗色详情](assets/issue-3/detail-en-dark.png)、[历史零额度只读](assets/issue-3/legacy-en.png)。

## 审查

- Standards：0 项明确违规。
- Spec：发现普通查看历史操作会绕过脏表单确认。Chrome 回归先复现失败，修复后确认取消保留输入；复核后 0 项未解决问题。

本地实现通过不代表 Issue #3 全部验收完成。真实环境可用且凭据获确认后，仍需从正式页面完成 max_users 准备或复用、必要激活、创建唯一测试套餐、激活，以及响应丢失后的原操作权威核查，并记录后端/Client/前端实际组合。
