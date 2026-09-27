import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFirmsCsv, filterTrailing24h } from '../src/data/firmsCsv.js';
import { cycloneProxy } from '../server/providers/cyclones.js';
import { weatherProxy } from '../server/providers/weather.js';
const dir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
const cache = new Map(),
  pending = new Map();
async function cached(key, url, ttl = 300000) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < ttl)
    return { ...existing, stale: false };
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'SunWatch/0.1 (sunwatch.johnbest.ai)',
          Accept: 'application/geo+json, application/json',
        },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw Error(`Provider returned HTTP ${r.status}`);
      const data = await r.json();
      const value = { data, at: Date.now() };
      cache.set(key, value);
      if (cache.size > 1000) cache.delete(cache.keys().next().value);
      return { ...value, stale: false };
    } catch (e) {
      if (existing && Date.now() - existing.at < 3600000)
        return { ...existing, stale: true };
      throw e;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, job);
  return job;
}
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    res
      .status(503)
      .json({ error: 'Source temporarily unavailable. Try again shortly.' });
  }
};
function coordinates(req) {
  const lat = Number(req.query.lat),
    lon = Number(req.query.lon);
  if (
    !req.query.lat ||
    !req.query.lon ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    throw Error('Invalid coordinates');
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}
app.get('/api/health', (_q, r) =>
  r.json({ ok: true, app: 'SunWatch', version: '0.1.0' }),
);
app.get('/api/branches', (_q, r) =>
  r.sendFile(path.join(dir, 'data/branches.json')),
);
app.get(
  '/api/alerts',
  wrap(async (q, r) => {
    let point;
    try {
      point = q.query.lat ? coordinates(q) : null;
    } catch {
      return r.status(400).json({ error: 'Invalid coordinates' });
    }
    const key = point || 'FL';
    r.json(
      await cached(
        'alerts:' + key,
        'https://api.weather.gov/alerts/active?' +
          (point ? 'point=' + point : 'area=FL'),
      ),
    );
  }),
);
app.get(
  '/api/forecast',
  wrap(async (q, r) => {
    let point;
    try {
      point = coordinates(q);
    } catch {
      return r.status(400).json({ error: 'Invalid coordinates' });
    }
    const info = await cached(
      'point:' + point,
      'https://api.weather.gov/points/' + point,
      86400000,
    );
    const url = info.data.properties?.forecast;
    if (!url || new URL(url).hostname !== 'api.weather.gov')
      throw Error('Forecast unavailable');
    r.json(await cached(url, url, 1800000));
  }),
);
let geoWindow = 0,
  geoCalls = 0;
let geoDay = new Date().toISOString().slice(0, 10),
  geoDailyCalls = 0;
app.use('/api/geocode', (_q, r, next) => {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== geoDay) {
    geoDay = today;
    geoDailyCalls = 0;
  }
  if (++geoDailyCalls > 500)
    return r
      .status(429)
      .json({
        error:
          'Daily address lookup allowance reached. Import coordinates or try tomorrow.',
      });
  next();
});
app.get(
  '/api/geocode',
  wrap(async (q, r) => {
    const query = String(q.query.q || '').trim();
    if (query.length < 5 || query.length > 250)
      return r.status(400).json({ error: 'Enter a full street address.' });
    if (!process.env.TOMTOM_API_KEY)
      return r
        .status(503)
        .json({
          error:
            'Address lookup is not configured. Import coordinates instead.',
        });
    if (Date.now() - geoWindow > 60000) {
      geoWindow = Date.now();
      geoCalls = 0;
    }
    if (++geoCalls > 20)
      return r
        .status(429)
        .json({ error: 'Address lookup is busy. Try again in one minute.' });
    const u = new URL(
      'https://api.tomtom.com/search/2/geocode/' +
        encodeURIComponent(query) +
        '.json',
    );
    u.searchParams.set('key', process.env.TOMTOM_API_KEY);
    u.searchParams.set('countrySet', 'US');
    u.searchParams.set('limit', '5');
    const value = await cached('geocode:' + query.toLowerCase(), u, 86400000);
    r.json({
      results: (value.data.results || []).map((x) => ({
        address: x.address?.freeformAddress,
        city: x.address?.municipality,
        county: x.address?.countrySecondarySubdivision,
        state: x.address?.countrySubdivisionCode,
        postal_code: x.address?.postalCode,
        latitude: x.position?.lat,
        longitude: x.position?.lon,
      })),
    });
  }),
);
let firesCache = null,
  firesPending = null;
app.get(
  '/api/fires',
  wrap(async (_q, r) => {
    if (!process.env.FIRMS_MAP_KEY)
      return r.status(503).json({ error: 'NASA FIRMS is not configured.' });
    if (firesCache && Date.now() - firesCache.at < 1800000)
      return r.json(firesCache);
    if (!firesPending)
      firesPending = (async () => {
        const sources = [
          'VIIRS_SNPP_NRT',
          'VIIRS_NOAA20_NRT',
          'VIIRS_NOAA21_NRT',
          'MODIS_NRT',
        ];
        const results = await Promise.allSettled(
          sources.map(async (source) => {
            const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${process.env.FIRMS_MAP_KEY}/${source}/-88,24,-79,32/2`;
            const response = await fetch(url, {
              signal: AbortSignal.timeout(25000),
            });
            if (!response.ok) throw Error('NASA unavailable');
            const rows = parseFirmsCsv(await response.text());
            if (!rows) throw Error('Invalid NASA response');
            return filterTrailing24h(rows, Date.now()).map((row) => ({
              ...row,
              source,
            }));
          }),
        );
        if (results.every((x) => x.status === 'rejected'))
          throw Error('NASA unavailable');
        return (firesCache = {
          at: Date.now(),
          stale: false,
          partial: results.some((x) => x.status === 'rejected'),
          detections: results.flatMap((x) =>
            x.status === 'fulfilled' ? x.value : [],
          ),
        });
      })().finally(() => {
        firesPending = null;
      });
    try {
      r.json(await firesPending);
    } catch (e) {
      if (firesCache && Date.now() - firesCache.at < 3600000)
        r.json({ ...firesCache, stale: true });
      else throw e;
    }
  }),
);
for (const plugin of [cycloneProxy(), weatherProxy()])
  plugin.configureServer({ middlewares: app });
app.use(
  '/vendor/leaflet',
  express.static(path.join(dir, 'node_modules/leaflet/dist')),
);
app.get('/vendor/papaparse.js', (_q, r) =>
  r.sendFile(path.join(dir, 'node_modules/papaparse/papaparse.min.js')),
);
app.use(express.static(path.join(dir, 'public'), { maxAge: 300000 }));
app.use('/api', (_q, r) => r.status(404).json({ error: 'Unknown API route' }));
app.use((_q, r) => r.status(404).send('Not found'));
app.listen(
  Number(process.env.PORT || 4180),
  process.env.HOST || '127.0.0.1',
  () => console.log('SunWatch listening on ' + (process.env.PORT || 4180)),
);
