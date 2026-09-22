import { SessionFailure } from './console-session';
import type { CoordinationMessage, LogoutIntent, SessionCoordination } from './console-session';

/** Only logout intent is durable. Credentials, identity and session snapshots never leave the Realm. */
export function createBrowserCoordination(apiOrigin: string): SessionCoordination {
  const name = `sf:console:${apiOrigin}`;
  const storageKey = `${name}:logout`;
  const listeners = new Set<(kind: CoordinationMessage) => void>();
  const channel = new BroadcastChannel(name);
  channel.onmessage = event => {
    if (['changed', 'logout', 'switching', 'edited'].includes(event.data))
      listeners.forEach(listener => listener(event.data));
  };
  // 只传递编辑发生这一事实，不读取或广播任何输入值。休眠页仍按未知状态显式确认。
  const edited = () => {
    listeners.forEach(listener => listener('edited'));
    channel.postMessage('edited');
  };
  document.addEventListener('input', edited, true);
  document.addEventListener('change', edited, true);
  return {
    async exclusive(operation) {
      if (!navigator.locks) throw new SessionFailure('SESSION_COORDINATION_UNAVAILABLE');
      return await navigator.locks.request(name, operation);
    },
    pending() {
      try {
        const value = localStorage.getItem(storageKey);
        if (!value) return undefined;
        const intent: unknown = JSON.parse(value);
        if (
          typeof intent !== 'object' ||
          !intent ||
          !('key' in intent) ||
          typeof intent.key !== 'string' ||
          ('revision' in intent && typeof intent.revision !== 'string')
        )
          throw new Error('Invalid logout intent');
        return intent as LogoutIntent;
      } catch {
        throw new SessionFailure('SESSION_COORDINATION_UNAVAILABLE');
      }
    },
    savePending(value) {
      try {
        if (value) localStorage.setItem(storageKey, JSON.stringify(value));
        else localStorage.removeItem(storageKey);
      } catch {
        throw new SessionFailure('SESSION_COORDINATION_UNAVAILABLE');
      }
    },
    publish(kind) {
      channel.postMessage(kind);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      document.removeEventListener('input', edited, true);
      document.removeEventListener('change', edited, true);
      listeners.clear();
      channel.close();
    }
  };
}

export function operationKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = Date.now();
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] % 16) + 112;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
