import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const origin = 'https://console.ui.test';
const tenant = {
  id: '019944ca-0000-7000-8000-000000000004',
  displayName: 'Example Company',
  status: 'PENDING',
  expiresAt: null,
  createdAt: '2026-01-02T01:30:00Z',
  updatedAt: '2026-01-02T01:30:00Z'
};
const snapshot = {
  sessionId: '019944ca-0000-7000-8000-000000000001',
  revision: '1',
  state: 'AUTHENTICATED',
  identity: { identityId: '019944ca-0000-7000-8000-000000000002', email: 'admin@example.test' },
  activeContext: { type: 'PLATFORM' },
  availableContexts: { platform: true, companies: [] }
};

// 生产构建 + 正式路由 + 模拟 HTTP，仅证明前端回归，不能替代 Chrome/Gateway/Fresh 验收。
async function prepare(
  context: BrowserContext,
  options: { locale?: string; authenticated?: boolean; failed?: boolean; tenant?: boolean } = {}
) {
  const errors: string[] = [];
  const unexpected: string[] = [];
  await context.addInitScript(({ locale }) => {
    if (!localStorage.getItem('UI_lang')) localStorage.setItem('UI_lang', JSON.stringify(locale ?? 'zh-CN'));
  }, options);
  const observePage = (page: Page) => {
    page.on('pageerror', error => errors.push(error.name));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
  };
  context.pages().forEach(observePage);
  context.on('page', observePage);
  // eslint-disable-next-line complexity -- 共享 HTTP 夹具需要区分正式 Console 的多个 operation。
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) {
      const response = await context.request.get(`http://127.0.0.1:4173${url.pathname}${url.search}`);
      await route.fulfill({ response });
      return;
    }
    if (url.origin === 'https://api.ui.test') {
      const path = url.pathname;
      const session = options.tenant
        ? {
            ...snapshot,
            activeContext: { type: 'TENANT', membershipId: '019944ca-0000-7000-8000-000000000006' },
            availableContexts: {
              platform: false,
              companies: [
                {
                  tenantId: tenant.id,
                  tenantDisplayName: tenant.displayName,
                  membershipId: '019944ca-0000-7000-8000-000000000006'
                }
              ]
            }
          }
        : snapshot;
      let body: unknown;
      if (path.endsWith('/bootstrap'))
        body = { revision: '1', sessionPresent: Boolean(options.authenticated || options.failed), transition: 'NONE' };
      else if (options.failed && path.endsWith('/session')) {
        await route.fulfill({ status: 503, json: { code: 'SESSION_SECURITY_UNAVAILABLE' } });
        return;
      } else if (path.endsWith('/session')) body = session;
      else if (path.endsWith('/refresh') || path.endsWith('/login'))
        body = { ...session, accessToken: 'ui-fixture-token', tokenType: 'Bearer', expiresIn: 900 };
      else if (options.tenant && path === '/api/v1/permissions')
        body = { items: [{ code: 'example:project:list', enabled: true }] };
      else if (options.tenant && path === '/api/v1/organization/units') body = { items: [] };
      else if (options.tenant && path === '/api/v1/tenant-roles')
        body = {
          items: [
            {
              id: '019944ca-0000-7000-8000-000000000007',
              roleKey: 'TENANT_ADMINISTRATOR',
              systemManaged: true,
              permissions: [],
              assignedMembers: 1
            }
          ]
        };
      else if (options.tenant && path === '/api/v1/remote-manifests/enabled')
        body = { items: [], hasMore: false, nextCursor: null };
      else if (path === '/api/v1/platform/tenants') body = { items: [tenant], hasMore: false, nextCursor: null };
      else if (path === '/api/v1/platform/tenant-creations') body = { items: [], hasMore: false, nextCursor: null };
      else if (path === `/api/v1/platform/tenants/${tenant.id}`) body = tenant;
      else if (path.endsWith('/subscription'))
        body = {
          observedAt: tenant.createdAt,
          subscription: null,
          effective: false,
          maxUsersLimit: null,
          maxUsersUsed: null
        };
      else if (
        [
          '/api/v1/platform/plans',
          '/api/v1/platform/plan-operations',
          '/api/v1/platform/subscription-operations',
          '/api/v1/platform/quota-definitions',
          '/api/v1/platform/remote-manifests',
          `/api/v1/platform/tenants/${tenant.id}/subscription-operations`
        ].includes(path)
      )
        body = { items: [], hasMore: false, nextCursor: null };
      else if (path.endsWith('/administrator-initialization'))
        body = {
          tenantId: tenant.id,
          state: 'NOT_STARTED',
          canStart: true,
          canContinue: false,
          initialAdministratorMembershipId: null
        };
      else if (path.endsWith('/administrator-password-setup'))
        body = { tenantId: tenant.id, state: 'PENDING', operationState: 'NONE', canResend: false, canContinue: false };
      else if (path.endsWith('/lifecycle'))
        body = {
          tenantId: tenant.id,
          state: 'NONE',
          canSuspend: false,
          canResume: false,
          canRecoverSuspension: false,
          canContinue: false
        };
      else {
        unexpected.push(path);
        await route.abort();
        return;
      }
      await route.fulfill({ json: body });
      return;
    }
    if (
      ['https://api.iconify.design', 'https://api.unisvg.com', 'https://api.simplesvg.com'].includes(url.origin) &&
      /^\/[a-z0-9-]+\.json$/.test(url.pathname)
    ) {
      // 使用锁文件内的官方图标资源响应模拟 CDN，禁止浏览器连接外网。
      await route.fulfill({
        contentType: 'application/json',
        body: readFileSync(require.resolve(`@iconify/json/json${url.pathname}`), 'utf8')
      });
      return;
    }
    unexpected.push(url.origin);
    await route.abort();
  });
  await context.route('https://api.ui.test/api/v2/auth/password-recover*', async route => {
    const request = route.request().url().endsWith('/password-recovery-requests');
    await route.fulfill({
      status: request ? 202 : 200,
      json: { status: request ? 'ACCEPTED' : 'COMPLETED' }
    });
  });
  return { errors, unexpected };
}

