/**
 * Stripe [H] — money truth; invoice/overdue scans (SPEC §4.3). Connected via
 * Stripe Connect OAuth with the platform-level `read_only` scope (C8 holds at
 * the provider). The 'invoice.nudge' capability drafts reminder text in the
 * runtime — it sends through the user's email connector, not Stripe, so this
 * client is read-only end to end.
 */
import { HttpConnectorClient } from './base';
import type { Connection } from '../types';
import type { TokenVault } from '../vault';
import type { UnsafeTestOverrides } from '../egress/safe-fetch';

const BASE = 'https://api.stripe.com';

export interface StripeInvoice {
  id: string;
  status?: string;
  created: number;
  due_date?: number | null;
  amount_due?: number;
  amount_paid?: number;
  customer?: string;
  status_transitions?: { finalized_at?: number | null; paid_at?: number | null };
}

interface StripeList<T> {
  data: T[];
  has_more: boolean;
}

export class StripeConnectorClient extends HttpConnectorClient {
  constructor(connection: Connection, vault: TokenVault, unsafeTestOverrides?: UnsafeTestOverrides) {
    super(connection, BASE, vault, unsafeTestOverrides);
  }

  /** Invoices created in the window (epoch seconds), newest first. */
  async listInvoices(createdGteSecs: number, startingAfter?: string): Promise<StripeList<StripeInvoice>> {
    const params = new URLSearchParams({ 'created[gte]': String(createdGteSecs), limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const { data } = await this.readJson<StripeList<StripeInvoice>>(`/v1/invoices?${params}`);
    return data;
  }

  /** Charges in the window — fee-leakage scans read balance transactions. */
  async listCharges(createdGteSecs: number, startingAfter?: string): Promise<StripeList<{ id: string; amount: number; created: number; customer?: string }>> {
    const params = new URLSearchParams({ 'created[gte]': String(createdGteSecs), limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const { data } = await this.readJson<StripeList<{ id: string; amount: number; created: number; customer?: string }>>(
      `/v1/charges?${params}`,
    );
    return data;
  }

  async listBalanceTransactions(createdGteSecs: number): Promise<StripeList<{ id: string; fee: number; amount: number; created: number }>> {
    const params = new URLSearchParams({ 'created[gte]': String(createdGteSecs), limit: '100' });
    const { data } = await this.readJson<StripeList<{ id: string; fee: number; amount: number; created: number }>>(
      `/v1/balance_transactions?${params}`,
    );
    return data;
  }
}
