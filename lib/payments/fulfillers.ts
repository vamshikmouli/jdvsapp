// Fulfillment handler registry — the one seam each consuming app plugs into.
//
// An app registers a handler for its `purpose`; it runs exactly once when an order is
// confirmed PAID. This ERP registers "FEES" (→ recordPayment); another app would
// register its own ("SUBSCRIPTION", "INVOICE", …) without touching payment plumbing.
import type { PaymentOrder } from '@prisma/client';

export type Fulfiller = (order: PaymentOrder) => Promise<void>;

const registry = new Map<string, Fulfiller>();

export function registerFulfiller(purpose: string, fn: Fulfiller): void {
  registry.set(purpose, fn);
}

export function getFulfiller(purpose: string): Fulfiller | undefined {
  return registry.get(purpose);
}
