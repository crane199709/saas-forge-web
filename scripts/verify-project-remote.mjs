/* eslint-disable no-await-in-loop -- 真实业务请求与上下文边界必须按顺序验收。 */
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { frontendProvenance } from '../build/provenance.ts';
import { chromeRouting, loadHandoff } from './verify-browser.mjs';

const config = JSON.parse(readFileSync(process.env.SF_STAGE3_BROWSER_CONFIG, 'utf8'));
const { handoff, handoffSha256 } = loadHandoff(config.handoff);
assert.equal(handoff.isolation.kind, 'fresh-compose');
assert.equal(handoff.requiredServices.length, 7);
const output = resolve(process.argv[2]);
mkdirSync(output, { mode: 0o700 });
const report = {
  schemaVersion: 1,
  kind: 'browser',
  runId: handoff.runId,
  handoffSha256,
  startedAt: new Date().toISOString(),
  ...frontendProvenance(),
  checks: [],
  requests: [],
  status: 'failed'
};
const browser = await chromium.launch({ channel: 'chrome', ...chromeRouting(handoff) });
report.chromeVersion = browser.version();
const suffix = randomBytes(4).toString('hex');
const credential = file => {
  assert.equal(statSync(file).mode % 64, 0, 'PASSWORD_FILE_MUST_BE_PRIVATE');
  return readFileSync(file, 'utf8').trim();
};
const button = (p, name) => p.getByRole('button', { name, exact: true });
const row = (p, name) =>
  p
    .locator('[data-testid="project-remote"] li')
    .filter({ has: p.locator('span').filter({ hasText: new RegExp(`^${name} ·`) }) });
