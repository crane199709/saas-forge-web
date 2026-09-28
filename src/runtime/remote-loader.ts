export type RemoteVersion = 'v1' | 'v2';

/** 固定拓扑、固定版本，不接受 Manifest、任意资源地址或认证参数。 */
export function remoteAssetBase(consoleOrigin: string, version: RemoteVersion): string {
  const url = new URL(consoleOrigin);
  if (
    url.origin !== consoleOrigin ||
    url.protocol !== 'https:' ||
    url.port ||
    !/^console\.[a-z0-9.-]+$/.test(url.hostname) ||
    !['v1', 'v2'].includes(version)
  )
    throw new Error('Invalid Remote origin or version');
  return `https://remote.${url.hostname.slice('console.'.length)}/static-acceptance/${version}/`;
}

export interface RemoteMount {
  ready: Promise<void>;
  dispose(): void;
}

/** 仅加载已审核的无依赖公开夹具；释放 DOM、资源 URL 和未完成请求，晚到结果不能重新挂载。 */
export function mountStaticRemote(container: HTMLElement, consoleOrigin: string, version: RemoteVersion): RemoteMount {
  const base = remoteAssetBase(consoleOrigin, version);
  const controller = new AbortController();
  const urls: string[] = [];
  const target = document.createElement('div');
  const stylesheet = document.createElement('link');
  const image = new Image();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    stylesheet.remove();
    image.removeAttribute('src');
    target.remove();
    urls.forEach(url => URL.revokeObjectURL(url));
  };
  const timeout = setTimeout(dispose, 10000);
  const signal = controller.signal;
  const interrupted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Remote cancelled')), { once: true });
  });
  async function resource(file: string, mime: string) {
    const response = await fetch(`${base}${file}`, { credentials: 'omit', redirect: 'error', signal });
    if (!response.ok || response.headers.get('Content-Type')?.split(';')[0] !== mime)
      throw new Error('Remote unavailable');
    const blob = await response.blob();
    if (disposed) throw new Error('Remote cancelled');
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  }
  const ready = Promise.race([
    (async () => {
      const [scriptUrl, styleUrl, imageUrl] = await Promise.all([
        resource('remote.js', 'text/javascript'),
        resource('styles.css', 'text/css'),
        resource('image.svg', 'image/svg+xml')
      ]);
      if (disposed) return;
      const styled = new Promise<void>((resolve, reject) => {
        stylesheet.onload = () => resolve();
        stylesheet.onerror = () => reject(new Error('Remote stylesheet unavailable'));
      });
      stylesheet.rel = 'stylesheet';
      stylesheet.href = styleUrl;
      document.head.append(stylesheet);
      image.alt = `Remote ${version} sample`;
      image.src = imageUrl;
      const [module] = await Promise.all([
        import(/* @vite-ignore */ scriptUrl) as Promise<{ mount(target: HTMLElement): void }>,
        styled,
        image.decode()
      ]);
      if (disposed) return;
      module.mount(target);
      target.append(image);
      container.append(target);
    })(),
    interrupted
  ])
    .catch(() => {
      dispose();
      throw new Error('Remote unavailable');
    })
    .finally(() => clearTimeout(timeout));
  return { ready, dispose };
}
