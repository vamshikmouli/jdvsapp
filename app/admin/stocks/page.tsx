'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Card, EmptyState, Skeleton, Field, Input } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { jsonFetcher } from '@/lib/query';
import { toast } from '@/lib/toast';

type Gender = 'M' | 'F' | 'ANY';
const GENDER_LABEL: Record<Gender, string> = { M: 'Boys', F: 'Girls', ANY: 'All' };

interface StockRow {
  itemKey: string; itemName: string; classId: string; className: string;
  gender: Gender; price: number | null; qty: number; lowThreshold: number; low: boolean; negative: boolean;
}
interface Overview { year: { id: string; label: string }; rows: StockRow[]; matrixConfigured: boolean; deductionEnabled: boolean }

interface Analytics {
  totalOnHand: number; skuCount: number; lowCount: number; negativeCount: number;
  health: { ok: number; low: number; out: number };
  byItem: { itemKey: string; itemName: string; onHand: number; sold: number; ok: number; low: number; out: number }[];
  lowStock: StockRow[];
  sold: { itemKey: string; itemName: string; className: string; gender: Gender; units: number }[];
  soldTotal: number; from: string; to: string;
}

const qtyClass = (r: { negative: boolean; low: boolean }) =>
  r.negative ? 'text-danger-700 font-bold' : r.low ? 'text-marigold-700 font-semibold' : 'text-slate-900';

export default function StocksPage() {
  const { canAny, isLoading: permLoading } = usePermissions();
  const canManage = canAny(['STOCK_MANAGE', 'SETTINGS_MANAGE']);
  const [tab, setTab] = useState<'stock' | 'analytics'>('stock');

  return (
    <>
      <PageHeader eyebrow="Inventory" title="Stocks" meta="Uniform stock levels and analytics." />

      <div className="flex items-center gap-1 mt-6 border-b border-slate-200">
        {([['stock', 'Stock', 'Boxes'], ['analytics', 'Analytics', 'BarChart3']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            <Icon name={icon as any} size={16} />{label}
          </button>
        ))}
      </div>

      {!permLoading && tab === 'stock' && <StockTab canManage={canManage} />}
      {!permLoading && tab === 'analytics' && <AnalyticsTab />}
    </>
  );
}

// Compact one-line deduction gate + toggle.
function GateBar({ enabled, canManage, onToggle }: { enabled: boolean; canManage: boolean; onToggle: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/stocks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deductionEnabled: !enabled }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Failed');
      onToggle(!!d.deductionEnabled);
      toast.success(`Auto-deduction turned ${d.deductionEnabled ? 'ON' : 'OFF'}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] ${enabled ? 'bg-success-50 border-success-100' : 'bg-slate-50 border-slate-200'}`}>
      <Icon name={enabled ? 'CheckCircle2' : 'PauseCircle'} size={16} className={enabled ? 'text-success-600' : 'text-slate-400'} />
      <span className="text-slate-700">Receipt auto-deduction <b>{enabled ? 'ON' : 'OFF'}</b></span>
      <span className="text-slate-400 hidden sm:inline">· {enabled ? 'receipts deduct stock' : 'set counts first, then turn on'}</span>
      {canManage && <button onClick={flip} disabled={busy} className="ml-auto text-purple-600 hover:text-purple-700 font-medium disabled:opacity-50">{busy ? '…' : enabled ? 'Turn off' : 'Turn on'}</button>}
    </div>
  );
}

interface Col { itemKey: string; itemName: string; gender: Gender; label: string; sub: string }

const SHORT: Record<string, string> = {
  school: 'School', white: 'White', tshirt: 'T-Shirt', wed: 'Wed', tie: 'Tie', bow: 'Bow',
  belt: 'Belt', socks_white: 'W.Socks', socks_blue: 'Blue.Socks', socks_maroon: 'M.Socks', socks_purple: 'P.Socks',
};

