/* eslint-disable no-await-in-loop -- 浏览器业务步骤按顺序执行并逐次核对正式 API 响应。 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { frontendProvenance } from '../build/provenance.ts';
import { chromeRouting, loadHandoff } from './verify-browser.mjs';
import { loadStage4ProductConfig } from './stage4-product-config.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHECKS = [
  'organization-two-roots',
  'tenant-role-with-project-permission',
  'invitation-created',
  'brand-five-fields-preview-and-save'
];

function asset(path, maxBytes) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && info.size > 32 && info.size <= maxBytes, 'ASSET_INVALID');
  assert.equal(readFileSync(path).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG_REQUIRED');
}

async function apiResponse(page, origin, { method, path, status, action }) {
  const startedAt = new Date().toISOString();
  const captureMutation = path.startsWith('/api/v1/') && method !== 'GET';
  const previousCount = captureMutation ? await page.evaluate(() => window.stage4MutationResponses?.length ?? 0) : 0;
  const [response] = await Promise.all([
    page.waitForResponse(candidate => {
      const url = new URL(candidate.url());
      return url.origin === origin && url.pathname === path && candidate.request().method() === method;
    }),
    action()
  ]);
  assert.equal(response.status(), status, 'API_STATUS_MISMATCH');
  if (captureMutation) {
    const expected = { path, method, status, previousCount };
    await page.waitForFunction(
      ({ path: expectedPath, method: expectedMethod, status: expectedStatus, previousCount: count }) =>
        window.stage4MutationResponses
          ?.slice(count)
          .some(item => item.path === expectedPath && item.method === expectedMethod && item.status === expectedStatus),
      expected
    );
    const body = await page.evaluate(
      ({ path: expectedPath, method: expectedMethod, status: expectedStatus, previousCount: count }) =>
        window.stage4MutationResponses
          .slice(count)
          .findLast(
            item => item.path === expectedPath && item.method === expectedMethod && item.status === expectedStatus
          ).body,
      expected
    );
    return { response: { json: async () => body }, startedAt, finishedAt: new Date().toISOString() };
  }
  return { response, startedAt, finishedAt: new Date().toISOString() };
}

async function run(configPath, outputPath) {
  const repository = resolve(new URL('../', import.meta.url).pathname);
  assert.ok(
    isAbsolute(outputPath) && !resolve(outputPath).startsWith(`${repository}${sep}`),
    'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY'
  );
  const config = loadStage4ProductConfig(configPath);
  const { handoff, handoffSha256 } = loadHandoff(config.handoff);
  assert.equal(handoff.isolation.kind, 'fresh-compose');
  assert.equal(handoff.requiredServices.length, 7);
  assert.equal(handoff.backend.dirty, false);
  asset(config.logoPng, 2 * 1024 * 1024);
  asset(config.faviconPng, 256 * 1024);
  mkdirSync(outputPath, { mode: 0o700 });
  const report = {
    schemaVersion: 1,
    kind: 'stage4-product-observations',
    scope: 'selected-real-chrome-paths',
    runId: handoff.runId,
    handoffSha256,
    startedAt: new Date().toISOString(),
    ...frontendProvenance(),
    status: 'failed',
    checks: CHECKS.map(name => ({ name, status: 'not_run' })),
    operations: []
  };
  let browser;
  try {
    assert.equal(report.frontend.dirty, false, 'FRONTEND_DIRTY');
    browser = await chromium.launch({ channel: 'chrome', headless: true, ...chromeRouting(handoff) });
    report.chrome = browser.version();
    const context = await browser.newContext({ locale: 'en', viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
      localStorage.setItem('SOY_lang', JSON.stringify('en'));
      window.stage4MutationResponses = [];
      const original = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await original(...args);
        const url = String(args[0] instanceof Request ? args[0].url : args[0]);
        const method = String(args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET')).toUpperCase();
        const path = new URL(url, location.origin).pathname;
        if (
          method !== 'GET' &&
          [
            '/api/v1/organization/units',
            '/api/v1/tenant-roles',
            '/api/v1/invitations',
            '/api/v1/brand-assets/logo',
            '/api/v1/brand-assets/favicon',
            '/api/v1/brand-profile'
          ].includes(path)
        ) {
          try {
            window.stage4MutationResponses.push({
              path,
              method,
              status: response.status,
              body: await response.clone().json()
            });
          } catch {}
        }
        return response;
      };
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let pageErrors = 0;
    page.on('pageerror', () => {
      pageErrors += 1;
    });
    await page.goto(`${handoff.consoleOrigin}/login`);
    const login = apiResponse(page, handoff.apiOrigin, {
      method: 'POST',
      path: '/api/v2/auth/login',
      status: 200,
      action: async () => {
        await page.getByRole('textbox', { name: 'Email' }).fill(config.tenantAdmin.email);
        await page
          .getByLabel('Password', { exact: true })
          .fill(readFileSync(config.tenantAdmin.passwordFile, 'utf8').trim());
        await page.getByRole('button', { name: 'Sign in' }).click();
      }
    });
    const auth = await (await login).response.json();
    assert.match(auth.identity?.identityId, UUID);
    assert.equal(auth.activeContext?.type, 'TENANT', 'TENANT_CONTEXT_REQUIRED');
    assert.match(auth.activeContext.tenantId, UUID);
    const actorIdentityId = auth.identity.identityId;
    const tenantId = auth.activeContext.tenantId;
    const suffix = randomBytes(4).toString('hex');
    const record = ({ label, source, action, resourceId }, window) => {
      assert.match(resourceId, UUID);
      report.operations.push({
        label,
        source,
        action,
        resourceId,
        actorIdentityId,
        startedAt: window.startedAt,
        finishedAt: window.finishedAt
      });
    };
    async function runCase(name, task) {
      const check = report.checks.find(item => item.name === name);
      check.status = 'failed';
      try {
        await task();
        check.status = 'passed';
      } catch {
        check.reason = 'DIRECT_BROWSER_ASSERTION_FAILED';
      }
    }

    await runCase('organization-two-roots', async () => {
      await page.goto(`${handoff.consoleOrigin}/workbench`);
      const section = page.locator('section[aria-label="Organization units"]');
      await section.getByRole('button', { name: 'Add root' }).waitFor();
      for (const [index, name] of [`Stage 4 A ${suffix}`, `Stage 4 B ${suffix}`].entries()) {
        await section.getByRole('button', { name: 'Add root' }).click();
        const dialog = page.getByRole('dialog', { name: 'Create organization unit' });
        await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
        const window = await apiResponse(page, handoff.apiOrigin, {
          method: 'POST',
          path: '/api/v1/organization/units',
          status: 201,
          action: () => dialog.getByRole('button', { name: 'Save' }).click()
        });
        const created = await window.response.json();
        assert.equal(created.name, name);
        assert.equal(created.parentId ?? null, null);
        record(
          {
            label: `org-root-${index + 1}`,
            source: 'tenant-access',
            action: 'ORGANIZATION_UNIT_CREATED',
            resourceId: created.id
          },
          window
        );
        await section.getByText(name, { exact: false }).first().waitFor();
      }
    });

    await runCase('tenant-role-with-project-permission', async () => {
      await page.goto(`${handoff.consoleOrigin}/workbench`);
      const key = `STAGE4_${suffix.toUpperCase()}`;
      await page.getByRole('button', { name: 'Create role' }).click();
      const dialog = page.getByRole('dialog', { name: 'Create role' });
      await dialog.getByRole('textbox', { name: 'Role key' }).fill(key);
      await dialog.getByText(config.rolePermission, { exact: true }).click();
      const window = await apiResponse(page, handoff.apiOrigin, {
        method: 'POST',
        path: '/api/v1/tenant-roles',
        status: 201,
        action: () => dialog.getByRole('button', { name: 'Save' }).click()
      });
      const created = await window.response.json();
      assert.equal(created.roleKey, key);
      assert.ok(created.permissions.includes(config.rolePermission));
      record(
        {
          label: 'tenant-role-created',
          source: 'tenant-access',
          action: 'TENANT_ROLE_CHANGED',
          resourceId: created.id
        },
        window
      );
      await page.getByRole('cell', { name: key }).waitFor();
    });

    await runCase('invitation-created', async () => {
      await page.goto(`${handoff.consoleOrigin}/workbench`);
      const section = page.locator('section[aria-label="Member invitations"]');
      await section.locator('#invitation-email').fill(config.invitationEmail);
      const window = await apiResponse(page, handoff.apiOrigin, {
        method: 'POST',
        path: '/api/v1/invitations',
        status: 201,
        action: () => section.getByRole('button', { name: 'Send invitation' }).click()
      });
      const created = await window.response.json();
      assert.equal(created.email, config.invitationEmail);
      record(
        { label: 'invitation-created', source: 'tenant-access', action: 'INVITATION_CREATED', resourceId: created.id },
        window
      );
      await section.getByRole('row').filter({ hasText: config.invitationEmail }).waitFor();
    });

    await runCase('brand-five-fields-preview-and-save', async () => {
      await page.goto(`${handoff.consoleOrigin}/tenant-settings`);
      await page.getByRole('heading', { name: 'Tenant brand' }).waitFor();
      const uploaded = {};
      for (const [kind, file, max] of [
        ['logo', config.logoPng, 2 * 1024 * 1024],
        ['favicon', config.faviconPng, 256 * 1024]
      ]) {
        asset(file, max);
        const window = await apiResponse(page, handoff.apiOrigin, {
          method: 'POST',
          path: `/api/v1/brand-assets/${kind}`,
          status: 201,
          action: () => page.locator(`#brand-${kind}`).setInputFiles(file)
        });
        const created = await window.response.json();
        assert.match(created.url, /^\/brands\/[0-9a-f-]{36}$/);
        uploaded[kind] = created.url;
        record(
          {
            label: `brand-${kind}-uploaded`,
            source: 'tenant-access',
            action: 'BRAND_ASSET_UPLOADED',
            resourceId: created.id
          },
          window
        );
        await page
          .locator(`[aria-label="Isolated image preview"] img[alt="${kind === 'logo' ? 'Logo PNG' : 'Favicon PNG'}"]`)
          .waitFor();
      }
      const displayName = `Stage 4 Brand ${suffix}`;
      await page.getByRole('textbox', { name: 'Brand display name' }).fill(displayName);
      await page.getByRole('textbox', { name: 'Primary color (hex)' }).fill('#123456');
      await page.getByRole('textbox', { name: 'Accent color (hex)' }).fill('#234567');
      await page.getByRole('button', { name: 'Isolated preview', exact: true }).click();
      await page.locator('[aria-label="Isolated preview"]').filter({ hasText: displayName }).waitFor();
      const window = await apiResponse(page, handoff.apiOrigin, {
        method: 'PUT',
        path: '/api/v1/brand-profile',
        status: 200,
        action: () => page.getByRole('button', { name: 'Save brand' }).click()
      });
      const saved = await window.response.json();
      assert.equal(saved.profile?.displayName, displayName);
      assert.equal(saved.profile.primaryColor, '#123456');
      assert.equal(saved.profile.accentColor, '#234567');
      assert.equal(saved.profile.logoUrl, uploaded.logo);
      assert.equal(saved.profile.faviconUrl, uploaded.favicon);
      record(
        { label: 'brand-profile-saved', source: 'tenant-access', action: 'BRAND_PROFILE_SAVED', resourceId: tenantId },
        window
      );
      await page.reload();
      await page.getByRole('textbox', { name: 'Brand display name' }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Brand display name' }).inputValue(), displayName);
    });
    report.pageErrors = pageErrors;
    assert.equal(pageErrors, 0, 'PAGE_ERRORS');
    report.status = report.checks.every(check => check.status === 'passed') ? 'passed' : 'failed';
  } catch {
    report.reason = 'STAGE4_PRODUCT_BOOTSTRAP_OR_BROWSER_FAILED';
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    if (report.status !== 'passed') process.exitCode = 1;
    writeFileSync(resolve(outputPath, 'stage4-product-observations.json'), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    });
    console.log(
      JSON.stringify({
        status: report.status,
        scope: report.scope,
        passed: report.checks.filter(check => check.status === 'passed').length
      })
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    if (process.argv.length !== 4) throw new Error('USAGE');
    await run(...process.argv.slice(2));
  } catch {
    console.error('STAGE4_PRODUCT_FAILED: verify Fresh handoff, private inputs, Chrome and trusted HTTPS');
    process.exitCode = 1;
  }
}
