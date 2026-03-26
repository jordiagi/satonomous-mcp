export interface L402McpConfig {
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
  gatewayUrl: string;
  gatewayKey?: string;
}

export interface L402McpOptions {
  lnbitsUrl?: string;
  lnbitsAdminKey?: string;
  gatewayUrl?: string;
  gatewayKey?: string;
}

const DEFAULT_GATEWAY_URL = 'https://l402.nosaltres2.info';

function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/\/+$/, '');
}

export function resolveConfig(options: L402McpOptions = {}): L402McpConfig {
  return {
    lnbitsUrl:
      normalizeUrl(options.lnbitsUrl) ??
      normalizeUrl(process.env['LNBITS_URL']),
    lnbitsAdminKey:
      options.lnbitsAdminKey ??
      process.env['LNBITS_ADMIN_KEY'],
    gatewayUrl:
      normalizeUrl(options.gatewayUrl) ??
      normalizeUrl(process.env['L402_GATEWAY_URL']) ??
      DEFAULT_GATEWAY_URL,
    gatewayKey:
      options.gatewayKey ??
      process.env['L402_GATEWAY_KEY'],
  };
}
