// Geofence helpers for staff attendance. A punch must be taken within
// `geofenceRadiusM` of the school's GPS centre. We compute the great-circle
// distance with the haversine formula and apply a tolerance for GPS accuracy.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeofenceConfig {
  schoolLat: number | null;
  schoolLng: number | null;
  geofenceRadiusM: number;
  gpsAccuracyMaxM: number;
}

export interface GeofenceVerdict {
  ok: boolean;
  distanceM: number | null;
  reason?: 'NO_SCHOOL_LOCATION' | 'POOR_ACCURACY' | 'OUTSIDE_FENCE';
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two coordinates, in metres. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Decide whether a punch at `point` (with optional GPS `accuracy` in metres)
 * is allowed. The accuracy is added to the radius so a slightly-fuzzy fix near
 * the edge isn't unfairly rejected, but wildly inaccurate fixes are refused.
 */
export function evaluateGeofence(
  point: GeoPoint,
  accuracy: number | null | undefined,
  cfg: GeofenceConfig
): GeofenceVerdict {
  if (cfg.schoolLat == null || cfg.schoolLng == null) {
    return { ok: false, distanceM: null, reason: 'NO_SCHOOL_LOCATION' };
  }
  if (accuracy != null && accuracy > cfg.gpsAccuracyMaxM) {
    return { ok: false, distanceM: null, reason: 'POOR_ACCURACY' };
  }
  const distanceM = haversineMeters(point, { lat: cfg.schoolLat, lng: cfg.schoolLng });
  const tolerance = accuracy != null ? Math.min(accuracy, cfg.gpsAccuracyMaxM) : 0;
  if (distanceM - tolerance > cfg.geofenceRadiusM) {
    return { ok: false, distanceM, reason: 'OUTSIDE_FENCE' };
  }
  return { ok: true, distanceM };
}
