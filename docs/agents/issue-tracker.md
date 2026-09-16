# Issue tracker: GitHub

需求与规格记录在 crane199709/saas-forge-web 的 GitHub Issues，
通过 gh CLI 操作。在仓库内运行时，根据 git remote 确定目标仓库。

## 常用操作

- 创建：`gh issue create --title "..." --body-file <文件>`
- 读取：`gh issue view <编号> --comments`；
  需要结构化数据时使用 `--json number,title,body,labels,comments`。
- 列表：`gh issue list --state open --json number,title,body,labels,comments`；
  按需使用 `--label` 和 `--state` 筛选。
- 评论：`gh issue comment <编号> --body-file <文件>`
- 添加标签：`gh issue edit <编号> --add-label "<标签>"`
- 移除标签：`gh issue edit <编号> --remove-label "<标签>"`
- 关闭：`gh issue close <编号>`

多行正文写入临时文件，再通过 --body-file 传入。

技能要求“发布到 issue tracker”时，创建 GitHub Issue；
要求“获取相关 ticket”时，读取对应 Issue 及评论。

## Pull requests as a triage surface

**PRs as a request surface: no.**

GitHub 的 Issue 和 PR 共用编号空间；编号类型不明确时，
先用 `gh pr view <编号>` 判断，再读取对应 Issue。

## Wayfinding

- Map：使用带 `wayfinder:map` 标签的 Issue，
  正文维护 Notes、Decisions-so-far 和 Fog。
- 子任务：优先关联为 GitHub sub-issue；不支持时，
  在 Map 正文维护任务列表，子任务注明 `Part of #<map>`。
- 类型标签：`wayfinder:research`、`wayfinder:prototype`、
  `wayfinder:grilling`、`wayfinder:task`。
- 阻塞关系：优先使用 GitHub 原生 Issue dependencies；
  不支持时，在子任务正文注明 `Blocked by: #<编号>`。
- 可执行任务：按 Map 顺序选择未关闭、未指派且没有未关闭阻塞项的子任务。
- 领取：`gh issue edit <编号> --add-assignee @me`
- 完成：评论记录结果，关闭子任务，并向 Map 的 Decisions-so-far
  补充结论摘要和链接。
