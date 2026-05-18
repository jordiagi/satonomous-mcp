import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';

describe('server', () => {
  it('creates server without an apiKey so l402_register can onboard first-time users', async () => {
    const server = await createServer({ apiKey: '', apiUrl: 'https://test.example.com' });
    expect(server).toBeDefined();
  });

  it('creates server with valid config', async () => {
    const server = await createServer({
      apiKey: 'test-key',
      apiUrl: 'https://l402gw.nosaltres2.info',
    });
    expect(server).toBeDefined();
  });
});
