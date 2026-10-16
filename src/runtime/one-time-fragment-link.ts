/** 每种邮件链接分别持有只读一次的凭据槽；URL 擦除必须早于页面回调。 */
export function createOneTimeFragmentLink(pathname: string) {
  let token = '';
  let onLink: (() => void) | undefined;
  let listening = false;

  function capture() {
    if (window.location.pathname !== pathname) return;
    const fragment = window.location.hash;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    const match = /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment);
    token = match?.[1] ?? '';
    onLink?.();
  }

  return {
    captureLink() {
      capture();
      if (listening) return;
      listening = true;
      const changed = () => {
        if (window.location.hash || window.location.search) capture();
      };
      window.addEventListener('popstate', changed);
      window.addEventListener('hashchange', changed);
    },
    onLink(listener: () => void) {
      onLink = listener;
      return () => {
        if (onLink === listener) onLink = undefined;
      };
    },
    take() {
      const value = token;
      token = '';
      return value;
    }
  };
}
