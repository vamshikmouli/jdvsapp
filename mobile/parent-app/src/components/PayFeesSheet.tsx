import React from 'react';
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';
import { api } from '@/api/client';
import { money } from '@/lib/format';
import { C, G } from '@/theme';

export interface OutstandingItem {
  chargeId: string;
  label: string;
  headName: string;
  balance: number;
}

type Step = 'choose' | 'pay' | 'done' | 'failed';

interface Order {
  id: string;
  amount: number;
  redirectUrl: string | null;
  intentUrl: string | null;
  qrDataUrl: string | null;
}

/**
 * Parent-facing "Pay fees online" flow for the native app. Mirrors the web
 * components/parent/PayFees.tsx: the parent picks the full balance (default) or
 * specific line items, we create an order, bounce them into their UPI app
 * (GPay / PhonePe) via Linking, and poll until the provider confirms. No UTR,
 * no typing — approval happens inside the parent's own UPI app.
 */
export function PayFeesSheet({
  studentId,
  studentName,
  balance,
  outstanding,
  onPaid,
}: {
  studentId: string;
  studentName: string;
  balance: number;
  outstanding: OutstandingItem[];
  onPaid?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>('choose');
  const [mode, setMode] = React.useState<'full' | 'charges'>('full');
  const [picked, setPicked] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<Order | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const pickedIds = Object.keys(picked).filter((k) => picked[k]);
  const pickedTotal = outstanding.filter((o) => picked[o.chargeId]).reduce((t, o) => t + o.balance, 0);
  const payAmount = mode === 'full' ? balance : pickedTotal;

  const stopPoll = React.useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  function reset() {
    setStep('choose'); setMode('full'); setPicked({}); setError(null); setOrder(null); setBusy(false);
    stopPoll();
  }
  function close() { reset(); setOpen(false); }

  React.useEffect(() => () => stopPoll(), [stopPoll]);

  async function start() {
    setError(null);
    if (mode === 'charges' && pickedIds.length === 0) { setError('Select at least one item to pay.'); return; }
    setBusy(true);
    try {
      const d = await api<Order>('/api/payments/orders', {
        method: 'POST',
        body: { studentId, mode, chargeIds: mode === 'charges' ? pickedIds : undefined },
      });
      setOrder({ id: d.id, amount: d.amount, redirectUrl: d.redirectUrl, intentUrl: d.intentUrl, qrDataUrl: d.qrDataUrl });
      setStep('pay');
      // Bounce the parent into their UPI app with the amount pre-filled.
      const url = d.intentUrl || d.redirectUrl;
      if (url) Linking.openURL(url).catch(() => { /* parent can retry from the sheet */ });
      beginPolling(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start payment');
    } finally {
      setBusy(false);
    }
  }

  function beginPolling(id: string) {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const d = await api<{ paid: boolean; failed: boolean }>(`/api/payments/orders/${id}`);
        if (d.paid) {
          stopPoll();
          setStep('done');
          onPaid?.();
        } else if (d.failed) {
          stopPoll();
          setStep('failed');
        }
      } catch { /* transient — keep polling */ }
    }, 4000);
  }

  function openUpiAgain() {
    const url = order?.intentUrl || order?.redirectUrl;
    if (url) Linking.openURL(url).catch(() => {});
  }

  if (balance <= 0) return null;

  return (
    <>
      <Pressable
        onPress={() => { reset(); setOpen(true); }}
        className="mt-5 rounded-2xl items-center justify-center overflow-hidden"
      >
        <LinearGradient colors={G.violetGold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
        <Text className="font-fred text-[15px] text-white" style={{ paddingVertical: 15 }}>💳 Pay {money(balance)} online</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(16,10,40,0.5)' }} onPress={close}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="bg-white rounded-t-3xl"
            style={{ paddingBottom: insets.bottom + 10, maxHeight: '88%' }}
          >
            <View className="flex-row items-center justify-between px-5 pt-4 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: C.line }}>
              <View className="flex-1 pr-2">
                <Text className="font-fred text-[16px]" style={{ color: C.ink }}>Pay fees</Text>
                <Text className="font-jak-s text-[11px]" style={{ color: C.inkMut }}>{studentName}</Text>
              </View>
              <Pressable onPress={close} hitSlop={8} className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: C.appbg }}>
                <X size={16} color={C.inkMut} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
              {step === 'choose' && (
                <>
                  <ModeRow
                    selected={mode === 'full'}
                    onPress={() => setMode('full')}
                    label="Pay full balance"
                    amount={money(balance)}
                  />
                  <View style={{ height: 10 }} />
                  <ModeRow
                    selected={mode === 'charges'}
                    onPress={() => setMode('charges')}
                    label="Choose what to pay"
                  />

                  {mode === 'charges' && (
                    <View className="mt-3 rounded-2xl p-2" style={{ borderWidth: 1, borderColor: C.line }}>
                      {outstanding.length === 0 ? (
                        <Text className="font-jak-s text-[12px] text-center" style={{ color: C.inkMut, paddingVertical: 10 }}>Nothing outstanding.</Text>
                      ) : outstanding.map((o) => {
                        const on = !!picked[o.chargeId];
                        return (
                          <Pressable
                            key={o.chargeId}
                            onPress={() => setPicked((p) => ({ ...p, [o.chargeId]: !on }))}
                            className="flex-row items-center gap-2.5 rounded-xl px-2.5"
                            style={{ paddingVertical: 11 }}
                          >
                            <View
                              className="w-5 h-5 rounded-md items-center justify-center"
                              style={{ backgroundColor: on ? C.violet : '#fff', borderWidth: 1.5, borderColor: on ? C.violet : C.line }}
                            >
                              {on && <Check size={13} color="#fff" strokeWidth={3} />}
                            </View>
                            <Text className="flex-1 font-jak-m text-[13px]" style={{ color: C.inkSoft }} numberOfLines={1}>{o.label}</Text>
                            <Text className="font-jak-b text-[13px]" style={{ color: C.coral }}>{money(o.balance)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  )}

                  {error && <Text className="mt-3 font-jak-s text-[12px]" style={{ color: C.coral }}>{error}</Text>}

                  <Pressable
                    disabled={busy || payAmount <= 0}
                    onPress={start}
                    className="mt-5 rounded-2xl items-center justify-center overflow-hidden"
                    style={{ opacity: busy || payAmount <= 0 ? 0.5 : 1 }}
                  >
                    <LinearGradient colors={G.violetGold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                    {busy ? (
                      <View style={{ paddingVertical: 14 }}><ActivityIndicator color="#fff" /></View>
                    ) : (
                      <Text className="font-fred text-[15px] text-white" style={{ paddingVertical: 14 }}>Pay {money(payAmount)}</Text>
                    )}
                  </Pressable>
                  <Text className="mt-2.5 font-jak-s text-[11px] text-center" style={{ color: C.inkMut }}>
                    You'll approve the payment in your own GPay / PhonePe app.
                  </Text>
                </>
              )}

              {step === 'pay' && order && (
                <View className="items-center" style={{ paddingVertical: 6 }}>
                  <Text className="font-fred text-[30px]" style={{ color: C.ink }}>{money(order.amount)}</Text>
                  <Text className="font-jak-m text-[13px] mt-1 text-center" style={{ color: C.inkMut }}>Approve the payment in your UPI app.</Text>

                  {(order.intentUrl || order.redirectUrl) && (
                    <Pressable onPress={openUpiAgain} className="mt-5 w-full rounded-2xl items-center justify-center overflow-hidden">
                      <LinearGradient colors={G.violetGold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                      <Text className="font-fred text-[15px] text-white" style={{ paddingVertical: 14 }}>Open payment app again</Text>
                    </Pressable>
                  )}

                  <View className="flex-row items-center gap-2 mt-5">
                    <ActivityIndicator color={C.violet} size="small" />
                    <Text className="font-jak-s text-[12px]" style={{ color: C.inkMut }}>Waiting for confirmation…</Text>
                  </View>
                </View>
              )}

              {step === 'done' && (
                <View className="items-center" style={{ paddingVertical: 14 }}>
                  <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: C.grassSoft }}>
                    <Check size={28} color={C.grass} strokeWidth={3} />
                  </View>
                  <Text className="font-fred text-[17px] mt-3" style={{ color: C.ink }}>Payment received</Text>
                  <Text className="font-jak-m text-[13px] mt-1 text-center" style={{ color: C.inkMut }}>Your receipt has been generated. Thank you! 🎉</Text>
                  <Pressable onPress={close} className="mt-5 w-full rounded-2xl items-center justify-center" style={{ backgroundColor: C.ink }}>
                    <Text className="font-fred text-[15px] text-white" style={{ paddingVertical: 14 }}>Done</Text>
                  </Pressable>
                </View>
              )}

              {step === 'failed' && (
                <View className="items-center" style={{ paddingVertical: 14 }}>
                  <View className="w-14 h-14 rounded-full items-center justify-center" style={{ backgroundColor: C.coralSoft }}>
                    <X size={28} color={C.coral} strokeWidth={3} />
                  </View>
                  <Text className="font-fred text-[17px] mt-3" style={{ color: C.ink }}>Payment not completed</Text>
                  <Text className="font-jak-m text-[13px] mt-1 text-center" style={{ color: C.inkMut }}>No money was deducted, or it couldn't be confirmed. Please try again.</Text>
                  <Pressable onPress={reset} className="mt-5 w-full rounded-2xl items-center justify-center overflow-hidden">
                    <LinearGradient colors={G.violetGold} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                    <Text className="font-fred text-[15px] text-white" style={{ paddingVertical: 14 }}>Try again</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function ModeRow({ selected, onPress, label, amount }: { selected: boolean; onPress: () => void; label: string; amount?: string }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-2.5 rounded-2xl px-3.5"
      style={{ paddingVertical: 13, borderWidth: 1.5, borderColor: selected ? C.violet : C.line, backgroundColor: selected ? C.violetSoft : '#fff' }}
    >
      <View className="w-5 h-5 rounded-full items-center justify-center" style={{ borderWidth: 2, borderColor: selected ? C.violet : C.line }}>
        {selected && <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: C.violet }} />}
      </View>
      <Text className="flex-1 font-jak-b text-[13.5px]" style={{ color: C.ink }}>{label}</Text>
      {amount != null && <Text className="font-fred text-[14px]" style={{ color: C.ink }}>{amount}</Text>}
    </Pressable>
  );
}
