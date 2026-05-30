export interface L402Challenge {
  scheme: string;
  macaroon?: string;
  invoice?: string;
  params: Record<string, string>;
  raw: string;
}

export interface DecodedMacaroon {
  format: 'signed-json' | 'json' | 'packet' | 'unknown';
  identifier: string | null;
  caveats: string[];
  payload?: unknown;
  signature?: string;
  fields?: Array<{ field: string; value: string }>;
}

function normalizeBase64(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padding = normalized.length % 4;
  return padding === 0 ? normalized : normalized + '='.repeat(4 - padding);
}

function decodeBase64(input: string): Buffer {
  return Buffer.from(normalizeBase64(input), 'base64');
}

function tryDecodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? String(value);
}

function pickIdentifierEntry(payload: Record<string, unknown>): { key: string; value: string } | null {
  for (const key of ['identifier', 'tenant_id', 'payment_hash', 'resource_id', 'id']) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return { key, value };
  }
  return null;
}

function decodeJsonMacaroon(
  text: string,
  format: 'signed-json' | 'json',
  signature?: string
): DecodedMacaroon | null {
  const payload = tryParseJson(text);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  const record = payload as Record<string, unknown>;
  const identifierEntry = pickIdentifierEntry(record);
  const caveats = Object.entries(record)
    .filter(([key, value]) => value !== undefined && value !== null && key !== identifierEntry?.key)
    .map(([key, value]) => `${key} = ${stringifyValue(value)}`);

  return {
    format,
    identifier: identifierEntry?.value ?? null,
    caveats,
    payload: record,
    signature,
  };
}

function parsePacketText(text: string): Array<{ field: string; value: string }> | null {
  const packets: Array<{ field: string; value: string }> = [];
  let offset = 0;

  while (offset < text.length) {
    const sizeHex = text.slice(offset, offset + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(sizeHex)) return null;

    const size = parseInt(sizeHex, 16);
    if (!Number.isFinite(size) || size < 6) return null;

    const packet = text.slice(offset, offset + size);
    if (packet.length !== size || !packet.endsWith('\n')) return null;

    const body = packet.slice(4, -1);
    const spaceIndex = body.indexOf(' ');
    if (spaceIndex === -1) return null;

    packets.push({
      field: body.slice(0, spaceIndex),
      value: body.slice(spaceIndex + 1),
    });

    offset += size;
  }

  return packets.length > 0 ? packets : null;
}

export function parseChallengeHeader(header: string): L402Challenge | null {
  const trimmed = header.trim();
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*)\s+(.*)$/);
  if (!match) return null;

  const [, scheme, rest] = match;
  const params: Record<string, string> = {};
  const regex = /([A-Za-z][A-Za-z0-9_-]*)=(?:"((?:\\.|[^"])*)"|([^,]+))/g;

  for (const paramMatch of rest.matchAll(regex)) {
    const key = paramMatch[1];
    const value = (paramMatch[2] ?? paramMatch[3] ?? '').trim().replace(/\\"/g, '"');
    params[key] = value;
  }

  return {
    scheme,
    macaroon: params['macaroon'],
    invoice: params['invoice'],
    params,
    raw: header,
  };
}

export function buildAuthorizationHeader(macaroon: string, preimage: string): string {
  return `L402 ${macaroon}:${preimage}`;
}

export function decodeMacaroon(macaroon: string): DecodedMacaroon {
  const dotIndex = macaroon.lastIndexOf('.');
  if (dotIndex !== -1) {
    const payloadB64 = macaroon.slice(0, dotIndex);
    const signature = macaroon.slice(dotIndex + 1);
    if (/^[0-9a-fA-F]{64}$/.test(signature)) {
      const text = tryDecodeUtf8(decodeBase64(payloadB64));
      if (text) {
        const decoded = decodeJsonMacaroon(text, 'signed-json', signature);
        if (decoded) return decoded;
      }
    }
  }

  const text = tryDecodeUtf8(decodeBase64(macaroon));
  if (!text) {
    return { format: 'unknown', identifier: null, caveats: [] };
  }

  const decodedJson = decodeJsonMacaroon(text, 'json');
  if (decodedJson) return decodedJson;

  const packets = parsePacketText(text);
  if (packets) {
    const identifier = packets.find((packet) => packet.field === 'identifier')?.value ?? null;
    const caveats = packets
      .filter((packet) => packet.field !== 'identifier' && packet.field !== 'location' && packet.field !== 'signature')
      .map((packet) => `${packet.field}: ${packet.value}`);

    return {
      format: 'packet',
      identifier,
      caveats,
      fields: packets,
    };
  }

  return { format: 'unknown', identifier: null, caveats: [] };
}

export function parseBolt11Amount(invoice: string): number | null {
  const match = invoice.toLowerCase().match(/^ln(?:bc|tb|bcrt)(\d+)([munp])?1/);
  if (!match) return null;

  const amount = parseInt(match[1], 10);
  const multiplier = match[2];

  if (!multiplier) {
    return Math.round(amount * 100_000_000);
  }

  const btcMultipliers: Record<string, number> = {
    m: 0.001,
    u: 0.000001,
    n: 0.000000001,
    p: 0.000000000001,
  };

  const btc = amount * (btcMultipliers[multiplier] ?? 1);
  return Math.round(btc * 100_000_000);
}
