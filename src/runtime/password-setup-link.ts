let challenge = '';
let onLink: (() => void) | undefined;
let listening = false;

function capture() {
  if (window.location.pathname !== '/password-setup') return;
  const fragment = window.location.hash;
  window.history.replaceState(window.history.state, '', window.location.pathname);
  const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
  challenge = match?.[1] ?? '';
  onLink?.();
}

/** 在 Router 创建前擦除邮件 fragment，包括同文档打开另一封设置邮件的导航。 */
export function capturePasswordSetupLink() {
  capture();
  if (listening) return;
  listening = true;
  const changed = () => {
    if (window.location.hash || window.location.search) capture();
  };
  window.addEventListener('popstate', changed);
  window.addEventListener('hashchange', changed);
}

export function onPasswordSetupLink(listener: () => void) {
  onLink = listener;
  return () => {
    if (onLink === listener) onLink = undefined;
  };
}

export function takePasswordSetupChallenge() {
  const value = challenge;
  challenge = '';
  return value;
}
