let challenge = '';
let onLink: (() => void) | undefined;
let listening = false;

function capture() {
  if (window.location.pathname !== '/password-recovery') return;
  const fragment = window.location.hash;
  window.history.replaceState(window.history.state, '', window.location.pathname);
  const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
  challenge = match?.[1] ?? '';
  onLink?.();
}

/** Router 初始化前擦除邮件链接中的秘密，后续同文档导航也重新捕获。 */
export function capturePasswordRecoveryLink() {
  capture();
  if (listening) return;
  listening = true;
  const changed = () => {
    if (window.location.hash || window.location.search) capture();
  };
  window.addEventListener('popstate', changed);
  window.addEventListener('hashchange', changed);
}

export function onPasswordRecoveryLink(listener: () => void) {
  onLink = listener;
  return () => {
    if (onLink === listener) onLink = undefined;
  };
}

export function takePasswordRecoveryChallenge() {
  const value = challenge;
  challenge = '';
  return value;
}
