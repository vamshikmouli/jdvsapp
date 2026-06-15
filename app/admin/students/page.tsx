'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  PageHeader,
  Button,
  Card,
  Select,
  Input,
  Field,
  Modal,
  Drawer,
  StatCard,
  EmptyState,
  Avatar,
  Skeleton,
  TableRowSkeleton,
  StatCardSkeleton,
  DetailRow,
  Chip,
  Th,
  sortRows,
  nextSort,
  type SortState,
} from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { downloadBackup } from '@/lib/utils';
import * as XLSX from 'xlsx';

interface SchoolClass {
  id: string;
  name: string;
  _count: { students: number };
}

interface Student {
  id: string;
  name: string;
  classId: string | null;
  class: { id: string; name: string } | null;
  roll: string | null;
  gender: 'M' | 'F';
  dob?: string | null;
  religion?: string | null;
  category?: string | null;
  caste?: string | null;
  address?: string | null;
  fatherName?: string | null;
  fatherPhone?: string | null;
  motherName?: string | null;
  motherPhone?: string | null;
  smsFor?: string | null;
  photoUrl?: string | null;
  guardianName: string;
  guardianPhone: string;
  village: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

const emptyForm = {
  id: '',
  name: '',
  classId: '',
  roll: '',
  gender: 'M' as 'M' | 'F',
  dob: '',
  religion: '',
  category: '',
  caste: '',
  address: '',
  fatherName: '',
  fatherPhone: '',
  motherName: '',
  motherPhone: '',
  smsFor: 'FATHER',
  photoUrl: '',
  village: '',
  status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
};

function shortClassName(name: string) {
  return name.replace(/\s?STD$/, '');
}

export default function StudentsPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canManage = perms.includes('STUDENTS_MANAGE');
  const canExport = perms.includes('REPORTS_EXPORT') || perms.includes('SETTINGS_MANAGE');
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try { await downloadBackup('students'); } catch (e) { alert(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };

  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete state
  const [deleting, setDeleting] = useState<Student | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  // View-details drawer
  const [viewing, setViewing] = useState<Student | null>(null);

  // Excel import drawer
  const [importOpen, setImportOpen] = useState(false);

  const fetchClasses = useCallback(async () => {
    const res = await fetch('/api/classes');
    if (res.ok) setClasses(await res.json());
  }, []);

  const fetchStudents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (classFilter !== 'all') params.set('classId', classFilter);

      const res = await fetch(`/api/students?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load students (${res.status})`);
      setStudents(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, classFilter]);

  useEffect(() => {
    fetchClasses();
  }, [fetchClasses]);

  useEffect(() => {
    const t = setTimeout(fetchStudents, 250);
    return () => clearTimeout(t);
  }, [fetchStudents]);

  const totalStudents = classes.reduce((t, c) => t + c._count.students, 0);

  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const onSort = (k: string) => setSort((s) => nextSort(s, k));
  const sorted = React.useMemo(
    () => sortRows(students, sort, (s, k) =>
      k === 'name' ? s.name : k === 'id' ? s.id : k === 'class' ? (s.class?.name || '') : k === 'status' ? s.status : s.name
    ),
    [students, sort]
  );

  const active = students.filter((s) => s.status === 'ACTIVE').length;
  const girls = students.filter((s) => s.gender === 'F').length;
  const boys = students.filter((s) => s.gender === 'M').length;

