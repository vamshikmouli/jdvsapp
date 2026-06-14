import { Gender, StudentStatus, AttendanceStatus, ClassGroup, Surface, Permission } from '@prisma/client';

export type { Gender, StudentStatus, AttendanceStatus, ClassGroup, Surface, Permission };

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  surface: Surface;
  perms: Permission[];
  phone?: string;
  staffId?: string;
  childrenIds?: string[];
}

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  count?: number;
  perm?: Permission; // if set, item only shows when the user holds this permission
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export type NavStructure = Record<Surface, NavGroup[]>;
