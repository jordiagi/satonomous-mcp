export { createServer, runServer } from './server.js';
export { resolveConfig } from './config.js';
export { CliArgumentError, parseCliArgs, shouldShowHelp } from './cli.js';
export type { L402McpConfig, L402McpOptions } from './config.js';

import { resolveConfig } from './config.js';
import { runServer } from './server.js';
import type { L402McpOptions } from './config.js';

/**
 * Start the L402 MCP server with stdio transport.
 * This is the main entry point used by the CLI.
 */
export async function startServer(options: L402McpOptions = {}): Promise<void> {
  const config = resolveConfig(options);
  await runServer(config);
}
