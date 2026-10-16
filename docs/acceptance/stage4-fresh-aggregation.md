# 阶段 4 同轮证据聚合入口（#240）

状态：仅完成失败关闭判定器和轻量自动化测试；阶段 4 Fresh Chrome 产品验收尚未执行。本文不表示任何场景已通过。

## 责任与输入

后端环境准备方持有 Fresh Compose 项目、受限凭据、受控 v2 启用、服务镜像、权威探针与 Audit 持久查询。前端只运行真实桌面 Chrome 中的统一 Console/Remote 场景，不启动、替换或清理后端。两仓各自运行 CI；环境准备方负责本轮资源清理。前端脚本只读取下列脱敏文件，不接受 Cookie、Token、密码或原始邮件内容。

本仓 `scripts/stage4-aggregate.mjs` 接收两个参数：受限的 `manifest.json` 和尚不存在的输出文件路径。Manifest 指向本轮 `handoff.json`、`browser` / `authority` / `audit` 三类直接报告及 `ci.json`，并记录当日 Chrome Stable 公告：

```json
{
  "handoff": "/absolute/round/handoff.json",
  "reports": {
    "browser": "/absolute/round/browser.json",
    "authority": "/absolute/round/authority.json",
    "audit": "/absolute/round/audit.json"
  },
  "ci": "/absolute/round/ci.json",
  "chromeRelease": {
    "version": "当轮实际 Chrome 版本",
    "checkedAt": "当轮核对 Google Desktop Stable 公告的 ISO 时间",
    "url": "https://chromereleases.googleblog.com/对应公告"
  }
}
```

三类报告均须有 `schemaVersion: 1`、对应的 `kind: stage4-browser` / `stage4-authority` / `stage4-audit`、相同 `runId` 和 `handoffSha256`、位于 handoff 有效窗口内的 `startedAt` / `finishedAt`、`status` 与 `checks`。每个 `checks` 条目以脚本中的稳定名称表达本轮**直接执行**的场景及 `passed` / `failed` / `skipped` / `not_run`。浏览器报告另须记录真实 `chrome`、`frontend` 源码提交与 dirty、已部署 HTML 来源核对、源码和锁文件 SHA-256、正式 Client 名称/版本/来源提交、Project Remote 版本与入口 SHA-256、实际浏览器驱动文件 SHA-256。报告生成器应沿用 `build/provenance.ts` 的正式 Client 来源校验；本聚合器只交叉检查脱敏结果，不代替生成器的真实性验证。

`ci.json` 记录后端 `Verify`、后端 `API Client artifact`、前端 `Frontend verification` 三个成功运行的提交、结论和 GitHub Actions run URL，分别使用 `backend`、`apiClient`、`frontend` 键。只有运行提交与 handoff 后端/浏览器前端提交一致，才能关联。当前后端 API Client 工作流由 PR 或手动触发；若尚无对应运行，明确记为未执行，不借用旧版本运行。

## 判定与范围

```sh
node scripts/stage4-aggregate.mjs /absolute/round/manifest.json /absolute/round/new-aggregate.json
```

判定器检查 Fresh 项目名、隔离网络及 PostgreSQL/Redis/Kafka 数据卷、七个应用镜像、JDK 17、干净两仓提交、正式 Client 大于当前 0.5.0、同轮报告的必需场景、Chrome 版本与 48 小时内核对的 Google 官方 Desktop Stable 公告，以及上述三个 CI 运行。缺失、失败、跳过、未执行、跨轮、旧 Client 或不可覆盖的输出文件均退出非零。输出逐项保留 `passed` / `failed` / `skipped` / `not_run`，并写入原报告 SHA-256；不复制报告中可能含有的附加字段。

这是一道证据关联门禁。真实浏览器操作、跨进程故障、受限账号/RLS、Outbox → Audit 持久行验证和敏感信息扫描必须由各自报告的执行者完成。仅生成符合形状的 JSON、阶段 2/3 的旧报告、普通 handoff 冒烟或单仓测试，均不能作为 #240 的直接证据。审计报告需要逐个成功变更关联源事件、Outbox 和已持久 Audit Record；日志、Kafka 投递或消费计数不算持久证明。

