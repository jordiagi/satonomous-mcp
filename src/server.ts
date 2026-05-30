import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  L402Agent,
  createWalletPolicy,
  evaluateWalletPolicy,
  verifyContractReceipt,
  verifyServiceCard,
  verifyWalletPolicy,
} from 'satonomous';
import type { ContractReceipt, ServiceCard, WalletPolicy, WalletPolicyContext } from 'satonomous';
import type { L402McpConfig } from './config.js';

type ReputationLevel = 'new' | 'bronze' | 'silver' | 'gold' | 'platinum';

interface OfferSellerReputation {
  score: number;
  level: ReputationLevel;
  completed_contracts: number;
  settled_contracts: number;
  dispute_rate: number;
  total_volume_sats: number;
  unique_counterparties: number;
}

interface McpOffer {
  id: string;
  seller_tenant_id: string;
  title: string;
  description: string | null;
  price_sats: number;
  service_type: string;
  active: number;
  created_at: string;
  seller_reputation?: OfferSellerReputation;
}

interface ListOffersParams {
  service_type?: string;
  min_reputation?: number;
  hide_unrated?: boolean;
  sort?: 'created_at' | 'price' | 'reputation';
  limit?: number;
  offset?: number;
}

interface TenantReputation {
  tenant_id: string;
  seller: {
    score: number;
    level: ReputationLevel;
    summary: {
      settled_contracts: number;
      released_contracts: number;
      dispute_rate: number;
      total_volume_sats: number;
      unique_counterparties: number;
      median_delivery_minutes: number | null;
    };
  };
  buyer: {
    score: number;
    level: ReputationLevel;
    summary: {
      settled_contracts: number;
      funded_contracts: number;
      dispute_rate: number;
      total_volume_sats: number;
      unique_counterparties: number;
    };
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function formatSellerReputation(rep?: OfferSellerReputation): string {
  if (!rep) return 'seller reputation unavailable';
  return [
    `${rep.score}/100 ${rep.level}`,
    `${formatNumber(rep.settled_contracts)} settled`,
    `${formatPercent(rep.dispute_rate)} disputes`,
    `${formatNumber(rep.total_volume_sats)} sats volume`,
  ].join(', ');
}

function formatTenantReputation(rep: TenantReputation): string {
  return [
    `Reputation for ${rep.tenant_id}`,
    '',
    `Seller: ${rep.seller.score}/100 ${rep.seller.level}`,
    `  Settled: ${formatNumber(rep.seller.summary.settled_contracts)}`,
    `  Released: ${formatNumber(rep.seller.summary.released_contracts)}`,
    `  Dispute rate: ${formatPercent(rep.seller.summary.dispute_rate)}`,
    `  Volume: ${formatNumber(rep.seller.summary.total_volume_sats)} sats`,
    `  Counterparties: ${formatNumber(rep.seller.summary.unique_counterparties)}`,
    rep.seller.summary.median_delivery_minutes !== null
      ? `  Median delivery: ${Math.round(rep.seller.summary.median_delivery_minutes)} min`
      : null,
    '',
    `Buyer: ${rep.buyer.score}/100 ${rep.buyer.level}`,
    `  Settled: ${formatNumber(rep.buyer.summary.settled_contracts)}`,
    `  Funded: ${formatNumber(rep.buyer.summary.funded_contracts)}`,
    `  Dispute rate: ${formatPercent(rep.buyer.summary.dispute_rate)}`,
    `  Volume: ${formatNumber(rep.buyer.summary.total_volume_sats)} sats`,
    `  Counterparties: ${formatNumber(rep.buyer.summary.unique_counterparties)}`,
  ].filter(Boolean).join('\n');
}

function formatContractReceipt(receipt: ContractReceipt): string {
  const verification = verifyContractReceipt(receipt);
  return [
    '🧾 ContractReceipt v0',
    `  Receipt ID: ${receipt.receipt_id}`,
    `  Body Hash: ${receipt.body_hash}`,
    `  Contract: ${receipt.contract.id}`,
    `  Outcome: ${receipt.settlement.outcome}`,
    `  Price: ${formatNumber(receipt.contract.price_sats)} sats`,
    `  Buyer: ${receipt.contract.buyer_agent_id}`,
    `  Seller: ${receipt.contract.seller_agent_id}`,
    receipt.delivery_proof.url ? `  Delivery proof: ${receipt.delivery_proof.url}` : null,
    `  Evidence refs: ${formatNumber(receipt.evidence_refs.length)}`,
    `  Verification: ${verification.valid ? 'valid' : verification.codes.join(', ')}`,
    verification.warnings.length ? `  Warnings: ${verification.warnings.join(', ')}` : null,
    '',
    'Raw JSON:',
    JSON.stringify(receipt, null, 2),
  ].filter(Boolean).join('\n');
}

function formatServiceCard(card: ServiceCard): string {
  const verification = verifyServiceCard(card);
  const reputation = card.seller.reputation
    ? `${card.seller.reputation.score}/100 ${card.seller.reputation.level}, ` +
      `${formatNumber(card.seller.reputation.settled_contracts)} settled, ` +
      `${formatPercent(card.seller.reputation.dispute_rate)} disputes`
    : 'unavailable';

  return [
    '🪪 ServiceCard v0',
    `  Card ID: ${card.card_id}`,
    `  Body Hash: ${card.body_hash}`,
    `  Offer: ${card.service.offer_id}`,
    `  Seller: ${card.seller.agent_id}`,
    `  Service: ${card.service.title}`,
    `  Type: ${card.service.service_type}`,
    `  Price: ${formatNumber(card.service.price_sats)} sats`,
    `  SLA: ${card.terms.sla_minutes ?? 'unspecified'} min`,
    `  Reputation: ${reputation}`,
    `  Proof: ${card.terms.proof_requirements.join(', ') || 'unspecified'}`,
    `  Accept: ${card.accept.accept_url}`,
    `  Verification: ${verification.valid ? 'valid' : verification.codes.join(', ')}`,
    verification.warnings.length ? `  Warnings: ${verification.warnings.join(', ')}` : null,
    '',
    'Raw JSON:',
    JSON.stringify(card, null, 2),
  ].filter(Boolean).join('\n');
}

function formatServiceCardList(cards: ServiceCard[]): string {
  return [
    `ServiceCards (${cards.length} total):`,
    ...cards.map((card) => [
      `  ${card.card_id}: ${card.service.title} — ${formatNumber(card.service.price_sats)} sats`,
      `    Offer: ${card.service.offer_id}`,
      `    Seller: ${card.seller.agent_id}`,
      `    Type: ${card.service.service_type}`,
      `    Accept: ${card.accept.accept_url}`,
    ].join('\n')),
    '',
    'Raw JSON:',
    JSON.stringify(cards, null, 2),
  ].join('\n');
}

function formatWalletPolicy(policy: WalletPolicy): string {
  const verification = verifyWalletPolicy(policy);
  return [
    'WalletPolicy v0',
    `  Policy ID: ${policy.policy_id}`,
    `  Body Hash: ${policy.body_hash}`,
    policy.limits.max_contract_price_sats !== undefined
      ? `  Max price: ${formatNumber(policy.limits.max_contract_price_sats)} sats`
      : null,
    policy.limits.max_contract_total_sats !== undefined
      ? `  Max total: ${formatNumber(policy.limits.max_contract_total_sats)} sats`
      : null,
    policy.limits.daily_spend_limit_sats !== undefined
      ? `  Daily limit: ${formatNumber(policy.limits.daily_spend_limit_sats)} sats`
      : null,
    policy.approvals.ask_human_above_sats !== undefined
      ? `  Ask human above: ${formatNumber(policy.approvals.ask_human_above_sats)} sats`
      : null,
    `  Verification: ${verification.valid ? 'valid' : verification.codes.join(', ')}`,
    '',
    'Raw JSON:',
    JSON.stringify(policy, null, 2),
  ].filter(Boolean).join('\n');
}

function parseWalletPolicy(policyJson?: string): WalletPolicy | null {
  if (!policyJson) return null;
  return JSON.parse(policyJson) as WalletPolicy;
}

function buildWalletPolicy(args: {
  policy_json?: string;
  max_contract_price_sats?: number;
  max_contract_total_sats?: number;
  daily_spend_limit_sats?: number;
  max_spend_per_counterparty_sats?: number;
  min_seller_reputation?: number;
  ask_human_above_sats?: number;
  ask_human_for_unrated_counterparty?: boolean;
  allowed_service_types?: string[];
  denied_service_types?: string[];
  allowed_counterparties?: string[];
  denied_counterparties?: string[];
}): WalletPolicy {
  const parsed = parseWalletPolicy(args.policy_json);
  if (parsed) return parsed;
  return createWalletPolicy({
    limits: {
      max_contract_price_sats: args.max_contract_price_sats,
      max_contract_total_sats: args.max_contract_total_sats,
      daily_spend_limit_sats: args.daily_spend_limit_sats,
      max_spend_per_counterparty_sats: args.max_spend_per_counterparty_sats,
      min_seller_reputation: args.min_seller_reputation,
    },
    approvals: {
      ask_human_above_sats: args.ask_human_above_sats,
      ask_human_for_unrated_counterparty: args.ask_human_for_unrated_counterparty,
    },
    allowlists: {
      service_types: args.allowed_service_types,
      counterparties: args.allowed_counterparties,
    },
    denylists: {
      service_types: args.denied_service_types,
      counterparties: args.denied_counterparties,
    },
  });
}

function buildQuery(params?: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query.append(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export async function createServer(config: L402McpConfig): Promise<McpServer> {
  function getAgent(): L402Agent {
    if (!config.apiKey) {
      throw new Error(
        'L402_API_KEY not configured. First call l402_register, then add the returned API key to your MCP client config and restart this server.'
      );
    }

    return new L402Agent({
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
    });
  }

  async function gatewayRequest<T>(path: string, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) {
      if (!config.apiKey) {
        throw new Error(
          'L402_API_KEY not configured. First call l402_register, then add the returned API key to your MCP client config and restart this server.'
        );
      }
      headers['X-L402-Key'] = config.apiKey;
    }

    const res = await fetch(`${config.apiUrl}${path}`, { method: 'GET', headers });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const data = await res.json() as { error?: string };
        message = data.error || message;
      } catch {
        // Keep HTTP fallback.
      }
      throw new Error(message);
    }

    return res.json() as Promise<T>;
  }

  async function listGatewayOffers(filters: ListOffersParams, mine: boolean): Promise<McpOffer[]> {
    const result = await gatewayRequest<{ offers: McpOffer[] }>(
      `/api/v1/offers${buildQuery(filters)}`,
      mine
    );
    return result.offers || [];
  }

  async function getGatewayReputation(tenantId?: string): Promise<TenantReputation> {
    const id = tenantId ?? (await gatewayRequest<{ tenant_id: string }>('/api/v1/tenants/me')).tenant_id;
    return gatewayRequest<TenantReputation>(`/api/v1/reputation/${encodeURIComponent(id)}`);
  }

  const server = new McpServer({
    name: 'satonomous-mcp',
    version: '0.2.6',
  });

  // ── l402_register ───────────────────────────────────────────────────────────
  server.tool(
    'l402_register',
    'Register a new agent on the L402 Gateway to start trading services and escrow contracts.',
    {
      name: z.string().describe('Display name for this agent'),
      description: z.string().optional().describe('Description of what this agent does'),
      wallet_type: z
        .enum(['custodial', 'external'])
        .optional()
        .default('custodial')
        .describe('Type of wallet'),
      lightning_address: z.string().optional().describe('Your Lightning address'),
    },
    async ({ name, description, wallet_type, lightning_address }) => {
      try {
        const reg = await L402Agent.register({
          name,
          description,
          wallet_type,
          lightning_address,
          apiUrl: config.apiUrl,
        });
        const text = [
          '✅ Registered on L402 Gateway',
          `  Tenant ID: ${reg.tenant_id}`,
          `  Name: ${reg.name}`,
          `  API Key: ${reg.api_key}`,
          `  Balance: ${formatNumber(reg.balance_sats)} sats`,
          '',
          'Next: add this API key as L402_API_KEY in your MCP client config and restart the MCP server.',
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_balance ────────────────────────────────────────────────────────────
  server.tool('l402_balance', 'Check your current balance on the L402 Gateway.', async () => {
    try {
      const info = await getAgent().getBalance();
      const text = `💰 Balance: ${formatNumber(info.balance_sats)} sats`;
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
    }
  });

  // ── l402_deposit ────────────────────────────────────────────────────────────
  server.tool(
    'l402_deposit',
    'Create a Lightning invoice to deposit sats into your L402 account. ' +
    'IMPORTANT: AI agents cannot pay Lightning invoices — you MUST forward ' +
    'the invoice to a human for payment. Show them the invoice string and ' +
    'amount, then use l402_check_deposit to poll until paid.',
    {
      amount_sats: z.number().int().positive().describe('Amount in satoshis'),
      reason: z.string().optional().describe('Why you need this deposit (shown to the human)'),
    },
    async ({ amount_sats, reason }) => {
      try {
        const invoice = await getAgent().createDeposit(amount_sats);
        const text = [
          '⚡ PAYMENT NEEDED — Forward this to a human!',
          '',
          `  Amount: ${formatNumber(invoice.amount_sats)} sats`,
          reason ? `  Reason: ${reason}` : null,
          '',
          `📱 Tap to pay: lightning:${invoice.invoice}`,
          '',
          `Or paste into any Lightning wallet:`,
          invoice.invoice,
          '',
          `  Payment Hash: ${invoice.payment_hash}`,
          '',
          '👉 You (the AI agent) cannot pay this invoice.',
          '   Send the above to your human operator.',
          '   Then call l402_check_deposit with the payment_hash to confirm.',
        ].filter(Boolean).join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_check_deposit ──────────────────────────────────────────────────────
  server.tool(
    'l402_check_deposit',
    'Check if a deposit invoice has been paid.',
    {
      paymentHash: z.string().describe('Payment hash from the invoice'),
    },
    async ({ paymentHash }) => {
      try {
        const status = await getAgent().checkDeposit(paymentHash);
        const text = [
          `📋 Deposit Status: ${status.status}`,
          `  Amount: ${formatNumber(status.amount_sats)} sats`,
          status.paid_at ? `  Paid at: ${status.paid_at}` : '  Not yet paid',
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_withdraw ───────────────────────────────────────────────────────────
  server.tool(
    'l402_withdraw',
    'Create an LNURL-withdraw to send sats from your L402 balance to your Lightning wallet.',
    {
      amount_sats: z.number().int().positive().optional().describe('Amount in satoshis (optional)'),
    },
    async ({ amount_sats }) => {
      try {
        const result = await getAgent().withdraw(amount_sats);
        const text = [
          '💸 Withdrawal Created',
          `  Amount: ${formatNumber(result.amount_sats)} sats`,
          `  Remaining balance: ${formatNumber(result.balance_sats)} sats`,
          `  LNURL: ${result.lnurl}`,
          `  K1: ${result.k1}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_create_offer ───────────────────────────────────────────────────────
  server.tool(
    'l402_create_offer',
    'Publish a service offer for other agents to accept and purchase.',
    {
      title: z.string().describe('Title of the offer'),
      description: z.string().optional().describe('Description of the service'),
      price_sats: z.number().int().positive().describe('Price in satoshis'),
      service_type: z.string().describe('Type of service (e.g., "analysis", "review", "consulting")'),
      sla_minutes: z
        .number()
        .int()
        .positive()
        .optional()
        .default(30)
        .describe('Service level agreement - minutes until delivery required'),
      dispute_window_minutes: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1440)
        .describe('Dispute window - minutes buyer has to dispute after delivery'),
    },
    async ({ title, description, price_sats, service_type, sla_minutes, dispute_window_minutes }) => {
      try {
        const offer = await getAgent().createOffer({
          title,
          description,
          price_sats,
          service_type,
          sla_minutes,
          dispute_window_minutes,
        });
        const text = [
          '✅ Offer Created',
          `  ID: ${offer.id}`,
          `  Title: ${offer.title}`,
          `  Price: ${formatNumber(offer.price_sats)} sats`,
          `  Service Type: ${offer.service_type}`,
          `  Created: ${offer.created_at}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_list_offers ────────────────────────────────────────────────────────
  server.tool(
    'l402_list_offers',
    'Browse marketplace offers with optional reputation filters. Set mine=true to list your own offers.',
    {
      service_type: z.string().optional().describe('Filter by service type'),
      min_reputation: z.number().min(0).max(100).optional().describe('Minimum seller reputation score'),
      hide_unrated: z.boolean().optional().default(false).describe('Hide sellers with fewer than 3 settled contracts'),
      sort: z.enum(['created_at', 'price', 'reputation']).optional().default('created_at').describe('Offer sort order'),
      limit: z.number().int().positive().max(100).optional().default(20).describe('Number of offers'),
      offset: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
      mine: z.boolean().optional().default(false).describe('List offers created by this agent instead of public marketplace offers'),
    },
    async ({ service_type, min_reputation, hide_unrated, sort, limit, offset, mine }) => {
      try {
        const filters: ListOffersParams = {
          service_type,
          min_reputation,
          hide_unrated,
          sort,
          limit,
          offset,
        };
        const offers = await listGatewayOffers(filters, mine);
      if (offers.length === 0) {
        return { content: [{ type: 'text', text: mine ? 'No offers created yet.' : 'No marketplace offers found.' }] };
      }
      const text = [
        `${mine ? 'Your Offers' : 'Marketplace Offers'} (${offers.length} total):`,
        ...offers.map(
          (o) => [
            `  ${o.id}: ${o.title} — ${formatNumber(o.price_sats)} sats`,
            `    Seller: ${o.seller_tenant_id}`,
            `    Reputation: ${formatSellerReputation(o.seller_reputation)}`,
          ].join('\n')
        ),
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
    }
    }
  );

  // ── l402_get_offer ──────────────────────────────────────────────────────────
  server.tool(
    'l402_get_offer',
    'Get details of a specific offer.',
    {
      offerId: z.string().describe('Offer ID'),
    },
    async ({ offerId }) => {
      try {
        const offer = await getAgent().getOffer(offerId) as McpOffer;
        const text = [
          '📋 Offer Details',
          `  ID: ${offer.id}`,
          `  Seller: ${offer.seller_tenant_id}`,
          `  Title: ${offer.title}`,
          offer.description ? `  Description: ${offer.description}` : '',
          `  Price: ${formatNumber(offer.price_sats)} sats`,
          `  Service Type: ${offer.service_type}`,
          `  Seller Reputation: ${formatSellerReputation(offer.seller_reputation)}`,
          `  Active: ${offer.active ? 'yes' : 'no'}`,
          `  Created: ${offer.created_at}`,
        ]
          .filter(Boolean)
          .join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_get_service_card ──────────────────────────────────────────────────
  server.tool(
    'l402_get_service_card',
    'Generate a portable ServiceCard v0 for an offer. Returns compact text plus raw JSON.',
    {
      offerId: z.string().describe('Offer ID'),
    },
    async ({ offerId }) => {
      try {
        const card = await getAgent().getServiceCard(offerId);
        return { content: [{ type: 'text', text: formatServiceCard(card) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_list_service_cards ────────────────────────────────────────────────
  server.tool(
    'l402_list_service_cards',
    'Browse marketplace offers as portable ServiceCard v0 discovery objects.',
    {
      service_type: z.string().optional().describe('Filter by service type'),
      min_reputation: z.number().min(0).max(100).optional().describe('Minimum seller reputation score'),
      hide_unrated: z.boolean().optional().default(false).describe('Hide sellers with fewer than 3 settled contracts'),
      sort: z.enum(['created_at', 'price', 'reputation']).optional().default('created_at').describe('Offer sort order'),
      limit: z.number().int().positive().max(50).optional().default(10).describe('Number of service cards'),
      offset: z.number().int().min(0).optional().default(0).describe('Pagination offset'),
    },
    async ({ service_type, min_reputation, hide_unrated, sort, limit, offset }) => {
      try {
        const cards = await getAgent().browseServiceCards({
          service_type,
          min_reputation,
          hide_unrated,
          sort,
          limit,
          offset,
        });
        if (cards.length === 0) {
          return { content: [{ type: 'text', text: 'No marketplace service cards found.' }] };
        }
        return { content: [{ type: 'text', text: formatServiceCardList(cards) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_create_wallet_policy ──────────────────────────────────────────────
  server.tool(
    'l402_create_wallet_policy',
    'Create a local WalletPolicy v0 JSON object with spend limits, allowlists, denylists, and ask-human thresholds.',
    {
      max_contract_price_sats: z.number().int().nonnegative().optional().describe('Maximum contract price in sats'),
      max_contract_total_sats: z.number().int().nonnegative().optional().describe('Maximum price + fee in sats'),
      daily_spend_limit_sats: z.number().int().nonnegative().optional().describe('Maximum spend per day in sats'),
      max_spend_per_counterparty_sats: z.number().int().nonnegative().optional().describe('Maximum spend per counterparty in sats'),
      min_seller_reputation: z.number().min(0).max(100).optional().describe('Minimum seller reputation score'),
      ask_human_above_sats: z.number().int().nonnegative().optional().describe('Ask a human above this spend amount'),
      ask_human_for_unrated_counterparty: z.boolean().optional().default(true).describe('Ask a human when seller reputation is unavailable'),
      allowed_service_types: z.array(z.string()).optional().describe('Only allow these service types'),
      denied_service_types: z.array(z.string()).optional().describe('Block these service types'),
      allowed_counterparties: z.array(z.string()).optional().describe('Only allow these seller tenant IDs'),
      denied_counterparties: z.array(z.string()).optional().describe('Block these seller tenant IDs'),
    },
    async (args) => {
      try {
        const policy = buildWalletPolicy(args);
        return { content: [{ type: 'text', text: formatWalletPolicy(policy) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_evaluate_wallet_policy ────────────────────────────────────────────
  server.tool(
    'l402_evaluate_wallet_policy',
    'Evaluate WalletPolicy v0 against either a contract ID or a proposed spend. Returns allow, deny, or ask_human.',
    {
      policy_json: z.string().optional().describe('Existing WalletPolicy JSON. If omitted, limit fields create one inline.'),
      contractId: z.string().optional().describe('Contract ID to evaluate'),
      amount_sats: z.number().int().positive().optional().describe('Spend amount in sats when contractId is omitted'),
      price_sats: z.number().int().positive().optional().describe('Contract price in sats when contractId is omitted'),
      fee_sats: z.number().int().nonnegative().optional().describe('Contract fee in sats when contractId is omitted'),
      counterparty_tenant_id: z.string().optional().describe('Seller/counterparty tenant ID when contractId is omitted'),
      service_type: z.string().optional().describe('Service type when contractId is omitted'),
      daily_spent_sats: z.number().int().nonnegative().optional().describe('Already spent today in sats'),
      counterparty_spent_sats: z.number().int().nonnegative().optional().describe('Already spent with this counterparty in sats'),
      seller_reputation_score: z.number().min(0).max(100).optional().describe('Seller reputation score'),
      max_contract_price_sats: z.number().int().nonnegative().optional(),
      max_contract_total_sats: z.number().int().nonnegative().optional(),
      daily_spend_limit_sats: z.number().int().nonnegative().optional(),
      max_spend_per_counterparty_sats: z.number().int().nonnegative().optional(),
      min_seller_reputation: z.number().min(0).max(100).optional(),
      ask_human_above_sats: z.number().int().nonnegative().optional(),
      ask_human_for_unrated_counterparty: z.boolean().optional().default(true),
      allowed_service_types: z.array(z.string()).optional(),
      denied_service_types: z.array(z.string()).optional(),
      allowed_counterparties: z.array(z.string()).optional(),
      denied_counterparties: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const policy = buildWalletPolicy(args);
        let request = {
          amount_sats: args.amount_sats ?? ((args.price_sats ?? 0) + (args.fee_sats ?? 0)),
          price_sats: args.price_sats,
          fee_sats: args.fee_sats,
          counterparty_tenant_id: args.counterparty_tenant_id,
          service_type: args.service_type,
        };
        let context: WalletPolicyContext = {
          daily_spent_sats: args.daily_spent_sats,
          counterparty_spent_sats: args.counterparty_spent_sats,
          seller_reputation_score: args.seller_reputation_score,
        };

        if (args.contractId) {
          const contract = await getAgent().getContract(args.contractId);
          const terms = contract.terms_snapshot && typeof contract.terms_snapshot === 'object'
            ? contract.terms_snapshot
            : {};
          request = {
            amount_sats: contract.price_sats + contract.fee_sats,
            price_sats: contract.price_sats,
            fee_sats: contract.fee_sats,
            counterparty_tenant_id: contract.seller_tenant_id,
            service_type: typeof terms.service_type === 'string' ? terms.service_type : undefined,
          };
          if (context.seller_reputation_score === undefined) {
            try {
              context = {
                ...context,
                seller_reputation_score: (await getAgent().getReputation(contract.seller_tenant_id)).seller.score,
              };
            } catch {
              // Unavailable reputation is meaningful to WalletPolicy.
            }
          }
        }

        if (!request.amount_sats || request.amount_sats <= 0) {
          throw new Error('amount_sats is required when contractId is omitted');
        }

        const decision = evaluateWalletPolicy(policy, request, context);
        const text = [
          `WalletPolicy decision: ${decision.decision}`,
          `  Policy: ${decision.policy_id}`,
          `  Amount: ${formatNumber(decision.amount_sats)} sats`,
          `  Codes: ${decision.codes.join(', ')}`,
          decision.reasons.length ? `  Reasons: ${decision.reasons.join('; ')}` : null,
          '',
          'Raw JSON:',
          JSON.stringify({ policy, request, context, decision }, null, 2),
        ].filter(Boolean).join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_fund_contract_with_policy ─────────────────────────────────────────
  server.tool(
    'l402_fund_contract_with_policy',
    'Fund a contract only if WalletPolicy v0 allows it. If decision is ask_human, pass human_approved=true after approval.',
    {
      contractId: z.string().describe('Contract ID to fund'),
      human_approved: z.boolean().optional().default(false).describe('Set true only after a human approved an ask_human decision'),
      policy_json: z.string().optional().describe('Existing WalletPolicy JSON. If omitted, limit fields create one inline.'),
      daily_spent_sats: z.number().int().nonnegative().optional(),
      counterparty_spent_sats: z.number().int().nonnegative().optional(),
      seller_reputation_score: z.number().min(0).max(100).optional(),
      max_contract_price_sats: z.number().int().nonnegative().optional(),
      max_contract_total_sats: z.number().int().nonnegative().optional(),
      daily_spend_limit_sats: z.number().int().nonnegative().optional(),
      max_spend_per_counterparty_sats: z.number().int().nonnegative().optional(),
      min_seller_reputation: z.number().min(0).max(100).optional(),
      ask_human_above_sats: z.number().int().nonnegative().optional(),
      ask_human_for_unrated_counterparty: z.boolean().optional().default(true),
      allowed_service_types: z.array(z.string()).optional(),
      denied_service_types: z.array(z.string()).optional(),
      allowed_counterparties: z.array(z.string()).optional(),
      denied_counterparties: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const policy = buildWalletPolicy(args);
        const result = await getAgent().fundContract(args.contractId, {
          policy,
          humanApproved: args.human_approved,
          context: {
            daily_spent_sats: args.daily_spent_sats,
            counterparty_spent_sats: args.counterparty_spent_sats,
            seller_reputation_score: args.seller_reputation_score,
          },
        });
        const text = [
          'Contract funded under WalletPolicy',
          `  Contract ID: ${result.contract.id}`,
          `  Status: ${result.contract.status}`,
          `  Price: ${formatNumber(result.contract.price_sats)} sats`,
          `  Message: ${result.message}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_get_reputation ────────────────────────────────────────────────────
  server.tool(
    'l402_get_reputation',
    'Get seller and buyer reputation for this agent or another tenant.',
    {
      tenantId: z.string().optional().describe('Tenant ID. Omit to fetch this agent reputation.'),
    },
    async ({ tenantId }) => {
      try {
        const reputation = await getGatewayReputation(tenantId);
        return { content: [{ type: 'text', text: formatTenantReputation(reputation) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_accept_offer ───────────────────────────────────────────────────────
  server.tool(
    'l402_accept_offer',
    'Accept an offer to create a contract. You become the buyer.',
    {
      offerId: z.string().describe('Offer ID to accept'),
    },
    async ({ offerId }) => {
      try {
        const contract = await getAgent().acceptOffer(offerId);
        const text = [
          '✅ Contract Created',
          `  Contract ID: ${contract.id}`,
          `  Offer ID: ${contract.offer_id}`,
          `  Status: ${contract.status}`,
          `  Price: ${formatNumber(contract.price_sats)} sats`,
          `  Fee: ${formatNumber(contract.fee_sats)} sats`,
          `  Created: ${contract.created_at}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_fund_contract ──────────────────────────────────────────────────────
  server.tool(
    'l402_fund_contract',
    'Fund a contract from your balance. Debits your account and puts funds in escrow.',
    {
      contractId: z.string().describe('Contract ID to fund'),
    },
    async ({ contractId }) => {
      try {
        const result = await getAgent().fundContract(contractId);
        const text = [
          '💰 Contract Funded',
          `  Contract ID: ${result.contract.id}`,
          `  Status: ${result.contract.status}`,
          `  Price: ${formatNumber(result.contract.price_sats)} sats`,
          `  Message: ${result.message}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_list_contracts ────────────────────────────────────────────────────
  server.tool(
    'l402_list_contracts',
    'List your contracts.',
    {
      role: z
        .enum(['buyer', 'seller'])
        .optional()
        .describe('Filter by your role'),
      status: z.string().optional().describe('Filter by status (e.g., "funded", "completed")'),
    },
    async ({ role, status }) => {
      try {
        const contracts = await getAgent().listContracts({ role, status });
        if (contracts.length === 0) {
          return { content: [{ type: 'text', text: 'No contracts found.' }] };
        }
        const text = [
          `📋 Contracts (${contracts.length} total):`,
          ...contracts.map(
            (c) =>
              `  ${c.id}: ${c.status} — ${formatNumber(c.price_sats)} sats`
          ),
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_get_contract ───────────────────────────────────────────────────────
  server.tool(
    'l402_get_contract',
    'Get full details of a contract.',
    {
      contractId: z.string().describe('Contract ID'),
    },
    async ({ contractId }) => {
      try {
        const contract = await getAgent().getContract(contractId);
        const text = [
          '📋 Contract Details',
          `  ID: ${contract.id}`,
          `  Offer ID: ${contract.offer_id}`,
          `  Buyer: ${contract.buyer_tenant_id}`,
          `  Seller: ${contract.seller_tenant_id}`,
          `  Status: ${contract.status}`,
          `  Price: ${formatNumber(contract.price_sats)} sats`,
          `  Fee: ${formatNumber(contract.fee_sats)} sats`,
          `  Created: ${contract.created_at}`,
          contract.accepted_at ? `  Accepted: ${contract.accepted_at}` : '',
          contract.funded_at ? `  Funded: ${contract.funded_at}` : '',
          contract.completed_at ? `  Completed: ${contract.completed_at}` : '',
          contract.released_at ? `  Released: ${contract.released_at}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_get_contract_receipt ──────────────────────────────────────────────
  server.tool(
    'l402_get_contract_receipt',
    'Generate a portable ContractReceipt v0 for a terminal contract. Returns compact text plus raw JSON.',
    {
      contractId: z.string().describe('Contract ID'),
    },
    async ({ contractId }) => {
      try {
        const receipt = await getAgent().getContractReceipt(contractId);
        return { content: [{ type: 'text', text: formatContractReceipt(receipt) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_deliver ────────────────────────────────────────────────────────────
  server.tool(
    'l402_deliver',
    'Submit delivery proof to complete the contract. Call as the seller.',
    {
      contractId: z.string().describe('Contract ID'),
      proofUrl: z.string().url().describe('URL to your delivery proof'),
      proofData: z.record(z.string(), z.unknown()).optional().describe('Additional proof data as JSON'),
    },
    async ({ contractId, proofUrl, proofData }) => {
      try {
        const contract = await getAgent().submitDelivery(contractId, proofUrl, proofData);
        const text = [
          '✅ Delivery Submitted',
          `  Contract ID: ${contract.id}`,
          `  Status: ${contract.status}`,
          `  Proof URL: ${proofUrl}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_confirm ────────────────────────────────────────────────────────────
  server.tool(
    'l402_confirm',
    'Confirm delivery and release funds to the seller. Call as the buyer.',
    {
      contractId: z.string().describe('Contract ID'),
    },
    async ({ contractId }) => {
      try {
        const contract = await getAgent().confirmDelivery(contractId);
        const text = [
          '✅ Delivery Confirmed',
          `  Contract ID: ${contract.id}`,
          `  Status: ${contract.status}`,
          `  Funds released to seller`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_dispute ────────────────────────────────────────────────────────────
  server.tool(
    'l402_dispute',
    'Dispute a delivery if you are not satisfied. Call as the buyer.',
    {
      contractId: z.string().describe('Contract ID'),
      reason: z.string().describe('Reason for dispute'),
      evidenceUrl: z.string().url().optional().describe('URL to evidence file'),
    },
    async ({ contractId, reason, evidenceUrl }) => {
      try {
        const contract = await getAgent().disputeDelivery(contractId, reason, evidenceUrl);
        const text = [
          '⚠️ Dispute Opened',
          `  Contract ID: ${contract.id}`,
          `  Status: ${contract.status}`,
          `  Reason: ${reason}`,
        ].join('\n');
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
      }
    }
  );

  // ── l402_ledger ─────────────────────────────────────────────────────────────
  server.tool(
    'l402_ledger',
    'View your transaction ledger.',
    {
      limit: z.number().int().positive().optional().default(50).describe('Number of entries'),
      offset: z.number().int().optional().default(0).describe('Offset for pagination'),
    },
    async ({ limit, offset }) => {
      try {
        const { balance_sats, entries } = await getAgent().getLedger(limit, offset);
        if (entries.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `📊 Ledger\n  Current balance: ${formatNumber(balance_sats)} sats\n  No entries`,
              },
            ],
          };
        }
        const text = [
          `📊 Ledger — Balance: ${formatNumber(balance_sats)} sats`,
          ...entries.map(
            (e) =>
              `  ${e.type === 'credit' ? '➕' : '➖'} ${formatNumber(e.amount_sats)} — ${e.source} @ ${e.created_at}`
          ),
        ].join('\n');
        return { content: [{ type: 'text', text }] };
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
  console.error('[satonomous-mcp] Server running on stdio');
}
