'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, EmptyState, Modal, Drawer, Field, Input, Select, DetailRow, Skeleton, Th, sortRows, nextSort, type SortState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';

interface SchoolClass {
  id: string;
  name: string;
  order: number;
  room: string | null;
  group: 'PRE' | 'PRIMARY' | 'SECONDARY';
  teachers: { id: string; name: string }[];
  sections: { id: string; name: string }[];
  _count: { students: number };
}

const GROUP_LABEL: Record<string, string> = {
  PRE: 'Pre-primary',
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
};

interface StaffOption {
  id: string;
  name: string;
  roleName?: string | null;
}

const emptyForm = { id: '', name: '', room: '', group: 'PRIMARY' as SchoolClass['group'], teacherIds: [] as string[] };

export default function ClassesPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('CLASSES_MANAGE');
  const canExport = perms.includes('REPORTS_EXPORT') || perms.includes('SETTINGS_MANAGE');
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try { await downloadBackup('classes'); } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const sorted = React.useMemo(
    () => sortRows<SchoolClass>(classes, sort, (c, k) => {
      const x = c as any;
      return k === 'name' ? x.order : k === 'group' ? x.group : k === 'room' ? (x.room || '') : k === 'students' ? (x._count?.students ?? 0) : x.order;
    }),
    [classes, sort]
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SchoolClass | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleting, setDeleting] = useState<SchoolClass | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [viewing, setViewing] = useState<SchoolClass | null>(null);

  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);

  const fetchClasses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/classes${showArchived ? '?archived=1' : ''}`);
      if (!res.ok) throw new Error(`Failed to load classes (${res.status})`);
      setClasses(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load classes');
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  const restore = async (cls: SchoolClass) => {
    const res = await fetch(`/api/classes/${cls.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: true }) });
    if (res.ok) await fetchClasses();
  };

  const fetchStaff = useCallback(async () => {
    try {
      const res = await fetch('/api/staff');
      if (!res.ok) return;
      const all = await res.json();
      setStaffOptions(all.map((s: any) => ({ id: s.id, name: s.name, roleName: s.roleName })));
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    fetchClasses();
    fetchStaff();
  }, [fetchClasses, fetchStaff]);

  const totalStudents = classes.reduce((t, c) => t + c._count.students, 0);
  const pre = classes.filter((c) => c.group === 'PRE').length;
  const primary = classes.filter((c) => c.group === 'PRIMARY').length;
  const secondary = classes.filter((c) => c.group === 'SECONDARY').length;

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (c: SchoolClass) => {
    setEditing(c);
    setForm({ id: c.id, name: c.name, room: c.room || '', group: c.group, teacherIds: c.teachers.map((t) => t.id) });
    setFormError('');
    setFormOpen(true);
  };

  const toggleTeacher = (id: string) =>
    setForm((f) => ({
      ...f,
      teacherIds: f.teacherIds.includes(id) ? f.teacherIds.filter((t) => t !== id) : [...f.teacherIds, id],
    }));

  const saveClass = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!form.name.trim()) throw new Error('Class name is required');

      const payload = {
        id: form.id || undefined,
        name: form.name.trim(),
        room: form.room.trim() || null,
        group: form.group,
        teacherIds: form.teacherIds,
      };

      const res = await fetch(editing ? `/api/classes/${editing.id}` : '/api/classes', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      setFormOpen(false);
      await fetchClasses();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save class');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const res = await fetch(`/api/classes/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setDeleting(null);
      await fetchClasses();
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Manage"
        title="Classes"
        meta={`${classes.length} classes · ${totalStudents} students`}
        actions={(canExport || canManage) ? (
          <>
            {canExport && <Button icon="Download" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
            {canManage && <Button kind="primary" icon="Plus" onClick={openAdd}>Add class</Button>}
          </>
        ) : undefined}
      />

      {/* Compact summary chips */}
      <div className="flex flex-wrap gap-2.5 mt-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={52} width={150} rounded="lg" />)
          : [
              { label: 'Total classes', value: classes.length, icon: 'BookOpen', badge: 'bg-purple-100 text-purple-700' },
              { label: 'Pre-primary', value: pre, icon: 'Baby', badge: 'bg-info-100 text-info-700' },
              { label: 'Primary', value: primary, icon: 'Pencil', badge: 'bg-success-100 text-success-700' },
              { label: 'Secondary', value: secondary, icon: 'GraduationCap', badge: 'bg-marigold-100 text-marigold-700' },
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

      <Card className="mt-6" padded={false} title={showArchived ? 'Archived classes' : 'Classes and sections'}
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
                <Th label="Class" sortKey="name" sort={sort} onSort={onSort} />
                <Th label="Group" sortKey="group" sort={sort} onSort={onSort} />
                <Th label="Room" sortKey="room" sort={sort} onSort={onSort} />
                <th className="text-left py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600">Class teacher</th>
                <Th label="Students" sortKey="students" sort={sort} onSort={onSort} align="right" />
                <th className="text-right py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-500 text-sm">Loading classes…</td>
                </tr>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={6} className="py-12">
                    <EmptyState icon="AlertCircle" title="Couldn't load classes" body={error} />
                  </td>
                </tr>
              )}

              {!loading && !error && classes.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12">
                    <EmptyState icon="BookOpen" title="No classes yet" body="Add a class to get started." />
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                sorted.map((cls) => (
                  <tr key={cls.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-6">
                      <button onClick={() => setViewing(cls)} className="font-medium text-slate-900 hover:text-purple-700 text-left">
                        {cls.name}
                      </button>
                    </td>
                    <td className="py-3 px-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${
                        cls.group === 'PRE' ? 'bg-info-50 text-info-700' : cls.group === 'PRIMARY' ? 'bg-success-50 text-success-700' : 'bg-marigold-50 text-marigold-700'
                      }`}>
                        {GROUP_LABEL[cls.group]}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-sm text-slate-600">{cls.room || '—'}</td>
                    <td className="py-3 px-6 text-sm text-slate-600">
                      {cls.teachers.length ? (
                        <div className="flex flex-wrap gap-1">
                          {cls.teachers.map((t) => (
                            <span key={t.id} className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-xs">{t.name}</span>
                          ))}
                        </div>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="py-3 px-6 text-right">
                      <span className="inline-flex items-center justify-center min-w-[28px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">{cls._count.students}</span>
                    </td>
                    <td className="py-3 px-6 text-right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(cls)}
                            className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100"
                            title="Edit"
                          >
                            <Icon name="Pencil" size={16} />
                          </button>
                          {(cls as any).archived ? (
                            <button onClick={() => restore(cls)} className="text-slate-400 hover:text-success-600 p-1.5 rounded-md hover:bg-slate-100" title="Restore">
                              <Icon name="ArchiveRestore" size={16} />
                            </button>
                          ) : (
                            <button onClick={() => setDeleting(cls)} className="text-slate-400 hover:text-amber-600 p-1.5 rounded-md hover:bg-slate-100" title="Archive (hide until restored)">
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
          {loading && <div className="p-4 text-center text-slate-500 text-sm">Loading classes…</div>}
          {!loading && error && (
            <div className="py-10"><EmptyState icon="AlertCircle" title="Couldn't load classes" body={error} /></div>
          )}
          {!loading && !error && classes.length === 0 && (
            <div className="py-10"><EmptyState icon="BookOpen" title="No classes yet" body="Add a class to get started." /></div>
          )}
          {!loading && !error && sorted.map((cls) => (
            <div key={cls.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
              <button onClick={() => setViewing(cls)} className="flex-1 min-w-0 text-left">
                <div className="font-medium text-slate-900 truncate">{cls.name}</div>
                <div className="text-xs text-slate-500 truncate">
                  {GROUP_LABEL[cls.group]}{cls.room ? ` · Room ${cls.room}` : ''} · {cls._count.students} students
                </div>
                {cls.teachers.length > 0 && (
                  <div className="text-xs text-slate-400 truncate mt-0.5">{cls.teachers.map((t) => t.name).join(', ')}</div>
                )}
              </button>
              {canManage && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => openEdit(cls)} className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100" title="Edit">
                    <Icon name="Pencil" size={15} />
                  </button>
                  {(cls as any).archived ? (
                    <button onClick={() => restore(cls)} className="text-slate-400 hover:text-success-600 p-1.5 rounded-md hover:bg-slate-100" title="Restore">
                      <Icon name="ArchiveRestore" size={15} />
                    </button>
                  ) : (
                    <button onClick={() => setDeleting(cls)} className="text-slate-400 hover:text-amber-600 p-1.5 rounded-md hover:bg-slate-100" title="Archive">
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
        title={editing ? 'Edit class' : 'Add class'}
        subtitle={editing ? editing.name : 'Create a new class'}
        width={460}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button kind="primary" onClick={saveClass} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add class'}
            </Button>
          </div>
        }
      >
        {formError && (
          <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{formError}</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Class name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 5th STD" />
          </Field>
          {!editing && (
            <Field label="Class ID" hint="Leave blank to auto-generate">
              <Input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="e.g. 5" />
            </Field>
          )}
          <Field label="Room">
            <Input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="e.g. 105" />
          </Field>
          <Field label="Group">
            <Select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value as SchoolClass['group'] })}>
              <option value="PRE">Pre-primary</option>
              <option value="PRIMARY">Primary</option>
              <option value="SECONDARY">Secondary</option>
            </Select>
          </Field>
        </div>

        {/* Class teachers */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-slate-900 mb-1">Class teachers</label>
          <p className="text-xs text-slate-500 mb-2">
            Teachers assigned here can see &amp; mark attendance for this class.
          </p>
          {staffOptions.length === 0 ? (
            <p className="text-xs text-slate-400">No staff available. Add staff first.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-1">
              {staffOptions.map((s) => {
                const on = form.teacherIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleTeacher(s.id)}
                    title={s.roleName || undefined}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill text-xs font-medium transition-colors ${
                      on ? 'bg-purple-500 text-white' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {on && <Icon name="Check" size={12} />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
          {form.teacherIds.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">{form.teacherIds.length} teacher(s) selected</p>
          )}
        </div>
      </Drawer>

      {/* View details */}
      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name || 'Class'}
        subtitle={viewing ? GROUP_LABEL[viewing.group] : ''}
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
            <DetailRow label="Class" value={viewing.name} />
            <DetailRow label="Group" value={GROUP_LABEL[viewing.group]} />
            <DetailRow label="Room" value={viewing.room} />
            <DetailRow label="Students" value={viewing._count.students} />
            <DetailRow
              label="Class teachers"
              value={viewing.teachers.length ? viewing.teachers.map((t) => t.name).join(', ') : 'None'}
            />
            <DetailRow
              label="Sections"
              value={viewing.sections.length ? viewing.sections.map((s) => s.name).join(', ') : 'None'}
            />
          </div>
        )}
      </Drawer>

      {/* Archive confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Archive class?"
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
          The class is <b>hidden everywhere</b> (pickers, lists, dropdowns) but its students and history are kept. Turn on <b>Show archived</b> to restore it anytime.
        </p>
      </Modal>
    </>
  );
}
