export interface LNbitsConfig {
  lnbitsUrl: string;
  lnbitsAdminKey: string;
}

export interface LNbitsPaymentResult {
  paymentHash?: string;
  preimage: string;
  raw: unknown;
}

export interface LNbitsBalance {
  id?: string;
  name?: string;
  balanceSats: number;
  raw: unknown;
}

function lnbitsHeaders(config: LNbitsConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': config.lnbitsAdminKey,
  };
}

function summarizeText(text: string, limit = 300): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

async function readJsonOrThrow(response: Response, prefix: string): Promise<any> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${prefix} (${response.status}): ${summarizeText(text || response.statusText)}`);
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${prefix}: invalid JSON response`);
  }
}

function extractPreimage(data: any): string | undefined {
  const candidates = [
    data?.payment_preimage,
    data?.preimage,
    data?.details?.preimage,
    data?.payment?.preimage,
    data?.data?.preimage,
  ];

  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function extractPaymentHash(data: any): string | undefined {
  const candidates = [
    data?.payment_hash,
    data?.checking_id,
    data?.details?.payment_hash,
    data?.payment?.payment_hash,
    data?.data?.payment_hash,
  ];

  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}

async function getPaymentDetails(config: LNbitsConfig, paymentHash: string): Promise<any> {
  const response = await fetch(`${config.lnbitsUrl}/api/v1/payments/${paymentHash}`, {
    headers: lnbitsHeaders(config),
  });
  return readJsonOrThrow(response, 'LNbits payment lookup failed');
}

export async function payInvoice(config: LNbitsConfig, bolt11: string): Promise<LNbitsPaymentResult> {
  const response = await fetch(`${config.lnbitsUrl}/api/v1/payments`, {
    method: 'POST',
    headers: lnbitsHeaders(config),
    body: JSON.stringify({ out: true, bolt11 }),
  });

  const data = await readJsonOrThrow(response, 'LNbits payment failed');
  let preimage = extractPreimage(data);
  const paymentHash = extractPaymentHash(data);

  if (!preimage && paymentHash) {
    const details = await getPaymentDetails(config, paymentHash);
    preimage = extractPreimage(details);
  }

  if (!preimage) {
    throw new Error('LNbits payment succeeded but no preimage was returned');
  }

  return {
    paymentHash,
    preimage,
    raw: data,
  };
}

export async function getBalance(config: LNbitsConfig): Promise<LNbitsBalance> {
  const response = await fetch(`${config.lnbitsUrl}/api/v1/wallet`, {
    headers: lnbitsHeaders(config),
  });

  const data = await readJsonOrThrow(response, 'LNbits wallet lookup failed');
  const rawBalance = typeof data?.balance === 'number' ? data.balance : 0;

  return {
    id: typeof data?.id === 'string' ? data.id : undefined,
    name: typeof data?.name === 'string' ? data.name : undefined,
    balanceSats: Math.floor(rawBalance / 1000),
    raw: data,
  };
}
