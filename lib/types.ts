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
  // If set, the item only shows when the user holds this permission — or, when a
  // list is given, ANY of them (e.g. a granular access perm OR a legacy umbrella
  // so admins keep access without a data migration).
  perm?: Permission | Permission[];
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export type NavStructure = Record<Surface, NavGroup[]>;
