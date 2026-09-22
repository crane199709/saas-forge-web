import type { Console } from '@crane199709/saas-forge-api-client';

export interface ConsoleBrand {
  displayName: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
}

/** 保持既有 /brands/ 匿名受控素材边界；禁止外域、重定向和路径逃逸。 */
export function controlledBrandAsset(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/brands/') || /[%\\\s?#]/.test(value)) return false;
  const url = new URL(value, 'https://brand.invalid');
  return url.origin === 'https://brand.invalid' && url.pathname.startsWith('/brands/') && url.pathname.length > 8;
}

function readableColor(value: unknown): value is string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return false;
  const rgb = [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = rgb.map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return 1.05 / (luminance + 0.05) >= 4.5;
}

export function validBrand(profile: Console.ConsoleTenantBrand): boolean {
  return (
    typeof profile.displayName === 'string' &&
    Boolean(profile.displayName.trim()) &&
    profile.displayName.length <= 200 &&
    !Array.from(profile.displayName).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    controlledBrandAsset(profile.logoUrl) &&
    controlledBrandAsset(profile.faviconUrl) &&
    readableColor(profile.primaryColor) &&
    readableColor(profile.accentColor)
  );
}

/** 完整 Profile 和两个素材都通过才应用品牌；任何失败整体回退，不沿用上一公司。 */
export async function resolveConsoleBrand(snapshot: Console.ConsoleSessionSnapshot): Promise<ConsoleBrand | undefined> {
  const profile = snapshot.activeContext?.type === 'TENANT' ? snapshot.activeContext.brand : undefined;
  if (!profile || !validBrand(profile)) return undefined;
  const urls: string[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const assets = await Promise.allSettled(
      [profile.logoUrl!, profile.faviconUrl!].map(async (url, index) => {
        const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: controller.signal });
        const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
        const allowed =
          index === 0
            ? ['image/png', 'image/svg+xml', 'image/webp']
            : ['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
        if (!response.ok || !mime || !allowed.includes(mime)) throw new Error('Invalid brand asset');
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        urls.push(objectUrl);
        const image = new Image();
        image.src = objectUrl;
        await Promise.race([
          image.decode(),
          new Promise<never>((_resolve, reject) => {
            if (controller.signal.aborted) reject(new Error('Brand timeout'));
            else controller.signal.addEventListener('abort', () => reject(new Error('Brand timeout')), { once: true });
          })
        ]);
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Invalid brand image');
        return objectUrl;
      })
    );
    if (assets[0].status !== 'fulfilled' || assets[1].status !== 'fulfilled') throw new Error('Incomplete brand');
    return {
      displayName: profile.displayName,
      logoUrl: assets[0].value,
      faviconUrl: assets[1].value,
      primaryColor: profile.primaryColor,
      accentColor: profile.accentColor
    };
  } catch {
    urls.forEach(url => URL.revokeObjectURL(url));
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function releaseConsoleBrand(brand: ConsoleBrand | undefined) {
  if (!brand) return;
  for (const url of [brand.logoUrl, brand.faviconUrl]) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}
