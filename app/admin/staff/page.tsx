'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Button, Card, Avatar, EmptyState, Modal, Drawer, Field, Input, Select, DetailRow, Chip, Skeleton, Th, sortRows, nextSort, type SortState } from '@/components/Primitives';
import { downloadBackup } from '@/lib/utils';
import { Icon } from '@/components/Icon';
import * as XLSX from 'xlsx';

interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  designation: string | null;
  classes: { id: string; name: string }[];
  hasLogin?: boolean;
  roleId?: string | null;
  roleName?: string | null;
}

interface RoleOption {
  id: string;
  name: string;
  baseSurface: 'ADMIN' | 'TEACHER' | 'ACCOUNTANT' | 'PARENT';
}

interface ClassOption {
  id: string;
  name: string;
}

const emptyForm = { name: '', email: '', phone: '', designation: '', roleId: '', classIds: [] as string[] };

export default function StaffPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('STAFF_MANAGE');
  const canExport = perms.includes('REPORTS_EXPORT') || perms.includes('SETTINGS_MANAGE');
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try { await downloadBackup('staff'); } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };
  const [staffImportOpen, setStaffImportOpen] = useState(false);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const sorted = React.useMemo(
    () => sortRows<StaffMember>(staff, sort, (m, k) => {
      const x = m as any;
      return k === 'name' ? x.name : k === 'role' ? (x.roleName || x.designation || '') : k === 'email' ? (x.email || '') : k === 'phone' ? (x.phone || '') : x.name;
    }),
    [staff, sort]
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleting, setDeleting] = useState<StaffMember | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [viewing, setViewing] = useState<StaffMember | null>(null);

  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);
  const [newLogin, setNewLogin] = useState<{ name: string; email: string; password: string } | null>(null);

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/staff${showArchived ? '?archived=1' : ''}`);
      if (!res.ok) throw new Error(`Failed to load staff (${res.status})`);
      setStaff(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const restore = async (m: StaffMember) => {
    const res = await fetch(`/api/staff/${m.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: true }) });
    if (res.ok) await fetchStaff();
  };

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/roles');
      if (!res.ok) return;
      const all: RoleOption[] = await res.json();
      // Staff get non-parent roles (Parent role is for guardians)
      setRoles(all.filter((r) => r.baseSurface !== 'PARENT'));
    } catch {
      /* non-fatal */
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/classes');
      if (!res.ok) return;
      const all = await res.json();
      setClassOptions(all.map((c: any) => ({ id: c.id, name: c.name })));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    fetchStaff();
    fetchRoles();
    fetchClasses();
  }, [fetchStaff, fetchRoles, fetchClasses]);

  const teachers = staff.filter((s) => (s.roleName || '').toLowerCase().includes('teacher')).length;
  const admins = staff.filter((s) => (s.roleName || '').toLowerCase().includes('admin')).length;
  const accountants = staff.filter((s) => (s.roleName || '').toLowerCase().includes('account')).length;

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, roleId: roles.find((r) => r.baseSurface === 'TEACHER')?.id || roles[0]?.id || '' });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (s: StaffMember) => {
    setEditing(s);
    setForm({
      name: s.name,
      email: s.email || '',
      phone: s.phone || '',
      designation: s.designation || '',
      roleId: s.roleId || '',
      classIds: s.classes.map((c) => c.id),
    });
    setFormError('');
    setFormOpen(true);
  };

  const toggleClass = (id: string) =>
    setForm((f) => ({
      ...f,
      classIds: f.classIds.includes(id) ? f.classIds.filter((c) => c !== id) : [...f.classIds, id],
    }));

  const saveStaff = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!form.name.trim()) throw new Error('Name is required');
      if (!form.phone.trim()) throw new Error('Phone is required — it becomes the login password');
      if (!form.roleId) throw new Error('Please select a login role');

      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim(),
        designation: form.designation.trim() || null,
        roleId: form.roleId,
        classIds: form.classIds,
      };

      const res = await fetch(editing ? `/api/staff/${editing.id}` : '/api/staff', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setFormOpen(false);
      // Show the login credentials whenever an account was just created
      // (new staff, or a role assigned to a previously login-less staff member)
      if (data.login) {
        setNewLogin({ name: data.name, email: data.login.email, password: data.login.password });
      }
      await fetchStaff();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save staff');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const res = await fetch(`/api/staff/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setDeleting(null);
      await fetchStaff();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <>
      {/* KPI summary + actions (compact, no separate page header) */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
        <div className="flex flex-wrap gap-2.5">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={52} width={150} rounded="lg" />)
          : [
              { label: 'Total staff', value: staff.length, icon: 'UserCog', badge: 'bg-purple-100 text-purple-700' },
              { label: 'Teachers', value: teachers, icon: 'GraduationCap', badge: 'bg-info-100 text-info-700' },
              { label: 'Admin', value: admins, icon: 'Shield', badge: 'bg-success-100 text-success-700' },
              { label: 'Accountant', value: accountants, icon: 'Calculator', badge: 'bg-marigold-100 text-marigold-700' },
            ].map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl shadow-xs px-4 py-2.5 hover:shadow-md transition-shadow"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.badge}`}>
                  <Icon name={s.icon as any} size={18} />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-900 leading-none">{s.value}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{s.label}</div>
                </div>
              </div>
            ))}
        </div>
        {(canExport || canManage) && (
          <div className="flex items-center gap-2 flex-wrap">
            {canExport && <Button icon="Download" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
            {canManage && <Button icon="Upload" onClick={() => setStaffImportOpen(true)}>Import</Button>}
            {canManage && <Button kind="primary" icon="UserPlus" onClick={openAdd}>Add staff</Button>}
          </div>
        )}
      </div>

      <Card className="mt-6" padded={false} title={showArchived ? 'Archived staff' : 'Staff directory'}
        action={
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded border-slate-300 text-purple-600 focus:ring-purple-500/20" />
            Show archived
          </label>
        }>
        {/* Desktop / tablet: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th label="Name" sortKey="name" sort={sort} onSort={onSort} />
                <Th label="Role" sortKey="role" sort={sort} onSort={onSort} />
                <th className="text-left py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600">Classes</th>
                <Th label="Email" sortKey="email" sort={sort} onSort={onSort} />
                <Th label="Phone" sortKey="phone" sort={sort} onSort={onSort} />
                <th className="text-right py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 text-sm">Loading staff…</td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={6} className="py-12">
                    <EmptyState icon="AlertCircle" title="Couldn't load staff" body={error} />
                  </td>
                </tr>
              )}

              {!loading && !error && staff.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12">
                    <EmptyState icon="UserCog" title="No staff yet" body="Add a staff member to get started." />
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                sorted.map((member) => (
                  <tr key={member.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-6">
                      <button onClick={() => setViewing(member)} className="flex items-center gap-3 text-left group">
                        <Avatar name={member.name} size="sm" />
                        <span className="font-medium text-slate-900 group-hover:text-purple-700">{member.name}</span>
                      </button>
                    </td>
                    <td className="py-3 px-6">
                      {member.roleName ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-info-50 text-info-700 text-xs font-medium">{member.roleName}</span>
                      ) : (
                        <span className="text-xs text-slate-400">{member.designation || '—'}</span>
                      )}
                    </td>
                    <td className="py-3 px-6">
                      {member.classes.length ? (
                        <div className="flex flex-wrap gap-1">
                          {member.classes.slice(0, 3).map((c) => (
                            <span key={c.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-xs font-medium">
                              {c.name.replace(/\s?STD$/, '')}
                            </span>
                          ))}
                          {member.classes.length > 3 && (
                            <span className="text-xs text-slate-400">+{member.classes.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-sm text-slate-600">{member.email || '—'}</td>
                    <td className="py-3 px-6 text-sm text-slate-600">{member.phone || '—'}</td>
                    <td className="py-3 px-6 text-right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(member)}
                            className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100"
                            title="Edit"
                          >
                            <Icon name="Pencil" size={16} />
                          </button>
                          {(member as any).archived ? (
                            <button onClick={() => restore(member)} className="text-slate-400 hover:text-success-600 p-1.5 rounded-md hover:bg-slate-100" title="Restore">
                              <Icon name="ArchiveRestore" size={16} />
                            </button>
                          ) : (
                            <button onClick={() => setDeleting(member)} className="text-slate-400 hover:text-amber-600 p-1.5 rounded-md hover:bg-slate-100" title="Archive (hide until restored)">
                              <Icon name="Archive" size={16} />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="md:hidden">
          {loading && <div className="p-4 text-center text-slate-500 text-sm">Loading staff…</div>}
          {!loading && error && (
            <div className="py-10"><EmptyState icon="AlertCircle" title="Couldn't load staff" body={error} /></div>
          )}
          {!loading && !error && staff.length === 0 && (
            <div className="py-10"><EmptyState icon="UserCog" title="No staff yet" body="Add a staff member to get started." /></div>
          )}
          {!loading && !error && sorted.map((member) => (
            <div key={member.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
              <button onClick={() => setViewing(member)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Avatar name={member.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">{member.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {member.designation || member.roleName || 'Staff'}
                    {member.phone ? ` · ${member.phone}` : ''}
                  </div>
                  {member.classes.length > 0 && (
                    <div className="text-xs text-slate-400 truncate mt-0.5">{member.classes.map((c) => c.name).join(', ')}</div>
                  )}
                </div>
              </button>
              {canManage && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => openEdit(member)} className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100" title="Edit">
                    <Icon name="Pencil" size={15} />
                  </button>
                  {(member as any).archived ? (
                    <button onClick={() => restore(member)} className="text-slate-400 hover:text-success-600 p-1.5 rounded-md hover:bg-slate-100" title="Restore">
                      <Icon name="ArchiveRestore" size={15} />
                    </button>
                  ) : (
                    <button onClick={() => setDeleting(member)} className="text-slate-400 hover:text-amber-600 p-1.5 rounded-md hover:bg-slate-100" title="Archive">
                      <Icon name="Archive" size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Add / Edit Drawer */}
      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit staff' : 'Add staff'}
        subtitle={editing ? editing.name : 'Create a new staff member'}
        width={480}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button kind="primary" onClick={saveStaff} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add staff'}
            </Button>
          </div>
        }
      >
        {formError && (
          <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{formError}</div>
        )}
        <div className="space-y-4">
          <Field label="Full name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Staff name" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Login role">
              <Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                <option value="">Select role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Designation">
              <Input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Maths teacher" />
            </Field>
          </div>
          <Field label="Phone (becomes the login password)">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 9876543210" />
          </Field>
          <Field label="Email (optional — for login & notices)">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@jnanadeepika.edu" />
          </Field>

          {/* Assigned classes */}
          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1">Assigned classes</label>
            <p className="text-xs text-slate-500 mb-2">
              Controls which classes this person can see &amp; mark attendance for (unless their role can access all classes).
            </p>
            {classOptions.length === 0 ? (
              <p className="text-xs text-slate-400">No classes available.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-1">
                {classOptions.map((c) => {
                  const on = form.classIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleClass(c.id)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-xs font-medium transition-colors ${
                        on ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {on && <Icon name="Check" size={12} />}
                      {c.name.replace(/\s?STD$/, '')}
                    </button>
                  );
                })}
              </div>
            )}
            {form.classIds.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">{form.classIds.length} class(es) selected</p>
            )}
          </div>

          {!editing && (
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-md p-3">
              <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <span>A login account is created automatically. They sign in with their <strong>phone or email</strong>, and their <strong>phone number is the initial password</strong> (they can change it later).</span>
            </div>
          )}
          {editing && (
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-md p-3">
              <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
              <span>Changing the role will sign this person out so the new permissions apply immediately.</span>
            </div>
          )}
        </div>
      </Drawer>

      {/* View details */}
      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name || 'Staff'}
        subtitle={viewing?.roleName || viewing?.designation || 'Staff'}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setViewing(null)}>Close</Button>
            {canManage && viewing && (
              <Button kind="primary" icon="Pencil" onClick={() => { const v = viewing; setViewing(null); openEdit(v); }}>
                Edit
              </Button>
            )}
          </div>
        }
      >
        {viewing && (
          <div>
            <div className="flex items-center gap-3 pb-4 mb-2 border-b border-slate-100">
              <Avatar name={viewing.name} size="md" />
              <div>
                <div className="font-semibold text-slate-900">{viewing.name}</div>
                {viewing.roleName && <Chip tone="info">{viewing.roleName}</Chip>}
              </div>
            </div>
            <DetailRow label="Login role" value={viewing.roleName} />
            <DetailRow label="Designation" value={viewing.designation} />
            <DetailRow label="Phone" value={viewing.phone} />
            <DetailRow label="Email" value={viewing.email} />
            <DetailRow label="Has login" value={viewing.hasLogin ? 'Yes' : 'No'} />
            <DetailRow
              label="Assigned classes"
              value={viewing.classes.length ? viewing.classes.map((c) => c.name).join(', ') : 'None'}
            />
          </div>
        )}
      </Drawer>

      {/* New login credentials (shown once after creating staff) */}
      <Modal
        open={!!newLogin}
        onClose={() => setNewLogin(null)}
        title="Staff account created"
        subtitle={newLogin?.name}
        width={420}
        footer={
          <div className="flex justify-end">
            <Button kind="primary" onClick={() => setNewLogin(null)}>Done</Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600 mb-4">Share these sign-in details. They can change the password after first login.</p>
        <div className="space-y-2">
          <div className="flex justify-between items-center bg-slate-50 rounded-md px-3 py-2">
            <span className="text-xs text-slate-500">Login (email or phone)</span>
            <span className="text-sm font-mono text-slate-900">{newLogin?.email}</span>
          </div>
          <div className="flex justify-between items-center bg-slate-50 rounded-md px-3 py-2">
            <span className="text-xs text-slate-500">Password (their phone)</span>
            <span className="text-sm font-mono text-slate-900">{newLogin?.password}</span>
          </div>
        </div>
      </Modal>

      {/* Archive confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Archive staff?"
        subtitle={deleting ? deleting.name : ''}
        width={420}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button kind="primary" icon="Archive" onClick={confirmDelete} disabled={deletingBusy}>
              {deletingBusy ? 'Archiving…' : 'Archive'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          The staff member is <b>hidden from the list and their login is disabled</b>, but nothing is deleted. Turn on <b>Show archived</b> to restore them anytime.
        </p>
      </Modal>

      <StaffImportDrawer open={staffImportOpen} onClose={() => setStaffImportOpen(false)} onImported={fetchStaff} />
    </>
  );
}

/* ---------- Staff Excel import ---------- */

interface StaffRow {
  name?: string; designation?: string; phone?: string; email?: string;
  dob?: string; joiningDate?: string; serviceJoiningDate?: string;
  durationEmployment?: string; subjectSpecialization?: string; experience?: string;
}

function mapStaffHeaders(headers: string[]): Record<string, keyof StaffRow> {
  const map: Record<string, keyof StaffRow> = {};
  for (const h of headers) {
    const k = h.toLowerCase().trim();
    if (/^name$|staff.*name|employee.*name|teacher.*name/.test(k)) map[h] = 'name';
    else if (/designation|^role$|^post$|position/.test(k)) map[h] = 'designation';
    else if (/email/.test(k)) map[h] = 'email';
    else if (/service.*join|service.*date/.test(k)) map[h] = 'serviceJoiningDate';
    else if (/join/.test(k)) map[h] = 'joiningDate';
    else if (/date.*birth|dob|birth/.test(k)) map[h] = 'dob';
    else if (/duration/.test(k)) map[h] = 'durationEmployment';
    else if (/subject|special/.test(k)) map[h] = 'subjectSpecialization';
    else if (/experience|^exp/.test(k)) map[h] = 'experience';
    else if (/primary.*contact|contact.*no|phone|mobile|contact/.test(k)) map[h] = 'phone';
  }
  return map;
}

function StaffImportDrawer({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; total: number; created: number; logins: number; merged?: number; usedExisting?: number; failed: number; errors: { row: number; name: string; reason: string }[] } | null>(null);

  const close = () => { setRows([]); setFileName(''); setParseError(''); setResult(null); onClose(); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { name: 'Asha Rao', designation: 'Assistant Teacher', joining_date: '2020-06-01', date_of_birth: '1990-05-10', duration_employment: '', service_joining_date: '', primary_contact_no: '9876543210', subject_specialization: 'Maths', experience: '5 years' },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Staff');
    XLSX.writeFile(wb, 'staff-import-template.xlsx');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(''); setResult(null); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (raw.length === 0) throw new Error('The sheet has no data rows.');
      const headers = Object.keys(raw[0]);
      const colMap = mapStaffHeaders(headers);
      if (!Object.values(colMap).includes('name')) throw new Error('Could not find a "name" column. Use the template.');
      const parsed: StaffRow[] = raw.map((r) => {
        const o: StaffRow = {};
        for (const h of headers) { const f = colMap[h]; if (f) { const v = r[h]; (o as any)[f] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim(); } }
        return o;
      }).filter((o) => Object.values(o).some(Boolean));
      setRows(parsed);
    } catch (err) {
      setRows([]);
      setParseError(err instanceof Error ? err.message : 'Could not read the file.');
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/staff/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && data.created === undefined) throw new Error(data.error || `Failed (${res.status})`);
      setResult(data);
      if (data.created > 0) onImported();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} onClose={close} title="Import staff from Excel" subtitle=".xlsx, .xls or .csv" width={620}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button onClick={downloadTemplate} className="text-sm text-purple-600 hover:text-purple-700 font-medium inline-flex items-center gap-1"><Icon name="Download" size={15} /> Template</button>
          {result ? (
            <Button kind="primary" onClick={close}>Done</Button>
          ) : (
            <div className="flex gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button kind="primary" onClick={doImport} disabled={busy || rows.length === 0}>{busy ? 'Importing…' : `Import ${rows.length || ''} staff`}</Button>
            </div>
          )}
        </div>
      }>
      {result ? (
        result.created === 0 && result.failed > 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-white text-danger-600 flex items-center justify-center mx-auto mb-2"><Icon name="AlertTriangle" size={26} /></div>
              <div className="text-lg font-bold text-slate-900">Import blocked — nothing was saved</div>
              <div className="text-sm text-danger-700 mt-0.5">Fix the {result.failed} issue{result.failed > 1 ? 's' : ''} below and upload again.</div>
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {result.errors.map((e, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span className="text-slate-600">Row {e.row} · {e.name}</span>
                  <span className="text-danger-700 text-xs text-right">{e.reason}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-success-100 bg-success-50 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-white text-success-600 flex items-center justify-center mx-auto mb-2"><Icon name="CheckCircle2" size={26} /></div>
            <div className="text-lg font-bold text-slate-900">{result.created} staff imported</div>
            <div className="text-sm text-slate-500 mt-0.5">{result.logins} new login{result.logins === 1 ? '' : 's'} created (password = phone).</div>
            {!!result.merged && <div className="text-xs text-success-700 mt-1">{result.merged} staff were already a parent on that phone → upgraded to staff + parent (they can switch between both).</div>}
            {!!result.usedExisting && <div className="text-xs text-slate-400 mt-1">{result.usedExisting} (Office Staff / Driver) already had a parent login — kept as-is.</div>}
          </div>
        )
      ) : (
        <div className="space-y-4">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer hover:border-purple-300 hover:bg-slate-50 transition-colors">
            <Icon name="FileSpreadsheet" size={32} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-700 mt-2">{fileName || 'Choose an Excel / CSV file'}</span>
            <span className="text-xs text-slate-400 mt-0.5">Columns: name, designation, primary_contact_no, date_of_birth, joining_date…</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </label>

          {parseError && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{parseError}</div>}

          {rows.length > 0 && (
            <>
              <div className="text-sm"><Chip tone="info">{rows.length} rows</Chip></div>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="text-left font-semibold px-3 py-2">Name</th>
                      <th className="text-left font-semibold px-3 py-2">Designation</th>
                      <th className="text-left font-semibold px-3 py-2">Phone</th>
                      <th className="text-left font-semibold px-3 py-2">Login?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r, i) => {
                      const d = (r.designation || '').toLowerCase();
                      const role = d.includes('teacher') ? 'Teacher' : d.includes('account') ? 'Accountant' : (d.includes('admin') || d.includes('principal')) ? 'Admin' : '';
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 text-slate-800">{r.name || <span className="text-danger-600">—</span>}</td>
                          <td className="px-3 py-1.5 text-slate-600">{r.designation || '—'}</td>
                          <td className="px-3 py-1.5 text-slate-600">{r.phone || '—'}</td>
                          <td className="px-3 py-1.5">{role && r.phone ? <span className="text-success-700">{role}</span> : <span className="text-slate-400">no login</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {rows.length > 8 && <div className="px-3 py-1.5 text-[11px] text-slate-400 bg-slate-50">+ {rows.length - 8} more rows</div>}
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-md p-3">
                <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <span>Teaching staff → Teacher login, Admin → Admin login, Accountant → Accountant login (username &amp; password = phone). Office Staff / Driver are saved without a login. Validated all-or-nothing.</span>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