const ready = p => p.getByTestId('project-remote').waitFor();
function observe(p) {
  p.on('response', r => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api/v1/projects'))
      report.requests.push({ method: r.request().method(), path, status: r.status() });
  });
  p.on('pageerror', () => {
    report.pageError = true;
  });
}
async function login(actor) {
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  observe(p);
  await p.goto(`${handoff.consoleOrigin}/login`);
  await p.getByLabel('邮箱', { exact: true }).fill(actor.email);
  await p.getByLabel('密码', { exact: true }).fill(credential(actor.passwordFile));
  await button(p, '登录').click();
  await ready(p);
  return p;
}
async function create(p, name) {
  const f = p.getByRole('form', { name: '项目', exact: true });
  await f.getByLabel('项目名称', { exact: true }).fill(name);
  await button(f, '创建').click();
  await p.getByText(`${name} · v1`, { exact: true }).waitFor();
  const get = p.waitForRequest(r => r.method() === 'GET' && /\/projects\/[^/]+$/.test(new URL(r.url()).pathname));
  await button(row(p, name), '查看任务').click();
  const id = new URL((await get).url()).pathname.split('/').pop();
  const tasks = p.getByRole('form', { name: '任务', exact: true });
  await tasks.getByLabel('任务标题', { exact: true }).fill(`${name} task`);
  await button(tasks, '创建').click();
  await p.getByText(`${name} task · 待办 · v1`, { exact: true }).waitFor();
  const taskGet = p.waitForRequest(r => r.method() === 'GET' && /\/tasks\/[^/]+$/.test(new URL(r.url()).pathname));
  await button(row(p, `${name} task`), '编辑').click();
  const taskId = new URL((await taskGet).url()).pathname.split('/').pop();
  await button(tasks, '取消').click();
  return { id, taskId, name };
}
async function foreign(p, { method, from, to }, action) {
  const pattern = '**/api/v1/projects/**';
  // 只篡改资源地址，认证和业务请求仍来自 Shell Client；不伪造服务端响应。
  const handler = route =>
    route.continue(
      route.request().method() === method && new URL(route.request().url()).pathname === from
        ? { url: new URL(to, handoff.apiOrigin).href }
        : {}
    );
  await p.route(pattern, handler);
  try {
    const response = p.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === to);
    await action();
    assert.equal((await response).status(), 404);
    await p.waitForFunction(
      () => document.querySelector('[data-testid="project-remote"]')?.getAttribute('aria-busy') === 'false'
    );
    report.checks.push({
      name: 'cross-tenant',
      method,
      path: to,
      status: 'passed',
      expectedHttp: 404,
      requestAddressTampering: true
    });
  } finally {
    await p.unroute(pattern, handler);
  }
}
try {
  const a = await login(config.tenantA);
  const b = await login(config.tenantB);
  const av = await create(a, `Stage3 A ${suffix}`);
  const bv = await create(b, `Stage3 B ${suffix}`);
  report.resources = { tenantA: av, tenantB: bv };
  const project = p => `/api/v1/projects/${p.id}`;
  const task = p => `${project(p)}/tasks/${p.taskId}`;
  assert.equal(await a.getByText(`${bv.name} · v1`, { exact: true }).count(), 0);
  await foreign(a, { method: 'GET', from: project(av), to: project(bv) }, () =>
    button(row(a, av.name), '查看任务').click()
  );
  await button(row(a, av.name), '编辑').click();
  const pf = a.getByRole('form', { name: '项目', exact: true });
  await pf.getByLabel('项目名称', { exact: true }).fill(`${av.name} updated`);
  await foreign(a, { method: 'PUT', from: project(av), to: project(bv) }, () => button(pf, '保存').click());
  await button(pf, '保存').click();
  await a.getByText(`${av.name} updated · v2`, { exact: true }).waitFor();
  av.name += ' updated';
  await foreign(a, { method: 'DELETE', from: project(av), to: project(bv) }, () =>
    button(row(a, av.name), '删除').click()
  );
  const taskName = `Stage3 A ${suffix} task`;
  await foreign(a, { method: 'GET', from: task(av), to: task(bv) }, () => button(row(a, taskName), '编辑').click());
  await button(row(a, taskName), '编辑').click();
  const tf = a.getByRole('form', { name: '任务', exact: true });
  await tf.getByLabel('任务标题', { exact: true }).fill(`${taskName} updated`);
  await foreign(a, { method: 'PUT', from: task(av), to: task(bv) }, () => button(tf, '保存').click());
  await button(tf, '保存').click();
  await a.getByText(`${taskName} updated · 待办 · v2`, { exact: true }).waitFor();
  await foreign(a, { method: 'DELETE', from: task(av), to: task(bv) }, () =>
    button(row(a, `${taskName} updated`), '删除').click()
  );
  await tf.getByLabel('任务标题', { exact: true }).fill('forbidden');
  await foreign(a, { method: 'POST', from: `${project(av)}/tasks`, to: `${project(bv)}/tasks` }, () =>
    button(tf, '创建').click()
  );
  await tf.getByLabel('任务标题', { exact: true }).fill('');
  await pf.getByLabel('项目名称', { exact: true }).fill('retained-through-session-check');
  await a.waitForTimeout(35000);
  assert.equal(await pf.getByLabel('项目名称', { exact: true }).inputValue(), 'retained-through-session-check');
  report.checks.push({ name: 'session-check-retains-draft', status: 'passed', durationMs: 35000 });
  await pf.getByLabel('项目名称', { exact: true }).fill('');
  await b.reload();
  await ready(b);
  await button(row(b, bv.name), '查看任务').click();
  await b.getByText(`${bv.name} task · 待办 · v1`, { exact: true }).waitFor();
  report.checks.push({ name: 'foreign-data-unchanged', status: 'passed' });
  await button(row(a, `${taskName} updated`), '删除').click();
  await row(a, `${taskName} updated`).waitFor({ state: 'hidden' });
  await button(row(a, av.name), '删除').click();
  await row(a, av.name).waitFor({ state: 'hidden' });
  report.checks.push({ name: 'project-task-crud', status: 'passed', projectId: av.id, taskId: av.taskId });
  await a.route('**/project/1.0.0/remote.js', r => r.abort('failed'));
  await a.reload();
  await a.getByRole('alert').waitFor();
  assert.equal(await a.getByTestId('project-remote').count(), 0);
  await a.unroute('**/project/1.0.0/remote.js');
  await button(a, '重新读取').click();
  await ready(a);
  report.checks.push({ name: 'remote-download-failure-recovery', status: 'passed', fault: 'browser-network-abort' });
  assert.equal(report.pageError, undefined);
  report.status = 'passed';
} catch {
  report.failure = 'BROWSER_ASSERTION_FAILED';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output }));
