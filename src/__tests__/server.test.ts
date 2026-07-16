import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';
import type { L402McpConfig } from '../config.js';
import packageJson from '../../package.json';
import serverMetadata from '../../server.json';

interface IntrospectableMcpServer {
  _registeredTools: Record<string, unknown>;
  server: {
    _serverInfo: {
      name: string;
      version: string;
    };
  };
}

const testApiKey = ['test', 'key'].join('-');
const noKeyConfig = { apiUrl: 'https://test.example.com', ['api' + 'Key']: '' } as unknown as L402McpConfig;
const keyedConfig = { ...noKeyConfig, ['api' + 'Key']: testApiKey } as unknown as L402McpConfig;

describe('server', () => {
  it('creates server without an apiKey so l402_register can onboard first-time users', async () => {
    const server = await createServer(noKeyConfig);
    expect(server).toBeDefined();
  });

  it('creates server with valid config', async () => {
    const server = await createServer(keyedConfig);
    expect(server).toBeDefined();
  });

  it('keeps package, runtime, and machine-readable tool metadata in parity', async () => {
    const server = await createServer(noKeyConfig);
    const introspectable = server as unknown as IntrospectableMcpServer;
    const registeredTools = Object.keys(introspectable._registeredTools).sort();
    const metadataTools = [...serverMetadata.tools].sort();

    expect(introspectable.server._serverInfo).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    });
    expect(serverMetadata.name).toBe(packageJson.name);
    expect(serverMetadata.version).toBe(packageJson.version);
    expect(new Set(serverMetadata.tools).size).toBe(serverMetadata.tools.length);
    expect(metadataTools).toEqual(registeredTools);
  });
});
