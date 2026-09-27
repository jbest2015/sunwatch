export function mappable(r) {
  return (
    r.latitude !== null &&
    r.longitude !== null &&
    r.latitude !== '' &&
    r.longitude !== '' &&
    Number.isFinite(Number(r.latitude)) &&
    Number.isFinite(Number(r.longitude)) &&
    Math.abs(Number(r.latitude)) <= 90 &&
    Math.abs(Number(r.longitude)) <= 180
  );
}
export function distanceKm(a, b) {
  if (!mappable(a) || !mappable(b)) return Infinity;
  const rad = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * rad,
    dlon = (b.longitude - a.longitude) * rad;
  const v =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
}
export function filterLocations(
  rows,
  { query = '', type = '', county = '', near = null, radius = 10 } = {},
) {
  return rows
    .filter(
      (r) =>
        (!type || r.type === type) &&
        (!county || r.county === county) &&
        (!near || distanceKm(near, r) <= radius) &&
        [r.name, r.address_line1, r.city, r.county, r.postal_code]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      near
        ? distanceKm(near, a) - distanceKm(near, b)
        : a.name.localeCompare(b.name),
    );
}
export function safeSource(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
      u.hostname === 'locations.suncoastcreditunion.com'
      ? u.href
      : null;
  } catch {
    return null;
  }
}
