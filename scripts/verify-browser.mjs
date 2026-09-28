import process from 'node:process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { frontendProvenance } from '../build/provenance.ts';

function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password)
    throw new Error('ORIGIN_INVALID');
}
function checkIsolation(handoff) {
  if (handoff.isolation?.kind === 'fresh-compose') {
    if (
      handoff.isolation.project !== `sf-acceptance-${handoff.runId}` ||
      handoff.isolation.volumes?.length !== 3 ||
      handoff.backend.images?.length !== 5 ||
      handoff.backend.jdkMajor !== 17
    )
      throw new Error('FRESH_EVIDENCE_MISSING');
  } else if (handoff.isolation?.kind !== 'existing-environment') throw new Error('ISOLATION_INVALID');
}
function loadHandoff(path) {
  const content = readFileSync(path);
  const handoff = JSON.parse(content);
  if (
    handoff.schemaVersion !== 1 ||
    handoff.status !== 'ready' ||
    !/^[0-9a-f-]{36}$/.test(handoff.runId) ||
    !Number.isFinite(Date.parse(handoff.readyAt)) ||
    Date.parse(handoff.readyAt) > Date.now() ||
    !Number.isFinite(Date.parse(handoff.expiresAt)) ||
    Date.parse(handoff.expiresAt) <= Date.now() ||
    !/^[0-9a-f]{64}$/.test(handoff.jwksSha256) ||
    !/^[0-9a-f]{40}$/.test(handoff.backend?.commit) ||
    typeof handoff.backend.dirty !== 'boolean' ||
    handoff.cleanup?.owner !== 'environment-preparer' ||
    handoff.cleanup.automatic !== false
  ) {
    throw new Error('HANDOFF_INVALID');
  }
  httpsOrigin(handoff.consoleOrigin);
  httpsOrigin(handoff.apiOrigin);
  checkIsolation(handoff);
  return { handoff, handoffSha256: createHash('sha256').update(content).digest('hex') };
}

