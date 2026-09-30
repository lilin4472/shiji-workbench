export interface GeoPoint {
  longitude: number
  latitude: number
}

const EARTH_RADIUS_KM = 6371.0088

export function haversineDistanceKm(left: GeoPoint, right: GeoPoint): number {
  assertGeoPoint(left)
  assertGeoPoint(right)
  const latitudeDelta = radians(right.latitude - left.latitude)
  const longitudeDelta = radians(right.longitude - left.longitude)
  const leftLatitude = radians(left.latitude)
  const rightLatitude = radians(right.latitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

export function isGeoPoint(value: unknown): value is GeoPoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Partial<GeoPoint>
  return Number.isFinite(candidate.longitude) && Number.isFinite(candidate.latitude)
    && (candidate.longitude as number) >= -180 && (candidate.longitude as number) <= 180
    && (candidate.latitude as number) >= -90 && (candidate.latitude as number) <= 90
}

function assertGeoPoint(value: GeoPoint): void {
  if (!isGeoPoint(value)) throw new Error('经纬度参数无效。')
}

function radians(degrees: number): number {
  return degrees * Math.PI / 180
}