test('tenant role form is keyboard reachable and shows a newly created role', async ({ context, page }, testInfo) => {
  const state = await prepare(context, { locale: 'en', authenticated: true, tenant: true });
  let created = false;
  await page.route('**/api/v1/tenant-roles', async route => {
    if (route.request().method() === 'GET') {
      const items = [
        {
          id: '019944ca-0000-7000-8000-000000000007',
          roleKey: 'TENANT_ADMINISTRATOR',
          systemManaged: true,
          permissions: [] as string[],
          assignedMembers: 1
        }
      ];
      if (created)
        items.push({
          id: '019944ca-0000-7000-8000-000000000008',
          roleKey: 'REPORT_READER',
          systemManaged: false,
          permissions: ['example:project:list'],
          assignedMembers: 0
        });
      return route.fulfill({ json: { items } });
    }
    if (route.request().method() !== 'POST') return route.fallback();
    expect(route.request().postDataJSON()).toEqual({ roleKey: 'REPORT_READER', permissions: ['example:project:list'] });
    created = true;
    return route.fulfill({
      status: 201,
      json: {
        id: '019944ca-0000-7000-8000-000000000008',
        roleKey: 'REPORT_READER',
        systemManaged: false,
        permissions: ['example:project:list'],
        assignedMembers: 0
      }
    });
  });
  await page.goto(`${origin}/workbench`);
  await expect(page.getByRole('heading', { name: 'Tenant roles' })).toBeVisible();
  await stable(page);
  await audit(page);
  const create = page.getByRole('button', { name: 'Create role' });
  await create.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create role' });
  await expect(dialog).toBeVisible();
  await audit(page, true);
  await dialog.getByRole('textbox', { name: 'Role key' }).fill('REPORT_READER');
  await dialog.getByText('example:project:list', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'REPORT_READER' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('tenant-roles.png'), fullPage: false });
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

async function audit(page: Page, dialog = false) {
  await page.addScriptTag({ content: axe });
  const violations = await page.evaluate(async modal => {
    const result = await (window as any).axe.run(
      modal ? document.querySelector('[role=dialog][aria-modal=true]') : document,
      { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }
    );
    return result.violations.map((v: any) => ({ id: v.id, targets: v.nodes.map((n: any) => n.target) }));
  }, dialog);
  expect(violations).toEqual([]);
}

async function stable(page: Page) {
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('#nprogress')).toHaveCount(0);
}

