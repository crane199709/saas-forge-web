/* eslint-disable no-await-in-loop -- Each browser mutation is observed before the next one begins. */
/* eslint-disable max-params -- Browser operation coordinates and audit windows are passed together. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute, resolve, sep } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { chromium } from 'playwright';
import { frontendProvenance } from '../build/provenance.ts';
import { chromeRouting, loadHandoff } from './verify-browser.mjs';
import { loadStage4BrowserCoreConfig } from './stage4-browser-core-config.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CASES = ['organization-tree-move-and-multi-association', 'tenant-role-union-and-delegated-organization'];
const code = file => readFileSync(file, 'utf8').trim();
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const section = (page, name) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .first();
const treeRow = (page, name) =>
  section(page, 'Organization units')
    .locator('.el-tree-node__content')
    .filter({
      has: page.getByText(name, { exact: true })
    });
const memberRow = (page, email) => section(page, 'Members').getByRole('row').filter({ hasText: email });

async function observed(page, apiOrigin, method, path, status, action) {
  const startedAt = new Date().toISOString();
  const [response] = await Promise.all([
    page.waitForResponse(candidate => {
      const url = new URL(candidate.url());
      return url.origin === apiOrigin && url.pathname === path && candidate.request().method() === method;
    }),
    action()
  ]);
  assert.equal(response.status(), status, 'API_STATUS_MISMATCH');
  return {
    body: status === 204 ? undefined : await response.json().catch(() => undefined),
    startedAt,
    finishedAt: new Date().toISOString()
  };
}

async function run(configPath, outputPath) {
  const repository = resolve(new URL('../', import.meta.url).pathname);
  assert.ok(
    isAbsolute(outputPath) && !resolve(outputPath).startsWith(`${repository}${sep}`),
    'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY'
  );
  const config = loadStage4BrowserCoreConfig(configPath);
  const { handoff, handoffSha256 } = loadHandoff(config.handoff);
  assert.equal(handoff.isolation.kind, 'fresh-compose');
  assert.equal(handoff.requiredServices.length, 7);
  assert.equal(handoff.backend.dirty, false);
  const provenance = frontendProvenance();
  assert.equal(provenance.frontend.dirty, false, 'FRONTEND_DIRTY');
  mkdirSync(outputPath, { mode: 0o700 });
  const report = {
    schemaVersion: 1,
    kind: 'stage4-browser-observations',
    scope: 'two-selected-real-chrome-paths',
    runId: handoff.runId,
    handoffSha256,
    startedAt: new Date().toISOString(),
    ...provenance,
    driverSha256: createHash('sha256')
      .update(readFileSync(new URL(import.meta.url)))
      .digest('hex'),
    status: 'failed',
    checks: CASES.map(name => ({ name, status: 'not_run' })),
    operations: []
  };
  let browser;
  let pageErrors = 0;
  const suffix = randomBytes(5).toString('hex');
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, ...chromeRouting(handoff) });
    report.chrome = browser.version();
    const newActorPage = async () => {
      const context = await browser.newContext({ locale: 'en', viewport: { width: 1440, height: 1000 } });
      await context.addInitScript(() => localStorage.setItem('SOY_lang', JSON.stringify('en')));
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', () => {
        pageErrors += 1;
      });
      return page;
    };
    const admin = await newActorPage();
    await admin.goto(`${handoff.consoleOrigin}/login`);
    assert.deepEqual(JSON.parse(await admin.locator('meta[name=sf-build]').getAttribute('content')), provenance);
    report.frontend.versionSource = 'served-html-provenance-matched';
    async function login(page, actor) {
      const result = await observed(page, handoff.apiOrigin, 'POST', '/api/v2/auth/login', 200, async () => {
        await page.getByRole('textbox', { name: 'Email' }).fill(actor.email);
        await page.getByLabel('Password', { exact: true }).fill(code(actor.passwordFile));
        await button(page, 'Sign in').click();
      });
      assert.match(result.body.identity?.identityId, UUID);
      return result.body;
    }
    const adminAuth = await login(admin, config.tenantAdmin);
    assert.equal(adminAuth.activeContext?.type, 'TENANT');
    assert.match(adminAuth.activeContext.tenantId, UUID);
    const tenantId = adminAuth.activeContext.tenantId;
    const directory = await observed(admin, handoff.apiOrigin, 'GET', '/api/v1/members', 200, () =>
      admin.goto(`${handoff.consoleOrigin}/workbench`)
    );
    const memberId = directory.body.items?.find(
      item => item.invitedEmail === config.ordinaryMember.email
    )?.membershipId;
    assert.match(memberId, UUID, 'ORDINARY_MEMBER_MISSING');
    await button(section(admin, 'Organization units'), 'Add root').waitFor();
    const member = memberRow(admin, config.ordinaryMember.email);
    await member.waitFor();
    await button(member, 'Manage roles').click();
    const assignments = admin.getByRole('dialog', { name: 'Manage roles' });
    await assignments.getByText('This member has no roles yet.').waitFor();
    await admin.keyboard.press('Escape');
    await button(member, 'Manage associations').click();
    const existingUnits = admin.getByRole('dialog', { name: 'Organization units' });
    await existingUnits.getByText('No organization units are assigned.').waitFor();
    await admin.keyboard.press('Escape');

    function record(label, action, resourceId, actorIdentityId, window) {
      assert.match(resourceId, UUID);
      report.operations.push({
        label,
        source: 'tenant-access',
        action,
        resourceId,
        actorIdentityId,
        startedAt: window.startedAt,
        finishedAt: window.finishedAt
      });
    }
    async function createUnit(name, parent) {
      if (parent) await button(treeRow(admin, parent.name), 'Add child').click();
      else await button(section(admin, 'Organization units'), 'Add root').click();
      const dialog = admin.getByRole('dialog', { name: 'Create organization unit' });
      await dialog.getByRole('textbox', { name: 'Name' }).fill(name);
      const result = await observed(admin, handoff.apiOrigin, 'POST', '/api/v1/organization/units', 201, () =>
        button(dialog, 'Save').click()
      );
      assert.equal(result.body.name, name);
      assert.equal(result.body.parentId ?? null, parent?.id ?? null);
      record(
        'organization-unit-created',
        'ORGANIZATION_UNIT_CREATED',
        result.body.id,
        adminAuth.identity.identityId,
        result
      );
      await treeRow(admin, name).waitFor();
      return result.body;
    }

    const organization = report.checks[0];
    organization.status = 'failed';
    const first = await createUnit(`Stage4 Core A ${suffix}`);
    const second = await createUnit(`Stage4 Core B ${suffix}`);
    const child = await createUnit(`Stage4 Core Child ${suffix}`, first);
    await button(treeRow(admin, child.name), 'Move').click();
    const moveDialog = admin.getByRole('dialog', { name: 'Move organization unit' });
    await moveDialog.getByRole('combobox', { name: 'Destination parent' }).click();
    await admin.getByRole('option', { name: second.name, exact: true }).click();
    const moved = await observed(
      admin,
      handoff.apiOrigin,
      'POST',
      `/api/v1/organization/units/${child.id}/move`,
      200,
      () => button(moveDialog, 'Save').click()
    );
    assert.equal(moved.body.id, child.id);
    assert.equal(moved.body.parentId, second.id);
    record('organization-unit-moved', 'ORGANIZATION_UNIT_MOVED', child.id, adminAuth.identity.identityId, moved);
    await button(memberRow(admin, config.ordinaryMember.email), 'Manage associations').click();
    const units = admin.getByRole('dialog', { name: 'Organization units' });
    for (const unit of [first, second]) {
      await units.getByRole('combobox', { name: 'Add association' }).click();
      await admin.getByRole('option', { name: unit.name, exact: true }).click();
      const association = await observed(
        admin,
        handoff.apiOrigin,
        'POST',
        `/api/v1/members/${memberId}/organization-units`,
        201,
        () => button(units, 'Add association').click()
      );
      record(
        'membership-organization-associated',
        'MEMBERSHIP_ORGANIZATION_UNIT_ADDED',
        memberId,
        adminAuth.identity.identityId,
        association
      );
      await button(units, `${unit.name} · Remove association`).waitFor();
    }
    assert.equal(await units.getByRole('button', { name: /Remove association$/ }).count(), 2);
    await admin.keyboard.press('Escape');
    organization.status = 'passed';

    const roles = report.checks[1];
    roles.status = 'failed';
    async function createRole(key, permission) {
      await button(section(admin, 'Tenant roles'), 'Create role').click();
      const dialog = admin.getByRole('dialog', { name: 'Create role' });
      await dialog.getByRole('textbox', { name: 'Role key' }).fill(key);
      await dialog.getByText(permission, { exact: true }).click();
      const result = await observed(admin, handoff.apiOrigin, 'POST', '/api/v1/tenant-roles', 201, () =>
        button(dialog, 'Save').click()
      );
      assert.equal(result.body.roleKey, key);
      assert.deepEqual(result.body.permissions, [permission]);
      record('tenant-role-created', 'TENANT_ROLE_CHANGED', result.body.id, adminAuth.identity.identityId, result);
      await section(admin, 'Tenant roles').getByRole('cell', { name: key }).waitFor();
      return result.body;
    }
    const orgRole = await createRole(`CORE_ORG_${suffix.toUpperCase()}`, 'system:organization:manage');
    const projectRole = await createRole(`CORE_PROJECT_${suffix.toUpperCase()}`, 'example:project:create');
    async function changeRole(role, method, expectedStatus) {
      await button(memberRow(admin, config.ordinaryMember.email), 'Manage roles').click();
      const dialog = admin.getByRole('dialog', { name: 'Manage roles' });
      if (method === 'PUT') {
        await dialog.getByRole('combobox', { name: 'Choose a role to assign' }).click();
        await admin.getByRole('option', { name: role.roleKey, exact: true }).click();
      }
      const response = await observed(
        admin,
        handoff.apiOrigin,
        method,
        `/api/v1/members/${memberId}/roles/${role.id}`,
        expectedStatus,
        () =>
          method === 'PUT'
            ? button(dialog, 'Assign role').click()
            : button(dialog.getByRole('listitem').filter({ hasText: role.roleKey }), 'Revoke').click()
      );
      await dialog.getByText(role.roleKey, { exact: true }).waitFor(method === 'PUT' ? {} : { state: 'hidden' });
      await admin.keyboard.press('Escape');
      record(
        method === 'PUT' ? 'membership-role-assigned' : 'membership-role-revoked',
        method === 'PUT' ? 'MEMBERSHIP_ROLE_ASSIGNED' : 'MEMBERSHIP_ROLE_REVOKED',
        memberId,
        adminAuth.identity.identityId,
        response
      );
    }
    await changeRole(orgRole, 'PUT', 200);
    const delegate = await newActorPage();
    await delegate.goto(`${handoff.consoleOrigin}/login`);
    const memberAuth = await login(delegate, config.ordinaryMember);
    const target = memberAuth.availableContexts?.companies?.find(item => item.tenantId === tenantId);
    assert.ok(target && target.membershipId === memberId, 'MEMBER_TENANT_MISMATCH');
    if (memberAuth.activeContext?.tenantId !== tenantId) {
      await button(delegate, target.tenantDisplayName).click();
      const confirm = button(delegate, 'Discard changes and switch');
      if (
        await confirm.waitFor({ timeout: 3000 }).then(
          () => true,
          () => false
        )
      )
        await confirm.click();
      await delegate.getByRole('heading', { name: 'Company workspace' }).waitFor();
    }
    await delegate.goto(`${handoff.consoleOrigin}/workbench`);
    await button(section(delegate, 'Organization units'), 'Add root').waitFor();
    await section(delegate, 'Tenant roles').getByText('Only a Tenant Administrator can manage roles.').waitFor();
    await delegate.getByTestId('project-remote').waitFor();
    assert.equal(await delegate.getByTestId('project-remote').getByRole('form', { name: 'Projects' }).count(), 0);
    await changeRole(projectRole, 'PUT', 200);
    await button(delegate.getByTestId('project-remote'), 'Refresh operation permissions').click();
    const projectForm = delegate.getByTestId('project-remote').getByRole('form', { name: 'Projects' });
    await projectForm.waitFor();
    assert.equal(await button(section(delegate, 'Organization units'), 'Add root').isEnabled(), true);
    await projectForm.getByRole('textbox', { name: 'Project name' }).fill(`Stage4 Union ${suffix}`);
    const project = await observed(delegate, handoff.apiOrigin, 'POST', '/api/v1/projects', 201, () =>
      button(projectForm, 'Create').click()
    );
    assert.match(project.body.id, UUID);
    report.operations.push({
      label: 'delegated-project-created',
      source: 'project',
      action: 'PROJECT_CREATED',
      resourceId: project.body.id,
      actorIdentityId: memberAuth.identity.identityId,
      startedAt: project.startedAt,
      finishedAt: project.finishedAt
    });
    await changeRole(projectRole, 'DELETE', 200);
    await button(delegate.getByTestId('project-remote'), 'Refresh operation permissions').click();
    await delegate.getByTestId('project-remote').getByRole('form', { name: 'Projects' }).waitFor({ state: 'hidden' });
    assert.equal(await button(section(delegate, 'Organization units'), 'Add root').isEnabled(), true);
    await section(delegate, 'Tenant roles').getByText('Only a Tenant Administrator can manage roles.').waitFor();
    roles.status = 'passed';
    assert.equal(pageErrors, 0, 'PAGE_ERROR');
    report.status = 'passed';
  } catch {
    report.reason = 'DIRECT_BROWSER_ASSERTION_FAILED';
    process.exitCode = 1;
  } finally {
    report.pageErrors = pageErrors;
    report.finishedAt = new Date().toISOString();
    writeFileSync(
      resolve(outputPath, 'stage4-browser-core-observations.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      {
        mode: 0o600,
        flag: 'wx'
      }
    );
    if (browser) await browser.close();
  }
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.map(({ name, status }) => ({ name, status })),
      outputPath
    })
  );
}

await run(process.argv[2], process.argv[3]);
