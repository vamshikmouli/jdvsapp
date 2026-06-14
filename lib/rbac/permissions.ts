import { Permission, Surface } from '@prisma/client';

/**
 * Permission catalog — grouped for rendering the admin checkbox grid.
 * Devs add new permissions to the Prisma enum + here; admins toggle per role.
 */
export interface PermissionDef {
  key: Permission;
  label: string;
  desc: string;
}

export interface PermissionGroup {
  group: string;
  icon: string;
  permissions: PermissionDef[];
}

export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    group: 'Students',
    icon: 'Users',
    permissions: [
      { key: 'STUDENTS_VIEW', label: 'View students', desc: 'See the student list and profiles' },
      { key: 'STUDENTS_MANAGE', label: 'Manage students', desc: 'Add, edit and remove students' },
    ],
  },
  {
    group: 'Classes',
    icon: 'BookOpen',
    permissions: [
      { key: 'CLASSES_VIEW', label: 'View classes', desc: 'See classes and their rosters' },
      { key: 'CLASSES_MANAGE', label: 'Manage classes', desc: 'Add, edit and remove classes' },
    ],
  },
  {
    group: 'Staff',
    icon: 'UserCog',
    permissions: [
      { key: 'STAFF_VIEW', label: 'View staff', desc: 'See the staff directory' },
      { key: 'STAFF_MANAGE', label: 'Manage staff', desc: 'Add, edit and remove staff (creates logins)' },
    ],
  },
  {
    group: 'Attendance',
    icon: 'Calendar',
    permissions: [
      { key: 'ATTENDANCE_VIEW', label: 'View attendance', desc: 'See attendance records and reports' },
      { key: 'ATTENDANCE_MARK', label: 'Mark attendance', desc: 'Record present / absent / leave — saving finalizes (closes) the session' },
      { key: 'ATTENDANCE_LOCK', label: 'Reopen sessions', desc: 'Reopen a finalized session to allow corrections (admins by default; can be granted to teachers)' },
    ],
  },
  {
    group: 'Fees',
    icon: 'CreditCard',
    permissions: [
      { key: 'FEES_VIEW', label: 'View fees', desc: 'See fee dues and payment status' },
      { key: 'FEES_COLLECT', label: 'Collect payments', desc: 'Take payments at the counter' },
      { key: 'FEES_RECEIPT', label: 'Generate receipts', desc: 'Issue and print receipts' },
      { key: 'FEES_VIEW_ALL', label: 'View all accounts', desc: 'See every student’s fee account' },
      { key: 'FEES_CONCESSION_APPROVE', label: 'Approve concessions', desc: 'Approve or reject fee concession (discount) requests' },
      { key: 'FEES_VOID', label: 'Cancel payments', desc: 'Cancel/void a recorded payment (reverses it, keeps an audit record)' },
    ],
  },
  {
    group: 'Reporting & Admin',
    icon: 'Settings',
    permissions: [
      { key: 'NOTICES_MANAGE', label: 'Send notices & reminders', desc: 'Create circulars and send fee reminders to parents' },
      { key: 'ANALYTICS_VIEW', label: 'View analytics', desc: 'See dashboards and insights' },
      { key: 'REPORTS_EXPORT', label: 'Export reports', desc: 'Download data and reports' },
      { key: 'SETTINGS_MANAGE', label: 'Manage settings', desc: 'Change school-wide settings' },
      { key: 'ROLES_MANAGE', label: 'Manage roles & access', desc: 'Create roles and set permissions' },
      { key: 'USERS_MANAGE', label: 'Manage user accounts', desc: 'Assign roles to people' },
    ],
  },
  {
    group: 'Data access',
    icon: 'LayoutGrid',
    permissions: [
      {
        key: 'ALL_CLASSES_ACCESS',
        label: 'Access all classes',
        desc: 'See every class. Without this, the person only sees the classes assigned to them.',
      },
    ],
  },
];

/** Workspace (surface) metadata — where a role "lives" after login. */
export interface SurfaceMeta {
  key: Surface;
  label: string;
  short: string;
  desc: string;
  icon: string;
  color: string; // tailwind text/bg accent token base, e.g. 'purple'
}

export const SURFACE_META: Record<Surface, SurfaceMeta> = {
  ADMIN: {
    key: 'ADMIN',
    label: 'Admin panel',
    short: 'Admin',
    desc: 'Full back-office: students, classes, staff, settings.',
    icon: 'Shield',
    color: 'purple',
  },
  TEACHER: {
    key: 'TEACHER',
    label: 'Teacher view',
    short: 'Teacher',
    desc: 'Daily classroom tools — mark attendance for their classes.',
    icon: 'GraduationCap',
    color: 'blue',
  },
  ACCOUNTANT: {
    key: 'ACCOUNTANT',
    label: 'Accountant view',
    short: 'Accountant',
    desc: 'Fee collection, receipts and financial reports.',
    icon: 'Calculator',
    color: 'green',
  },
  PARENT: {
    key: 'PARENT',
    label: 'Parent app',
    short: 'Parent',
    desc: 'Mobile app for parents to track their child.',
    icon: 'Users',
    color: 'amber',
  },
};

export const ALL_PERMISSIONS: Permission[] = PERMISSION_CATALOG.flatMap((g) =>
  g.permissions.map((p) => p.key)
);

/**
 * The 4 built-in system roles (isSystem: true).
 */
export interface SystemRoleDef {
  key: string;
  name: string;
  description: string;
  baseSurface: Surface;
  permissions: Permission[];
}

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: 'admin',
    name: 'Administrator',
    description: 'Full access to the entire system.',
    baseSurface: 'ADMIN',
    permissions: ALL_PERMISSIONS, // everything
  },
  {
    key: 'teacher',
    name: 'Teacher',
    description: 'Marks attendance for assigned classes.',
    baseSurface: 'TEACHER',
    permissions: ['STUDENTS_VIEW', 'CLASSES_VIEW', 'ATTENDANCE_VIEW', 'ATTENDANCE_MARK'],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Manages fee collection and financial reports.',
    baseSurface: 'ACCOUNTANT',
    permissions: [
      'STUDENTS_VIEW',
      'ATTENDANCE_VIEW',
      'FEES_VIEW',
      'FEES_COLLECT',
      'FEES_RECEIPT',
      'FEES_VIEW_ALL',
      'ANALYTICS_VIEW',
      'REPORTS_EXPORT',
      'ALL_CLASSES_ACCESS',
    ],
  },
  {
    key: 'parent',
    name: 'Parent',
    description: "Views their own child's attendance and fees.",
    baseSurface: 'PARENT',
    permissions: ['ATTENDANCE_VIEW', 'FEES_VIEW'],
  },
];
