# 阶段 3 Project / Task Remote

2026-10-06，同轮隔离 Fresh Compose、Google Chrome 154.0.8037.98 与正式 Client 0.5.0 完成真实浏览器验收。后端 runId 为 `4558f7d2-2296-4377-be69-b3de59c4d641`；基线 `6866345`，前端基线 `aa67f6b`，两者 dirty=true。具体来源与请求结果见 [浏览器报告](stage3-project-remote-report.json)。不代表完整 MVP 或远端 CI 通过。

通过交互式 Playwright 的真实 Chrome 完成 CI Client 页面创建、CI 注册 Project 1.0.0、平台批准/启用、Tenant Shell 加载、两个 Tenant 的 Project/Task CRUD。待审核与仅批准时租户无业务模块；另一个声明由平台拒绝，无启用按钮。外部来源经真实 CI 注册返回 400，平台无该声明。平台上下文访问 Project 返回 403。Console 的 HttpOnly Cookie/Origin/Fetch Metadata 由浏览器管理；Remote 仅获得冻结的业务 Host，不获得 Token、通用 Client 或底层请求参数。

`scripts/verify-project-remote.mjs` 对最终产物自动重跑 11 项：CRUD，7 项跨租户拒绝，B 数据不变，35 秒会话核查期间草稿保持，以及下载失败/恢复。跨租户用例只修改浏览器出站资源地址；响应来自真实 Gateway/Starter/RLS，无 Mock。与交互式审核流程使用相同 Fresh 环境及 handoff。制品 SHA-256 为 `acc9d5d5e709ee109dbbbeeb33ae1717d9ae3db4930055e6d9448eab64366209`，UI 为 `vue@3.5.31;element-plus@2.13.6`。

同轮英文页面、Tenant 名称传递、键盘输入、Remote axe 与平台 WCAG 2 A/AA、2.1 AA 检查通过。Shell 在只读 checking 期间保留但隐藏组件，Host 拒绝调用；失败或上下文变化仍卸载。240 项单元测试、类型检查、ESLint 和生产构建通过。哈希/UI 版本非法输入由单元测试覆盖，不将其写作已启用非法 Manifest 的浏览器结果。

后端对最终报告中的 A Project/Task ID 精确验证六种成功事实入 Audit，并验证实际 JSON 日志 Schema 和完整 OTLP Server/Server/Producer/Consumer 父子链。完整结果及发现的部署/接收端缺陷在后端仓库 `docs/acceptance/stage3-browser-acceptance.md` 与附带公开 JSON；本仓不运行后端编排。

## 重跑核心业务路径

由环境准备方提供有效的七服务 Fresh handoff、两个已初始化且可登录的 Tenant 账号，以及已审核启用的 Project 1.0.0。使用 Git 忽略、受限配置文件，结构为 `{ "handoff": "绝对路径", "tenantA": { "email": "验收邮箱", "passwordFile": "0600 密码文件" }, "tenantB": { "email": "验收邮箱", "passwordFile": "0600 密码文件" } }`。文件路径与凭据不提交。

```sh
SF_STAGE3_BROWSER_CONFIG=/absolute/private/config.json \
  node scripts/verify-project-remote.mjs /absolute/private/new-output-directory
```

输出目录必须不存在；脚本会创建两租户测试数据并删除本次 A 数据，保留 B 用于拒绝后的权威回读。清理由环境准备方按验收记录处理，不默认销毁卷。需要完整重跑注册/审核路径时，先用空环境从正式 CI 注册和平台页面审核开始，不能把此核心脚本单独运行描述成重跑全部阶段。

生产构建先执行 `pnpm build`，再执行 `pnpm build:project-remote`。环境准备方校验声明与文件哈希后，将不可变制品放到固定只读交付目录；不要把可能被后续构建删除的 dist 目录直接作为长寿命挂载。手动检查期间的受控网络故障、身份拒绝和准备失败与最终核心报告分开记录。
