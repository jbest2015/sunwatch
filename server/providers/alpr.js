import { readResponseJsonCapped } from './common/http.js';

// Public OSM-derived snapshots used by DeFlock's map. No vendor credentials.
const DATASETS = [
  'https://data.dontgetflocked.com/cameras.geojson.gz',
  'https://data.dontgetflocked.com/cameras-ca.geojson.gz',
];
const TTL = 3600_000;

export function cameraElements(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length)
    throw new Error('Incomplete camera dataset');
  return data.features.flatMap(feature => {
    const p = feature.properties || {};
    const coords = feature.geometry?.coordinates;
    // Existing marker links identify OSM nodes; do not mislabel way IDs as nodes.
    if ((p.osmType || 'node') !== 'node' || feature.geometry?.type !== 'Point' ||
        !Number.isSafeInteger(p.osmId) || p.osmId <= 0 ||
        !Array.isArray(coords) || !coords.slice(0, 2).every(Number.isFinite) || coords.length < 2)
      return [];
    return [{ type: 'node', id: p.osmId, lon: coords[0], lat: coords[1], tags: {
      'surveillance:type': 'ALPR', manufacturer: p.brand, operator: p.operator,
      'camera:direction': p.direction, 'surveillance:zone': p.surveillanceZone,
      ref: p.ref, source: 'OpenStreetMap via DeFlock/FlockHopper',
    }}];
  });
}

export function createCameraDatasetLoader(fetchImpl = fetch) {
  let cache;
  let pending;
  return async () => {
    if (cache && Date.now() - cache.at < TTL) return { ...cache, stale: false };
    if (!pending) pending = (async () => {
      const chunks = await Promise.all(DATASETS.map(async url => {
        const signal = AbortSignal.timeout(25000);
        const response = await fetchImpl(url, { signal });
        if (!response.ok) throw new Error(`Camera dataset HTTP ${response.status}`);
        return cameraElements(await readResponseJsonCapped(response, 100 * 1024 * 1024, signal));
      }));
      cache = { elements: [...new Map(chunks.flat().map(el => [el.id, el])).values()], at: Date.now() };
      return { ...cache, stale: false };
    })().catch(error => {
      if (cache) return { ...cache, stale: true };
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  };
}

export function alprDatasetProxy() {
  const load = createCameraDatasetLoader();
  const install = server => { server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/alpr-locations') return next();
    res.setHeader('Content-Type', 'application/json');
    const values = ['south', 'west', 'north', 'east'].map(k =>
      url.searchParams.has(k) ? Number(url.searchParams.get(k)) : NaN);
    const [south, west, north, east] = values;
    if (req.method !== 'GET' || !values.every(Number.isFinite) || south < -90 || north > 90 ||
        west < -180 || east > 180 || north <= south || east <= west || north - south > 3.11 || east - west > 3.11) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'A bounded camera viewport is required' }));
    }
    try {
      const snapshot = await load();
      const elements = snapshot.elements.filter(el => el.lat >= south && el.lat <= north && el.lon >= west && el.lon <= east);
      res.setHeader('x-overpass-cache', snapshot.stale ? 'STALE' : 'HIT');
      res.end(JSON.stringify({ elements: elements.slice(0, 1500) }));
    } catch {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'Published camera locations temporarily unavailable' }));
    }
  }); };
  return { name: 'alpr-published-locations', configureServer: install, configurePreviewServer: install };
}
