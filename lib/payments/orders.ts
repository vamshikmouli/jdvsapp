// Order lifecycle for the payments core. App-agnostic: knows about providers and the
// PaymentOrder ledger, nothing about fees. Fee-specific behaviour lives in a registered
// fulfiller (see fulfillers.ts / fulfill.ts).
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import type { PaymentOrder } from '@prisma/client';
import { getProvider } from './providers';
import { getFulfiller } from './fulfillers';

/** Short, unique, UPI-safe merchant transaction reference (<= ~30 chars). */
export function genRef(): string {
  const t = Date.now().toString(36).toUpperCase();
  const r = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `JDVS${t}${r}`;
}

export interface CreateOrderInput {
  appId?: string;
  purpose?: string; // default "FEES"
  amount: number; // whole rupees
  providerName?: string | null; // Settings.paymentProvider; falls back to env/PhonePe
  studentId?: string | null;
  yearId?: string | null;
  createdById?: string | null;
  meta?: unknown; // e.g. { allocations:[{chargeId,amount}] }
  note?: string | null;
  expiresInMins?: number; // default 20
}

export interface CreateOrderResult {
  order: PaymentOrder;
  redirectUrl: string | null;
  intentUrl: string | null;
  qrDataUrl: string | null;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const amount = Math.round(Number(input.amount) || 0);
  if (amount <= 0) throw new Error('Amount must be greater than zero');

  const provider = getProvider(input.providerName);
  if (!provider.isConfigured()) throw new Error('Online payments are not configured on the server');

  const ref = genRef();
  const expiresAt = new Date(Date.now() + (input.expiresInMins ?? 20) * 60 * 1000);

  const order = await prisma.paymentOrder.create({
    data: {
      appId: input.appId || 'jdvs-erp',
      purpose: input.purpose || 'FEES',
      amount,
      status: 'CREATED',
      provider: provider.key,
      ref,
      studentId: input.studentId || null,
      yearId: input.yearId || null,
      createdById: input.createdById || null,
      meta: (input.meta as any) ?? undefined,
      expiresAt,
    },
  });

  try {
    const res = await provider.createPayment({
      ref,
      amount,
      userId: input.createdById,
      purpose: order.purpose,
      note: input.note ?? null,
    });
    const updated = await prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: 'PENDING', providerTxnId: res.providerTxnId ?? undefined },
    });
    return {
      order: updated,
      redirectUrl: res.redirectUrl ?? null,
      intentUrl: res.intentUrl ?? null,
      qrDataUrl: res.qrDataUrl ?? null,
    };
  } catch (e) {
    await prisma.paymentOrder
      .update({ where: { id: order.id }, data: { status: 'FAILED', failReason: e instanceof Error ? e.message : 'create failed' } })
      .catch(() => {});
    throw e;
  }
}

export function getOrder(id: string) {
  return prisma.paymentOrder.findUnique({ where: { id } });
}

/**
 * Mark an order PAID and run its fulfiller — exactly once. The conditional updateMany
 * is the idempotency guard: a webhook and a status-poll racing each other both call
 * this, but only the first flips the status and runs fulfillment.
 */
export async function markPaid(
  orderId: string,
  info: { utr?: string | null; providerTxnId?: string | null; providerStatus?: string | null } = {}
): Promise<void> {
  const upd = await prisma.paymentOrder.updateMany({
    where: { id: orderId, status: { notIn: ['PAID'] } },
    data: {
      status: 'PAID',
      utr: info.utr ?? undefined,
      providerTxnId: info.providerTxnId ?? undefined,
      providerStatus: info.providerStatus ?? undefined,
    },
  });
  if (upd.count === 0) return; // already fulfilled by a concurrent caller
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) return;
  const fulfiller = getFulfiller(order.purpose);
  if (!fulfiller) {
    console.error(`[payments] no fulfiller for purpose "${order.purpose}" (order ${order.id})`);
    return;
  }
  // The order is already PAID; if fulfillment throws it stays PAID-without-paymentId and
  // surfaces on the admin monitoring screen for a manual retry. Never rolls the status back.
  await fulfiller(order).catch((e) => console.error('[payments] fulfiller failed', order.id, e));
}

/** Re-check the provider's authoritative status; fulfill on PAID, fail on FAILED. */
export async function syncStatus(orderId: string): Promise<PaymentOrder | null> {
  const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) return null;
  if (order.status === 'PAID' || order.status === 'FAILED') return order;
  const provider = getProvider(order.provider);
  if (!provider.isConfigured()) return order;
  try {
    const st = await provider.fetchStatus(order.ref, order.providerTxnId);
    if (st.status === 'PAID') {
      await markPaid(order.id, { utr: st.utr, providerTxnId: st.providerTxnId, providerStatus: st.status });
    } else if (st.status === 'FAILED') {
      await prisma.paymentOrder.updateMany({
        where: { id: order.id, status: { notIn: ['PAID'] } },
        data: { status: 'FAILED', providerStatus: 'FAILED' },
      });
    }
  } catch (e) {
    console.error('[payments] syncStatus', order.id, e);
  }
  return prisma.paymentOrder.findUnique({ where: { id: orderId } });
}

/**
 * Handle a verified webhook. We never trust the webhook payload alone — we re-check the
 * provider's status API before fulfilling (callbacks can be intermediate or spoofed-shaped).
 */
export async function confirmFromWebhook(w: { ref: string; providerTxnId?: string | null; status: string }): Promise<void> {
  if (!w.ref) return;
  const order = await prisma.paymentOrder.findUnique({ where: { ref: w.ref } });
  if (!order) {
    console.error('[payments] webhook for unknown ref', w.ref);
    return;
  }
  await syncStatus(order.id);
}

/** Admin exception path: force PAID (after the admin confirmed the credit) or reject. */
export async function resolveOrder(
  orderId: string,
  action: 'verify' | 'reject',
  byUserId: string | null,
  reason?: string | null
): Promise<void> {
  if (action === 'verify') {
    await markPaid(orderId, { providerStatus: 'MANUAL' });
    await prisma.paymentOrder.update({ where: { id: orderId }, data: { verifiedById: byUserId, verifiedAt: new Date() } }).catch(() => {});
  } else {
    await prisma.paymentOrder.updateMany({
      where: { id: orderId, status: { notIn: ['PAID'] } },
      data: { status: 'FAILED', failReason: reason || 'Rejected by admin', verifiedById: byUserId, verifiedAt: new Date() },
    });
  }
}

/** Recent + needs-attention list for the admin monitoring screen. */
export function listRecent(limit = 50) {
  return prisma.paymentOrder.findMany({
    where: { appId: 'jdvs-erp', purpose: 'FEES' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { student: { select: { id: true, name: true, class: { select: { name: true } } } } },
  });
}