for (const locale of ['zh-CN', 'en']) {
  for (const failed of [false, true]) {
    test(`login ${locale} ${failed ? 'recovery' : 'ready'}`, async ({ context, page }) => {
      const state = await prepare(context, { locale, failed });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/login`);
      await expect(
        page.getByRole('button', {
          name: failed ? { en: 'Retry', 'zh-CN': '重试' }[locale] : { en: 'Sign in', 'zh-CN': '登录' }[locale],
          exact: true
        })
      ).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await stable(page);
      await audit(page);
      await expect(page).toHaveScreenshot(`login-${locale}-${failed ? 'recovery' : 'ready'}.png`);
      expect(state.unexpected).toEqual([]);
      expect(state.errors.filter(error => !failed || !error.includes('503'))).toEqual([]);
    });
  }
}

test('password recovery email and one-use link render and accept keyboard input', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/login`);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(`${origin}/password-recovery`);
  await page.getByRole('textbox', { name: 'Email' }).fill('person@example.test');
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await expect(page.getByRole('status')).toContainText('If this address belongs to a recoverable account');
  await audit(page);

  await page.goto(`${origin}/password-recovery#token=${'A'.repeat(43)}`);
  await expect(page).toHaveURL(`${origin}/password-recovery`);
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('New-password-2026');
  await page.getByRole('textbox', { name: 'Confirm new password' }).fill('New-password-2026');
  await page.getByRole('button', { name: 'Set a new password' }).click();
  await expect(page.getByRole('status')).toContainText('Password recovered and previous sessions ended');
  await audit(page);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('new invitee requests first password setup from the invitation page', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en' });
  const keys: string[] = [];
  await page.route('https://api.ui.test/api/v1/invitation-password-setups', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.postDataJSON()).toEqual({ token: 'A'.repeat(43) });
    keys.push(request.headers()['idempotency-key']);
    await route.fulfill({ json: { status: 'MAIL_SERVICE_ACCEPTED' } });
  });
  await page.goto(`${origin}/invitation#token=${'A'.repeat(43)}`);
  await expect(page).toHaveURL(`${origin}/invitation`);
  await page.getByRole('button', { name: 'Set up a password' }).click();
  await expect(page.getByRole('status').last()).toContainText('The mail service accepted');
  await page.getByRole('button', { name: 'Resend setup email' }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).not.toBe(keys[1]);
  await audit(page);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const width of [1440, 1024]) {
  for (const dark of [false, true]) {
    test(`workspace ${width} ${dark ? 'dark' : 'light'}`, async ({ context, page }) => {
      const state = await prepare(context, { locale: 'en', authenticated: true });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/home`);
      await expect(page.getByRole('heading', { name: 'Platform workspace', exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Business Remote review and enablement', exact: true })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
      await expect(page.getByText('No records', { exact: true })).toBeVisible();
      await Promise.all(
        (await page.getByRole('menubar').getByRole('menuitem').all()).map(item =>
          expect(item.locator('.el-icon > *').first()).toBeVisible()
        )
      );
      if (dark) await page.getByRole('button', { name: 'Theme Schema', exact: true }).click();
      await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^((?!dark).)*$/);
      await stable(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await audit(page);
      await expect(page).toHaveScreenshot(`workspace-${width}-${dark ? 'dark' : 'light'}.png`);
      expect(state.unexpected).toEqual([]);
      expect(state.errors).toEqual([]);
    });
  }
}

test('legacy language resets to Chinese, English selection updates lang and persists', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en-US' });
  await page.goto(`${origin}/login`);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  expect(await page.evaluate(() => localStorage.getItem('UI_lang'))).toBe('"zh-CN"');
  await page.getByLabel('切换语言', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('UI_lang'))).toBe('"en"');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('tenant list and drawer retain keyboard, dirty form and accessible names', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en', authenticated: true });
  await page.goto(`${origin}/tenants`);
  await expect(page.getByText('Example Company', { exact: true })).toBeVisible();
  const create = page.getByRole('button', { name: 'Create tenant', exact: true });
  await expect(create).toBeEnabled();
  await stable(page);
  await audit(page);
  await expect(page).toHaveScreenshot('tenants-en.png');
  await create.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  // 模态背景已被遮罩；单独检查当前可操作层，避免把背景变暗计为对比度故障。
  await audit(page, true);
  await expect(page).toHaveScreenshot('tenant-create-en.png');
  await drawer.getByRole('textbox', { name: 'Tenant name', exact: true }).fill('Unsaved company');
  await page.keyboard.press('Escape');
  const confirmation = page.getByRole('dialog', { name: 'Leave creation form' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(drawer.getByRole('textbox', { name: 'Tenant name', exact: true })).toHaveValue('Unsaved company');
  await page.keyboard.press('Escape');
  await confirmation.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(create).toBeFocused();
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('tenant detail renders real sections with accessible headings', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en', authenticated: true });
  await page.goto(`${origin}/tenants/${tenant.id}`);
  await expect(page.getByText('Example Company', { exact: true })).toBeVisible();
  await stable(page);
  await audit(page);
  await expect(page).toHaveScreenshot('tenant-detail-en.png');
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('tenant detail name edit works by keyboard and keeps the independent expiry', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en', authenticated: true });
  let updated = false;
  await page.route(`**/api/v1/platform/tenants/${tenant.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const request = route.request();
    expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.postDataJSON()).toEqual({ displayName: 'Renamed Company', expiresAt: null });
    updated = true;
    return route.fulfill({ json: { ...tenant, displayName: 'Renamed Company' } });
  });
  await page.goto(`${origin}/tenants/${tenant.id}`);
  const edit = page.getByRole('form', { name: 'Manage tenant details' });
  await expect(edit.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await edit.getByRole('textbox', { name: 'Tenant name' }).fill('Renamed Company');
  await audit(page);
  await edit.getByRole('button', { name: 'Save changes' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Renamed Company', { exact: true }).first()).toBeVisible();
  expect(updated).toBe(true);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('tenant expiry edit sets a future deadline and can clear it', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en', authenticated: true });
  const requests: (string | null)[] = [];
  await page.route(`**/api/v1/platform/tenants/${tenant.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    requests.push(body.expiresAt);
    return route.fulfill({ json: { ...tenant, expiresAt: body.expiresAt } });
  });
  await page.goto(`${origin}/tenants/${tenant.id}`);
  const edit = page.getByRole('form', { name: 'Manage tenant details' });
  await edit.getByText('No expiry', { exact: true }).click();
  const deadline = edit.getByRole('combobox', { name: 'Expires at' });
  await deadline.fill('2099-01-01 12:00:00');
  await deadline.press('Tab');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('2099', { exact: false }).first()).toBeVisible();
  expect(requests[0]).toBe('2099-01-01T12:00:00.000Z');
  await edit.getByText('No expiry', { exact: true }).click();
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.el-descriptions').getByText('No expiry')).toBeVisible();
  expect(requests).toEqual(['2099-01-01T12:00:00.000Z', null]);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('desktop zoom reflow keeps login controls within 320 CSS pixels', async ({ context, page }) => {
  const state = await prepare(context, { locale: 'en' });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${origin}/login`);
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(signIn).toBeVisible();
  const box = await signIn.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await stable(page);
  await audit(page);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('runtime error guard observes an already created page', async ({ context, page }) => {
  const state = await prepare(context);
  await page.goto(`${origin}/login`);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
  await page.evaluate(() => {
    // eslint-disable-next-line no-console -- 故意注入错误以验证生产错误门禁确实在监听当前页面。
    console.error('UI_ERROR_GUARD_PROBE');
    setTimeout(() => {
      throw new Error('UI_PAGE_ERROR_GUARD_PROBE');
    }, 0);
  });
  await expect.poll(() => state.errors).toEqual(['UI_ERROR_GUARD_PROBE', 'Error']);
  expect(state.unexpected).toEqual([]);
});

for (const routeName of ['tenants', 'oauth-clients', 'plans', 'quota-definitions']) {
  for (const locale of ['en', 'zh-CN']) {
    test(`business lists ${routeName} ${locale}: folding preserves drafts and applied cursor query`, async ({
      context,
      page
    }, testInfo) => {
      const state = await prepare(context, { locale, authenticated: true });
      const chinese = locale === 'zh-CN';
      const listPath = `/api/v1/platform/${routeName}`;
      const queries: URL[] = [];
      const record = {
        id: '019944ca-0000-7000-8000-000000000005',
        displayName: 'Pending company',
        code: 'pending',
        operation: 'CREATE',
        state: 'NOT_COMMITTED',
        canReplay: true,
        createdAt: tenant.createdAt,
        replayUntil: '2099-01-02T01:30:00Z',
        idempotencyKey: '019944ca-0000-7000-8000-000000000006'
      };
      const resources: Record<string, unknown> = {
        tenants: tenant,
        'oauth-clients': {
          clientId: tenant.id,
          displayName: 'Example Client',
          allowedScopes: ['runtime:read'],
          clientType: 'RUNTIME_SERVICE',
          status: 'ACTIVE',
          createdAt: tenant.createdAt,
          updatedAt: tenant.updatedAt
        }
      };
      const resource = resources[routeName] ?? {
        id: tenant.id,
        code: 'example',
        displayName: 'Example Plan',
        quotaLimits: [],
        status: 'ACTIVE',
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt
      };
      await context.route('https://api.ui.test/api/v1/platform/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === listPath) {
          queries.push(url);
          const last = url.searchParams.has('cursor');
          await route.fulfill({ json: { items: [resource], hasMore: !last, nextCursor: last ? null : 'next-page' } });
        } else if (
          url.pathname.endsWith('/tenant-creations') ||
          url.pathname.endsWith('/plan-operations') ||
          url.pathname.endsWith('/quota-definition-operations')
        ) {
          await route.fulfill({ json: { items: [record], hasMore: false, nextCursor: null } });
        } else if (url.pathname.endsWith('/oauth-client-operations')) {
          await route.fulfill({
            json: {
              items: [
                {
                  operationId: record.id,
                  clientId: tenant.id,
                  displayName: 'Recoverable Client',
                  action: 'CREATE',
                  completedAt: tenant.createdAt,
                  recoveryUntil: record.replayUntil,
                  canRecover: true
                }
              ],
              hasMore: false,
              nextCursor: null
            }
          });
        } else await route.fallback();
      });
      await page.setViewportSize({ width: chinese ? 1024 : 1440, height: 1000 });
      await page.goto(`${origin}/${routeName}`);
      await expect(
        page
          .locator('.el-table__body-wrapper')
          .first()
          .getByRole('button', { name: chinese ? '查看详情' : 'View details', exact: true })
      ).toBeVisible();
      await expect.poll(() => queries.length).toBe(1);
      if (chinese) await page.getByRole('button', { name: '主题模式', exact: true }).click();
      await stable(page);
      const fold = page.getByRole('button', { name: /^(Filter |筛选)/ });
      const search = page.getByRole('main').getByRole('button', { name: chinese ? '搜索' : 'Search', exact: true });
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      await expect(search).not.toBeVisible();
      await fold.focus();
      await page.keyboard.press('Enter');
      await expect(fold).toHaveAttribute('aria-expanded', 'true');
      const field = page.getByRole('form').getByRole('textbox').first();
      await field.fill('example');
      await fold.click();
      await expect(search).not.toBeVisible();
      await expect(fold).not.toContainText(chinese ? '已应用' : 'Applied filters');
      expect(queries).toHaveLength(1);
      await fold.click();
      await expect(field).toHaveValue('example');
      await search.click();
      await expect.poll(() => queries.length).toBe(2);
      await expect(fold).toContainText(chinese ? '已应用 1 项筛选' : 'Applied filters: 1');
      const key = ['tenants', 'oauth-clients'].includes(routeName) ? 'name' : 'code';
      expect(queries[1].searchParams.get(key)).toBe('example');
      expect(queries[1].searchParams.has('cursor')).toBe(false);
      await field.fill('unsubmitted');
      await fold.click();
      await page.getByRole('button', { name: chinese ? '下一页' : 'Next', exact: true }).click();
      await expect.poll(() => queries.length).toBe(3);
      expect(queries[2].searchParams.get(key)).toBe('example');
      expect(queries[2].searchParams.get('cursor')).toBe('next-page');
      await fold.click();
      await expect(field).toHaveValue('unsubmitted');
      await page.getByRole('button', { name: chinese ? '重置' : 'Reset', exact: true }).click();
      await expect.poll(() => queries.length).toBe(4);
      expect(queries[3].searchParams.has(key)).toBe(false);
      expect(queries[3].searchParams.has('cursor')).toBe(false);
      await expect(field).toHaveValue('');
      await expect(fold).not.toContainText(chinese ? '已应用' : 'Applied filters');
      await stable(page);
      const headers = page.locator('.el-table__header-wrapper th');
      expect(await headers.count()).toBeGreaterThan(0);
      expect(
        await headers.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).textAlign === 'center'))
      ).toBe(true);
      await expect(page.locator('.el-table__body-wrapper').first().locator('td').first()).toHaveCSS(
        'text-align',
        'left'
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(
        await page.locator('.business-table td button').evaluateAll(buttons =>
          buttons.every(button => {
            const cell = button.closest('td')!.getBoundingClientRect();
            const box = button.getBoundingClientRect();
            return box.left >= cell.left && box.right <= cell.right;
          })
        )
      ).toBe(true);
      await audit(page);
      await page.screenshot({ path: testInfo.outputPath('expanded.png'), fullPage: true });
      await fold.click();
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      await page.screenshot({ path: testInfo.outputPath('collapsed.png'), fullPage: true });
      expect(state.errors).toEqual([]);
      expect(state.unexpected).toEqual([]);
    });
  }
}

for (const locale of ['zh-CN', 'en']) {
  test(`collapsed sidebar reveals menu names ${locale}`, async ({ context, page }, testInfo) => {
    const state = await prepare(context, { locale, authenticated: true });
    const chinese = locale === 'zh-CN';
    await page.goto(`${origin}/home`);
    const menu = page.getByRole('menubar');
    const tenantItem = menu.getByRole('menuitem').nth(1);
    const name = chinese ? '租户管理' : 'Tenants';
    await expect(tenantItem).toHaveText(name);
    const names = await menu.getByRole('menuitem').allTextContents();
    await page.getByRole('button', { name: chinese ? '折叠菜单' : 'Collapse Menu', exact: true }).click();
    await expect(menu).toHaveClass(/el-menu--collapse/);
    /* eslint-disable no-await-in-loop -- 菜单悬停需串行，避免覆盖前一个名称提示。 */
    for (let index = 0; index < names.length; index += 1) {
      const label = names[index];
      const item = menu.getByRole('menuitem').nth(index);
      await expect(item).toHaveAccessibleName(label);
      await item.hover();
      await expect(page.getByRole('tooltip', { name: label, exact: true })).toBeVisible();
    }
    /* eslint-enable no-await-in-loop */
    await tenantItem.hover();
    await expect(page.getByRole('tooltip', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath('collapsed-menu.png') });
    await tenantItem.click();
    await expect(page).toHaveURL(`${origin}/tenants`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await stable(page);
    await audit(page);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('collapsed sidebar keeps a visible icon for each menu entry', async ({ context, page }) => {
  await prepare(context, { authenticated: true });
  await page.goto(`${origin}/home`);
  await page.getByRole('button', { name: '折叠菜单', exact: true }).click();
  const entries = page.getByRole('menubar').getByRole('menuitem');
  await expect(entries).toHaveCount(5);
  await Promise.all(
    (await entries.all()).map(async item => {
      const icon = item.locator('.el-icon > *').first();
      await expect(icon).toBeVisible();
      const box = await icon.boundingBox();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    })
  );
});
