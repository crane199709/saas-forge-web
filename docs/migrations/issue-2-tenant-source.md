# Tenant 页面迁移来源

本次对应 saas-forge-web #2，父规格为 saas-forge #201。Soybean Admin Element Plus 固定底座仍为 `7613bd206cd42001b40e3eafceeb895dcbc277a8`，正式 API Client 仍锁定 0.4.0。

业务来源是后端仓库迁出前的 `b29a86390916619d79b709752467e3b3d691390f`：

- `consoles/platform-console/src/TenantCreate.vue`：名称校验、创建抽屉、未知结果锁定与脏表单保护。
- `consoles/platform-console/src/TenantDetails.vue`：正式详情读取、返回名称、时间展示与后续业务模块位置。
- `consoles/shared/admin/src/components/OperationRecovery.vue`：原操作者记录读取、状态展示及原操作恢复。
- `consoles/integration-test/tenant-creation-acceptance.mjs`：查询、分页、失败恢复与真实页面验收要求。
- `consoles/shared/app-runtime/src/authentication-runtime.ts`：Tenant operation 与私有恢复材料边界，具体映射见该提交中的 `createTenant`、`listTenantCreations`、`recoverTenantCreation`。

[原始相关提交补丁](issue-2-tenant-history.patch) 由 `git format-patch --no-signature --stdout --root b29a863 -- <上述前四个路径>` 生成，保留相关文件的逐提交差异、原提交标识、作者、日期和提交说明；没有把历史快照当作当前代码或验收结果。该文件用于历史追溯，不由构建加载，不应直接应用到当前统一 Console。

当前适配使用已有 Soybean Layout、Element Plus、路由生成配置和 vue-i18n。会话仍由同一 Console Runtime 管理，正式 Client 从其私有内存凭据读取鉴权。恢复页面不接触幂等键，不持久化操作材料。比旧通用恢复组件更严格地检查完整分页、重复游标、重复记录、缺失字段和点击时的权威允许动作；查询失败不能放行创建或恢复。

详情的后续订阅、管理员初始化和生命周期模块仍由各自迁移票接入，当前不展示虚假的按钮或业务结果。后端迁出记录中的其他业务、安全和全量浏览器覆盖继续由 #206 和相应业务票跟踪。
