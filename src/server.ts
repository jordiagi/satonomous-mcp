import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { L402Agent } from 'satonomous';
import type { L402McpConfig } from './config.js';

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export async function createServer(config: L402McpConfig): Promise<McpServer> {
  if (!config.apiKey) {
    throw new Error(
      'L402_API_KEY not configured. Please set the L402_API_KEY environment variable.'
    );
  }

  const agent = new L402Agent({
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
  });

  const server = new McpServer({
    name: 'l402-mcp',
    version: '0.1.0',
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
      const info = await agent.getBalance();
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
        const invoice = await agent.createDeposit(amount_sats);
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
        const status = await agent.checkDeposit(paymentHash);
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
        const result = await agent.withdraw(amount_sats);
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
        const offer = await agent.createOffer({
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
  server.tool('l402_list_offers', 'List all offers you have created.', async () => {
    try {
      const offers = await agent.listOffers();
      if (offers.length === 0) {
        return { content: [{ type: 'text', text: 'No offers created yet.' }] };
      }
      const text = [
        `📝 Your Offers (${offers.length} total):`,
        ...offers.map(
          (o) => `  ${o.id}: ${o.title} — ${formatNumber(o.price_sats)} sats`
        ),
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `❌ Error: ${msg}` }], isError: true };
    }
  });

  // ── l402_get_offer ──────────────────────────────────────────────────────────
  server.tool(
    'l402_get_offer',
    'Get details of a specific offer.',
    {
      offerId: z.string().describe('Offer ID'),
    },
    async ({ offerId }) => {
      try {
        const offer = await agent.getOffer(offerId);
        const text = [
          '📋 Offer Details',
          `  ID: ${offer.id}`,
          `  Seller: ${offer.seller_tenant_id}`,
          `  Title: ${offer.title}`,
          offer.description ? `  Description: ${offer.description}` : '',
          `  Price: ${formatNumber(offer.price_sats)} sats`,
          `  Service Type: ${offer.service_type}`,
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

  // ── l402_accept_offer ───────────────────────────────────────────────────────
  server.tool(
    'l402_accept_offer',
    'Accept an offer to create a contract. You become the buyer.',
    {
      offerId: z.string().describe('Offer ID to accept'),
    },
    async ({ offerId }) => {
      try {
        const contract = await agent.acceptOffer(offerId);
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
        const result = await agent.fundContract(contractId);
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
        const contracts = await agent.listContracts({ role, status });
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
        const contract = await agent.getContract(contractId);
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
        const contract = await agent.submitDelivery(contractId, proofUrl, proofData);
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
        const contract = await agent.confirmDelivery(contractId);
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
        const contract = await agent.disputeDelivery(contractId, reason, evidenceUrl);
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
        const { balance_sats, entries } = await agent.getLedger(limit, offset);
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
  console.error('[l402-mcp] Server running on stdio');
}