### 真实 Chrome 局部产品驱动

`scripts/verify-stage4-product.mjs` 可在本轮 Fresh handoff `ready`、SMTP 已确认指向本轮 Mailpit 后运行。它使用系统 Google Chrome、四域受信 HTTPS、正式 Console UI 和正式 Client；只设置页面语言，不注入 Cookie、Origin、Fetch Metadata 或 Token，也不模拟服务端响应。脚本直接执行：创建两棵组织根节点、创建带 Project Permission 的 Tenant Role、创建一条 `.test` Invitation，以及上传 Logo/Favicon、隔离预览并保存五字段 Brand Profile。每项均核对浏览器经 Gateway 收到的正式 API 状态、资源 ID 与页面结果，并在仅本轮可读的报告中记录 Audit 关联所需的操作时间窗、action、actor 与 resource。Mailpit 的实际收信仍需另行取证。

受限 0600 配置文件包含绝对路径 `handoff`、`tenantAdmin: { email, passwordFile }`、`invitationEmail`（必须为独立的 `.test` 地址）、`rolePermission`（例如 `example:project:list`）、`logoPng`、`faviconPng`。密码只放在另一份 0600 文件；两个 PNG 必须为本轮待上传的有效静态图片，配置和输出均不得提交。

```sh
node scripts/verify-stage4-product.mjs \
  /absolute/private/stage4-product-config.json \
  /absolute/private/new-stage4-product-output
```

输出为仓库外权限 0700 的新目录及 0600 的 `stage4-product-observations.json`，`kind=stage4-product-observations`、`scope=selected-real-chrome-paths`。它保留失败/未执行状态，不等于完整 `stage4-browser` 报告；组织移动/多归属、角色委派与拒绝、邀请接受/等待授权、品牌冲突/回退、Project/Task 十操作允许与拒绝等仍须同轮直接验收。旧 `verify-project-remote.mjs` 可作为 Project/Task 基本 CRUD 与跨 Tenant 404 的补充，但不能代替同 Tenant 不同角色拒绝或撤权即时失败。

### 本轮 Mailpit 一次性链接辅助器

邀请、首次密码设置和密码恢复均须消费本轮 Mailpit **新增**邮件。`scripts/stage4-mailpit-link.mjs` 只从回环 Mailpit 读取邮件：先在触发业务操作前记录该收件人的消息 ID，再等待新邮件；仅接受 handoff 所指 Console HTTPS Origin 下的 `/invitation`、`/password-setup` 或 `/password-recovery` 链接。0600 配置包含 `handoff` 绝对路径、`mailbox`（例如本轮 `http://127.0.0.1:8025`）及本轮独占的 `.test` `recipient`。快照和链接文件必须放在仓库外、所有者独占的目录，且路径不存在。命令只打印消息 ID 和链接的 SHA-256，不打印 Token 或邮件正文。

```sh
node scripts/stage4-mailpit-link.mjs snapshot /absolute/private/mailbox-config.json /absolute/private/new-snapshot.json
# 在真实 Chrome 中触发邀请、密码设置或恢复邮件，然后：
node scripts/stage4-mailpit-link.mjs wait /absolute/private/mailbox-config.json /absolute/private/new-snapshot.json /invitation /absolute/private/new-link.txt
```

后续只让受限 Chrome driver 从 0600 链接文件导航；不得把原始链接写进日志、截图、验收报告或命令行参数。若同一快照后出现多封匹配邮件，辅助器拒绝选择，以免误用旧链接。取得链接仅证明邮件到达，不证明身份绑定、接受、等待授权或全局会话撤销成功。

场景名称与覆盖边界见脚本的 `required` 常量及后端仓库 `docs/acceptance/issue-240-stage4-fresh.md`。当后续切片改变正式契约或场景时，同步修订要求并在真实报告生成器中执行，不能通过删掉必需项获得通过。完整原始脱敏报告、SHA-256 清单和最终结论在执行后落入版本控制的验收目录；本地 `.scratch/` 只放中间材料。
