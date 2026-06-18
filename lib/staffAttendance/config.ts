// Loads the staff-attendance configuration (geofence + schedule) from the
// Settings singleton, applying sane defaults. Centralised so every route reads
// the same shape.
import { prisma } from '@/lib/db';
import type { GeofenceConfig } from './geofence';
import type { ScheduleConfig } from './rules';

export interface StaffAttConfig {
  enabled: boolean;
  timezone: string;
  geofence: GeofenceConfig;
  schedule: ScheduleConfig;
}

function parseWeeklyOff(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map((n) => Number(n)).filter((n) => n >= 0 && n <= 6);
  return [0]; // default: Sunday off
}

export async function loadStaffAttConfig(): Promise<StaffAttConfig> {
  const s = await prisma.settings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });
  const timezone = s.timezone || 'Asia/Kolkata';
  return {
    enabled: s.staffAttEnabled,
    timezone,
    geofence: {
      schoolLat: s.schoolLat,
      schoolLng: s.schoolLng,
      geofenceRadiusM: s.geofenceRadiusM,
      gpsAccuracyMaxM: s.gpsAccuracyMaxM,
    },
    schedule: {
      timezone,
      shiftStart: s.shiftStart,
      shiftEnd: s.shiftEnd,
      afternoonStart: s.afternoonStart,
      lateGraceMins: s.lateGraceMins,
      halfDayMins: s.halfDayMins,
      fullDayMins: s.fullDayMins,
      weeklyOffDays: parseWeeklyOff(s.weeklyOffDays),
    },
  };
}
