import type { L402McpOptions } from './config.js';

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgumentError';
  }
}

export function shouldShowHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

export function parseCliArgs(args: string[]): L402McpOptions {
  const lnbitsUrlIdx = args.indexOf('--lnbits-url');
  const lnbitsUrl = lnbitsUrlIdx !== -1 ? args[lnbitsUrlIdx + 1] : undefined;
  const lnbitsKeyIdx = args.indexOf('--lnbits-key');
  const lnbitsAdminKey = lnbitsKeyIdx !== -1 ? args[lnbitsKeyIdx + 1] : undefined;
  const gatewayUrlIdx = args.indexOf('--gateway-url');
  const gatewayUrl = gatewayUrlIdx !== -1 ? args[gatewayUrlIdx + 1] : undefined;
  const gatewayKeyIdx = args.indexOf('--gateway-key');
  const gatewayKey = gatewayKeyIdx !== -1 ? args[gatewayKeyIdx + 1] : undefined;

  for (const [flag, index, value] of [
    ['--lnbits-url', lnbitsUrlIdx, lnbitsUrl],
    ['--lnbits-key', lnbitsKeyIdx, lnbitsAdminKey],
    ['--gateway-url', gatewayUrlIdx, gatewayUrl],
    ['--gateway-key', gatewayKeyIdx, gatewayKey],
  ] as const) {
    if (index !== -1 && (value === undefined || value.startsWith('--'))) {
      throw new CliArgumentError(`${flag} requires a value`);
    }
  }

  return { lnbitsUrl, lnbitsAdminKey, gatewayUrl, gatewayKey };
}
