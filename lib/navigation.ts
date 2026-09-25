import { Surface } from '@prisma/client';
import { NavGroup } from './types';

// Single staff navigation (admin shell). Items are filtered by the user's
// permissions at render time — everyone sees the same UI, scoped to what they can do.
export const STAFF_NAV: NavGroup[] = [
  {
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' }, // always
    ],
  },
  {
    label: 'Attendance',
    items: [
      { id: 'attendance', label: 'Student attendance', icon: 'Calendar', perm: 'ATTENDANCE_VIEW' },
      { id: 'staff-attendance', label: 'Staff attendance', icon: 'CalendarClock', perm: 'STAFF_ATTENDANCE_VIEW' },
      { id: 'kiosk', label: 'Kiosk', icon: 'Tablet', perm: 'STAFF_ATTENDANCE_KIOSK' },
      { id: 'leave', label: 'Leave', icon: 'CalendarOff', perm: 'STAFF_ATTENDANCE_MARK' },
      { id: 'my-attendance', label: 'My attendance', icon: 'Fingerprint', perm: 'STAFF_ATTENDANCE_MARK' },
    ],
  },
  {
    label: 'Exams',
    items: [
      { id: 'marks', label: 'Marks', icon: 'ClipboardList', perm: 'MARKS_VIEW' },
    ],
  },
  {
    label: 'Super Tools',
    items: [
      // Each is individually grantable; the STUDENTS_MANAGE fallback keeps admins
      // (who already hold it) seeing the tools with no data migration.
      { id: 'hall-tickets', label: 'Hall tickets', icon: 'Ticket', perm: ['HALL_TICKETS_ACCESS', 'STUDENTS_MANAGE'] },
      { id: 'admission-extract', label: 'Admission extract', icon: 'FileText', perm: ['ADMISSION_EXTRACT_ACCESS', 'STUDENTS_MANAGE'] },
      { id: 'study-certificate', label: 'Study certificate', icon: 'FileCheck', perm: ['STUDY_CERTIFICATE_ACCESS', 'STUDENTS_MANAGE'] },
      { id: 'rural-certificate', label: 'Rural certificate', icon: 'Trees', perm: ['RURAL_CERTIFICATE_ACCESS', 'STUDENTS_MANAGE'] },
    ],
  },
  {
    label: 'Manage',
    items: [
      { id: 'students', label: 'Students', icon: 'Users', perm: 'STUDENTS_VIEW' },
      { id: 'classes', label: 'Classes', icon: 'BookOpen', perm: 'CLASSES_VIEW' },
      { id: 'staff', label: 'Staff', icon: 'UserCog', perm: 'STAFF_VIEW' },
      { id: 'fees', label: 'Fees', icon: 'CreditCard', perm: 'FEES_VIEW' },
      { id: 'payroll', label: 'Payroll', icon: 'Wallet', perm: 'PAYROLL_VIEW' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'communications', label: 'Communications', icon: 'Megaphone', perm: 'NOTICES_MANAGE' },
      { id: 'whatsapp-chat', label: 'WhatsApp', icon: 'MessagesSquare', perm: 'NOTICES_MANAGE' },
      { id: 'whatsapp', label: 'WA Templates', icon: 'FileText', perm: 'SETTINGS_MANAGE' },
      { id: 'promotions', label: 'Promotions', icon: 'GraduationCap', perm: 'SETTINGS_MANAGE' },
      { id: 'users', label: 'Logins & PINs', icon: 'KeyRound', perm: 'USERS_MANAGE' },
      { id: 'activity', label: 'Activity log', icon: 'ScrollText', perm: 'USERS_MANAGE' },
      { id: 'roles', label: 'Roles & access', icon: 'Lock', perm: 'ROLES_MANAGE' },
      { id: 'logos', label: 'School logos', icon: 'Images', perm: 'SETTINGS_MANAGE' }, // admin-only downloads
      { id: 'settings', label: 'Settings', icon: 'Settings' }, // always (My Account)
    ],
  },
];

export const ROLE_META: Record<Surface, { title: string; icon: string }> = {
  ADMIN: { title: 'Admin', icon: 'Shield' },
  TEACHER: { title: 'Teacher', icon: 'GraduationCap' },
  ACCOUNTANT: { title: 'Accountant', icon: 'Calculator' },
  PARENT: { title: 'Parent', icon: 'Users' },
};
