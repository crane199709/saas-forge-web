import assert from 'node:assert/strict';
import test from 'node:test';
import { captureInvitationLink, onInvitationLink, takeInvitationToken } from '../src/runtime/invitation-link';
import {
  capturePasswordRecoveryLink,
  onPasswordRecoveryLink,
  takePasswordRecoveryChallenge
} from '../src/runtime/password-recovery-link';
import {
  capturePasswordSetupLink,
  onPasswordSetupLink,
  takePasswordSetupChallenge
} from '../src/runtime/password-setup-link';

test('each one-time link strips its fragment before notifying and hands each token out once', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = new Map<string, Array<() => void>>();
  const browser = {
    location: { pathname: '', hash: '', search: '' },
    history: {
      state: null,
      replaceState(_state: unknown, _title: string, path: string) {
        assert.equal(path, browser.location.pathname);
        browser.location.hash = '';
        browser.location.search = '';
      }
    },
    addEventListener(name: string, listener: () => void) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    fire(name: string) {
      for (const listener of listeners.get(name) ?? []) listener();
    }
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  try {
    const links = [
      { path: '/invitation', capture: captureInvitationLink, on: onInvitationLink, take: takeInvitationToken },
      {
        path: '/password-recovery',
        capture: capturePasswordRecoveryLink,
        on: onPasswordRecoveryLink,
        take: takePasswordRecoveryChallenge
      },
      {
        path: '/password-setup',
        capture: capturePasswordSetupLink,
        on: onPasswordSetupLink,
        take: takePasswordSetupChallenge
      }
    ];
    for (const link of links) {
      browser.location.pathname = link.path;
      browser.location.hash = `#token=${'A'.repeat(43)}`;
      browser.location.search = '?untrusted=1';
      link.capture();
      assert.equal(browser.location.hash, '');
      assert.equal(browser.location.search, '');
      assert.equal(link.take(), 'A'.repeat(43));
      assert.equal(link.take(), '');

      const observed: string[] = [];
      const stop = link.on(() => {
        assert.equal(browser.location.hash, '');
        observed.push(link.take());
      });
      browser.location.hash = `#token=${'B'.repeat(43)}`;
      browser.fire('hashchange');
      assert.deepEqual(observed, ['B'.repeat(43)]);
      browser.location.hash = '#token=invalid';
      browser.fire('popstate');
      assert.deepEqual(observed, ['B'.repeat(43), '']);
      stop();
    }
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
