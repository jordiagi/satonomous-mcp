export interface L402McpConfig {
  apiKey: string;
  apiUrl: string;
}

export interface L402McpOptions {
  apiKey?: string;
  apiUrl?: string;
}

const DEFAULT_API_URL = 'https://l402gw.nosaltres2.info';

export function resolveConfig(options?: Partial<L402McpConfig>): L402McpConfig {
  return {
    apiKey: options?.apiKey ?? process.env['L402_API_KEY'] ?? '',
    apiUrl: options?.apiUrl ?? process.env['L402_API_URL'] ?? DEFAULT_API_URL,
  };
}
