let token = '';
let onLink: (() => void) | undefined;
let listening = false;

function capture() {
  if (window.location.pathname !== '/invitation') return;
  const fragment = window.location.hash;
  window.history.replaceState(window.history.state, '', window.location.pathname);
  const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
  token = match?.[1] ?? '';
  onLink?.();
}

/** 在 Router 创建前移除邮件凭据；页面只在当前内存中保留它。 */
export function captureInvitationLink() {
  capture();
  if (listening) return;
  listening = true;
  const changed = () => {
    if (window.location.hash || window.location.search) capture();
  };
  window.addEventListener('popstate', changed);
  window.addEventListener('hashchange', changed);
}

export function onInvitationLink(listener: () => void) {
  onLink = listener;
  return () => {
    if (onLink === listener) onLink = undefined;
  };
}

export function takeInvitationToken() {
  const value = token;
  token = '';
  return value;
}
