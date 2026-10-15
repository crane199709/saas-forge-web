/* eslint-disable no-await-in-loop -- 邮件投递的有界轮询按序检查。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadHandoff } from './verify-browser.mjs';

const PATHS = new Set(['/invitation', '/password-setup', '/password-recovery']);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const repository = resolve(new URL('../', import.meta.url).pathname);

function privateFile(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && stat.mode % 64 === 0, 'PRIVATE_FILE_REQUIRED');
  assert.equal(stat.uid, process.getuid(), 'PRIVATE_FILE_OWNER');
  return readFileSync(path, 'utf8');
}

function privateOutput(path) {
  const target = resolve(path);
  assert.equal(target, path, 'ABSOLUTE_OUTPUT_REQUIRED');
  assert.ok(!target.startsWith(`${repository}${sep}`), 'OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  const parent = lstatSync(dirname(target));
  assert.ok(parent.isDirectory() && parent.mode % 64 === 0, 'PRIVATE_OUTPUT_DIRECTORY_REQUIRED');
  assert.equal(parent.uid, process.getuid(), 'PRIVATE_OUTPUT_OWNER');
  return target;
}

export function loadMailboxConfig(path) {
  const config = JSON.parse(privateFile(path));
  assert.deepEqual(Object.keys(config).sort(), ['handoff', 'mailbox', 'recipient']);
  assert.ok(resolve(config.handoff) === config.handoff, 'ABSOLUTE_HANDOFF_REQUIRED');
  const { handoff, handoffSha256 } = loadHandoff(config.handoff);
  assert.equal(handoff.isolation.kind, 'fresh-compose');
  assert.equal(handoff.requiredServices.length, 7);
  assert.equal(handoff.backend.dirty, false);
  const mailbox = new URL(config.mailbox);
  assert.equal(mailbox.protocol, 'http:');
  assert.equal(mailbox.hostname, '127.0.0.1');
  assert.equal(mailbox.origin, config.mailbox);
  assert.match(config.recipient, /^[a-z0-9._%+-]+@[a-z0-9.-]+\.test$/);
  return { handoff, handoffSha256, mailbox: mailbox.origin, recipient: config.recipient };
}

async function mailboxJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, 'MAILPIT_UNAVAILABLE');
  return response.json();
}

export async function listMessages(mailbox) {
  const body = await mailboxJson(`${mailbox}/api/v1/messages`);
  assert.ok(Array.isArray(body.messages), 'MAILPIT_MESSAGES_INVALID');
  return body.messages;
}

export function extractLink(mail, expectedPath, consoleOrigin) {
  assert.ok(PATHS.has(expectedPath), 'LINK_PATH_INVALID');
  const text = [mail.Text, mail.HTML].filter(value => typeof value === 'string').join('\n');
  const links = text.match(/https:\/\/[^\s"<>]+/g) ?? [];
  return links
    .map(candidate => {
      let parsed;
      try {
        parsed = new URL(candidate.replaceAll('&amp;', '&'));
      } catch {
        return undefined;
      }
      if (
        parsed.origin !== consoleOrigin ||
        parsed.pathname !== expectedPath ||
        parsed.search ||
        !parsed.hash.startsWith('#token=')
      )
        return undefined;
      return TOKEN.test(parsed.hash.slice(7)) ? parsed.href : undefined;
    })
    .find(Boolean);
}

function belongsTo(message, recipient) {
  return Array.isArray(message.To) && message.To.some(to => to.Address === recipient);
}

export async function runStage4MailboxLink({ command, configPath, snapshotPath, expectedPath, linkPath }) {
  const { handoff, handoffSha256, mailbox, recipient } = loadMailboxConfig(configPath);
  assert.ok(Date.parse(handoff.expiresAt) > Date.now(), 'HANDOFF_EXPIRED');
  privateOutput(snapshotPath);
  if (command === 'snapshot') {
    assert.equal(expectedPath, undefined);
    const messages = await listMessages(mailbox);
    const snapshot = {
      schemaVersion: 1,
      runId: handoff.runId,
      handoffSha256,
      recipientSha256: sha256(recipient),
      messageIds: messages.filter(message => belongsTo(message, recipient)).map(message => message.ID)
    };
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600, flag: 'wx' });
    return { status: 'snapshot', messages: snapshot.messageIds.length };
  }
  assert.equal(command, 'wait');
  assert.ok(PATHS.has(expectedPath), 'LINK_PATH_INVALID');
  privateOutput(linkPath);
  const snapshot = JSON.parse(privateFile(snapshotPath));
  assert.equal(snapshot.runId, handoff.runId);
  assert.equal(snapshot.handoffSha256, handoffSha256);
  assert.equal(snapshot.recipientSha256, sha256(recipient));
  assert.ok(Array.isArray(snapshot.messageIds));
  const before = new Set(snapshot.messageIds);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidates = (await listMessages(mailbox)).filter(
      message => belongsTo(message, recipient) && !before.has(message.ID)
    );
    const found = [];
    for (const message of candidates) {
      const mail = await mailboxJson(`${mailbox}/api/v1/message/${encodeURIComponent(message.ID)}`);
      const link = extractLink(mail, expectedPath, handoff.consoleOrigin);
      if (link) found.push({ message, link });
    }
    assert.ok(found.length <= 1, 'AMBIGUOUS_NEW_MAIL');
    if (found.length === 1) {
      writeFileSync(linkPath, `${found[0].link}\n`, { mode: 0o600, flag: 'wx' });
      return {
        status: 'link-written',
        path: expectedPath,
        messageIdSha256: sha256(found[0].message.ID),
        linkSha256: sha256(found[0].link)
      };
    }
    await delay(1000);
  }
  throw new Error('NEW_MAIL_TIMEOUT');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    if (process.argv[2] === 'snapshot' && process.argv.length === 5)
      console.log(
        JSON.stringify(
          await runStage4MailboxLink({
            command: 'snapshot',
            configPath: process.argv[3],
            snapshotPath: process.argv[4]
          })
        )
      );
    else if (process.argv[2] === 'wait' && process.argv.length === 7)
      console.log(
        JSON.stringify(
          await runStage4MailboxLink({
            command: 'wait',
            configPath: process.argv[3],
            snapshotPath: process.argv[4],
            expectedPath: process.argv[5],
            linkPath: process.argv[6]
          })
        )
      );
    else throw new Error('USAGE');
  } catch {
    console.error('STAGE4_MAILPIT_LINK_FAILED: inspect private config, handoff, mailbox and new message');
    process.exitCode = 1;
  }
}
