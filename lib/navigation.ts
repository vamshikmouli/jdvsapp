import { Surface } from '@prisma/client';
import { NavGroup } from './types';

// Single staff navigation (admin shell). Items are filtered by the user's
// permissions at render time — everyone sees the same UI, scoped to what they can do.
export const STAFF_NAV: NavGroup[] = [
  {
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' }, // always
      { id: 'attendance', label: 'Attendance', icon: 'Calendar', perm: 'ATTENDANCE_VIEW' },
      { id: 'marks', label: 'Marks', icon: 'ClipboardList', perm: 'MARKS_VIEW' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { id: 'students', label: 'Students', icon: 'Users', perm: 'STUDENTS_VIEW' },
      { id: 'hall-tickets', label: 'Hall tickets', icon: 'Ticket', perm: 'STUDENTS_MANAGE' }, // admin-only by default; hidden for teacher/accountant
      { id: 'classes', label: 'Classes', icon: 'BookOpen', perm: 'CLASSES_VIEW' },
      { id: 'staff', label: 'Staff', icon: 'UserCog', perm: 'STAFF_VIEW' },
      { id: 'fees', label: 'Fees', icon: 'CreditCard', perm: 'FEES_VIEW' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'communications', label: 'Communications', icon: 'Megaphone', perm: 'NOTICES_MANAGE' },
      { id: 'promotions', label: 'Promotions', icon: 'GraduationCap', perm: 'SETTINGS_MANAGE' },
      { id: 'roles', label: 'Roles & access', icon: 'Lock', perm: 'ROLES_MANAGE' },
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
