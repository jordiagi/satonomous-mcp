import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig } from '../config.js';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses provided options', () => {
    const config = resolveConfig({
      apiKey: 'test-key',
      apiUrl: 'https://test.example.com',
    });
    expect(config.apiKey).toBe('test-key');
    expect(config.apiUrl).toBe('https://test.example.com');
  });

  it('uses environment variables', () => {
    process.env['L402_API_KEY'] = 'env-key';
    process.env['L402_API_URL'] = 'https://env.example.com';
    const config = resolveConfig();
    expect(config.apiKey).toBe('env-key');
    expect(config.apiUrl).toBe('https://env.example.com');
  });

  it('uses default API URL', () => {
    const config = resolveConfig({ apiKey: 'test-key' });
    expect(config.apiUrl).toBe('https://l402gw.nosaltres2.info');
  });

  it('prioritizes options over environment variables', () => {
    process.env['L402_API_KEY'] = 'env-key';
    const config = resolveConfig({ apiKey: 'option-key' });
    expect(config.apiKey).toBe('option-key');
  });
});
