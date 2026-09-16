# Issue #204：统一 Console 登录与会话恢复

状态：实现及正式依赖检查完成，真实 Chrome 部分验收通过。缺少单一平台上下文测试账号，首页主链及多标签整体退出尚未验收，不能据此关闭 Issue。

## 入口与会话行为

- `/login` 使用 Soybean 登录外观；平台会话进入 `/home`，复用既有 BaseLayout、菜单、页签、主题及语言切换。`/connection` 保留公开连接诊断。
- 页面仅接触 Runtime 的状态和快照；邮箱密码仅传入登录动作，提交后清空密码输入。Token 不进入 Pinia、localStorage、sessionStorage、URL 或 BroadcastChannel。
- Web Locks 串行化同源标签页的恢复与会话变更；BroadcastChannel 仅发送变更通知。退出意图持久化后先隐藏内容，再完成服务端撤销，失败可恢复；登录中的退出在取得锁后绑定权威版本。
- 刷新未知结果保留内存中的原幂等键；晚到响应受 generation 检查保护。只读检查不刷新、不延长会话；失焦返回和定时检查隐藏受保护内容，直到确认成功。
- 无权限、初始凭据、多上下文、公司上下文、服务不可用和退出未完成均有明确页面状态；本轮不增加 #205 的公司工作台与上下文切换交互。

## 配置与依赖

沿用个人忽略文件中的 `VITE_API_ORIGIN` 及原生 Vite 启动方式。浏览器仍必须经受信 HTTPS Console/Gateway，不能用内部监听地址或浏览器伪造安全请求头代替。后端需先完成 Issue #204 的受控协议切换。

目标依赖为正式 npm `@crane199709/saas-forge-api-client` 精确版本 `0.2.0`，使用新 `Console` namespace。已安装正式 `0.2.0` 并更新 manifest、lockfile 和完整性；不得把后端目录、临时生成物或本地 tarball 作为交付依赖。

## 当前验证

- 正式 npm Client 0.2.0 安装成功；包内来源为后端提交 `c904af13ad92f2ef6eafd98c7679628b09291405`，`dirty=false`。锁文件仅升级 Client，不更新其他依赖。
- 正式依赖下 15 个 Node 测试、常规 TypeScript 检查、全仓 ESLint 和生产构建通过。临时生成包解析映射已删除。
- Chrome 153.0.8010.48，经 `https://console.saas.forge.test` 连接 `https://api.saas.forge.test`，未绕过证书校验。用户在正式页面输入凭据，login/session 返回 200；实际账号有平台权限及 1 个公司上下文，正确显示 CONTEXT_SELECTION_REQUIRED，刷新后仍保持受限。
- 两个 API Cookie 均为 host-only、Path=/、HttpOnly、Secure、SameSite=Strict；Console document.cookie 不可见；检查时 localStorage/sessionStorage 无 JWT，sessionStorage 为空。
- 后端不可达时页面隐藏受保护内容并显示重试；未误报密码错误。已补齐主题、语言按钮可访问名称。
- 只读校验使用 checking 状态清除可用 Token，保留页面实例；模态遮罩同时禁用 body 上的传送浮层，成功后恢复尚有效的焦点。Runtime 回归通过，真实平台页面上的焦点保留仍待验收。

未执行：单一平台账号登录首页、首页刷新恢复、并发刷新、多标签整体退出、退出换账号及平台页键盘焦点验收。用户确认没有仅平台权限的测试账号；未修改现有账号授权或默认放行多上下文账号。真实角色撤销与全部服务的受控切换亦未完成；后端测试不能替代这些浏览器结论。
