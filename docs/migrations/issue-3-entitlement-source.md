# Quota Definition 与 Plan 迁移来源

对应 saas-forge-web #3 与父 PRD saas-forge #201。保留 Soybean Admin Element Plus 底座提交 `7613bd206cd42001b40e3eafceeb895dcbc277a8`；消费已发布的 `@crane199709/saas-forge-api-client@0.4.0`，没有引入新依赖或后端源码构建依赖。

历史业务来源为后端迁出前的 `b29a86390916619d79b709752467e3b3d691390f`：

- `consoles/platform-console/src/QuotaCreate.vue`：max_users 精确匹配、复用与创建。
- `consoles/platform-console/src/PlanCreate.vue`：创建抽屉、编码/名称/正整数额度、未知结果锁。
- `consoles/platform-console/src/EntitlementDetails.vue`：详情、激活、历史零额度只读。
- `consoles/platform-console/src/plan-guard.ts`：完整操作分页及按对象限制未决操作。
- `consoles/integration-test/plan-acceptance.mjs` 与 `quota-definition-acceptance.mjs`：页面链路及未知结果验收来源。

[相关提交补丁](issue-3-entitlement-history.patch) 由 `git format-patch --no-signature --stdout --root b29a86390916619d79b709752467e3b3d691390f -- <上述路径>` 生成，保留相关提交标识、作者、日期、说明与逐提交差异。历史补丁仅用于追溯，不由当前构建加载，也不作为本轮验收证据。

当前实现复用统一 Console 的私有凭据、Soybean 布局、Element Plus、vue-i18n 和现有路由体系。额度/套餐的共享业务 Workspace 分别持有当前主体的操作记录及原幂等键；页面只能传业务输入或记录 ID，不接触 Token、浏览器安全头或恢复键。

迁移同时补齐明确的边界：额度查询为子串匹配，需完整分页后精确识别 max_users；套餐人数按额度定义 ID 匹配，不能取数组首项；新建或激活前重新读取权威记录，恢复前重读原记录许可。分页异常、缺失额度、权限失败均关闭写入口，历史零额度与 RETIRED 记录可读。同一编码创建或同一 ID 激活的未决状态不阻断其他对象。

只交付已有额度与套餐能力；订阅、管理员初始化、生命周期等由对应业务票负责。真实、模拟和未执行项分别见本票验收记录。
