import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { L402McpConfig } from './config.js';
import { getBalance, payInvoice } from './lnbits.js';
import {
  buildAuthorizationHeader,
  decodeMacaroon,
  parseBolt11Amount,
  parseChallengeHeader,
} from './l402.js';

type RequestHeaders = Record<string, string>;

interface ResponseBody {
  text: string;
  json?: unknown;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function limitText(text: string, limit = 1600): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function safeJsonParse(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readResponseBody(response: Response): Promise<ResponseBody> {
  const text = await response.text();
  return {
    text,
    json: text ? safeJsonParse(text) : undefined,
  };
}

function formatBody(body: ResponseBody): string {
  if (body.json !== undefined) {
    return limitText(JSON.stringify(body.json, null, 2) ?? String(body.json));
  }

  if (!body.text) return '(empty)';
  return limitText(body.text);
}

function ensureLNbitsConfig(config: L402McpConfig): { lnbitsUrl: string; lnbitsAdminKey: string } {
  if (!config.lnbitsUrl) {
    throw new Error('Missing LNbits URL. Set --lnbits-url or LNBITS_URL.');
  }
  if (!config.lnbitsAdminKey) {
    throw new Error('Missing LNbits admin key. Set --lnbits-key or LNBITS_ADMIN_KEY.');
  }
  return {
    lnbitsUrl: config.lnbitsUrl,
    lnbitsAdminKey: config.lnbitsAdminKey,
  };
}

function ensureGatewayKey(config: L402McpConfig): string {
  if (!config.gatewayKey) {
    throw new Error('Missing gateway key. Set --gateway-key or L402_GATEWAY_KEY.');
  }
  return config.gatewayKey;
}

function ensureObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractChallenge(header: string | null, body: ResponseBody) {
  const parsedHeader = header ? parseChallengeHeader(header) : null;
  const json = ensureObject(body.json);

  const macaroon = parsedHeader?.macaroon ?? pickString(json, 'macaroon');
  const invoice = parsedHeader?.invoice ?? pickString(json, 'payment_request') ?? pickString(json, 'invoice');

  if (!macaroon || !invoice) {
    throw new Error('Could not extract macaroon and invoice from the 402 response');
  }

  return {
    scheme: parsedHeader?.scheme ?? 'L402',
    macaroon,
    invoice,
    params: parsedHeader?.params ?? {},
    raw: parsedHeader?.raw ?? '',
    body: json,
  };
}

function extractPriceSats(body: Record<string, unknown> | undefined, invoice: string): number | null {
  const direct = pickNumber(body, 'amount_sats')
    ?? pickNumber(body, 'price_sats')
    ?? pickNumber(body, 'total_sats');

  if (typeof direct === 'number') return direct;
  return parseBolt11Amount(invoice);
}

function serializeRequestBody(body: unknown, headers: Headers, method: string): string | undefined {
  if (body === undefined) return undefined;

  if (method === 'GET' || method === 'HEAD') {
    throw new Error(`${method} requests cannot include a body`);
  }

  if (typeof body === 'string') return body;

  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return JSON.stringify(body);
}

function buildRequestInit(method: string, body: unknown, headerRecord?: RequestHeaders): RequestInit {
  const headers = new Headers(headerRecord ?? {});
  const normalizedMethod = method.toUpperCase();

  return {
    method: normalizedMethod,
    headers,
    body: serializeRequestBody(body, headers, normalizedMethod),
  };
}

async function gatewayRequest(
  config: L402McpConfig,
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; body: ResponseBody }> {
  const gatewayKey = ensureGatewayKey(config);
  const headers = new Headers(init.headers ?? {});
  headers.set('X-L402-Key', gatewayKey);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${config.gatewayUrl}${path}`, {
    ...init,
    headers,
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(`Gateway request failed (${response.status}): ${formatBody(body)}`);
  }

  return { response, body };
}

function formatMacaroonLines(macaroon: string): string[] {
  const decoded = decodeMacaroon(macaroon);
  const lines = [
    `  Format: ${decoded.format}`,
    `  Identifier: ${decoded.identifier ?? '(not found)'}`,
  ];

  if (decoded.signature) {
    lines.push(`  Signature: ${decoded.signature}`);
  }

  if (decoded.caveats.length > 0) {
    lines.push('  Caveats:');
    decoded.caveats.forEach((caveat) => lines.push(`    - ${caveat}`));
  } else {
    lines.push('  Caveats: none found');
  }

  return lines;
}

export async function createServer(config: L402McpConfig): Promise<McpServer> {
  const server = new McpServer({
    name: 'l402-mcp',
    version: '1.0.0',
  });

  // ── l402_request ────────────────────────────────────────────────────────────
  server.tool(
    'l402_request',
    'Run the full L402 flow: request a URL, detect the 402 challenge, pay the invoice via LNbits, retry with Authorization, and return the unlocked response.',
    {
      url: z.string().url().describe('The L402-protected URL to request'),
      method: z.string().optional().default('GET').describe('HTTP method to use (default: GET)'),
      body: z.unknown().optional().describe('Optional request body for non-GET requests'),
      headers: z.record(z.string(), z.string()).optional().describe('Optional request headers'),
    },
    async ({ url, method, body, headers }) => {
      try {
        const lnbitsConfig = ensureLNbitsConfig(config);
        const firstResponse = await fetch(url, buildRequestInit(method, body, headers));
        const firstBody = await readResponseBody(firstResponse);

        if (firstResponse.status !== 402) {
          const text = [
            '⚡ L402 Request',
            '  No 402 challenge was returned.',
            `  URL: ${url}`,
            `  Status: ${firstResponse.status} ${firstResponse.statusText}`,
            `  Body: ${formatBody(firstBody)}`,
          ].join('\n');
          return { content: [{ type: 'text', text }] };
        }

        const challenge = extractChallenge(firstResponse.headers.get('WWW-Authenticate'), firstBody);
        const payment = await payInvoice(lnbitsConfig, challenge.invoice);
        const retryHeaders = { ...(headers ?? {}), Authorization: buildAuthorizationHeader(challenge.macaroon, payment.preimage) };
        const retryResponse = await fetch(url, buildRequestInit(method, body, retryHeaders));
        const retryBody = await readResponseBody(retryResponse);

        if (!retryResponse.ok) {
          throw new Error(`L402 retry failed (${retryResponse.status}): ${formatBody(retryBody)}`);
        }

        const priceSats = extractPriceSats(challenge.body, challenge.invoice);
        const lines = [
          '⚡ L402 Request Complete',
          `  URL: ${url}`,
          `  Initial status: ${firstResponse.status} ${firstResponse.statusText}`,
          `  Challenge scheme: ${challenge.scheme}`,
          `  Invoice amount: ${priceSats !== null ? `${formatNumber(priceSats)} sats` : 'unknown'}`,
          `  LNbits payment hash: ${payment.paymentHash ?? '(not returned)'}`,
          `  Retry status: ${retryResponse.status} ${retryResponse.statusText}`,
          '',
          '🔐 Macaroon',
          ...formatMacaroonLines(challenge.macaroon),
          '',
          '📦 Response',
          `  Body: ${formatBody(retryBody)}`,
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_inspect ────────────────────────────────────────────────────────────
  server.tool(
    'l402_inspect',
    'Decode an L402 macaroon and show its identifier and caveats.',
    {
      macaroon: z.string().describe('The macaroon string to inspect'),
    },
    async ({ macaroon }) => {
      try {
        const text = [
          '🔐 L402 Macaroon',
          ...formatMacaroonLines(macaroon),
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_check ──────────────────────────────────────────────────────────────
  server.tool(
    'l402_check',
    'Probe a URL to see whether it is L402-protected, and report the invoice price and macaroon caveats when present.',
    {
      url: z.string().url().describe('The URL to probe'),
    },
    async ({ url }) => {
      try {
        const response = await fetch(url);
        const body = await readResponseBody(response);

        if (response.status !== 402) {
          const text = [
            '🔎 L402 Check',
            `  URL: ${url}`,
            `  Protected: no`,
            `  Status: ${response.status} ${response.statusText}`,
            `  Body: ${formatBody(body)}`,
          ].join('\n');
          return { content: [{ type: 'text', text }] };
        }

        const challenge = extractChallenge(response.headers.get('WWW-Authenticate'), body);
        const priceSats = extractPriceSats(challenge.body, challenge.invoice);
        const lines = [
          '🔎 L402 Check',
          `  URL: ${url}`,
          '  Protected: yes',
          `  Challenge scheme: ${challenge.scheme}`,
          `  Price: ${priceSats !== null ? `${formatNumber(priceSats)} sats` : 'unknown'}`,
          '',
          '🔐 Macaroon',
          ...formatMacaroonLines(challenge.macaroon),
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_create_resource ────────────────────────────────────────────────────
  server.tool(
    'l402_create_resource',
    'Create or update a protected resource on the configured L402 gateway.',
    {
      resource_id: z.string().describe('Resource identifier'),
      price_sats: z.number().int().positive().describe('Price in sats'),
      description: z.string().optional().describe('Optional resource description'),
      content_type: z.string().optional().describe('Optional content type'),
      ttl_seconds: z.number().int().positive().optional().describe('Optional resource TTL in seconds'),
    },
    async ({ resource_id, price_sats, description, content_type, ttl_seconds }) => {
      try {
        const payload = {
          resource_id,
          price_sats,
          ...(description ? { description } : {}),
          ...(content_type ? { content_type } : {}),
          ...(ttl_seconds ? { ttl_seconds } : {}),
        };
        const { body } = await gatewayRequest(config, '/api/v1/resources', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const text = [
          '📦 Resource Created',
          `  Resource ID: ${resource_id}`,
          `  Price: ${formatNumber(price_sats)} sats`,
          `  Response: ${formatBody(body)}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_list_resources ────────────────────────────────────────────────────
  server.tool(
    'l402_list_resources',
    'List resources from the configured L402 gateway.',
    async () => {
      try {
        const { body } = await gatewayRequest(config, '/api/v1/resources');
        const text = [
          '📚 Gateway Resources',
          `  Response: ${formatBody(body)}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_delete_resource ───────────────────────────────────────────────────
  server.tool(
    'l402_delete_resource',
    'Delete a resource from the configured L402 gateway.',
    {
      resource_id: z.string().describe('Resource identifier to delete'),
    },
    async ({ resource_id }) => {
      try {
        const { body } = await gatewayRequest(config, `/api/v1/resources/${encodeURIComponent(resource_id)}`, {
          method: 'DELETE',
        });
        const text = [
          '🗑️ Resource Deleted',
          `  Resource ID: ${resource_id}`,
          `  Response: ${formatBody(body)}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_stats ──────────────────────────────────────────────────────────────
  server.tool(
    'l402_stats',
    'Fetch gateway payment and usage statistics from the configured L402 gateway.',
    async () => {
      try {
        const { body } = await gatewayRequest(config, '/api/v1/stats');
        const text = [
          '📊 Gateway Stats',
          `  Response: ${formatBody(body)}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_balance ────────────────────────────────────────────────────────────
  server.tool(
    'l402_balance',
    'Check the configured LNbits wallet balance.',
    async () => {
      try {
        const balance = await getBalance(ensureLNbitsConfig(config));
        const lines = [
          '💰 LNbits Balance',
          `  Balance: ${formatNumber(balance.balanceSats)} sats`,
        ];
        if (balance.name) lines.push(`  Wallet: ${balance.name}`);
        if (balance.id) lines.push(`  Wallet ID: ${balance.id}`);
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  return server;
}

export async function runServer(config: L402McpConfig): Promise<void> {
  const server = await createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}
