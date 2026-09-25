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
      { key: 'STUDENTS_VIEW', label: 'View (read)', desc: 'See the student list and profiles' },
      { key: 'STUDENTS_CREATE', label: 'Create', desc: 'Add new students' },
      { key: 'STUDENTS_UPDATE', label: 'Update', desc: 'Edit existing students' },
      { key: 'STUDENTS_DELETE', label: 'Delete', desc: 'Archive / remove students' },
      { key: 'STUDENTS_MANAGE', label: 'Manage (full)', desc: 'Legacy: all of create, update and delete' },
    ],
  },
  {
    group: 'Classes',
    icon: 'BookOpen',
    permissions: [
      { key: 'CLASSES_VIEW', label: 'View (read)', desc: 'See classes and their rosters' },
      { key: 'CLASSES_CREATE', label: 'Create', desc: 'Add new classes' },
      { key: 'CLASSES_UPDATE', label: 'Update', desc: 'Edit existing classes' },
      { key: 'CLASSES_DELETE', label: 'Delete', desc: 'Remove classes' },
      { key: 'CLASSES_MANAGE', label: 'Manage (full)', desc: 'Legacy: all of create, update and delete' },
    ],
  },
  {
    group: 'Staff',
    icon: 'UserCog',
    permissions: [
      { key: 'STAFF_VIEW', label: 'View (read)', desc: 'See the staff directory' },
      { key: 'STAFF_CREATE', label: 'Create', desc: 'Add new staff (creates logins)' },
      { key: 'STAFF_UPDATE', label: 'Update', desc: 'Edit existing staff' },
      { key: 'STAFF_DELETE', label: 'Delete', desc: 'Archive / remove staff' },
      { key: 'STAFF_MANAGE', label: 'Manage (full)', desc: 'Legacy: all of create, update and delete' },
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
    group: 'Staff attendance',
    icon: 'Fingerprint',
    permissions: [
      { key: 'STAFF_ATTENDANCE_MARK', label: 'Punch in / out', desc: 'Record own staff attendance via phone biometric or the shared kiosk' },
      { key: 'STAFF_ATTENDANCE_VIEW', label: 'View staff attendance', desc: 'See the daily board, per-staff history and reports' },
      { key: 'STAFF_ATTENDANCE_MANAGE', label: 'Manage staff attendance', desc: 'Regularize entries and reset a staff member’s device / PIN' },
      { key: 'STAFF_ATTENDANCE_CONFIG', label: 'Configure staff attendance', desc: 'Set the geofence, shift timings and weekly-offs / holidays' },
      { key: 'STAFF_ATTENDANCE_KIOSK', label: 'Run the kiosk', desc: 'Run the shared on-campus attendance kiosk (dedicated device login)' },
      { key: 'LEAVE_APPROVE', label: 'Approve leave', desc: 'Approve or reject staff leave requests (anyone who can punch may apply)' },
    ],
  },
  {
    group: 'Exams / Marks',
    icon: 'ClipboardList',
    permissions: [
      { key: 'MARKS_VIEW', label: 'View (read)', desc: 'View marks and assessments' },
      { key: 'MARKS_ENTER', label: 'Enter marks', desc: 'Teacher: enter & submit marks for assigned classes' },
      { key: 'MARKS_APPROVE', label: 'Approve / publish', desc: 'Admin: verify, edit and publish submitted marks' },
      { key: 'MARKS_SETUP', label: 'Set up', desc: 'Manage subjects, assessments and grade bands' },
    ],
  },
  {
    group: 'Payroll',
    icon: 'Wallet',
    permissions: [
      { key: 'PAYROLL_VIEW', label: 'View (read)', desc: 'View the salary register and payslips' },
      { key: 'PAYROLL_CREATE', label: 'Create', desc: 'Generate a salary run' },
      { key: 'PAYROLL_UPDATE', label: 'Update', desc: 'Edit amounts, approve and mark paid' },
      { key: 'PAYROLL_DELETE', label: 'Delete', desc: 'Delete / discard a run' },
      { key: 'PAYROLL_MANAGE', label: 'Manage (full)', desc: 'Legacy: all of create, update and delete' },
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
      { key: 'FEES_SETUP', label: 'Fee setup tab', desc: 'See the Fee setup tab (changing values still needs Manage settings)' },
      { key: 'FEES_REPORTS', label: 'Fee reports tab', desc: 'See the Fee reports tab and its analytics' },
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
    group: 'Super Tools',
    icon: 'Wrench',
    permissions: [
      { key: 'HALL_TICKETS_ACCESS', label: 'Hall tickets', desc: 'Generate exam hall tickets' },
      { key: 'ADMISSION_EXTRACT_ACCESS', label: 'Admission extract', desc: 'Export admission details' },
      { key: 'STUDY_CERTIFICATE_ACCESS', label: 'Study certificate', desc: 'Generate study certificates' },
      { key: 'RURAL_CERTIFICATE_ACCESS', label: 'Rural certificate', desc: 'Generate rural certificates' },
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
    permissions: ['STUDENTS_VIEW', 'CLASSES_VIEW', 'ATTENDANCE_VIEW', 'ATTENDANCE_MARK', 'STAFF_ATTENDANCE_MARK'],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Manages fee collection and financial reports.',
    baseSurface: 'ACCOUNTANT',
    permissions: [
      'STUDENTS_VIEW',
      'ATTENDANCE_VIEW',
      'STAFF_ATTENDANCE_MARK',
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
