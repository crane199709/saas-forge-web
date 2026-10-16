# Console UI 与语言规则

本文承接后端仓 `docs/25-design-system.md` 与 `docs/29-console-internationalization.md` 中仍然有效的规则。2026-10-16 迁入时已对照本仓实现逐条核对，后端仓那两份文档现在只保留指向本文的说明。语言标识、资源门禁与 UI 回归入口以[语言与页面回归检查](locale-and-ui-verification.md)为准，开发入口见[独立前端开发](independent-development.md)。

## 布局与组件

- 使用完整 Soybean Admin Element Plus 底座，上游固定提交 `7613bd206cd42001b40e3eafceeb895dcbc277a8`。业务页面直接复用底座布局和 Element Plus；认证、品牌、语言、退出保护和原操作恢复只做必要适配，不自建重复 UI 包。
- 一个 Console、一个受控 Origin、一个当前 Identity 与工作上下文；登录前不预选 Intent。
- 创建类操作使用抽屉；Tenant 与 Plan/Quota Definition 详情为独立路由页面。返回与关闭使用有可访问名称的图标。列表样式见[语言与页面回归检查](locale-and-ui-verification.md#正式业务列表样式约定2026-09-30)。
- 不展示解释布局的小字；保留真实业务风险、失败与恢复信息。

## 认证、品牌与业务

- Console Runtime 持有会话凭据，UI 只观察公开状态并调用类型化 Client。Cookie、Origin、Fetch Metadata 由浏览器管理，不作为 UI 业务参数。
- 品牌必须完整校验名称、颜色、受控素材路径、MIME 与图片解码；取消或过期的解析结果不应用。任一字段失败都整体回退平台品牌，不拼接部分结果，也不沿用上一家公司的品牌。
- Remote 只读取宿主继承的 Theme Token 与 Locale，不独立解析品牌、加载素材，也不读写语言偏好或认证状态。
- 提交结果未知时锁定字段并禁止再次提交；原操作恢复只在服务器允许时提供，不生成第二个创建 Key。分页 guard 必须读完全部页；缺失游标、重复游标或中途失败都失败关闭。
- Tenant、订阅、初始化、通知和生命周期分区读取；成功快照可以保留，权威读取不足时禁止相关写入。

## 键盘与无障碍

- 所有控件有可访问名称，表单保留错误关联。路由有标题、焦点和 live announcement；抽屉与确认框处理焦点进入、焦点约束、关闭与返回。
- 脏表单离开、退出和公司切换都经过同一退出保护。卸载时取消请求并忽略迟到响应。

## 语言

- 产品语言为 `zh-CN` 与 `en`。只有有效偏好 `en` 选英文，其余值（包括历史 `en-US`）回到中文并写回；不按浏览器语言自动选择。
- 语言偏好是本地 UI 偏好，按 Origin 保存，不属于账号、Tenant 或 IAM 状态；登出、换账号、切换公司都保留偏好。
- 切换语言即时更新文案、Element Plus、Dayjs 与文档 `lang`，不刷新页面、不重新挂载路由或 Remote，也不触发业务请求；输入、弹窗与路由保持不变。
- 资源只允许纯文本，不执行资源中的 HTML 或富文本。当前语言缺失或无效时回退英文；英文也不可用时显示安全恢复文案，不向用户暴露翻译 key、资源原文或编译异常。
- 用户输入、Tenant 名称等业务数据保持原值。服务端返回的原始 `title`、`detail` 不作为翻译资源或兜底显示。

## 格式化

- 使用 `src/locales/format.ts` 的 `formatDate`、`formatInstant`、`formatNumber`、`formatMoney`，Locale 由调用方显式传入。
- 时间点是 UTC RFC 3339，默认按浏览器时区显示；日历日期 `YYYY-MM-DD` 不转换成时间点，不得出现跨日偏移。
- 精确小数和金额保持十进制字符串精度，不转成浮点数；币种由业务数据明确提供。切换语言不改变时间点、币种、金额数值或 API 数据格式。

## 未迁入的旧规则

后端仓旧文档中的以下内容已和本仓实现不一致，没有迁入，只能从后端仓 Git 历史追溯：按浏览器语言候选匹配、`en-US` 默认与回退、`sf:ui:locale` 存储键、ICU MessageFormat 与 `intl-messageformat`、`@saas-forge/i18n` 与 `@saas-forge/admin` 包、双 Console 各自独立偏好，以及 Plan 详情使用抽屉。