function credential(path) {
  const info = statSync(path);
  if (!info.isFile() || info.size > 4096 || info.mode % 64 !== 0) throw new Error('CREDENTIAL_FILE_INVALID');
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error('CREDENTIAL_FILE_EMPTY');
  return value;
}
async function verify(handoffPath, outputDirectory) {
  const { handoff, handoffSha256 } = loadHandoff(handoffPath);
  const versions = frontendProvenance();
  const email = credential(process.env.SF_EMAIL_FILE);
  const password = credential(process.env.SF_PASSWORD_FILE);
  mkdirSync(outputDirectory, { mode: 0o700 });
  const report = {
    schemaVersion: 1,
    kind: 'browser',
    runId: handoff.runId,
    handoffSha256,
    startedAt: new Date().toISOString(),
    ...versions,
    checks: [],
    requests: [],
    status: 'failed'
  };
  let browser;
  let phase = 'launch';
  let errors = 0;
  const passed = name => report.checks.push({ name, status: 'passed' });
  try {
    const { chromium } = await import(process.env.SF_PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.chrome = browser.version();
    report.playwright = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.resolve(process.env.SF_PLAYWRIGHT_MODULE || 'playwright')))
    ).version;
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
    context.on('page', page => {
      page.on('pageerror', () => {
        errors += 1;
      });
      page.on('console', message => {
        if (message.type() === 'error') errors += 1;
      });
    });
    context.on('response', response => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;
      if (url.origin !== handoff.apiOrigin || response.status() >= 400) errors += 1;
      // 固定认证路径无业务 ID；忽略原始头、查询串、请求与响应体。
      if (/^\/api\/v2\/auth\/[a-z-]+$/.test(url.pathname))
        report.requests.push({
          phase,
          path: url.pathname,
          method: response.request().method(),
          status: response.status()
        });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    phase = 'login-page';
    await page.goto(`${handoff.consoleOrigin}/login`);
    const emailInput = page.getByRole('textbox', { name: /邮箱|Email/ });
    await emailInput.waitFor();
    assert.equal(new URL(page.url()).origin, handoff.consoleOrigin);
    assert.ok(await page.title());
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    const jwks = await page.evaluate(async api => {
      const response = await fetch(`${api}/.well-known/jwks.json`, { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error('JWKS_UNAVAILABLE');
      const { keys } = await response.json();
      return keys.map(key => ({ kid: key.kid, n: key.n, e: key.e })).sort((a, b) => a.kid.localeCompare(b.kid));
    }, handoff.apiOrigin);
    assert.equal(createHash('sha256').update(JSON.stringify(jwks)).digest('hex'), handoff.jwksSha256);
    passed('trusted-console-and-same-gateway');
    phase = 'frontend-version';
    const deployed = JSON.parse(await page.locator('meta[name=sf-build]').getAttribute('content'));
    assert.deepEqual(deployed, versions);
    report.frontend = { ...report.frontend, versionSource: 'served-html-provenance-matched' };
    passed('served-frontend-and-client-match-checkout');
    phase = 'login-page';
    await page.getByLabel('切换语言', { exact: true }).locator('svg').waitFor();
    await page
      .getByRole('button', { name: /Theme Schema|切换主题模式|主题模式/i })
      .locator('svg')
      .waitFor();
    await page.locator('#nprogress').waitFor({ state: 'detached' });
    await page.screenshot({ path: resolve(outputDirectory, 'login-zh.png'), animations: 'disabled' });
    await page.getByLabel('切换语言', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'English' }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await page.getByRole('button', { name: /Theme Schema|切换主题模式|主题模式/i }).click();
    await page
      .getByRole('button', { name: /Theme Schema|切换主题模式|主题模式/i })
      .locator('svg')
      .waitFor();
    await page.screenshot({ path: resolve(outputDirectory, 'login-en.png'), animations: 'disabled' });
    passed('login-language-theme-and-visual-captures');
    phase = 'login';
    await emailInput.fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
    await page.getByRole('textbox', { name: 'Password', exact: true }).press('Tab');
    await page.getByRole('button', { name: 'Sign in', exact: true }).press('Enter');
    const heading = page.getByRole('heading', { name: 'Platform workspace', exact: true });
    const target = page.getByRole('button', { name: 'Platform management', exact: true });
    await Promise.race([heading.waitFor(), target.waitFor()]);
    if (await target.isVisible()) {
      phase = 'context-selection';
      await target.click();
      await page.getByRole('button', { name: 'Discard changes and switch', exact: true }).click();
    }
    await heading.waitFor();
    assert.equal(await heading.evaluate(element => document.activeElement === element), true);
    passed('real-login-authoritative-platform-context-heading-focus');
    const cookies = await context.cookies(handoff.apiOrigin);
    for (const name of ['__Host-sf_console_slot', '__Host-sf_console_refresh']) {
      const cookie = cookies.find(item => item.name === name);
      assert.ok(cookie?.httpOnly && cookie.secure && cookie.path === '/');
      assert.equal(cookie.domain, new URL(handoff.apiOrigin).hostname);
    }
    passed('browser-managed-host-only-secure-httponly-cookies');
    phase = 'refresh';
    await page.reload();
    await heading.waitFor();
    passed('refresh-restores-workspace');
    phase = 'second-tab';
    const second = await context.newPage();
    second.setDefaultTimeout(15000);
    await second.goto(`${handoff.consoleOrigin}/home`);
    await second.getByRole('heading', { name: /Platform workspace|平台工作台/, exact: true }).waitFor();
    passed('second-tab-restores-same-context');
    await second.close();
    phase = 'logout';
    await page.getByText(email, { exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Logout', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor();
    passed('logout-remains-anonymous-after-reload');
    assert.equal(errors, 0);
    for (const path of ['login', 'refresh', 'logout']) {
      assert.ok(report.requests.some(request => request.path === `/api/v2/auth/${path}` && request.status < 400));
    }
    passed('no-unexpected-console-page-or-api-errors');
    report.status = 'passed';
  } catch {
    report.checks.push({ name: phase, status: 'failed' });
    throw new Error('BROWSER_FLOW_FAILED');
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    report.unexpectedErrors = errors;
    writeFileSync(resolve(outputDirectory, 'browser.json'), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    });
  }
}

try {
  const [command, ...input] = process.argv.slice(2);
  const [path, ...extra] = input[0] === '--' ? input.slice(1) : input;
  if (command === '--check-handoff' && path && !extra.length) {
    const { handoff } = loadHandoff(path);
    console.log(JSON.stringify({ runId: handoff.runId, status: 'valid', scope: 'configuration-only' }));
  } else if (command === '--run' && path && extra.length === 1) await verify(path, extra[0]);
  else throw new Error('USAGE');
} catch {
  // Playwright 错误可能包含输入值或页面文本，不能把原始异常写入验收产物。
  console.error('BROWSER_CHECK_FAILED: verify handoff, trusted HTTPS, running frontend and credential files');
  process.exitCode = 1;
}
