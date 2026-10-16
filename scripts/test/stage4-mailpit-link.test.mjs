import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractLink, runStage4MailboxLink } from '../stage4-mailpit-link.mjs';

const origin = 'https://console.saas.forge.test';
const token = 'A'.repeat(43);

test('extracts only the expected fresh invitation link without changing its secret', () => {
  const mail = {
    Text: `Open ${origin}/invitation#token=${token}`,
    HTML: `<a href="${origin}/invitation#token=${token}">Accept</a>`
  };
  assert.equal(extractLink(mail, '/invitation', origin), `${origin}/invitation#token=${token}`);
  assert.equal(extractLink(mail, '/password-recovery', origin), undefined);
});

test('rejects foreign origins, malformed tokens and unrelated message links', () => {
  const mail = {
    Text: [
      `https://console.saas.forge.test.attacker.test/invitation#token=${token}`,
      `${origin}/invitation#token=short`,
      `${origin}/invitation?leak=1#token=${token}`
    ].join('\n')
  };
  assert.equal(extractLink(mail, '/invitation', origin), undefined);
  assert.equal(
    extractLink({ Text: `${origin}/password-recovery#token=${token}` }, '/password-recovery', origin),
    `${origin}/password-recovery#token=${token}`
  );
});

test('snapshot excludes old mail and writes only a private new link', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-stage4-mailbox-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const recipient = 'new-invitee@example.test';
  const oldId = 'old-mail';
  const newId = 'new-mail';
  let messages = [{ ID: oldId, To: [{ Address: recipient }] }];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.endsWith('/api/v1/messages')) return new Response(JSON.stringify({ messages }));
    if (url.endsWith(`/api/v1/message/${newId}`))
      return new Response(JSON.stringify({ Text: `${origin}/invitation#token=${token}` }));
    return new Response(JSON.stringify({ Text: `${origin}/invitation#token=${'B'.repeat(43)}` }));
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  const runId = '11111111-1111-4111-8111-111111111111';
  const services = [
    'gateway',
    'iam-service',
    'tenant-access-service',
    'entitlement-service',
    'audit-service',
    'project-service',
    'remote-delivery-service'
  ];
  const handoffPath = join(directory, 'handoff.json');
  writeFileSync(
    handoffPath,
    JSON.stringify({
      schemaVersion: 1,
      status: 'ready',
      runId,
      readyAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      consoleOrigin: origin,
      apiOrigin: 'https://api.saas.forge.test',
      jwksSha256: 'a'.repeat(64),
      isolation: { kind: 'fresh-compose', project: `sf-acceptance-${runId}`, volumes: [{}, {}, {}] },
      backend: { commit: 'a'.repeat(40), dirty: false, jdkMajor: 17, images: services.map(service => ({ service })) },
      requiredServices: services,
      cleanup: { owner: 'environment-preparer', automatic: false }
    })
  );
  const configPath = join(directory, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      handoff: handoffPath,
      mailbox: 'http://127.0.0.1:8025',
      recipient
    }),
    { mode: 0o600 }
  );
  const snapshotPath = join(directory, 'snapshot.json');
  const linkPath = join(directory, 'link.txt');
  const snapshot = await runStage4MailboxLink({ command: 'snapshot', configPath, snapshotPath });
  assert.equal(snapshot.messages, 1);
  messages = [messages[0], { ID: newId, To: [{ Address: recipient }] }];
  const result = await runStage4MailboxLink({
    command: 'wait',
    configPath,
    snapshotPath,
    expectedPath: '/invitation',
    linkPath
  });
  assert.equal(result.status, 'link-written');
  assert.equal(statSync(linkPath).mode % 64, 0);
  assert.equal(readFileSync(linkPath, 'utf8').trim(), `${origin}/invitation#token=${token}`);
  assert.ok(!JSON.stringify(result).includes(token));
});
