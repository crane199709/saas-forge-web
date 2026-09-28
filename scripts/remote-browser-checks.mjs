/* eslint-disable no-await-in-loop -- 按版本顺序验证切换与固定制品。 */
import assert from 'node:assert/strict';

/** 调用方提供已登录真实 Tenant 的 Chrome 页面；不建立账号、不改环境、不接管后端。 */
export async function verifyRemoteRendering(page) {
  const region = page.getByRole('region', { name: /Remote (消费验收|consumption acceptance)/ });
  await region.waitFor();
  const rendered = [];
  for (const [version, border, dimensions] of [
    ['v1', '7px', [24, 16]],
    ['v2', '11px', [32, 20]]
  ]) {
    await region.getByRole('button', { name: new RegExp(`^(加载|Load) ${version}$`) }).click();
    await region
      .getByRole('status')
      .filter({ hasText: new RegExp(`${version} (已就绪|ready)`) })
      .waitFor();
    const output = region.getByText(`Remote ${version} executed`, { exact: true });
    assert.equal(await output.evaluate(element => getComputedStyle(element).borderTopWidth), border);
    const image = region.getByRole('img', { name: `Remote ${version} sample` });
    assert.deepEqual(await image.evaluate(element => [element.naturalWidth, element.naturalHeight]), dimensions);
    assert.equal(await region.locator('[class^=sf-static-remote-]').count(), 1);
    rendered.push({ version, border, dimensions });
  }
  await region.getByRole('button', { name: /卸载 Remote|Unload Remote/ }).click();
  assert.equal(await region.locator('[class^=sf-static-remote-]').count(), 0);
  assert.equal(await region.getByRole('img').count(), 0);
  assert.equal(await page.locator('link[href^="blob:"]').count(), 0);
  return rendered;
}

/** Dev 宿主公开加载器的生命周期验证，使用真实资源，仅延迟自己的请求，不模拟响应内容。 */
export async function verifyRemoteLifecycle(page) {
  return page.evaluate(async () => {
    const { mountStaticRemote } = await import('/src/runtime/remote-loader.ts');
    const target = document.createElement('div');
    document.body.append(target);
    const baseline = document.querySelectorAll('link[href^="blob:"]').length;
    const check = (value, label) => {
      if (!value) throw new Error(label);
    };
    try {
      const first = mountStaticRemote(target, location.origin, 'v1');
      const cancelled = first.ready.then(
        () => false,
        () => true
      );
      first.dispose();
      check(await cancelled, 'cancelled load must reject');
      check(target.childElementCount === 0, 'cancelled load attached content');
      const second = mountStaticRemote(target, location.origin, 'v2');
      await second.ready;
      check(target.textContent === 'Remote v2 executed', 'latest mount did not render');
      second.dispose();
      second.dispose();
      check(target.childElementCount === 0, 'unmount left content');
      check(document.querySelectorAll('link[href^="blob:"]').length === baseline, 'unmount left stylesheet');
      return { cancelled: true, remounted: true, cleanup: true };
    } finally {
      target.remove();
    }
  });
}

/** 仅记录凭据是否存在；不保存原始请求头、Cookie、Token 或响应体。 */
export async function observeRemoteRequests(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled', { cacheDisabled: true });
  const records = new Map();
  const extras = new Map();
  const flags = headers => {
    const names = Object.keys(headers).map(name => name.toLowerCase());
    return {
      cookie: names.includes('cookie'),
      authorization: names.includes('authorization'),
      csrf: names.includes('x-sf-csrf')
    };
  };
  client.on('Network.requestWillBeSent', event => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith('/static-acceptance/')) return;
    records.set(event.requestId, { path: url.pathname, request: flags(event.request.headers) });
  });
  client.on('Network.requestWillBeSentExtraInfo', event => extras.set(event.requestId, flags(event.headers)));
  client.on('Network.responseReceived', event => {
    const record = records.get(event.requestId);
    if (!record) return;
    const headers = Object.fromEntries(
      Object.entries(event.response.headers).map(([key, value]) => [key.toLowerCase(), value])
    );
    record.status = event.response.status;
    record.allowedOrigin = headers['access-control-allow-origin'];
    record.allowCredentials = headers['access-control-allow-credentials'] !== undefined;
  });
  return {
    async finish() {
      await client.detach();
      const result = [...records.entries()].map(([id, record]) => ({ ...record, extra: extras.get(id) }));
      for (const version of ['v1', 'v2']) {
        for (const file of ['remote.js', 'styles.css', 'image.svg']) {
          const matches = result.filter(
            record => record.path === `/static-acceptance/${version}/${file}` && record.status === 200
          );
          assert.ok(matches.length > 0, `Missing observed ${version}/${file}`);
          for (const record of matches) {
            assert.deepEqual(record.request, { cookie: false, authorization: false, csrf: false });
            assert.deepEqual(record.extra, { cookie: false, authorization: false, csrf: false });
            assert.equal(record.allowedOrigin, new URL(page.url()).origin);
            assert.equal(record.allowCredentials, false);
          }
        }
      }
      return result;
    }
  };
}

