#!/usr/bin/env node
import { CliArgumentError, parseCliArgs, shouldShowHelp, startServer } from '../dist/index.js';

const args = process.argv.slice(2);

if (shouldShowHelp(args)) {
  console.log(`
l402-mcp — MCP server for L402 services

Usage:
  l402-mcp [options]

Options:
  --lnbits-url <url>      LNbits base URL
  --lnbits-key <key>      LNbits admin API key
  --gateway-url <url>     L402 gateway URL (default: https://l402.nosaltres2.info)
  --gateway-key <key>     L402 gateway API key
  --help, -h              Show this help message

Environment variables:
  LNBITS_URL              LNbits base URL
  LNBITS_ADMIN_KEY        LNbits admin API key
  L402_GATEWAY_URL        L402 gateway URL
  L402_GATEWAY_KEY        L402 gateway API key

Example (Claude Desktop):
  {
    "mcpServers": {
      "l402": {
        "command": "npx",
        "args": ["-y", "l402-mcp", "--gateway-key", "l402_sk_..."]
      }
    }
  }
`);
  process.exit(0);
}

try {
  await startServer(parseCliArgs(args));
} catch (error) {
  if (error instanceof CliArgumentError) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
