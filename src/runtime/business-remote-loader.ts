import type { Component } from 'vue';
import type { EnabledRemoteManifest } from '@crane199709/saas-forge-api-client';

export class BusinessRemoteFailure extends Error {
  constructor(readonly code: 'REMOTE_DECLARATION_INVALID' | 'REMOTE_UI_INCOMPATIBLE' | 'REMOTE_LOAD_FAILED') {
    super(code);
  }
}

/** 只接受正式启用投影；下载前复验部署来源，执行前复验统一 UI 与入口摘要。 */
export function businessRemoteSource(
  consoleOrigin: string,
  manifest: EnabledRemoteManifest,
  uiVersion: string
): string {
  const console = new URL(consoleOrigin);
  if (
    console.protocol !== 'https:' ||
    console.origin !== consoleOrigin ||
    console.port ||
    !console.hostname.startsWith('console.') ||
    !/^project$/.test(manifest.module) ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(manifest.version) ||
    !/^[0-9a-f]{64}$/.test(manifest.entrySha256)
  )
    throw new BusinessRemoteFailure('REMOTE_DECLARATION_INVALID');
  if (manifest.uiVersion !== uiVersion) throw new BusinessRemoteFailure('REMOTE_UI_INCOMPATIBLE');
  const source = `https://remote.${console.hostname.slice('console.'.length)}/${manifest.module}/${manifest.version}/remote.js`;
  if (manifest.source !== source) throw new BusinessRemoteFailure('REMOTE_DECLARATION_INVALID');
  return source;
}

export async function loadBusinessRemote(
  manifest: EnabledRemoteManifest,
  options: {
    consoleOrigin: string;
    uiVersion: string;
    dependencies: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }
): Promise<{ component: Component; dispose(): void }> {
  const { consoleOrigin, uiVersion, dependencies, signal } = options;
  const source = businessRemoteSource(consoleOrigin, manifest, uiVersion);
  let objectUrl: string | undefined;
  const dispose = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };
  try {
    const response = await fetch(source, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10000)])
    });
    const mime = response.headers.get('Content-Type')?.split(';')[0].trim();
    if (!response.ok || !['text/javascript', 'application/javascript'].includes(mime ?? ''))
      throw new Error('Remote response invalid');
    const bytes = await boundedEntry(response);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== manifest.entrySha256) throw new Error('Remote entry digest mismatch');
    signal.throwIfAborted();
    objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
    const entry = (await import(/* @vite-ignore */ objectUrl)) as {
      createComponent(dependencies: Readonly<Record<string, unknown>>): Component;
    };
    signal.throwIfAborted();
    if (typeof entry.createComponent !== 'function') throw new Error('Remote entry invalid');
    const component = entry.createComponent(dependencies);
    if (!component || !['object', 'function'].includes(typeof component)) throw new Error('Remote component invalid');
    return { component, dispose };
  } catch {
    dispose();
    throw new BusinessRemoteFailure('REMOTE_LOAD_FAILED');
  }
}

async function boundedEntry(response: Response): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Remote entry missing');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // 字节流按顺序读取并在上限处停止，避免先缓冲一个无界脚本。
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1024 * 1024) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        throw new Error('Remote entry too large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