/** 探针仅替换起始空白文档；目标 Remote/Gateway 响应全部来自真实已启动环境。 */
export async function verifyRemoteIsolation(context, consoleOrigin) {
  const root = new URL(consoleOrigin).hostname.slice('console.'.length);
  const remote = `https://remote.${root}`;
  const api = `https://api.${root}`;
  const cases = [
    [api, `${remote}/static-acceptance/v1/remote.js`, 200],
    ['null', `${remote}/static-acceptance/v1/remote.js`, 200],
    [`https://platform.${root}`, `${remote}/static-acceptance/v1/remote.js`, 200],
    [`https://tenant.${root}`, `${remote}/static-acceptance/v1/remote.js`, 200],
    [`https://evil.${root}`, `${remote}/static-acceptance/v1/remote.js`, 200],
    [remote, `${api}/.well-known/jwks.json`, 403],
    [`https://evil.${root}`, `${api}/.well-known/jwks.json`, 403]
  ];
  const results = [];
  for (const [origin, target, expectedStatus] of cases) {
    const page = await context.newPage();
    try {
      const probe = `${origin === 'null' ? `https://evil.${root}` : origin}/remote-isolation-probe`;
      await page.route(probe, route =>
        route.fulfill({
          headers: origin === 'null' ? { 'Content-Security-Policy': 'sandbox allow-scripts' } : {},
          contentType: 'text/html',
          body: '<!doctype html><title>Origin probe</title>'
        })
      );
      await page.goto(probe);
      const client = await context.newCDPSession(page);
      await client.send('Network.enable');
      let requestId;
      let resolveResponse;
      const observedResponses = new Map();
      const response = new Promise(resolve => {
        resolveResponse = resolve;
      });
      const deliver = () => {
        if (requestId && observedResponses.has(requestId)) resolveResponse(observedResponses.get(requestId));
      };
      client.on('Network.requestWillBeSent', event => {
        if (event.request.url !== target) return;
        requestId = event.requestId;
        deliver();
      });
      client.on('Network.responseReceivedExtraInfo', event => {
        observedResponses.set(event.requestId, {
          status: event.statusCode,
          allowed: Object.keys(event.headers).some(key => key.toLowerCase() === 'access-control-allow-origin')
        });
        deliver();
      });
      const readable = await page.evaluate(async url => {
        try {
          await fetch(url, { credentials: 'omit', redirect: 'error' });
          return true;
        } catch {
          return false;
        }
      }, target);
      let timer;
      const observed = await Promise.race([
        response,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Missing real denial response')), 10000);
        })
      ]).finally(() => clearTimeout(timer));
      assert.equal(readable, false);
      assert.equal(observed.status, expectedStatus);
      assert.equal(observed.allowed, false);
      results.push({ source: origin, target, readable, ...observed });
      await client.detach();
    } finally {
      await page.close();
    }
  }
  return results;
}

/** 网络故障注入单独记录，成功重试使用真实静态响应。 */
export async function verifyRemoteRetry(page) {
  const region = page.getByRole('region', { name: /Remote (消费验收|consumption acceptance)/ });
  const pattern = '**/static-acceptance/v1/styles.css';
  await page.route(pattern, route => route.abort('failed'));
  try {
    await region.getByRole('button', { name: /^(加载|Load) v1$/ }).click();
    await region
      .getByRole('status')
      .filter({ hasText: /v1 (加载失败|failed)/ })
      .waitFor();
    assert.equal(await region.locator('[class^=sf-static-remote-]').count(), 0);
    assert.equal(await page.locator('link[href^="blob:"]').count(), 0);
  } finally {
    await page.unroute(pattern);
  }
  await region.getByRole('button', { name: /^(加载|Load) v1$/ }).click();
  await region
    .getByRole('status')
    .filter({ hasText: /v1 (已就绪|ready)/ })
    .waitFor();
  await page.evaluate(async () => {
    const { consoleRuntime } = await import('/src/runtime/console.ts');
    await consoleRuntime().verify();
  });
  assert.equal(await region.getByText('Remote v1 executed', { exact: true }).count(), 1);
  await region.getByRole('button', { name: /卸载 Remote|Unload Remote/ }).click();
  return { injectedNetworkFailure: true, retryWithRealResources: true, retainedDuringSessionCheck: true };
}
