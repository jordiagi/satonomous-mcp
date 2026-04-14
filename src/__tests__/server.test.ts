import { describe, it, expect } from 'vitest';
import { createServer } from '../server.js';

describe('server', () => {
  it('requires apiKey in config', async () => {
    await expect(
      createServer({ apiKey: '', apiUrl: 'https://test.example.com' })
    ).rejects.toThrow('L402_API_KEY not configured');
  });

  it('creates server with valid config', async () => {
    const server = await createServer({
      apiKey: 'test-key',
      apiUrl: 'https://l402gw.nosaltres2.info',
    });
    expect(server).toBeDefined();
  });
});
