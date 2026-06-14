'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  PageHeader,
  Button,
  Card,
  Chip,
  Modal,
  Drawer,
  Field,
  Input,
  EmptyState,
  Skeleton,
} from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { SURFACE_META } from '@/lib/rbac/permissions';

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  baseSurface: 'ADMIN' | 'TEACHER' | 'ACCOUNTANT' | 'PARENT';
  permissions: string[];
  userCount: number;
}

interface PermissionGroup {
  group: string;
  icon: string;
  permissions: { key: string; label: string; desc: string }[];
}

type Surface = RoleRow['baseSurface'];
const SURFACES: Surface[] = ['ADMIN', 'TEACHER', 'ACCOUNTANT', 'PARENT'];

// Static tailwind accent classes per workspace (kept explicit so Tailwind keeps them)
const ACCENT: Record<Surface, { badge: string; ring: string; chip: string }> = {
  ADMIN: { badge: 'bg-purple-100 text-purple-700', ring: 'ring-purple-500 bg-purple-50', chip: 'bg-purple-50 text-purple-700' },
  TEACHER: { badge: 'bg-blue-100 text-blue-700', ring: 'ring-blue-500 bg-blue-50', chip: 'bg-blue-50 text-blue-700' },
  ACCOUNTANT: { badge: 'bg-green-100 text-green-700', ring: 'ring-green-500 bg-green-50', chip: 'bg-green-50 text-green-700' },
  PARENT: { badge: 'bg-amber-100 text-amber-700', ring: 'ring-amber-500 bg-amber-50', chip: 'bg-amber-50 text-amber-700' },
};

