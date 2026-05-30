import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export { CliArgumentError, parseCliArgs, shouldShowHelp } from './cli.js';

interface L402McpConfig {
    apiKey: string;
    apiUrl: string;
}
interface L402McpOptions {
    apiKey?: string;
    apiUrl?: string;
}
declare function resolveConfig(options?: Partial<L402McpConfig>): L402McpConfig;

declare function createServer(config: L402McpConfig): Promise<McpServer>;
declare function runServer(config: L402McpConfig): Promise<void>;

/**
 * Start the L402 MCP server with stdio transport.
 * This is the main entry point used by the CLI.
 */
declare function startServer(options?: L402McpOptions): Promise<void>;

export { type L402McpConfig, type L402McpOptions, createServer, resolveConfig, runServer, startServer };
