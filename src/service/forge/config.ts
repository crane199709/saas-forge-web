export class GatewayConfigurationError extends Error {
  constructor() {
    super('GATEWAY_CONFIGURATION_INVALID');
  }
}

export function requireHttpsOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new GatewayConfigurationError();
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new GatewayConfigurationError();
    }
    if (value !== url.origin && value !== `${url.origin}/`) throw new GatewayConfigurationError();
    return url.origin;
  } catch {
    throw new GatewayConfigurationError();
  }
}
