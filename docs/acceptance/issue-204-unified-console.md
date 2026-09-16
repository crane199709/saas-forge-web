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

## 2026-09-16 平台账号 Chrome 验收补充

本轮前端工作树基线 `77fc1e45dd6e0e8928d9f2fee08df21f20340a16`，后端工作树基线 `80c88de6d7393daf5eb05958d2e507c2c56fed94`，Client 0.2.0，Chrome 153.0.8010.48；连接用户已经启动的本地 HTTPS Console/Gateway，未管理后端进程。进程本身未提供构建提交标识，工作树版本不能作为运行制品哈希证明。

用户授权新建的本地测试 Identity 仅有 PLATFORM_ADMIN、常规密码和零公司 Membership。本轮通过正式页面输入邮箱密码并按 Enter 登录，进入平台首页，login 返回 200。

通过：

- 首页刷新恢复；同一 Chrome context 的第二标签页直接打开首页恢复成功；两个标签页同时 reload 后均恢复首页，refresh 均为 200。
- 定时只读 session 校验后，主题按钮保留键盘焦点，refresh 次数没有增加。
- 英文首页和账号/上下文文案切换；主题按钮切换后 html 为 dark。
- 通过头像菜单及确认对话框整体退出，logout 返回 204，两个标签页均返回登录页；随后刷新两页均保持登录表单，旧账号文本数量为零。
- Console document.cookie 为空，localStorage/sessionStorage 中未检出 JWT，成功退出后没有持久化退出意图；两个 Cookie 均为 API host-only、Path=/、Secure、HttpOnly、SameSite=Strict。
- 上述主链没有 pageerror。

未通过/未完成：额外晚到刷新响应注入在 Playwright route.fetch 的 Node TLS 信任链处失败，未绕过证书检查，不作为浏览器晚到响应通过证据；现有 Runtime 晚到响应测试仍有效。不同账号切换、真实角色撤销、完整来源安全矩阵及全部服务运行版本的切换验证尚未执行。本轮不据此声明 #204 的全部安全验收完成。

## 同日补充：换账号、权限撤销及晚到响应

用户授权两个账号登录，并允许临时撤销新平台测试账号角色。本轮仍使用 Chrome 153.0.8010.48、正式 Client 0.2.0 和同一已启动 HTTPS 后端。

- 换账号通过：平台账号退出后，双身份账号登录，在两页均显示 CONTEXT_SELECTION_REQUIRED；退出后切回仅平台账号，两页进入首页，旧账号文本为零。密码只从用户指定本机文件读取，不写入验收材料。
- 测试进程追加本地 root CA 后，HTTPS JWKS 请求返回 200；未设置 ignoreHTTPSErrors 或关闭 TLS 校验。route.fetch 虽通过证书验证，但代发刷新返回 403，因此该尝试不作为成功注入证据。
- 晚到成功响应通过：改在浏览器页面的 fetch 响应交付处设置临时闸门，请求仍由真实 Chrome 发往 Gateway，保持浏览器生成的安全头和 Cookie。刷新实际返回 200，先保留响应不交给 Runtime；另一页确认退出后才释放响应。旧会话未复活，两页账号文本为零，最终 logout 返回 204，恢复到登录表单。随后关闭带注入脚本的页面，重新创建无注入页面。
- 真实权限撤销通过：只临时撤销新测试账号的唯一 PLATFORM_ADMIN 行；会话检查分别返回 403、401，两页离开首页，旧 Token 访问平台 OAuth Client 查询返回 401 ACCESS_TOKEN_INVALID。
- 按角色 ID、账号与保存的撤销时间精确恢复该角色。恢复后旧 Token 仍返回 401，重新通过正式登录页登录可进入平台首页；随后整体退出测试会话。未改变任何公司 Membership 或其他账号授权。

本节补齐此前列出的三项浏览器验收缺口。全部服务运行制品标识、完整来源安全矩阵和其他专项 Issue 的验收不在本轮结果中冒充通过。
