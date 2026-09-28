const local: App.I18n.Schema = {
  oauth: {
    title: 'OAuth Client 管理',
    detail: 'OAuth Client 详情',
    create: '创建 OAuth Client',
    back: '返回 Client 列表',
    name: '名称',
    id: 'Client ID',
    type: 'Client 类型',
    reservedKey: '保留服务键',
    scopes: '允许的 Scope',
    filters: '筛选 OAuth Client',
    empty: '没有匹配的 Client',
    secretTitle: '一次性 Secret',
    secretHint:
      'Secret 仅展示一次。请保存到受控密钥管理器；关闭、离开、刷新或退出后无法再次查看。复制后请妥善处理系统剪贴板。',
    copy: '复制 Secret',
    copied: '已复制',
    copyFailed: '复制失败，请手动保存。',
    recovery: '原操作与恢复入口',
    recoveryHint: '只显示当前操作者的原操作。请先核查，再显式恢复；恢复许可、十分钟期限与一次替代限制由后端校验。',
    recoveryWarning:
      '恢复会签发新的 Secret，并立即使本次原签发的 Secret 失效。不会回读旧 Secret；轮换前的旧稳定 Secret 仍按原重叠截止时间生效，窗口不会延长。新 Secret 仅展示一次。',
    recoveryOriginalHint:
      '本标签页有同类待核查请求时，将由后端校验原请求与此 Client 的关联，并恢复该原请求；关联不成立时不会改为恢复另一笔操作。',
    recoveryUnknown: '恢复请求结果未知，不能再次恢复或发起替代签发。请刷新核查原操作；查询不会回读已签发的 Secret。',
    unknown: '操作结果未知，已保留原操作信息并锁定替代请求。',
    unchecked: '尚未完整核查操作记录，签发操作暂不可用。',
    noOperations: '没有操作记录',
    operationId: '操作 ID',
    completedAt: '完成时间',
    recoveryUntil: '可恢复截止时间',
    recoverable: '后端允许恢复',
    yes: '是',
    no: '否',
    nameInvalid: '请输入 1–200 个字符的非空名称。',
    scopesInvalid: '请至少选择一个运行时 Scope。',
    rotateWarning: '确认轮换此 Client 的 Secret？旧凭据有效期以服务器返回的重叠窗口为准。',
    revokeWarning: '确认吊销此 Client？吊销后其凭据将不可用，此操作不可撤销。',
    revokedAt: '吊销时间',
    overlap: '重叠截止时间',
    noOverlap: '无重叠窗口',
    authorityHint: '轮换与吊销许可由服务器决定。刷新可重新核查；本机时间不会自动放行轮换。',
    states: {
      ACTIVE: '有效',
      REVOKED: '已吊销'
    },
    types: {
      RUNTIME_SERVICE: '运行时服务',
      RESERVED_SERVICE: '保留服务'
    },
    actions: {
      CREATE: '创建',
      ROTATE: '轮换 Secret',
      RECOVER: '恢复签发',
      REVOKE: '吊销'
    },
    errors: {
      invalid: '服务响应无法确认，请刷新核查。',
      unavailable: '请求未能确认，请核查原操作，不要重复签发。',
      forbidden: '当前身份或凭据状态不允许此操作。',
      notFound: 'Client 不存在或不可访问。',
      stale: '会话或页面已改变，请重新核查。',
      pending: '存在待核查的原操作，不能发起替代请求。',
      input: '请检查名称与运行时 Scope。'
    }
  },
  notification: {
    title: '密码设置通知',
    refresh: '核查通知与原操作',
    resend: '重新发送通知',
    continue: '继续原通知操作',
    confirm: '确认向初始管理员重新发送密码设置通知？此操作不会重新初始化管理员，也不会更改 Membership 或 Quota。',
    hint: '通知状态由服务端确认。重发独立于初始化；只有原操作者可恢复其待处理通知。',
    unknown:
      '原操作结果尚未确认，不能开始新重发。请保留当前页面核查原通知，仅在服务端允许时继续；若刷新后仍无法定位原操作，需要核对服务端记录。',
    operation: '当前操作者的通知操作',
    pending: '原通知仍在处理中，或暂不允许恢复。请稍后核查。',
    operations: {
      NONE: '无通知重发操作',
      PENDING: '原操作待处理',
      COMPLETED: '原操作已结束',
      UNKNOWN: '原操作结果未知'
    }
  },
  initialization: {
    title: 'Tenant 管理员初始化',
    refresh: '核查初始化状态',
    start: '初始化管理员',
    continue: '继续原初始化',
    close: '关闭管理员初始化表单',
    submit: '确认初始化',
    hint: '仅在订阅有效且服务端允许时操作。处理中或补偿中请等待并核查；只有原管理员可继续待恢复的初始化。',
    formHint: '提交后会清除邮箱和名称。中断或结果未知时，请核查并继续原初始化，不要重新创建尝试。',
    email: '管理员邮箱',
    name: '管理员名称（可选）',
    emailInvalid: '请输入有效邮箱，长度不超过 320 个字符。',
    nameInvalid: '名称不能超过 200 个字符。',
    result: '初始化结果',
    membership: '初始管理员 Membership',
    notification: '密码设置通知',
    notificationHint:
      '通知状态独立于初始化结果。“邮件服务已接收”不表示邮件已到达；初始化成功以服务端结果和初始 Membership 为准。',
    unchecked: '尚未确认',
    stale: '当前为上次读取结果，最新状态尚未确认，操作已禁用。',
    unknown: '结果尚未确认，不能开始新尝试。请核查原初始化，仅在服务端允许时继续。',
    states: {
      NOT_STARTED: '尚未开始',
      PROCESSING: '初始化处理中',
      RECOVERY_REQUIRED: '等待原管理员恢复',
      COMPENSATING: '补偿处理中',
      RETRY_REQUIRED: '补偿完成，可在服务端允许后重新尝试',
      SUCCEEDED: '初始化成功',
      FAILED: '初始化失败'
    },
    notifications: {
      NOT_APPLICABLE: '无需通知',
      PENDING: '通知待处理',
      MAIL_SERVICE_ACCEPTED: '邮件服务已接收',
      PASSWORD_READY: '密码已就绪',
      ACTION_REQUIRED: '通知需要处理'
    }
  },
  subscriptions: {
    title: '订阅配置',
    configure: '配置订阅',
    close: '关闭订阅配置抽屉',
    submit: '确认配置订阅',
    refresh: '核查订阅与原操作',
    immediate: '首次订阅立即生效；当前不支持预约生效或替换已有订阅。',
    stale: '当前显示上次成功快照，最新状态尚未确认；依赖该状态的操作已禁用。',
    unknown: '提交结果未知，禁止重新提交。请核查原操作，仅在服务端允许时继续。',
    unchecked: '订阅状态尚未确认。',
    absent: '权威读取确认当前没有订阅。',
    observedAt: '权威观察时间',
    id: '订阅 ID',
    plan: '套餐',
    effective: '当前是否有效',
    yes: '有效',
    no: '无效',
    startsAt: '生效时间',
    endsAt: '到期时间',
    used: 'max_users 已用量',
    noPlans: '没有可用于新订阅的 ACTIVE 正额度套餐。',
    managePlans: '管理套餐',
    operations: '订阅操作记录',
    operationId: '操作 ID',
    replayUntil: '可恢复截止时间',
    noOperations: '没有订阅操作记录',
    recoveryHint:
      '完整核查当前租户的原操作；未知或未提交记录不允许使用新请求替代。恢复由原操作者权限和服务端许可决定。',
    planInvalid: '请选择当前可用的 ACTIVE 正额度套餐。',
    expiryHint: '留空表示永不到期。填写未来时间，必须包含秒和时区，例如 2099-01-01T08:00:00+08:00。',
    expiryInvalid: '请输入真实的未来日期时间，并包含秒和明确时区。',
    errors: {
      invalid: '服务端记录不完整或不一致，操作已禁用。',
      unavailable: '读取或提交失败，请核查原操作。',
      forbidden: '当前身份无权操作，请恢复原操作者的平台会话。',
      stale: '会话已变化，请重新核查。',
      input: '订阅、套餐或到期时间不再满足配置条件，请重新核查。',
      pending: '存在原操作记录，请核查并继续原操作。'
    }
  },
  entitlements: {
    codeHint: '以小写字母开头，使用 2–63 位小写字母、数字或连字符，例如 plan-1001。',
    codeExample: '例如 plan-1001',
    plan: {
      title: '套餐管理',
      create: '创建套餐',
      closeCreate: '关闭创建套餐抽屉',
      detail: '套餐详情',
      back: '返回套餐列表',
      activate: '激活套餐'
    },
    quota: {
      title: '额度定义',
      create: '准备额度定义',
      closeCreate: '关闭额度定义抽屉',
      detail: '额度定义详情',
      back: '返回额度定义列表',
      activate: '激活额度定义'
    },
    code: '编码',
    name: '套餐名称',
    limit: 'max_users 上限',
    id: 'ID',
    filters: '筛选额度或套餐',
    empty: '没有符合条件的记录',
    reuse: '复用已有 max_users',
    recovery: '我的操作记录',
    recoveryHint: '完整读取当前操作者的记录后，仅在服务端允许时继续原操作。其他对象的未决操作不会阻断当前对象。',
    operation: '操作',
    target: '对象',
    unknown: '操作结果待确认。请核查原操作，不要重复提交同一对象。',
    unchecked: '尚未完成记录核查，创建、激活和恢复暂不可用。',
    noOperations: '没有操作记录',
    requirements: '请先完成记录核查，确保没有同一对象的未决操作；创建套餐还需要已激活的 max_users 定义。',
    legacyZero: '历史零额度：不能用于新的授权或激活；已有权益保持不变。',
    states: {
      RETIRED: '已停用',
      DRAFT: '草稿',
      ACTIVE: '已激活'
    },
    actions: {
      CREATE: '创建',
      ACTIVATE: '激活'
    },
    errors: {
      codeInvalid: '编码必须以小写字母开头，长度为 2–63 位，仅支持小写字母、数字和连字符，例如 plan-1001。',
      nameInvalid: '套餐名称为 1–200 个字符，不能全部为空白。',
      limitInvalid: 'max_users 上限必须为 1–2147483647 的整数。',
      invalid: '服务返回的记录不完整或不一致，相关操作已锁定。',
      unavailable: '服务或网络不可用，请重试读取并核查原操作。',
      forbidden: '当前会话无权执行此操作，请核查会话与权限。',
      notFound: '未找到记录；这不表示可以重新提交。',
      stale: '会话或请求已变化，请重新读取。',
      input:
        '编码需为 2–63 位小写字母、数字或连字符且以字母开头；名称为 1–200 个字符且非全空白；max_users 上限为 1–2147483647 的整数。',
      definitionRequired: '需要已激活且精确匹配的 max_users 定义与正整数额度。请先准备额度，无法确认时不允许提交。',
      pending: '同一对象存在未决操作，请核查或继续原操作。'
    }
  },
  lifecycle: {
    title: '租户生命周期',
    check: '核查生命周期',
    hint: '操作以最新后台许可为准。冻结将撤销租户会话；解除冻结后，成员必须重新登录并通过资格校验。',
    unknown: '操作结果未知，已禁止新操作。请核查权威进展，不要重复提交。',
    progress: '操作进展',
    operation: '原操作 ID',
    actions: {
      suspend: '冻结租户',
      resume: '解除冻结',
      recover: '恢复冻结操作',
      continue: '继续原操作'
    },
    confirm: {
      suspend: '确认冻结此租户？其受保护访问和现有租户会话将失效。',
      resume: '确认解除冻结？旧会话不会恢复，成员需要重新登录。',
      recover: '确认恢复原冻结流程？不会新建冻结或解除冻结操作。',
      continue: '确认继续后台记录的原生命周期操作？'
    },
    states: {
      NONE: '暂无操作',
      PENDING: '处理中',
      COMPLETED: '已完成',
      RETRY_REQUIRED: '需要重试',
      RECOVERY_REQUIRED: '需要恢复冻结'
    }
  },
  tenants: {
    title: '租户管理',
    create: '创建租户',
    closeCreate: '关闭创建租户抽屉',
    name: '租户名称',
    status: '状态',
    createdAt: '创建时间',
    updatedAt: '更新时间',
    expiresAt: '到期时间',
    noExpiry: '无到期时间',
    id: '租户 ID',
    detail: '租户详情',
    view: '查看详情',
    back: '返回租户列表',
    filters: '筛选租户',
    search: '查询',
    reset: '重置',
    empty: '没有符合条件的租户',
    loading: '正在读取…',
    previous: '上一页',
    next: '下一页',
    page: '第 {page} 页',
    recovery: '我的创建记录',
    check: '核查原操作',
    continue: '继续原操作',
    noCreations: '没有创建记录',
    unchecked: '尚未完成记录核查。创建和恢复操作暂不可用。',
    recoveryHint: '只显示当前操作者的创建记录。仅在服务端允许时继续原操作，不会发起新的创建。',
    unknown: '创建结果未知，请核查原操作。即使未查到记录，也不要重复创建。',
    leaveTitle: '离开创建表单',
    leaveWarning: '未保存的输入将丢失；已发送的操作不会被取消。结果未知时，请回来核查原操作，不要重新创建。',
    leave: '确认离开',
    states: {
      PENDING: '待初始化',
      ACTIVE: '正常',
      SUSPENDED: '已暂停',
      CLOSED: '已关闭',
      COMMITTED: '已完成',
      PROCESSING: '处理中',
      NOT_COMMITTED: '未提交',
      UNKNOWN: '结果未知'
    },
    errors: {
      unavailable: '服务或网络不可用，请核查后重试读取。',
      invalid: '服务返回的记录不完整或不一致，相关操作已锁定。',
      forbidden: '当前会话无权执行此操作，请重新核查会话和权限。',
      notFound: '未找到记录；这不表示可以重新创建。',
      nameInvalid: '请输入 1–200 个字符的名称，不能全部为空白。',
      stale: '会话或请求已变化，请重新读取。'
    }
  },
  console: {
    accessRevoked: '当前租户访问已失效，可能已冻结、到期或成员资格已变更。受保护内容已隐藏；恢复资格后仍需重新登录。',
    setupTitle: '首次设置密码',
    setupIntro: '此链接仅用于建立首个密码。完成后，请使用邮箱和新密码登录。',
    setupInvalid: '链接缺失、无效、已过期或已使用，请联系管理员重新提供设置链接。',
    setupUnknown: '设置结果未确认。请重新输入相同密码以重试原操作，或返回登录。请勿改用其他密码。',
    setupUnavailable: 'API 配置不可用，请联系管理员修正后重新打开原始链接。',
    setupSubmitting: '正在设置密码…',
    backToLogin: '返回登录',

    changePassword: '设置新密码',
    newPassword: '新密码',
    confirmPassword: '确认新密码',
    passwordRules: '请输入 12–128 个字符，不含空白，避免使用常见或已泄露的密码。',
    passwordInvalid: '密码未满足要求或两次输入不一致，请重新输入。',
    passwordChanged: '密码已更新，请使用新密码重新登录。',
    passwordUnknown: '改密结果未确认，会话已结束。请尝试使用新密码登录。',

    company: '公司',
    chooseWorkspace: '选择工作区',
    platformManagement: '平台管理',
    switchTitle: '切换所有标签页的工作区',
    switchWarning:
      '无法确认所有标签页是否有未保存内容。继续将放弃当前及其他标签页的未保存更改，并同步切换工作区；你也可以取消并先返回保存。',
    switchConfirm: '放弃未保存内容并切换',
    targetUnavailable: '目标工作区已不可访问。请重新检查权限后再选择。',
    signIn: '登录',
    email: '邮箱',
    password: '密码',
    home: '平台工作台',
    welcome: '你已登录平台工作台。',
    identity: '当前账号',
    context: '工作上下文',
    platform: '平台',
    loading: '正在确认会话…',
    retry: '重试',
    logout: '退出当前 Console 的全部标签页',
    blocked: '无法确认当前会话，已隐藏受保护内容。',
    logoutPending: '退出尚未完成，请重试以完成会话撤销。',
    noContext: '当前账号没有可用的工作上下文。请联系管理员，或退出后使用其他账号登录。',
    initial: '当前账号需要先修改初始密码，才能进入工作台。',
    selection: '请选择要进入的工作区。',
    tenant: '公司工作台',
    invalid: '请输入有效的邮箱和密码。',
    credentials: '邮箱或密码不正确。',
    expired: '会话已过期，请恢复会话或退出。',
    footer: 'Console 标签页共享同一会话，退出将在所有标签页生效。'
  },
  system: {
    title: 'SaaS Forge',
    updateTitle: '系统版本更新通知',
    updateContent: '检测到系统有新版本发布，是否立即刷新页面？',
    updateConfirm: '立即刷新',
    updateCancel: '稍后再说'
  },
  common: {
    action: '操作',
    add: '新增',
    addSuccess: '添加成功',
    backToHome: '返回首页',
    batchDelete: '批量删除',
    cancel: '取消',
    close: '关闭',
    check: '勾选',
    expandColumn: '展开列',
    columnSetting: '列设置',
    config: '配置',
    confirm: '确认',
    delete: '删除',
    deleteSuccess: '删除成功',
    confirmDelete: '确认删除吗？',
    edit: '编辑',
    warning: '警告',
    error: '错误',
    index: '序号',
    keywordSearch: '请输入关键词搜索',
    logout: '退出登录',
    logoutConfirm: '确认退出登录吗？',
    lookForward: '敬请期待',
    modify: '修改',
    modifySuccess: '修改成功',
    noData: '无数据',
    operate: '操作',
    pleaseCheckValue: '请检查输入的值是否合法',
    refresh: '刷新',
    reset: '重置',
    search: '搜索',
    switch: '切换',
    tip: '提示',
    trigger: '触发',
    update: '更新',
    updateSuccess: '更新成功',
    userCenter: '个人中心',
    yesOrNo: {
      yes: '是',
      no: '否'
    }
  },
  request: {
    logout: '请求失败后登出用户',
    logoutMsg: '用户状态失效，请重新登录',
    logoutWithModal: '请求失败后弹出模态框再登出用户',
    logoutWithModalMsg: '用户状态失效，请重新登录',
    refreshToken: '请求的token已过期，刷新token',
    tokenExpired: 'token已过期'
  },
  theme: {
    themeSchema: {
      title: '主题模式',
      light: '亮色模式',
      dark: '暗黑模式',
      auto: '跟随系统'
    },
    grayscale: '灰色模式',
    colourWeakness: '色弱模式',
    layoutMode: {
      title: '布局模式',
      vertical: '左侧菜单模式',
      'vertical-mix': '左侧菜单混合模式',
      horizontal: '顶部菜单模式',
      'horizontal-mix': '顶部菜单混合模式',
      reverseHorizontalMix: '一级菜单与子级菜单位置反转'
    },
    recommendColor: '应用推荐算法的颜色',
    recommendColorDesc: '推荐颜色的算法参照',
    themeColor: {
      title: '主题颜色',
      primary: '主色',
      info: '信息色',
      success: '成功色',
      warning: '警告色',
      error: '错误色',
      followPrimary: '跟随主色'
    },
    scrollMode: {
      title: '滚动模式',
      wrapper: '外层滚动',
      content: '主体滚动'
    },
    page: {
      animate: '页面切换动画',
      mode: {
        title: '页面切换动画类型',
        'fade-slide': '滑动',
        fade: '淡入淡出',
        'fade-bottom': '底部消退',
        'fade-scale': '缩放消退',
        'zoom-fade': '渐变',
        'zoom-out': '闪现',
        none: '无'
      }
    },
    fixedHeaderAndTab: '固定头部和标签栏',
    header: {
      height: '头部高度',
      breadcrumb: {
        visible: '显示面包屑',
        showIcon: '显示面包屑图标'
      },
      multilingual: {
        visible: '显示多语言按钮'
      },
      globalSearch: {
        visible: '显示全局搜索按钮'
      }
    },
    tab: {
      visible: '显示标签栏',
      cache: '标签栏信息缓存',
      height: '标签栏高度',
      mode: {
        title: '标签栏风格',
        chrome: '谷歌风格',
        button: '按钮风格'
      }
    },
    sider: {
      inverted: '深色侧边栏',
      width: '侧边栏宽度',
      collapsedWidth: '侧边栏折叠宽度',
      mixWidth: '混合布局侧边栏宽度',
      mixCollapsedWidth: '混合布局侧边栏折叠宽度',
      mixChildMenuWidth: '混合布局子菜单宽度'
    },
    footer: {
      visible: '显示底部',
      fixed: '固定底部',
      height: '底部高度',
      right: '底部局右'
    },
    watermark: {
      visible: '显示全屏水印',
      text: '水印文本',
      enableUserName: '启用用户名水印'
    },
    themeDrawerTitle: '主题配置',
    pageFunTitle: '页面功能',
    configOperation: {
      copyConfig: '复制配置',
      copySuccessMsg: '复制成功，请替换 src/theme/settings.ts 中的变量 themeSettings',
      resetConfig: '重置配置',
      resetSuccessMsg: '重置成功'
    }
  },
  route: {
    'oauth-clients': 'OAuth Client 管理',
    'oauth-client-detail': 'OAuth Client 详情',
    plans: '套餐管理',
    'plan-detail': '套餐详情',
    'quota-definitions': '额度定义',
    'quota-detail': '额度定义详情',
    tenants: '租户管理',
    'tenant-detail': '租户详情',
    workbench: '公司工作台',
    login: '登录',
    403: '无权限',
    404: '页面不存在',
    500: '服务器错误',
    'iframe-page': '外链页面',
    home: '首页',
    document: '文档',
    document_project: '项目文档',
    'document_project-link': '项目文档(外链)',
    document_vue: 'Vue文档',
    document_vite: 'Vite文档',
    document_unocss: 'UnoCSS文档',
    document_naive: 'Naive UI文档',
    document_antd: 'Ant Design Vue文档',
    'document_element-plus': 'Element Plus文档',
    document_alova: 'Alova文档',
    'user-center': '个人中心',
    about: '关于',
    function: '系统功能',
    alova: 'alova示例',
    alova_request: 'alova请求',
    alova_user: '用户列表',
    alova_scenes: '场景化请求',
    function_tab: '标签页',
    'function_multi-tab': '多标签页',
    'function_hide-child': '隐藏子菜单',
    'function_hide-child_one': '隐藏子菜单',
    'function_hide-child_two': '菜单二',
    'function_hide-child_three': '菜单三',
    function_request: '请求',
    'function_toggle-auth': '切换权限',
    'function_super-page': '超级管理员可见',
    manage: '系统管理',
    manage_user: '用户管理',
    'manage_user-detail': '用户详情',
    manage_role: '角色管理',
    manage_menu: '菜单管理',
    'multi-menu': '多级菜单',
    'multi-menu_first': '菜单一',
    'multi-menu_first_child': '菜单一子菜单',
    'multi-menu_second': '菜单二',
    'multi-menu_second_child': '菜单二子菜单',
    'multi-menu_second_child_home': '菜单二子菜单首页',
    exception: '异常页',
    exception_403: '403',
    exception_404: '404',
    exception_500: '500',
    plugin: '插件示例',
    plugin_copy: '剪贴板',
    plugin_charts: '图表',
    plugin_charts_echarts: 'ECharts',
    plugin_charts_antv: 'AntV',
    plugin_charts_vchart: 'VChart',
    plugin_editor: '编辑器',
    plugin_editor_quill: '富文本编辑器',
    plugin_editor_markdown: 'MD 编辑器',
    plugin_icon: '图标',
    plugin_map: '地图',
    plugin_print: '打印',
    plugin_swiper: 'Swiper',
    plugin_video: '视频',
    plugin_barcode: '条形码',
    plugin_pinyin: '拼音',
    plugin_excel: 'Excel',
    plugin_pdf: 'PDF 预览',
    plugin_gantt: '甘特图',
    plugin_gantt_dhtmlx: 'dhtmlxGantt',
    plugin_gantt_vtable: 'VTableGantt',
    plugin_typeit: '打字机',
    plugin_tables: '表格',
    plugin_tables_vtable: 'VTable'
  },
  page: {
    login: {
      common: {
        loginOrRegister: '登录 / 注册',
        userNamePlaceholder: '请输入用户名',
        phonePlaceholder: '请输入手机号',
        codePlaceholder: '请输入验证码',
        passwordPlaceholder: '请输入密码',
        confirmPasswordPlaceholder: '请再次输入密码',
        codeLogin: '验证码登录',
        confirm: '确定',
        back: '返回',
        validateSuccess: '验证成功',
        loginSuccess: '登录成功',
        welcomeBack: '欢迎回来，{userName} ！'
      },
      pwdLogin: {
        title: '密码登录',
        rememberMe: '记住我',
        forgetPassword: '忘记密码？',
        register: '注册账号',
        otherAccountLogin: '其他账号登录',
        otherLoginMode: '其他登录方式',
        superAdmin: '超级管理员',
        admin: '管理员',
        user: '普通用户'
      },
      codeLogin: {
        title: '验证码登录',
        getCode: '获取验证码',
        reGetCode: '{time}秒后重新获取',
        sendCodeSuccess: '验证码发送成功',
        imageCodePlaceholder: '请输入图片验证码'
      },
      register: {
        title: '注册账号',
        agreement: '我已经仔细阅读并接受',
        protocol: '《用户协议》',
        policy: '《隐私权政策》'
      },
      resetPwd: {
        title: '重置密码'
      },
      bindWeChat: {
        title: '绑定微信'
      }
    },
    about: {
      title: '关于',
      introduction: `SoybeanAdmin 是一个优雅且功能强大的后台管理模板，基于最新的前端技术栈，包括 Vue3, Vite5, TypeScript, Pinia 和 UnoCSS。它内置了丰富的主题配置和组件，代码规范严谨，实现了自动化的文件路由系统。此外，它还采用了基于 ApiFox 的在线Mock数据方案。SoybeanAdmin 为您提供了一站式的后台管理解决方案，无需额外配置，开箱即用。同样是一个快速学习前沿技术的最佳实践。`,
      projectInfo: {
        title: '项目信息',
        version: '版本',
        latestBuildTime: '最新构建时间',
        githubLink: 'Github 地址',
        previewLink: '预览地址'
      },
      prdDep: '生产依赖',
      devDep: '开发依赖'
    },
    home: {
      branchDesc:
        '为了方便大家开发和更新合并，我们对main分支的代码进行了精简，只保留了首页菜单，其余内容已移至example分支进行维护。预览地址显示的内容即为example分支的内容。',
      greeting: '早安，{userName}, 今天又是充满活力的一天!',
      weatherDesc: '今日多云转晴，20℃ - 25℃!',
      projectCount: '项目数',
      todo: '待办',
      message: '消息',
      downloadCount: '下载量',
      registerCount: '注册量',
      schedule: '作息安排',
      study: '学习',
      work: '工作',
      rest: '休息',
      entertainment: '娱乐',
      visitCount: '访问量',
      turnover: '成交额',
      dealCount: '成交量',
      projectNews: {
        title: '项目动态',
        moreNews: '更多动态',
        desc1: 'Soybean 在2021年5月28日创建了开源项目 soybean-admin!',
        desc2: 'Yanbowe 向 soybean-admin 提交了一个bug，多标签栏不会自适应。',
        desc3: 'Soybean 准备为 soybean-admin 的发布做充分的准备工作!',
        desc4: 'Soybean 正在忙于为soybean-admin写项目说明文档！',
        desc5: 'Soybean 刚才把工作台页面随便写了一些，凑合能看了！'
      },
      creativity: '创意'
    },
    function: {
      tab: {
        tabOperate: {
          title: '标签页操作',
          addTab: '添加标签页',
          addTabDesc: '跳转到关于页面',
          closeTab: '关闭标签页',
          closeCurrentTab: '关闭当前标签页',
          closeAboutTab: '关闭"关于"标签页',
          addMultiTab: '添加多标签页',
          addMultiTabDesc1: '跳转到多标签页页面',
          addMultiTabDesc2: '跳转到多标签页页面(带有查询参数)'
        },
        tabTitle: {
          title: '标签页标题',
          changeTitle: '修改标题',
          change: '修改',
          resetTitle: '重置标题',
          reset: '重置'
        }
      },
      multiTab: {
        routeParam: '路由参数',
        backTab: '返回 function_tab'
      },
      toggleAuth: {
        toggleAccount: '切换账号',
        authHook: '权限钩子函数 `hasAuth`',
        superAdminVisible: '超级管理员可见',
        adminVisible: '管理员可见',
        adminOrUserVisible: '管理员和用户可见'
      },
      request: {
        repeatedErrorOccurOnce: '重复请求错误只出现一次',
        repeatedError: '重复请求错误',
        repeatedErrorMsg1: '自定义请求错误 1',
        repeatedErrorMsg2: '自定义请求错误 2'
      }
    },
    alova: {
      scenes: {
        captchaSend: '发送验证码',
        autoRequest: '自动请求',
        visibilityRequestTips: '浏览器窗口切换自动请求数据',
        pollingRequestTips: '每3秒自动请求一次',
        networkRequestTips: '网络重连后自动请求',
        refreshTime: '更新时间',
        startRequest: '开始请求',
        stopRequest: '停止请求',
        requestCrossComponent: '跨组件触发请求',
        triggerAllRequest: '手动触发所有自动请求'
      }
    },
    manage: {
      common: {
        status: {
          enable: '启用',
          disable: '禁用'
        }
      },
      role: {
        title: '角色列表',
        roleName: '角色名称',
        roleCode: '角色编码',
        roleStatus: '角色状态',
        roleDesc: '角色描述',
        menuAuth: '菜单权限',
        buttonAuth: '按钮权限',
        form: {
          roleName: '请输入角色名称',
          roleCode: '请输入角色编码',
          roleStatus: '请选择角色状态',
          roleDesc: '请输入角色描述'
        },
        addRole: '新增角色',
        editRole: '编辑角色'
      },
      user: {
        title: '用户列表',
        userName: '用户名',
        userGender: '性别',
        nickName: '昵称',
        userPhone: '手机号',
        userEmail: '邮箱',
        userStatus: '用户状态',
        userRole: '用户角色',
        form: {
          userName: '请输入用户名',
          userGender: '请选择性别',
          nickName: '请输入昵称',
          userPhone: '请输入手机号',
          userEmail: '请输入邮箱',
          userStatus: '请选择用户状态',
          userRole: '请选择用户角色'
        },
        addUser: '新增用户',
        editUser: '编辑用户',
        gender: {
          male: '男',
          female: '女'
        }
      },
      menu: {
        home: '首页',
        title: '菜单列表',
        id: 'ID',
        parentId: '父级菜单ID',
        menuType: '菜单类型',
        menuName: '菜单名称',
        routeName: '路由名称',
        routePath: '路由路径',
        pathParam: '路径参数',
        layout: '布局',
        page: '页面组件',
        i18nKey: '国际化key',
        icon: '图标',
        localIcon: '本地图标',
        iconTypeTitle: '图标类型',
        order: '排序',
        constant: '常量路由',
        keepAlive: '缓存路由',
        href: '外链',
        hideInMenu: '隐藏菜单',
        activeMenu: '高亮的菜单',
        multiTab: '支持多页签',
        fixedIndexInTab: '固定在页签中的序号',
        query: '路由参数',
        button: '按钮',
        buttonCode: '按钮编码',
        buttonDesc: '按钮描述',
        menuStatus: '菜单状态',
        form: {
          home: '请选择首页',
          menuType: '请选择菜单类型',
          menuName: '请输入菜单名称',
          routeName: '请输入路由名称',
          routePath: '请输入路由路径',
          pathParam: '请输入路径参数',
          page: '请选择页面组件',
          layout: '请选择布局组件',
          i18nKey: '请输入国际化key',
          icon: '请输入图标',
          localIcon: '请选择本地图标',
          order: '请输入排序',
          keepAlive: '请选择是否缓存路由',
          href: '请输入外链',
          hideInMenu: '请选择是否隐藏菜单',
          activeMenu: '请选择高亮的菜单的路由名称',
          multiTab: '请选择是否支持多标签',
          fixedInTab: '请选择是否固定在页签中',
          fixedIndexInTab: '请输入固定在页签中的序号',
          queryKey: '请输入路由参数Key',
          queryValue: '请输入路由参数Value',
          button: '请选择是否按钮',
          buttonCode: '请输入按钮编码',
          buttonDesc: '请输入按钮描述',
          menuStatus: '请选择菜单状态'
        },
        addMenu: '新增菜单',
        editMenu: '编辑菜单',
        addChildMenu: '新增子菜单',
        type: {
          directory: '目录',
          menu: '菜单'
        },
        iconType: {
          iconify: 'iconify图标',
          local: '本地图标'
        }
      }
    }
  },
  form: {
    required: '不能为空',
    userName: {
      required: '请输入用户名',
      invalid: '用户名格式不正确'
    },
    phone: {
      required: '请输入手机号',
      invalid: '手机号格式不正确'
    },
    pwd: {
      required: '请输入密码',
      invalid: '密码格式不正确，6-18位字符，包含字母、数字、下划线'
    },
    confirmPwd: {
      required: '请输入确认密码',
      invalid: '两次输入密码不一致'
    },
    code: {
      required: '请输入验证码',
      invalid: '验证码格式不正确'
    },
    email: {
      required: '请输入邮箱',
      invalid: '邮箱格式不正确'
    }
  },
  dropdown: {
    closeCurrent: '关闭',
    closeOther: '关闭其它',
    closeLeft: '关闭左侧',
    closeRight: '关闭右侧',
    closeAll: '关闭所有'
  },
  icon: {
    themeConfig: '主题配置',
    themeSchema: '主题模式',
    lang: '切换语言',
    fullscreen: '全屏',
    fullscreenExit: '退出全屏',
    reload: '刷新页面',
    collapse: '折叠菜单',
    expand: '展开菜单',
    pin: '固定',
    unpin: '取消固定'
  },
  datatable: {
    itemCount: '共 {total} 条'
  }
};

export default local;
