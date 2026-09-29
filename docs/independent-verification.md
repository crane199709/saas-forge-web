# 独立验证与验收环境交接

本仓库只连接已启动的受信 HTTPS Console/Gateway。Node.js 24.14.1、pnpm 11.22.0、桌面 Chrome 当前稳定版；不需要后端源码、JDK、Maven、Docker 或相邻目录。启动应用用 `pnpm run dev`，检查命令不会启动任何应用。

## 本仓库检查

`pnpm run verify` 顺序执行类型检查、只读 ESLint、全部 Node 测试及生产构建。CI 继续保留同样四项独立失败步骤。`pnpm run lint` 是底座既有修复命令；验收使用 `lint:check`，避免自动改写文件。

Runtime 与业务状态由 `tests/` 验证；`console-client.test.ts` 验证正式 Client HTTP 边界；`console-protocol.test.ts` 迁入原前端调用方会话门禁，禁止复活旧 Slot/手写认证端点；`locale-format.test.ts` 迁入精确数字、金额、日历日期/时间点和本地化安全回退断言。这些模拟/静态检查不能代替真实浏览器。

## 已准备环境的真实 Chrome 冒烟

环境准备方提供 `handoff.json`，格式版本为 1，包含 runId、Ready/失效时间、Console/API Origin、后端版本来源、隔离信息、清理责任及公开 JWKS 摘要。无需读取后端仓库；可以从任意位置传入该文件。

```sh
pnpm run verify:handoff -- /absolute/path/handoff.json
# 凭据只能是受限文件路径，文件权限 0600；不把密码写到命令行或交接 JSON。
SF_EMAIL_FILE=/absolute/path/email SF_PASSWORD_FILE=/absolute/path/password \
  pnpm run verify:browser -- /absolute/path/handoff.json /absolute/path/new-result-directory
```

`--` 是 pnpm 的参数分隔符；也可以直接执行 `node scripts/verify-browser.mjs --run <handoff> <output>`。目录须尚不存在且父目录已存在。运行者提供 Playwright：默认解析已安装的 `playwright`；外部工具运行时可设置 `SF_PLAYWRIGHT_MODULE` 为该包 `index.mjs` 的绝对路径。当前仓库未擅自引入新依赖，外部运行时必须记录版本，不能依赖作者机器路径。Chrome 用 `channel: chrome`，保持证书验证，不下载/使用另一浏览器冒充产品 Chrome。

邮箱账号应可进入平台上下文且已完成首次改密。入口不创建账号、改密、准备 Tenant、替换服务或删除数据。需要首次改密/公司/业务主链的专项由相应业务票接入；缺少前提会失败，不静默跳过。仅新建本次 Chrome 配置，不使用或更改用户正在浏览的标签页。

流程：登录页 → 中英文/主题及匿名截图 → 键盘登录 → 显式平台上下文选择 → 标题焦点 → Cookie Secure/HttpOnly/Host-only 属性 → 刷新恢复 → 第二标签页恢复 → 页面退出并刷新仍匿名。所有业务请求来自真实页面的正式类型化 Client，没有拦截成功响应或 API 建状态。检查实际 API Origin 与交接信息一致；公开 JWKS 在真实浏览器读取并匹配本轮摘要。这个有限流程不等同于完整 #205、#183 或所有多标签负例。

失败返回非零，已有报告不能被覆盖。输出只有脱敏 `browser.json` 和填入凭据前的登录截图；不保存密码、Cookie、Token、原始错误、HAR、trace、storageState 或登录后的个人数据截图。报告带阶段、版本和交接文件 SHA-256；任何未知页面异常、Console error 或 API 4xx/5xx 阻断通过，不能笼统忽略 401/403/503。截图供人工视觉核对，不声称自动视觉基线或完整无障碍认证。

普通 `existing-environment` 交接不证明 Fresh，后端版本来源标为 source-checkout-only 时不声称它是已部署制品的确切 Git SHA。Fresh 要求准备方提供专属新卷、网络、容器和镜像/JDK 证明。前端从不启动/替换/恢复/销毁后端；无论成功或失败，环境和业务数据清理由准备方负责。完成后把脱敏长期证据放入 `docs/acceptance/`，临时目录不作为交付证据。

## 同轮汇总与后续切片

后端独立运行同轮 `probe`，再用 `correlate` 检查前后端报告的 runId、交接摘要、有效时间和状态，任何失败/跳过/空报告均拒绝。关联摘要只代表交接冒烟，不自动合并/关闭业务票。环境准备、完整 schema 字段与命令见 [后端交接说明](https://github.com/crane199709/saas-forge/blob/master/docs/acceptance/independent-verification.md)。

后续浏览器切片可以复用交接输入、版本记录与脱敏约束，保留自己的真实场景结果；既有 `scripts/remote-browser-checks.mjs` 继续提供 Remote 加载/卸载/隔离验证。后端安全注入与服务消费由后端执行，前端观察页面恢复。

待迁独有覆盖及责任：#184 中文完整主链/Audit；#185 Token/越权/Redis 与恢复；#186 生命周期/英文代表流程；#187 OAuth 服务消费/窗口/吊销；#188 已提交丢响应与替代失效；#189 同轮全量聚合；#183 为父验收。旧视觉/自动无障碍/生产错误边界、多标签竞态和 i18n ICU/资源完整性不因当前入口通过而删除。#103 在 Soybean/Element Plus 上适配重排、局部表格滚动、主辅语义、键盘焦点及真实路由/Remote 消费，不恢复旧自建 Design System 或双 Console。完整逐项责任映射保留在后端交接说明，父 #201 状态不变。

## 固定版本与历史

继续锁定正式 `@crane199709/saas-forge-api-client@0.4.0`。脚本核对 manifest/lock/安装包来源，记录前端 Git SHA/dirty、源文件内容 SHA-256、lock SHA-256、Client 版本/源提交与 Chrome。Vite 在开发与生产 HTML 注入公开 sf-build 元数据，浏览器在提交凭据前核对实际页面与本地来源一致；缺失或不一致直接失败。该元数据不读取个人配置、环境变量或凭据，不是供应链签名。前端独立构建不调用后端生成器。兼容后端与 Client 先交付，再按需显式升级前端；不存在强制同时发布要求。

旧 Console 历史在隔离目录通过 Git fast-export/import 保留相关提交，完整 bundle 只导入 `refs/remotes/legacy/console-history`，不覆盖新 main。具体命令与树哈希见 [历史复现](https://github.com/crane199709/saas-forge/blob/master/docs/acceptance/console-history-reproduction.md)。保持 Soybean 固定祖先和许可证；旧 dist/本机备份不冒充发布制品。


## #201 检查修复

语言统一、资源安全回退、生产页面视觉/axe 与键盘门禁的现行入口、历史映射和模拟边界见 [语言与页面回归检查](locale-and-ui-verification.md)。上文待迁清单保留原时点事实；本次迁入项以新文档明确范围为准，未覆盖的 Session Tabs 或真实专项仍不能据此勾选。
