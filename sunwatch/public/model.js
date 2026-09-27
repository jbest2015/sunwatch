export const STATUS = ['Unknown', 'Open', 'Limited service', 'Closed'];
export function normalizeLocation(r) {
  const name = String(r.name || r.branch || '').trim();
  const lat = Number(r.latitude ?? r.lat),
    lon = Number(r.longitude ?? r.lon ?? r.lng);
  if (
    !name ||
    !String(r.latitude ?? r.lat ?? '').trim() ||
    !String(r.longitude ?? r.lon ?? r.lng ?? '').trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    throw Error('Each location needs a name and valid latitude / longitude.');
  return {
    id: String(r.id || `custom-${crypto.randomUUID()}`),
    name: name.slice(0, 100),
    address_line1: String(r.address_line1 || r.address || '').slice(0, 250),
    city: String(r.city || '').slice(0, 80),
    county: String(r.county || '').slice(0, 80),
    state: String(r.state || 'FL').slice(0, 20),
    postal_code: String(r.postal_code || r.zip || '').slice(0, 15),
    latitude: lat,
    longitude: lon,
    type: 'branch',
    source_url: r.source_url || null,
    services: Array.isArray(r.services) ? r.services : [],
    lobby_hours: r.lobby_hours || null,
    drive_through_hours: r.drive_through_hours || null,
    interactive_teller_hours: r.interactive_teller_hours || null,
    atm_information: r.atm_information || null,
  };
}
export function matches(r, query, county, status, updates) {
  return (
    (!county || r.county === county) &&
    (!status || (updates[r.id]?.status || 'Unknown') === status) &&
    [r.name, r.city, r.county, r.address_line1, r.postal_code]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase())
  );
}
export function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}
export function insideGeometry(r, g) {
  if (!g) return false;
  const polygons =
    g.type === 'Polygon'
      ? [g.coordinates]
      : g.type === 'MultiPolygon'
        ? g.coordinates
        : [];
  return polygons.some(
    (p) =>
      pointInRing(r.latitude, r.longitude, p[0]) &&
      !p.slice(1).some((h) => pointInRing(r.latitude, r.longitude, h)),
  );
}
export function html(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}
