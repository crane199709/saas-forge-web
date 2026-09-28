# 冻结的 Remote 静态夹具

来源：后端仓库提交 `b29a86390916619d79b709752467e3b3d691390f` 的 `consoles/static-remote-acceptance/` 与 `consoles/scripts/build-static-remote-acceptance.mjs`。本目录的 v1/v2 JS、CSS、SVG 为历史已交付制品，逐文件匹配该提交的 `checksums.json`，并非本轮工具链重新编译的结果。它们作为不可变测试输入提交，`dist/` 仍是忽略的构建输出。

`pnpm build:static-remote` 先校验所有字节，再复制到 `dist/static-remote-acceptance/`。更改内容必须使用新版本路径，不能重写旧 SHA-256 或格式化已发布 JS。本票没有添加版本、Manifest、业务 Remote、认证依赖或网络副作用。

宿主通过固定 HTTPS Remote Origin 匿名读取三个文件，禁止重定向，然后使用宿主拥有的临时 Blob URL 执行和显示；此方式只适用于当前已审核且无二级资源引用的夹具，不是任意 Remote 执行器。清理会移除 DOM、样式和图片、撤销 Blob URL、取消请求并阻止晚到挂载；浏览器已执行的 ES Module 缓存不等于可反执行的脚本。

原 `admin-consumer-fixture/src/Remote.vue` 的公开表单行为迁入 `src/remotes/admin-consumer-fixture/Remote.vue`，改为只消费宿主展示能力；原 `{name}` 消息插值通过现有 vue-i18n 实现，未使用的旧 ICU plural/select 资源没有引入本夹具。精确格式化从原 `shared/i18n/src/index.ts` 迁入宿主无状态函数，不保留独立语言注册表、翻译 Runtime 或旧 UI 包依赖。
