import { startServer } from './index.js';

export class CliArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgumentError';
  }
}

export function parseCliArgs(): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value || true;
    }
  }
  return args;
}

export function shouldShowHelp(): boolean {
  const args = parseCliArgs();
  return args.help === true || args.h === true;
}

function showHelp(): void {
  console.error(`
l402-mcp - MCP server for L402 Gateway

Usage:
  l402-mcp [OPTIONS]

Options:
  --api-key <key>     L402 API key (or set L402_API_KEY env var)
  --api-url <url>     L402 Gateway URL (default: https://l402gw.nosaltres2.info)
  --help, -h          Show this help message

Environment Variables:
  L402_API_KEY        Your L402 API key (required)
  L402_API_URL        L402 Gateway URL (optional)

Example:
  L402_API_KEY=sk_... l402-mcp
  l402-mcp --api-key=sk_... --api-url=https://custom.com
`);
}

async function run(): Promise<void> {
  if (shouldShowHelp()) {
    showHelp();
    process.exit(0);
  }

  const args = parseCliArgs();
  const options = {
    apiKey: (args['api-key'] as string) || undefined,
    apiUrl: (args['api-url'] as string) || undefined,
  };

  await startServer(options);
}

export { run };

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