  // --- Form handlers ---
  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    setForm({
      id: s.id,
      name: s.name,
      classId: s.classId || '',
      roll: s.roll || '',
      gender: s.gender,
      dob: s.dob ? String(s.dob).slice(0, 10) : '',
      religion: s.religion || '',
      category: s.category || '',
      caste: s.caste || '',
      address: s.address || '',
      fatherName: s.fatherName || '',
      fatherPhone: s.fatherPhone || '',
      motherName: s.motherName || '',
      motherPhone: s.motherPhone || '',
      smsFor: s.smsFor || 'FATHER',
      photoUrl: s.photoUrl || '',
      village: s.village || '',
      status: s.status,
    });
    setFormError('');
    setFormOpen(true);
  };

  const [uploading, setUploading] = useState(false);
  const uploadPhoto = async (file: File) => {
    setUploading(true);
    setFormError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setForm((f) => ({ ...f, photoUrl: data.url }));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const saveStudent = async () => {
    setSaving(true);
    setFormError('');
    try {
      if (!form.name.trim()) throw new Error('Student name is required');
      if (!form.fatherName.trim() && !form.motherName.trim()) throw new Error('Enter at least a father or mother name');

      const payload = {
        id: form.id || undefined,
        name: form.name.trim(),
        classId: form.classId || null,
        roll: form.roll || null,
        gender: form.gender,
        dob: form.dob || null,
        religion: form.religion.trim() || null,
        category: form.category || null,
        caste: form.caste.trim() || null,
        address: form.address.trim() || null,
        fatherName: form.fatherName.trim() || null,
        fatherPhone: form.fatherPhone.trim() || null,
        motherName: form.motherName.trim() || null,
        motherPhone: form.motherPhone.trim() || null,
        smsFor: form.smsFor,
        photoUrl: form.photoUrl || null,
        village: form.village.trim() || null,
        status: form.status,
      };

      const res = await fetch(
        editing ? `/api/students/${editing.id}` : '/api/students',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }

      setFormOpen(false);
      await Promise.all([fetchStudents(), fetchClasses()]);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save student');
    } finally {
      setSaving(false);
    }
  };

  // Archive = soft delete (mark INACTIVE). Hidden everywhere until restored.
  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      const res = await fetch(`/api/students/${deleting.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setDeleting(null);
      await Promise.all([fetchStudents(), fetchClasses()]);
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingBusy(false);
    }
  };

  const restore = async (s: Student) => {
    const res = await fetch(`/api/students/${s.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restore: true }) });
    if (res.ok) await Promise.all([fetchStudents(), fetchClasses()]);
  };

  return (
    <>
      <PageHeader
        eyebrow="Manage"
        title="Students"
        meta={`${totalStudents} students · ${active} active shown`}
        actions={
          (canExport || canManage) ? (
            <>
              {canExport && <Button icon="Download" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
              {canManage && <Button icon="Upload" onClick={() => setImportOpen(true)}>Import</Button>}
              {canManage && (
                <Button kind="primary" icon="UserPlus" onClick={openAdd}>
                  Add student
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Compact summary chips */}
      <div className="flex flex-wrap gap-2.5 mt-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={52} width={150} rounded="lg" />)
          : [
              { label: 'Total students', value: totalStudents, icon: 'Users', badge: 'bg-purple-100 text-purple-700' },
              { label: 'Active', value: active, icon: 'UserCheck', badge: 'bg-success-100 text-success-700' },
              { label: 'Girls · Boys', value: `${girls} · ${boys}`, icon: 'UsersRound', badge: 'bg-info-100 text-info-700' },
              { label: 'Classes', value: classes.length, icon: 'BookOpen', badge: 'bg-marigold-100 text-marigold-700' },
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

      {/* Class filter pills */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          onClick={() => setClassFilter('all')}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill text-sm font-medium transition-colors ${
            classFilter === 'all'
              ? 'bg-purple-500 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          All classes
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${classFilter === 'all' ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>
            {totalStudents}
          </span>
        </button>
        {classes.map((c) => (
          <button
            key={c.id}
            onClick={() => setClassFilter(c.id)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-pill text-sm font-medium transition-colors ${
              classFilter === c.id
                ? 'bg-purple-500 text-white'
                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {shortClassName(c.name)}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${classFilter === c.id ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>
              {c._count.students}
            </span>
          </button>
        ))}
      </div>

      <Card
        className="mt-4"
        padded={false}
        title={
          <div className="flex items-center gap-2 w-full sm:w-80">
            <Icon name="Search" size={18} className="text-slate-400" />
            <input
              type="text"
              placeholder="Search name, admission no, guardian..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-sm"
            />
          </div>
        }
        action={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{students.length} shown</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-32">
              <option value="all">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </div>
        }
      >
        {/* Desktop / tablet: table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <Th label="Student" sortKey="name" sort={sort} onSort={onSort} />
                <Th label="Admission no" sortKey="id" sort={sort} onSort={onSort} className="hidden lg:table-cell w-36" />
                <Th label="Class" sortKey="class" sort={sort} onSort={onSort} />
                <th className="hidden md:table-cell text-left py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600">Guardian</th>
                <Th label="Status" sortKey="status" sort={sort} onSort={onSort} />
                <th className="text-right py-2.5 px-6 font-semibold text-xs uppercase tracking-wide text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={6} />
                  ))}
                </>
              )}

              {!loading && error && (
                <tr>
                  <td colSpan={6} className="py-12">
                    <EmptyState icon="AlertCircle" title="Couldn't load students" body={error} />
                  </td>
                </tr>
              )}

              {!loading && !error && students.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12">
                    <EmptyState icon="SearchX" title="No students match" body="Try a different class, status, or search term." />
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                sorted.map((student) => (
                  <tr key={student.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-6">
                      <button onClick={() => setViewing(student)} className="flex items-center gap-3 text-left group">
                        <Avatar name={student.name} size="sm" />
                        <div>
                          <div className="font-medium text-slate-900 group-hover:text-purple-700">{student.name}</div>
                          <div className="text-xs text-slate-500">
                            {student.roll ? `Roll ${student.roll} · ` : ''}
                            {student.gender === 'F' ? 'Girl' : 'Boy'}
                          </div>
                        </div>
                      </button>
                    </td>
                    <td className="hidden lg:table-cell py-3 px-6">
                      <span className="font-mono text-xs bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">{student.id}</span>
                    </td>
                    <td className="py-3 px-6">
                      {student.class?.name ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-xs font-medium">
                          {shortClassName(student.class.name)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell py-3 px-6 text-sm">
                      <div className="text-slate-900">{student.guardianName}</div>
                      <div className="text-xs text-slate-500">{student.guardianPhone}</div>
                    </td>
                    <td className="py-3 px-6">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full ${
                          student.status === 'ACTIVE'
                            ? 'bg-success-50 text-success-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${student.status === 'ACTIVE' ? 'bg-success-500' : 'bg-slate-400'}`} />
                        {student.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-right">
                      {canManage ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEdit(student)}
                            className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100"
                            title="Edit"
                          >
                            <Icon name="Pencil" size={16} />
                          </button>
                          {student.status === 'ACTIVE' ? (
                            <button
                              onClick={() => setDeleting(student)}
                              className="text-slate-400 hover:text-amber-600 p-1.5 rounded-md hover:bg-slate-100"
                              title="Archive (hide until restored)"
                            >
                              <Icon name="Archive" size={16} />
                            </button>
                          ) : (
                            <button
                              onClick={() => restore(student)}
                              className="text-slate-400 hover:text-success-600 p-1.5 rounded-md hover:bg-slate-100"
                              title="Restore"
                            >
                              <Icon name="ArchiveRestore" size={16} />
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
          {loading && (
            <div className="p-4 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={72} />)}
            </div>
          )}
          {!loading && error && (
            <div className="py-10"><EmptyState icon="AlertCircle" title="Couldn't load students" body={error} /></div>
          )}
          {!loading && !error && students.length === 0 && (
            <div className="py-10"><EmptyState icon="SearchX" title="No students match" body="Try a different class, status, or search." /></div>
          )}
          {!loading && !error && sorted.map((student) => (
            <div key={student.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
              <button onClick={() => setViewing(student)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Avatar name={student.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">{student.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {student.class?.name || 'Unassigned'}
                    {student.roll ? ` · Roll ${student.roll}` : ''} · {student.guardianName}
                  </div>
                </div>
              </button>
              <span
                className={`flex-shrink-0 inline-block px-2 py-0.5 text-[11px] font-medium rounded-full ${
                  student.status === 'ACTIVE' ? 'bg-success-50 text-success-700' : 'bg-slate-100 text-slate-700'
                }`}
              >
                {student.status === 'ACTIVE' ? 'Active' : 'Inactive'}
              </span>
              {canManage && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => openEdit(student)} className="text-slate-400 hover:text-purple-600 p-1.5 rounded-md hover:bg-slate-100" title="Edit">
                    <Icon name="Pencil" size={15} />
                  </button>
                  {student.status === 'ACTIVE' ? (
                    <button onClick={() => setDeleting(student)} className="text-slate-400 hover:text-amber-600 p-1.5 rounded-md hover:bg-slate-100" title="Archive">
                      <Icon name="Archive" size={15} />
                    </button>
                  ) : (
                    <button onClick={() => restore(student)} className="text-slate-400 hover:text-success-600 p-1.5 rounded-md hover:bg-slate-100" title="Restore">
                      <Icon name="ArchiveRestore" size={15} />
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
        title={editing ? 'Edit student' : 'Add student'}
        subtitle={editing ? `Admission no ${editing.id}` : 'Create a new student record'}
        width={640}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button kind="primary" onClick={saveStudent} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add student'}
            </Button>
          </div>
        }
      >
        {formError && (
          <div className="mb-4 bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">
            {formError}
          </div>
        )}
        {/* Photo */}
        <div className="flex items-center gap-4 mb-5">
          <div className="w-20 h-20 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center flex-shrink-0">
            {form.photoUrl ? (
              <img src={form.photoUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <Icon name="ImagePlus" size={26} className="text-slate-300" />
            )}
          </div>
          <div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-purple-600 hover:text-purple-700 cursor-pointer">
              <Icon name="Upload" size={15} /> {uploading ? 'Uploading…' : form.photoUrl ? 'Change photo' : 'Upload student photo'}
              <input type="file" accept="image/*" className="hidden" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
            </label>
            {form.photoUrl && (
              <button type="button" onClick={() => setForm({ ...form, photoUrl: '' })} className="block text-xs text-slate-400 hover:text-danger-600 mt-1">Remove</button>
            )}
            <p className="text-[11px] text-slate-400 mt-1">JPG/PNG, up to 5 MB.</p>
          </div>
        </div>

        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Student details</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Student name" />
          </Field>
          {!editing && (
            <Field label="Admission no" hint="Leave blank to auto-generate">
              <Input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="JD2026-0001" />
            </Field>
          )}
          <Field label="Class">
            <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
              <option value="">Unassigned</option>
              {classes.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
            </Select>
          </Field>
          <Field label="Roll no">
            <Input value={form.roll} onChange={(e) => setForm({ ...form, roll: e.target.value })} placeholder="01" />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value as 'M' | 'F' })}>
              <option value="M">Boy</option>
              <option value="F">Girl</option>
            </Select>
          </Field>
          <Field label="Date of birth">
            <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          </Field>
          <Field label="Religion">
            <Input value={form.religion} onChange={(e) => setForm({ ...form, religion: e.target.value })} placeholder="Hindu / Muslim / Christian…" />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">—</option>
              <option value="General">General</option>
              <option value="OBC">OBC</option>
              <option value="SC">SC</option>
              <option value="ST">ST</option>
              <option value="EWS">EWS</option>
            </Select>
          </Field>
          <Field label="Caste">
            <Input value={form.caste} onChange={(e) => setForm({ ...form, caste: e.target.value })} placeholder="Caste" />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'INACTIVE' })}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </Field>
        </div>

        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 mt-5">Parents / guardian</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Father name">
            <Input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} placeholder="Father's name" />
          </Field>
          <Field label="Father phone">
            <Input value={form.fatherPhone} onChange={(e) => setForm({ ...form, fatherPhone: e.target.value })} placeholder="98xxxxxxxx" />
          </Field>
          <Field label="Mother name">
            <Input value={form.motherName} onChange={(e) => setForm({ ...form, motherName: e.target.value })} placeholder="Mother's name" />
          </Field>
          <Field label="Mother phone">
            <Input value={form.motherPhone} onChange={(e) => setForm({ ...form, motherPhone: e.target.value })} placeholder="98xxxxxxxx" />
          </Field>
          <Field label="Send SMS / login to" hint="This number becomes the parent login">
            <Select value={form.smsFor} onChange={(e) => setForm({ ...form, smsFor: e.target.value })}>
              <option value="FATHER">Father</option>
              <option value="MOTHER">Mother</option>
              <option value="BOTH">Both</option>
            </Select>
          </Field>
          <Field label="Village">
            <Input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} placeholder="Village name" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} placeholder="Home address"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 focus:outline-none" />
            </Field>
          </div>
        </div>
        {!editing && (
          <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-md p-3 mt-4">
            <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
            <span>A parent login is created from the “SMS / login to” number (father or mother). Username &amp; initial password are that phone number; siblings share one login.</span>
          </div>
        )}
      </Drawer>

      {/* View details */}
      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.name || 'Student'}
        subtitle={`Admission no ${viewing?.id ?? ''}`}
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
              {viewing.photoUrl ? (
                <img src={viewing.photoUrl} alt={viewing.name} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <Avatar name={viewing.name} size="md" />
              )}
              <div>
                <div className="font-semibold text-slate-900">{viewing.name}</div>
                <Chip tone={viewing.status === 'ACTIVE' ? 'success' : 'neutral'}>
                  {viewing.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                </Chip>
              </div>
            </div>
            <DetailRow label="Admission no" value={viewing.id} />
            <DetailRow label="Class" value={viewing.class?.name || 'Unassigned'} />
            <DetailRow label="Roll no" value={viewing.roll} />
            <DetailRow label="Gender" value={viewing.gender === 'F' ? 'Girl' : 'Boy'} />
            <DetailRow label="Date of birth" value={viewing.dob ? String(viewing.dob).slice(0, 10) : null} />
            <DetailRow label="Religion" value={viewing.religion} />
            <DetailRow label="Category" value={viewing.category} />
            <DetailRow label="Caste" value={viewing.caste} />
            <DetailRow label="Father" value={viewing.fatherName ? `${viewing.fatherName}${viewing.fatherPhone ? ` · ${viewing.fatherPhone}` : ''}` : null} />
            <DetailRow label="Mother" value={viewing.motherName ? `${viewing.motherName}${viewing.motherPhone ? ` · ${viewing.motherPhone}` : ''}` : null} />
            <DetailRow label="SMS / login to" value={viewing.smsFor ? viewing.smsFor[0] + viewing.smsFor.slice(1).toLowerCase() : null} />
            <DetailRow label="Village" value={viewing.village} />
            <DetailRow label="Address" value={viewing.address} />
          </div>
        )}
      </Drawer>

      {/* Archive confirm */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Archive student?"
        subtitle={deleting ? `${deleting.name} · ${deleting.id}` : ''}
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
          The student is <b>hidden everywhere</b> — lists, fees, marks, attendance and counts — but nothing is deleted. Their record and history are kept. You can restore them anytime from the <b>Inactive</b> filter.
        </p>
      </Modal>

      <ImportDrawer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => { fetchStudents(); fetchClasses(); }}
      />
    </>
  );
}

/* ---------- Excel import drawer ---------- */

interface ParsedRow {
  id?: string; name?: string; class?: string; roll?: string; gender?: string;
  dob?: string; religion?: string; category?: string; caste?: string; address?: string;
  fatherName?: string; fatherPhone?: string; motherName?: string; motherPhone?: string;
  smsFor?: string; photoUrl?: string; guardianName?: string; guardianPhone?: string; village?: string;
}

function mapHeaders(headers: string[]): Record<string, keyof ParsedRow> {
  const map: Record<string, keyof ParsedRow> = {};
  for (const h of headers) {
    const k = h.toLowerCase().trim();
    if (/admission|adm\.?\s*no|^id$/.test(k)) map[h] = 'id';
    else if (/father/.test(k) && /name/.test(k)) map[h] = 'fatherName';
    else if (/father/.test(k) && /(phone|mobile|contact|number|no)/.test(k)) map[h] = 'fatherPhone';
    else if (/mother/.test(k) && /name/.test(k)) map[h] = 'motherName';
    else if (/mother/.test(k) && /(phone|mobile|contact|number|no)/.test(k)) map[h] = 'motherPhone';
    else if (/(guardian|parent)/.test(k) && /name/.test(k)) map[h] = 'guardianName';
    else if (/(guardian|parent)/.test(k) && /(phone|mobile|contact|number|no)/.test(k)) map[h] = 'guardianPhone';
    else if (/sms/.test(k)) map[h] = 'smsFor';
    else if (/dob|birth/.test(k)) map[h] = 'dob';
    else if (/religion/.test(k)) map[h] = 'religion';
    else if (/category/.test(k)) map[h] = 'category';
    else if (/caste/.test(k)) map[h] = 'caste';
    else if (/address/.test(k)) map[h] = 'address';
    else if (/photo|image|picture/.test(k)) map[h] = 'photoUrl';
    else if (/student.*name|child.*name|^name$|^student$/.test(k)) map[h] = 'name';
    else if (/class|std|grade/.test(k)) map[h] = 'class';
    else if (/roll/.test(k)) map[h] = 'roll';
    else if (/gender|sex/.test(k)) map[h] = 'gender';
    else if (/village/.test(k)) map[h] = 'village';
    else if (/phone|mobile|contact/.test(k)) map[h] = 'fatherPhone';
  }
  return map;
}

function ImportDrawer({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; total: number; created: number; failed: number; errors: { row: number; name: string; reason: string }[] } | null>(null);

  const reset = () => { setRows([]); setFileName(''); setParseError(''); setResult(null); };
  const close = () => { reset(); onClose(); };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      {
        'Admission No': '', Name: 'Asha Rao', Class: '1st STD', Roll: '01', Gender: 'F',
        DOB: '2018-06-10', Religion: 'Hindu', Category: 'General', Caste: '',
        Address: '12 Main Road, Channasandra',
        'Father Name': 'Ramesh Rao', 'Father Phone': '9876543210',
        'Mother Name': 'Sita Rao', 'Mother Phone': '9876500000',
        'SMS For': 'Father', 'Photo URL': '', Village: 'Channasandra',
      },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    XLSX.writeFile(wb, 'students-import-template.xlsx');
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
      const colMap = mapHeaders(headers);
      if (!Object.values(colMap).includes('name')) throw new Error('Could not find a "Name" column. Use the template.');
      const parsed: ParsedRow[] = raw.map((r) => {
        const o: ParsedRow = {};
        for (const h of headers) {
          const f = colMap[h];
          if (f) { const v = r[h]; (o as any)[f] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim(); }
        }
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
      const res = await fetch('/api/students/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      setResult(data);
      if (data.created > 0) onImported();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const missingName = rows.filter((r) => !r.name).length;

  return (
    <Drawer
      open={open}
      onClose={close}
      title="Import students from Excel"
      subtitle=".xlsx, .xls or .csv"
      width={620}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button onClick={downloadTemplate} className="text-sm text-purple-600 hover:text-purple-700 font-medium inline-flex items-center gap-1">
            <Icon name="Download" size={15} /> Template
          </button>
          {result ? (
            <Button kind="primary" onClick={close}>Done</Button>
          ) : (
            <div className="flex gap-2">
              <Button onClick={close}>Cancel</Button>
              <Button kind="primary" onClick={doImport} disabled={busy || rows.length === 0}>
                {busy ? 'Importing…' : `Import ${rows.length || ''} students`}
              </Button>
            </div>
          )}
        </div>
      }
    >
      {result ? (
        result.created === 0 && result.failed > 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-center">
              <div className="w-12 h-12 rounded-full bg-white text-danger-600 flex items-center justify-center mx-auto mb-2"><Icon name="AlertTriangle" size={26} /></div>
              <div className="text-lg font-bold text-slate-900">Import blocked — nothing was saved</div>
              <div className="text-sm text-danger-700 mt-0.5">Fix the {result.failed} issue{result.failed > 1 ? 's' : ''} below in your Excel and upload again.</div>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 mb-2">Problems found</div>
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-slate-600">Row {e.row} · {e.name}</span>
                    <span className="text-danger-700 text-xs text-right">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-success-100 bg-success-50 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-white text-success-600 flex items-center justify-center mx-auto mb-2"><Icon name="CheckCircle2" size={26} /></div>
            <div className="text-lg font-bold text-slate-900">{result.created} students imported</div>
            <div className="text-sm text-slate-500 mt-0.5">Fees and parent logins were created automatically.</div>
          </div>
        )
      ) : (
        <div className="space-y-4">
          <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-xl py-8 cursor-pointer hover:border-purple-300 hover:bg-slate-50 transition-colors">
            <Icon name="FileSpreadsheet" size={32} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-700 mt-2">{fileName || 'Choose an Excel / CSV file'}</span>
            <span className="text-xs text-slate-400 mt-0.5">Columns: Name, Class, Gender, Guardian Name, Guardian Phone…</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </label>

          {parseError && <div className="bg-danger-50 border border-danger-100 rounded-md p-3 text-sm text-danger-700">{parseError}</div>}

          {rows.length > 0 && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Chip tone="info">{rows.length} rows</Chip>
                {missingName > 0 && <Chip tone="warn">{missingName} missing name</Chip>}
              </div>
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="text-left font-semibold px-3 py-2">Name</th>
                      <th className="text-left font-semibold px-3 py-2">Class</th>
                      <th className="text-left font-semibold px-3 py-2">Gender</th>
                      <th className="text-left font-semibold px-3 py-2">Father / Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 8).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-800">{r.name || <span className="text-danger-600">—</span>}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.class || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.gender || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.fatherName || r.guardianName || '—'}{(r.fatherPhone || r.guardianPhone) ? ` · ${r.fatherPhone || r.guardianPhone}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 8 && <div className="px-3 py-1.5 text-[11px] text-slate-400 bg-slate-50">+ {rows.length - 8} more rows</div>}
              </div>
              <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-md p-3">
                <Icon name="Info" size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <span>Class is matched flexibly (e.g. "10", "10th", "10th STD"). A parent login is auto-created from the guardian phone. Blank admission numbers are auto-generated.</span>
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
