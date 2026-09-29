import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { operationKey } from './tenant-context-security.mjs';

/** CDP 仅丢弃真实已提交响应；Secret 保留在测试进程内存，产品仍从原操作恢复。 */
export async function verifyStage2OAuthRecovery(h) {
  const {
    page,
    ctx,
    handoff,
    button,
    input,
    remember,
    displayed,
    closeSecret,
    credentials,
    issue,
    consume,
    probe,
    timeState,
    pass,
    phase,
    adminToken,
    report
  } = h;
  async function lose(path, action, expected) {
    const cdp = await ctx.newCDPSession(page);
    let accept;
    let reject;
    const result = new Promise((resolve, fail) => {
      accept = resolve;
      reject = fail;
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `*${path}`, requestStage: 'Response' }] });
    cdp.on('Fetch.requestPaused', event => {
      const task = (async () => {
        if (event.request.method !== 'POST') {
          await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
          return;
        }
        assert.equal(event.responseStatusCode, expected);
        const payload = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
        const body = JSON.parse(payload.base64Encoded ? Buffer.from(payload.body, 'base64').toString() : payload.body);
        remember(body.clientSecret);
        report.responseLosses ??= [];
        report.responseLosses.push({ phase: h.currentPhase(), path, at: Date.now(), committedStatus: expected });
        await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' });
        accept(body);
      })();
      task.catch(reject);
    });
    const timeout = setTimeout(() => reject(new Error('RESPONSE_LOSS_TIMEOUT')), 30000);
    try {
      await action();
      const body = await result;
      await page.getByText('操作结果未知，已保留原操作信息并锁定替代请求。', { exact: true }).waitFor();
      assert.equal(await input(page, '一次性 Secret').count(), 0);
      return body;
    } finally {
      clearTimeout(timeout);
      await cdp.send('Fetch.disable');
      await cdp.detach();
    }
  }
  async function operations(client) {
    await page.waitForLoadState('networkidle');
    const response = page
      .waitForResponse(
        r => new URL(r.url()).pathname === '/api/v1/platform/oauth-client-operations' && r.status() === 200
      )
      .then(value => value.json());
    await page.reload();
    const body = await response;
    const rows = body.items.filter(row => row.clientId === client.id);
    assert.ok(rows.length > 0);
    return rows;
  }
  async function recover(client, operation) {
    const row = page.getByRole('row').filter({ hasText: operation.operationId });
    await button(row, '恢复签发').click();
    await button(page.getByRole('dialog'), '恢复签发').click();
    const replacement = await displayed(page);
    await closeSecret(page);
    await issue(client, client.secret, 401);
    await consume(client, await issue(client, replacement));
    return replacement;
  }
  async function attack(client, operationId, token) {
    return probe(
      `/api/v1/platform/oauth-client-operations/${operationId}/secret-issuance-recoveries`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': operationKey() }
      },
      { client, expected: 409, code: 'CLIENT_SECRET_RECOVERY_NOT_ALLOWED' }
    );
  }
  phase('stage2-create-response-loss');
  await page.goto(`${handoff.consoleOrigin}/oauth-clients`);
  await button(page, '创建 OAuth Client').click();
  const name = `Issue189 ${handoff.runId} recovery`;
  const form = page.getByRole('form', { name: '创建 OAuth Client', exact: true });
  await input(form, '名称').fill(name);
  await form.locator('label').filter({ hasText: 'runtime:read' }).click();
  const created = await lose('/api/v1/platform/oauth-clients', () => button(form, '创建 OAuth Client').click(), 201);
  const client = { id: created.clientId, secret: created.clientSecret, scope: 'runtime:read', name };
  const creation = (await operations(client)).find(row => row.action === 'CREATE');
  assert.ok(creation.canRecover);
  assert.equal(Date.parse(creation.recoveryUntil) - Date.parse(creation.completedAt), 600000);
  if (h.otherActorToken) await attack(client, creation.operationId, h.otherActorToken);
  const stable = await recover(client, creation);
  pass('committed-create-response-loss-and-original-actor-recovery', { recoveryWindowSeconds: 600 });

  phase('stage2-recovery-ownership');
  await attack(client, creation.operationId, adminToken());
  if (h.otherActorToken) pass('recovery-rejects-second-use-and-other-actor');
  else
    report.checks.push({
      name: 'recovery-rejects-second-use-and-other-actor',
      status: 'not-run',
      reason: 'other-platform-actor-authorization-required',
      repeatRecoveryRejected: true
    });

  phase('stage2-rotation-response-loss');
  await credentials(page, client.id);
  await button(page, '轮换 Secret').click();
  const rotated = await lose(
    `/api/v1/platform/oauth-clients/${client.id}/secret-rotations`,
    () => button(page.getByRole('dialog'), '确认').click(),
    200
  );
  client.secret = rotated.clientSecret;
  const rotation = (await operations(client)).find(row => row.action === 'ROTATE');
  const before = await credentials(page, client.id);
  assert.equal(Date.parse(before.overlapEndsAt) - Date.parse(rotated.updatedAt), 86400000);
  await recover(client, rotation);
  await consume(client, await issue(client, stable));
  const after = await credentials(page, client.id);
  assert.equal(after.overlapEndsAt, before.overlapEndsAt);
  pass('committed-rotation-response-loss-recovery-preserves-overlap');

  phase('stage2-recovery-expiry');
  const expiring = await h.create(page, 'recovery-expiry');
  await closeSecret(page);
  const operation = (await operations(expiring)).find(row => row.action === 'CREATE');
  assert.ok(operation.canRecover);
  try {
    await timeState({ ...expiring, operationId: operation.operationId }, 'recovery-expired');
    const expired = (await operations(expiring)).find(row => row.operationId === operation.operationId);
    assert.equal(expired.canRecover, false);
    await attack(expiring, operation.operationId, adminToken());
  } finally {
    await timeState(expiring, 'restored');
  }
  const restored = (await operations(expiring)).find(row => row.operationId === operation.operationId);
  assert.equal(restored.completedAt, operation.completedAt);
  assert.equal(restored.canRecover, true);
  pass('ten-minute-expiry-injection-rejects-recovery-and-restores', { actualWaitTenMinutes: false });
}