function StockTab({ canManage }: { canManage: boolean }) {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['stocks', 'overview'], queryFn: () => jsonFetcher<Overview>('/api/stocks') });
  const [mode, setMode] = useState<'qty' | 'lowThreshold'>('qty'); // edit counts vs reorder points
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Build the matrix: item columns (gendered items get a Boys + Girls column),
  // class rows, and a cell lookup — the whole inventory in one compact table.
  const { cols, classes, cellMap } = useMemo(() => {
    const rows = data?.rows || [];
    const itemOrder: string[] = [], itemGendered = new Map<string, boolean>(), itemName = new Map<string, string>();
    const classOrder: string[] = [], className = new Map<string, string>();
    const cellMap = new Map<string, StockRow>();
    for (const r of rows) {
      if (!itemName.has(r.itemKey)) { itemName.set(r.itemKey, r.itemName); itemGendered.set(r.itemKey, false); itemOrder.push(r.itemKey); }
      if (r.gender !== 'ANY') itemGendered.set(r.itemKey, true);
      if (!className.has(r.classId)) { className.set(r.classId, r.className); classOrder.push(r.classId); }
      cellMap.set(`${r.itemKey}|${r.classId}|${r.gender}`, r);
    }
    const cols: Col[] = [];
    for (const k of itemOrder) {
      const name = SHORT[k] || itemName.get(k) || k;
      if (itemGendered.get(k)) {
        cols.push({ itemKey: k, itemName: name, gender: 'M', label: name, sub: 'B' });
        cols.push({ itemKey: k, itemName: name, gender: 'F', label: name, sub: 'G' });
      } else {
        cols.push({ itemKey: k, itemName: name, gender: 'ANY', label: name, sub: '' });
      }
    }
    return { cols, classes: classOrder.map((id) => ({ id, name: className.get(id) || id })), cellMap };
  }, [data]);

  if (isLoading) return <div className="mt-6 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={56} />)}</div>;
  if (!data) return <div className="mt-6"><Card><EmptyState icon="AlertCircle" title="Couldn't load stock" body="Please try again." /></Card></div>;
  if (!data.matrixConfigured) return (
    <div className="mt-6 space-y-3">
      <GateBar enabled={data.deductionEnabled} canManage={canManage} onToggle={() => refetch()} />
      <Card><EmptyState icon="Boxes" title="No uniform items priced yet"
        body="Stock lines come from the uniform prices in Fees → Fee setup. Add uniform prices there first." /></Card>
    </div>
  );

  // Save one cell (absolute value for the current mode), then refresh.
  const saveCell = async (r: StockRow, raw: string) => {
    const val = Math.max(0, Math.round(Number(raw) || 0));
    const cur = mode === 'qty' ? r.qty : r.lowThreshold;
    if (val === cur) return;
    const key = `${r.itemKey}|${r.classId}|${r.gender}`;
    setSavingKey(key);
    try {
      const res = await fetch('/api/stocks/cell', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemKey: r.itemKey, classId: r.classId, gender: r.gender, [mode]: val }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
      await refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSavingKey(null); }
  };

  const readOnlyCell = (r?: StockRow) => {
    if (!r) return <span className="text-slate-200">·</span>;
    const v = mode === 'qty' ? r.qty : r.lowThreshold;
    return <span className={`tabular-nums ${mode === 'qty' ? qtyClass(r) : 'text-slate-600'}`}>{v}{mode === 'qty' && (r.negative ? '⚠' : r.low ? '•' : '')}</span>;
  };

  return (
    <div className="mt-6 space-y-3">
      <GateBar enabled={data.deductionEnabled} canManage={canManage} onToggle={() => refetch()} />

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {/* Counts vs Reorder points */}
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {(['qty', 'lowThreshold'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 ${mode === m ? 'bg-purple-50 text-purple-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}>
                {m === 'qty' ? 'Counts' : 'Reorder points'}
              </button>
            ))}
          </div>
          <BulkFill cols={cols} onDone={() => refetch()} field={mode} />
        </div>
      )}

      {/* One matrix: classes down, items across. Sticky first column; scroll sideways. */}
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="text-[12.5px] border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium">Class</th>
                {cols.map((c, i) => (
                  <th key={i} className="px-2.5 py-2 font-medium text-right whitespace-nowrap border-l border-slate-50">
                    {c.label}{c.sub && <span className="text-slate-400 font-normal"> {c.sub}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {classes.map((cl) => (
                <tr key={cl.id} className="hover:bg-slate-50/50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-slate-800 whitespace-nowrap font-medium">{cl.name}</td>
                  {cols.map((c, i) => {
                    const r = cellMap.get(`${c.itemKey}|${cl.id}|${c.gender}`);
                    const key = r ? `${r.itemKey}|${r.classId}|${r.gender}` : '';
                    return (
                      <td key={i} className="px-1.5 py-1 text-right border-l border-slate-50">
                        {canManage && r ? (
                          <input
                            key={`${key}-${mode}-${mode === 'qty' ? r.qty : r.lowThreshold}`}
                            type="number" min={0} inputMode="numeric"
                            defaultValue={mode === 'qty' ? r.qty : r.lowThreshold}
                            onFocus={(e) => e.currentTarget.select()}
                            onBlur={(e) => saveCell(r, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                            disabled={savingKey === key}
                            className={`w-12 text-right tabular-nums rounded px-1 py-0.5 outline-none border border-transparent hover:border-slate-200 focus:border-purple-400 focus:ring-2 focus:ring-purple-500/15 ${mode === 'qty' && r.negative ? 'text-danger-700 font-semibold' : ''}`}
                          />
                        ) : readOnlyCell(r)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-slate-400">
        {canManage ? <>Type a {mode === 'qty' ? 'count' : 'reorder point'} and press Enter or click away to save. </> : null}
        B = Boys · G = Girls · <span className="text-marigold-600">•</span> low · <span className="text-danger-600">⚠</span> negative · {data.year.label}.
      </p>
    </div>
  );
}

// Bulk-set a value across every class for one item (fast seeding).
function BulkFill({ cols, field, onDone }: { cols: Col[]; field: 'qty' | 'lowThreshold'; onDone: () => void }) {
  const items = useMemo(() => {
    const seen = new Map<string, { key: string; name: string; gendered: boolean }>();
    for (const c of cols) {
      const e = seen.get(c.itemKey) || { key: c.itemKey, name: c.label, gendered: false };
      if (c.gender !== 'ANY') e.gendered = true;
      seen.set(c.itemKey, e);
    }
    return [...seen.values()];
  }, [cols]);
  const [itemKey, setItemKey] = useState('');
  const [gender, setGender] = useState<'ALL' | 'M' | 'F'>('ALL');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const item = items.find((i) => i.key === itemKey);

  const fill = async () => {
    if (!itemKey || value === '') return;
    setBusy(true);
    try {
      const res = await fetch('/api/stocks/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemKey, gender: item?.gendered ? gender : 'ALL', field, value: Number(value) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Failed');
      toast.success(`Set ${d.updated} ${item?.name || 'item'} line${d.updated === 1 ? '' : 's'} to ${value}.`);
      setValue(''); onDone();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1">
      <span className="text-slate-400">Bulk fill:</span>
      <select value={itemKey} onChange={(e) => setItemKey(e.target.value)} className="rounded border border-slate-200 px-1.5 py-1 text-[12.5px] bg-white">
        <option value="">Item…</option>
        {items.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}
      </select>
      {item?.gendered && (
        <select value={gender} onChange={(e) => setGender(e.target.value as any)} className="rounded border border-slate-200 px-1.5 py-1 text-[12.5px] bg-white">
          <option value="ALL">All</option><option value="M">Boys</option><option value="F">Girls</option>
        </select>
      )}
      <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" className="w-16 rounded border border-slate-200 px-1.5 py-1 text-[12.5px] text-right" />
      <button onClick={fill} disabled={busy || !itemKey || value === ''} className="px-2 py-1 rounded bg-purple-600 text-white text-[12.5px] font-medium disabled:opacity-40">{busy ? '…' : 'Fill'}</button>
    </div>
  );
}

// Traffic-light status palette (design-system status tokens; icon+label, never colour alone).
const STATUS = {
  ok:  { fill: 'bg-success-500',  text: 'text-success-700',  dot: 'bg-success-500',  label: 'In stock', icon: 'CheckCircle2' },
  low: { fill: 'bg-marigold-500', text: 'text-marigold-700', dot: 'bg-marigold-500', label: 'Low',      icon: 'AlertTriangle' },
  out: { fill: 'bg-danger-500',   text: 'text-danger-700',   dot: 'bg-danger-500',   label: 'Out',      icon: 'XCircle' },
} as const;

// Horizontal stacked traffic-light bar. 2px surface gaps between segments (mark spec).
function HealthBar({ ok, low, out, height = 10 }: { ok: number; low: number; out: number; height?: number }) {
  const total = ok + low + out || 1;
  const segs = ([['ok', ok], ['low', low], ['out', out]] as const).filter(([, n]) => n > 0);
  return (
    <div className="flex w-full rounded-full overflow-hidden bg-slate-100 gap-[2px]" style={{ height }} role="img"
      aria-label={`In stock ${ok}, low ${low}, out ${out}`}>
      {segs.map(([k, n]) => (
        <div key={k} className={STATUS[k].fill} style={{ width: `${(n / total) * 100}%` }} title={`${STATUS[k].label}: ${n}`} />
      ))}
    </div>
  );
}

function StatusLegend({ health }: { health: { ok: number; low: number; out: number } }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
      {(['ok', 'low', 'out'] as const).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <Icon name={STATUS[k].icon as any} size={14} className={STATUS[k].text} />
          <span className="text-slate-600">{STATUS[k].label}</span>
          <b className={`tabular-nums ${STATUS[k].text}`}>{health[k]}</b>
        </span>
      ))}
    </div>
  );
}

function AnalyticsTab() {
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const to = new Date();
    const from = new Date(Date.now() - 90 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });
  const { data, isLoading } = useQuery({
    queryKey: ['stocks', 'analytics', range.from, range.to],
    queryFn: () => jsonFetcher<Analytics>(`/api/stocks/analytics?from=${range.from}&to=${range.to}`),
  });

  return (
    <div className="mt-6 space-y-4">
      {isLoading || !data ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={72} />)}</div>
      ) : (
        <>
          {/* Overall stock health — the traffic-light chart. */}
          <Card title="Stock health">
            <div className="space-y-2.5">
              <HealthBar ok={data.health.ok} low={data.health.low} out={data.health.out} height={14} />
              <div className="flex items-center justify-between">
                <StatusLegend health={data.health} />
                <span className="text-[12px] text-slate-400 tabular-nums">{data.skuCount} lines · {data.totalOnHand} on hand</span>
              </div>
            </div>
          </Card>

          {/* Per-item health — a mini traffic-light bar per item. */}
          <Card title="By item" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-4 py-2 font-medium w-[38%]">Health</th>
                    <th className="px-4 py-2 font-medium text-right">On hand</th>
                    <th className="px-4 py-2 font-medium text-right">Sold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {data.byItem.length === 0 ? (
                    <tr><td colSpan={4} className="py-4 text-center text-slate-400">No stock yet.</td></tr>
                  ) : data.byItem.map((it) => (
                    <tr key={it.itemKey}>
                      <td className="px-4 py-2 text-slate-800 whitespace-nowrap">{it.itemName}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <HealthBar ok={it.ok} low={it.low} out={it.out} />
                          <span className="text-[11px] tabular-nums text-slate-400 whitespace-nowrap">
                            {it.out > 0 && <span className="text-danger-600">{it.out} out</span>}
                            {it.out > 0 && it.low > 0 && ' · '}
                            {it.low > 0 && <span className="text-marigold-600">{it.low} low</span>}
                            {it.out === 0 && it.low === 0 && <span className="text-success-600">all in stock</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-900">{it.onHand}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-600">{it.sold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`Needs restock (${data.lowStock.length})`} padded={false}>
            {data.lowStock.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">Nothing low or negative.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.lowStock.map((r) => (
                  <div key={`${r.itemKey}-${r.classId}-${r.gender}`} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700">{r.itemName} · {r.className} · {GENDER_LABEL[r.gender]}</span>
                    <span className={`tabular-nums ${qtyClass(r)}`}>{r.qty}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Units sold" action={
            <div className="flex items-center gap-2">
              <Field label=""><Input type="date" value={range.from} onChange={(e) => setRange((s) => ({ ...s, from: e.target.value }))} className="w-36" /></Field>
              <span className="text-slate-400 text-xs">to</span>
              <Field label=""><Input type="date" value={range.to} onChange={(e) => setRange((s) => ({ ...s, to: e.target.value }))} className="w-36" /></Field>
            </div>
          } padded={false}>
            {data.sold.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">No uniforms deducted in this range{' '}
                <span className="text-slate-400">(auto-deduction shows here once it's turned on and receipts are generated).</span>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {data.sold.map((s) => (
                  <div key={`${s.itemKey}-${s.className}-${s.gender}`} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-700">{s.itemName} · {s.className} · {GENDER_LABEL[s.gender]}</span>
                    <span className="tabular-nums text-slate-900">{s.units}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