const emptyForm = {
  name: '',
  description: '',
  baseSurface: 'TEACHER' as Surface,
  permissions: [] as string[],
};

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [catalog, setCatalog] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rRes, pRes] = await Promise.all([fetch('/api/roles'), fetch('/api/permissions')]);
      if (!rRes.ok) throw new Error(`Failed to load roles (${rRes.status})`);
      if (!pRes.ok) throw new Error(`Failed to load permissions (${pRes.status})`);
      setRoles(await rRes.json());
      setCatalog(await pRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const totalPerms = catalog.reduce((n, g) => n + g.permissions.length, 0);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (r: RoleRow) => {
    setEditing(r);
    setForm({
      name: r.name,
      description: r.description || '',
      baseSurface: r.baseSurface,
      permissions: [...r.permissions],
    });
    setFormError('');
    setFormOpen(true);
  };

  const togglePerm = (key: string) => {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key)
        ? f.permissions.filter((p) => p !== key)
        : [...f.permissions, key],
    }));
  };

  const toggleGroup = (group: PermissionGroup) => {
    const keys = group.permissions.map((p) => p.key);
    const allOn = keys.every((k) => form.permissions.includes(k));
    setForm((f) => ({
      ...f,
      permissions: allOn
        ? f.permissions.filter((p) => !keys.includes(p))
        : Array.from(new Set([...f.permissions, ...keys])),
    }));
  };

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!form.name.trim()) throw new Error('Role name is required');
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        baseSurface: form.baseSurface,
        permissions: form.permissions,
      };
      const res = await fetch(editing ? `/api/roles/${editing.id}` : '/api/roles', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setFormOpen(false);
      setNotice(
        data.affectedUsers > 0
          ? `Saved. ${data.affectedUsers} signed-in user(s) were logged out so the new permissions apply right away.`
          : 'Role saved.'
      );
      await fetchAll();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const res = await fetch(`/api/roles/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Failed (${res.status})`);
      }
      setDeleting(null);
      setNotice('Role deleted.');
      await fetchAll();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to delete role');
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  };

  const willForceReLogin = editing && editing.userCount > 0;

  // Which permission groups a role touches, e.g. "Students 2/2"
  const coverage = (role: RoleRow) =>
    catalog
      .map((g) => {
        const have = g.permissions.filter((p) => role.permissions.includes(p.key)).length;
        return { group: g.group, have, total: g.permissions.length };
      })
      .filter((c) => c.have > 0);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Roles & access"
        meta="Control what each kind of user can see and do."
        actions={<Button kind="primary" icon="Plus" onClick={openAdd}>Create role</Button>}
      />

      {/* How it works — quick explainer */}
      <Card className="mt-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
              <Icon name="LayoutGrid" size={18} className="text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">1. Workspace</div>
              <p className="text-xs text-slate-500 mt-0.5">Where the person works after signing in — Admin, Teacher, Accountant or Parent.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
              <Icon name="Key" size={18} className="text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">2. Permissions</div>
              <p className="text-xs text-slate-500 mt-0.5">The exact actions they can take — view students, mark attendance, collect fees…</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center flex-shrink-0">
              <Icon name="Users" size={18} className="text-purple-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">3. People</div>
              <p className="text-xs text-slate-500 mt-0.5">Assign a role to staff on the Staff page. Changing a role updates everyone in it.</p>
            </div>
          </div>
        </div>
      </Card>

      {notice && (
        <div className="mt-4 px-4 py-2.5 bg-info-50 text-info-700 rounded-md text-sm flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-info-500 hover:text-info-700">
            <Icon name="X" size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <Skeleton height={18} width="40%" />
              <Skeleton height={14} width="70%" className="mt-2" />
              <Skeleton height={28} width="100%" className="mt-4" />
            </Card>
          ))}

        {!loading && error && (
          <div className="col-span-2">
            <EmptyState icon="AlertCircle" title="Couldn't load roles" body={error} />
          </div>
        )}

        {!loading &&
          !error &&
          roles.map((r) => {
            const meta = SURFACE_META[r.baseSurface];
            const accent = ACCENT[r.baseSurface];
            const cov = coverage(r);
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between">
                  <div className="flex gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${accent.badge}`}>
                      <Icon name={meta.icon as any} size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{r.name}</h3>
                        {r.isSystem ? <Chip tone="neutral">Built-in</Chip> : <Chip tone="info">Custom</Chip>}
                        {!r.isActive && <Chip tone="warn">Inactive</Chip>}
                      </div>
                      <p className="text-sm text-slate-500 mt-0.5">{r.description || 'No description'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(r)}
                      className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100"
                      title="Edit role"
                    >
                      <Icon name="Pencil" size={16} />
                    </button>
                    {!r.isSystem && (
                      <button
                        onClick={() => setDeleting(r)}
                        className="text-slate-400 hover:text-danger-600 p-1.5 rounded-md hover:bg-slate-100"
                        title="Delete role"
                      >
                        <Icon name="Trash2" size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Workspace */}
                <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-500">
                  <Icon name={meta.icon as any} size={13} />
                  Works in <span className="font-medium text-slate-700">{meta.label}</span>
                </div>

                {/* What they can do */}
                <div className="mt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Can access</div>
                  {cov.length === 0 ? (
                    <p className="text-xs text-slate-400">No permissions yet</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {cov.map((c) => (
                        <span key={c.group} className={`text-xs px-2 py-0.5 rounded-full ${accent.chip}`}>
                          {c.group} <span className="opacity-60">{c.have}/{c.total}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="Users" size={13} /> {r.userCount} {r.userCount === 1 ? 'person' : 'people'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="Key" size={13} /> {r.permissions.length} of {totalPerms} permissions
                  </span>
                </div>
              </Card>
            );
          })}
      </div>

      {/* Create / Edit drawer */}
      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit role: ${editing.name}` : 'Create a role'}
        subtitle={
          editing?.isSystem
            ? 'Built-in role — you can change permissions, but not its name'
            : 'Pick a workspace, then choose what this role can do'
        }
        width={600}
        footer={
          <div className="flex items-center justify-between w-full gap-4">
            <span className="text-xs text-slate-500">
              <strong className="text-slate-700">{form.permissions.length}</strong> permission{form.permissions.length === 1 ? '' : 's'} selected
              {willForceReLogin ? ` · saving signs out ${editing!.userCount} user(s)` : ''}
            </span>
            <div className="flex gap-2 flex-shrink-0">
              <Button onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button kind="primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Create role'}
              </Button>
            </div>
          </div>
        }
      >
        {formError && (
          <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">
            {formError}
          </div>
        )}

        <div className="space-y-6">
          {/* Step 1 — basics */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">1 · Name this role</div>
            <Field label="Role name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Assistant Teacher"
                disabled={!!editing?.isSystem}
              />
            </Field>
            <Field label="Description (optional)">
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What is this role for?"
                disabled={!!editing?.isSystem}
              />
            </Field>
          </div>

          {/* Step 2 — workspace as descriptive cards */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">2 · Choose a workspace</div>
            <p className="text-xs text-slate-500 mb-3">Where this person lands after signing in.</p>
            <div className="grid grid-cols-2 gap-2">
              {SURFACES.map((s) => {
                const m = SURFACE_META[s];
                const selected = form.baseSurface === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, baseSurface: s })}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      selected
                        ? `ring-2 ${ACCENT[s].ring} border-transparent`
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center ${ACCENT[s].badge}`}>
                        <Icon name={m.icon as any} size={15} />
                      </div>
                      <span className="text-sm font-medium text-slate-900">{m.label}</span>
                      {selected && <Icon name="Check" size={15} className="ml-auto text-slate-500" />}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3 — permissions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">3 · What can they do?</div>
              <span className="text-xs text-slate-500">{form.permissions.length} selected</span>
            </div>
            <div className="space-y-2">
              {catalog.map((group) => {
                const keys = group.permissions.map((p) => p.key);
                const have = keys.filter((k) => form.permissions.includes(k)).length;
                const allOn = have === keys.length;
                return (
                  <div key={group.group} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                        <Icon name={group.icon as any} size={15} className="text-slate-400" />
                        {group.group}
                        <span className="text-xs text-slate-400 font-normal">{have}/{keys.length}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group)}
                        className="text-xs font-medium text-purple-600 hover:text-purple-700"
                      >
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {group.permissions.map((p) => {
                        const checked = form.permissions.includes(p.key);
                        return (
                          <label
                            key={p.key}
                            className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePerm(p.key)}
                              className="mt-0.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span>
                              <span className="block text-sm text-slate-900">{p.label}</span>
                              <span className="block text-xs text-slate-500">{p.desc}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Drawer>

      {/* Delete confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete role?"
        subtitle={deleting?.name}
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button kind="danger" onClick={confirmDelete} disabled={deletingBusy || (deleting?.userCount ?? 0) > 0}>
              {deletingBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          {deleting && deleting.userCount > 0
            ? `This role is assigned to ${deleting.userCount} person(s). Move them to another role on the Staff page first.`
            : 'This permanently removes the role. This cannot be undone.'}
        </p>
      </Modal>
    </>
  );
}
