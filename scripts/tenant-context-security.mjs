import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

export function operationKey() {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = (bytes[6] % 16) + 112;
  bytes[8] = (bytes[8] % 64) + 128;
  return bytes.toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

/**
 * #185 产品外攻击探针。两个上下文必须由本轮真实 Console 登录建立，目标来自另一身份的
 * 权威 Session。仅在内存中读取 Cookie；调用方负责 Fresh 来源、页面错误观察和结果脱敏。
 */
export async function verifyUnauthorizedTenant({ attacker, owner, apiOrigin, gateway, runId, records = [] }) {
  const alias = value => createHash('sha256').update(`${runId}:${value}`).digest('hex');
  async function request(context, path, { method = 'GET', data, revision } = {}) {
    const traceId = randomBytes(16).toString('hex');
    const cookie = (await context.cookies(apiOrigin)).map(value => `${value.name}=${value.value}`).join('; ');
    const headers = {
      Cookie: cookie,
      Origin: new URL(attacker.pages()[0].url()).origin,
      'Sec-Fetch-Site': 'same-site',
      traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`
    };
    if (method === 'POST') {
      // 攻击在测试进程构造；正常 Console 仍只使用浏览器管理的安全头与正式 Client。
      Object.assign(headers, {
        Origin: new URL(attacker.pages()[0].url()).origin,
        'Sec-Fetch-Site': 'same-site',
        'X-SF-CSRF': '1',
        'If-Match': revision,
        'Idempotency-Key': operationKey()
      });
    }
    const startedAt = new Date().toISOString();
    const response = await context.request.fetch(`${gateway}${path}`, {
      method,
      headers,
      data,
      maxRedirects: 0,
      timeout: 30000
    });
    const body = await response.json();
    records.push({
      path,
      method,
      traceId,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: response.status(),
      ...(body.code ? { code: body.code } : {})
    });
    return { response, body };
  }
  const before = await request(attacker, '/api/v2/auth/session');
  const target = await request(owner, '/api/v2/auth/session');
  assert.equal(before.response.status(), 200);
  assert.equal(target.response.status(), 200);
  const current = before.body.activeContext;
  const foreign = target.body.activeContext;
  assert.equal(current?.type, 'TENANT');
  assert.equal(foreign?.type, 'TENANT');
  assert.notEqual(before.body.identity.identityId, target.body.identity.identityId);
  assert.notEqual(current.tenantId, foreign.tenantId);
  assert.ok(target.body.availableContexts.companies.some(company => company.membershipId === foreign.membershipId));
  assert.ok(!before.body.availableContexts.companies.some(company => company.membershipId === foreign.membershipId));

  const denied = await request(attacker, '/api/v2/auth/context-selections', {
    method: 'POST',
    data: { type: 'TENANT', membershipId: foreign.membershipId },
    revision: before.response.headers().etag
  });
  assert.equal(denied.response.status(), 403);
  assert.equal(denied.body.code, 'TARGET_CONTEXT_UNAVAILABLE');
  const after = await request(attacker, '/api/v2/auth/session');
  assert.equal(after.response.status(), 200);
  assert.equal(after.body.sessionId, before.body.sessionId);
  assert.equal(after.body.revision, before.body.revision);
  assert.deepEqual(after.body.activeContext, current);

  // 由真实页面触发 Refresh，再读取权威状态，不能只凭菜单不可见认定未切换。
  const page = attacker.pages()[0];
  const refreshed = page.waitForResponse(
    response => new URL(response.url()).pathname === '/api/v2/auth/refresh' && response.status() === 200
  );
  await page.reload();
  await refreshed;
  await page
    .getByRole('heading', { name: /^(公司工作台|Company workspace)$/ })
    .first()
    .waitFor();
  const restored = await request(attacker, '/api/v2/auth/session');
  assert.equal(restored.response.status(), 200);
  assert.equal(restored.body.sessionId, before.body.sessionId);
  assert.deepEqual(restored.body.activeContext, current);
  assert.ok(!restored.body.availableContexts.companies.some(company => company.membershipId === foreign.membershipId));
  return {
    scenario: 'unauthorized-tenant-context',
    status: 'passed',
    runId,
    injection: 'independent-context-selection-request-with-other-identity-membership',
    attackerTenant: alias(current.tenantId),
    targetTenant: alias(foreign.tenantId),
    targetMembership: alias(foreign.membershipId),
    targetExistsAndOwnedByDifferentIdentity: true,
    targetAbsentFromAttackerAuthority: true,
    unchangedSessionAndRevisionAfterRejection: true,
    unchangedContextAfterBrowserRefresh: true,
    requests: records
  };
}
