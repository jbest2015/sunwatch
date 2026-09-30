// Hearth — living-room TV mode for SunWatch.
// Mounted only when HEARTH_DIR is set. All private inputs (calendar feed,
// guest Wi-Fi, TV address) live in $HEARTH_DIR/secrets.env on the device and
// never in the repository. Everything here is read-only toward providers.
import express from 'express';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import ical from 'node-ical';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { createProxyMiddleware } from 'http-proxy-middleware';

const UA = 'SunWatch-Hearth/0.1 (home dashboard)';

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of fss.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return out;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function getJson(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/geo+json, application/json', ...headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
}

// Small TTL memo with stale fallback so a provider hiccup never blanks the TV.
function memo(ttlMs, fn) {
  let value = null,
    at = 0,
    pending = null;
  return async (...args) => {
    if (value && Date.now() - at < ttlMs) return value;
    if (!pending)
      pending = (async () => {
        try {
          value = await fn(...args);
          at = Date.now();
          return value;
        } catch (e) {
          if (value) return { ...value, stale: true };
          throw e;
        } finally {
          pending = null;
        }
      })();
    return pending;
  };
}

const tidy = (t) =>
  t.replace(MONEY, '').replace(/,\s*\)/g, ')').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
const MONEY = /\$\s?\d[\d,]*(\.\d+)?|\b\d[\d,]*(\.\d\d)\b/g;
// Locations that are really meeting links / dial-ins, not places to drive to.
const VIRTUAL = /zoom|teams|meet\.google|webex|https?:|\bcall\b|phone|virtual|online|dial[- ]?in|skype/i;
const ONSITE_WORD = /\bon[- ]?site\b/i;
const FLIGHT_WORD = /\bflight\b|✈|\bairlines?\b|\b(?:DL|AA|UA|WN|B6|NK|F9|AS)\s?\d{2,4}\b/i;
const isOnsite = (e) => !e.allDay && (ONSITE_WORD.test(e.title) || ONSITE_WORD.test(e.location) || (!!e.location && !VIRTUAL.test(e.location)) || FLIGHT_WORD.test(e.title));

export function mountHearth(app, { hearthDir, tomtomKey, httpServer, log = console }) {
  const secrets = () => readEnvFile(path.join(hearthDir, 'secrets.env'));
  const config = () => readJson(path.join(hearthDir, 'config.json'), {});
  const router = express.Router();
  const state = { geo: null };
  const geoFile = path.join(hearthDir, '.geocache.json');

  async function geocode(address) {
    const cache = await readJson(geoFile, {});
    if (cache[address]) return cache[address];
    if (!tomtomKey) throw Error('TomTom key missing');
    const j = await getJson(
      `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json?limit=1&countrySet=US&key=${tomtomKey}`,
    );
    const p = j.results?.[0]?.position;
    if (!p) throw Error('No geocode for ' + address);
    cache[address] = { lat: p.lat, lon: p.lon };
    await fs.writeFile(geoFile, JSON.stringify(cache, null, 2));
    return cache[address];
  }

  async function home() {
    const c = await config();
    if (c.home?.lat) return c.home;
    return geocode(c.home?.address || 'Tampa, FL');
  }

  // ---------- weather (NWS) ----------
  const weather = memo(10 * 60e3, async () => {
    const h = await home();
    const pt = await getJson(`https://api.weather.gov/points/${h.lat.toFixed(4)},${h.lon.toFixed(4)}`);
    const [hourly, daily, stations, alerts] = await Promise.all([
      getJson(pt.properties.forecastHourly),
      getJson(pt.properties.forecast),
      getJson(pt.properties.observationStations),
      getJson(`https://api.weather.gov/alerts/active?point=${h.lat.toFixed(4)},${h.lon.toFixed(4)}`),
    ]);
    let obs = null;
    try {
      const sid = stations.features[0].properties.stationIdentifier;
      const o = await getJson(`https://api.weather.gov/stations/${sid}/observations/latest`);
      const c = o.properties.temperature.value;
      obs = {
        station: sid,
        tempF: c == null ? null : Math.round((c * 9) / 5 + 32),
        text: o.properties.textDescription,
        humidity: o.properties.relativeHumidity?.value == null ? null : Math.round(o.properties.relativeHumidity.value),
        windMph: o.properties.windSpeed?.value == null ? null : Math.round(o.properties.windSpeed.value * 0.621371),
        at: o.properties.timestamp,
      };
    } catch {}
    return {
      at: Date.now(),
      now: obs,
      hourly: hourly.properties.periods.slice(0, 12).map((p) => ({
        t: p.startTime,
        tempF: p.temperature,
        pop: p.probabilityOfPrecipitation?.value ?? 0,
        short: p.shortForecast,
        icon: p.icon,
      })),
      daily: daily.properties.periods.slice(0, 6).map((p) => ({
        name: p.name,
        day: p.isDaytime,
        tempF: p.temperature,
        pop: p.probabilityOfPrecipitation?.value ?? 0,
        short: p.shortForecast,
        detail: p.detailedForecast,
      })),
      alerts: alerts.features.map((f) => ({
        event: f.properties.event,
        severity: f.properties.severity,
        headline: f.properties.headline,
        ends: f.properties.ends || f.properties.expires,
      })),
    };
  });

  // ---------- calendar (secret iCal) ----------
  const calendarRaw = memo(10 * 60e3, async () => {
    const url = secrets().CAL_ICS_URL;
    if (!url) return { events: [] };
    const data = await ical.async.fromURL(url);
    const from = new Date(Date.now() - 12 * 3600e3);
    const to = new Date(Date.now() + 14 * 86400e3);
    const events = [];
    for (const ev of Object.values(data)) {
      if (ev.type !== 'VEVENT') continue;
      const durMs = (ev.end ? +ev.end : +ev.start) - +ev.start;
      const allDay = ev.datetype === 'date';
      const push = (start) =>
        events.push({
          title: String(ev.summary?.val ?? ev.summary ?? '').trim(),
          location: String(ev.location?.val ?? ev.location ?? '').trim(),
          start: start.toISOString(),
          end: new Date(+start + durMs).toISOString(),
          allDay,
        });
      if (ev.rrule) {
        const exdates = new Set(Object.values(ev.exdate || {}).map((d) => new Date(d).toISOString().slice(0, 16)));
        for (const occ of ev.rrule.between(from, to, true)) {
          // rrule returns floating times shifted by the original tz offset; node-ical documents this correction.
          const start = allDay ? occ : new Date(+occ);
          if (exdates.has(start.toISOString().slice(0, 16))) continue;
          const override = ev.recurrences && Object.values(ev.recurrences).find((r) => r.recurrenceid && +new Date(r.recurrenceid) === +start);
          if (override) continue;
          push(start);
        }
        for (const r of Object.values(ev.recurrences || {})) if (r.start >= from && r.start <= to) push(r.start);
      } else if (ev.start && +ev.start <= +to && +ev.start + Math.max(durMs, 1) >= +from) push(ev.start);
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { at: Date.now(), events };
  });

  async function calendar() {
    const c = await config();
    const hide = (c.calendarHide || []).map((s) => s.toLowerCase());
    const raw = await calendarRaw();
    return {
      at: raw.at,
      stale: raw.stale,
      events: raw.events
        .filter((e) => !hide.some((h) => (e.title + ' ' + e.location).toLowerCase().includes(h)))
        .map((e) => ({ ...e, title: tidy(e.title), location: VIRTUAL.test(e.location) ? '' : e.location.split(',')[0], onsite: isOnsite(e) })),
    };
  }

  // ---------- traffic (TomTom) ----------
  async function route(from, to) {
    const j = await getJson(
      `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?traffic=true&travelMode=car&routeType=fastest&key=${tomtomKey}`,
    );
    const s = j.routes[0].summary;
    return { minutes: Math.round(s.travelTimeInSeconds / 60), delayMin: Math.round((s.trafficDelayInSeconds || 0) / 60), miles: +(s.lengthInMeters / 1609.34).toFixed(1) };
  }

  // Where is the next place John has to physically be? A calendar event in the
  // next ~18 h with a real address, an "on-site" tag (mapped via onsitePlaces),
  // or a flight (mapped to the airport, with a bigger buffer).
  async function nextTrip(c) {
    const now = Date.now();
    const raw = (await calendarRaw()).events;
    const hide = (c.calendarHide || []).map((x) => x.toLowerCase());
    for (const e of raw) {
      if (e.allDay || +new Date(e.start) < now - 10 * 60e3 || +new Date(e.start) > now + (c.tripLookaheadHours || 18) * 3600e3) continue;
      if (hide.some((h) => (e.title + ' ' + e.location).toLowerCase().includes(h))) continue;
      let place = null,
        buffer = c.tripBufferMin ?? 10,
        kind = 'meeting';
      if (FLIGHT_WORD.test(e.title)) {
        place = { name: 'TPA Airport', address: c.airportAddress || '4100 George J Bean Pkwy, Tampa, FL 33607' };
        buffer = c.flightBufferMin ?? 100;
        kind = 'flight';
      } else if (e.location && !VIRTUAL.test(e.location)) {
        const known = (c.onsitePlaces || []).find((p) => (e.location + ' ' + e.title).toLowerCase().includes(p.match.toLowerCase()));
        place = known && !/\d/.test(e.location) ? known : { name: e.location.split(',')[0], address: e.location };
      } else if (ONSITE_WORD.test(e.title) || ONSITE_WORD.test(e.location)) {
        place = (c.onsitePlaces || []).find((p) => e.title.toLowerCase().includes(p.match.toLowerCase())) || null;
      }
      if (!place) continue;
      try {
        const g = place.lat ? place : await geocode(place.address);
        const r = await route(await home(), g);
        const leaveBy = new Date(+new Date(e.start) - (r.minutes + buffer) * 60e3);
        return { name: place.name, ...r, lat: g.lat, lon: g.lon, featured: true, kind, event: tidy(e.title), start: e.start, leaveBy: leaveBy.toISOString() };
      } catch (err) {
        log.warn?.('[hearth] trip route failed', err.message);
      }
    }
    return null;
  }

  const commutes = memo(8 * 60e3, async () => {
    const c = await config();
    const h = await home();
    const out = [];
    for (const d of c.destinations || []) {
      try {
        const g = d.lat ? d : await geocode(d.address);
        out.push({ name: d.name, ...(await route(h, g)), lat: g.lat, lon: g.lon });
      } catch (e) {
        out.push({ name: d.name, error: true });
      }
    }
    // Calendar trip takes slot 2 (Suncoast stays pinned first); total stays at 4.
    const trip = await nextTrip(c).catch(() => null);
    if (trip) {
      const dup = out.findIndex((r) => r.name === trip.name);
      if (dup >= 0) out.splice(dup, 1);
      out.splice(1, 0, trip);
      out.length = Math.min(out.length, 4);
    }
    return { at: Date.now(), routes: out };
  });

  const ICON = { 1: 'Crash', 6: 'Jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road work', 14: 'Broken-down vehicle', 3: 'Hazard', 11: 'Flooding', 2: 'Fog', 4: 'Ice', 5: 'Rain', 10: 'Wind' };
  const incidents = memo(3 * 60e3, async () => {
    const c = await config();
    const h = await home();
    const r = c.incidentRadiusKm || 18;
    const dLat = r / 111,
      dLon = r / (111 * Math.cos((h.lat * Math.PI) / 180));
    const bbox = [h.lon - dLon, h.lat - dLat, h.lon + dLon, h.lat + dLat].map((x) => x.toFixed(4)).join(',');
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},from,to,length,delay,roadNumbers,startTime}}}';
    const j = await getJson(
      `https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=en-US&timeValidityFilter=present&key=${tomtomKey}`,
    );
    const list = (j.incidents || []).map((i) => {
      const p = i.properties;
      const coords = i.geometry.type === 'Point' ? [i.geometry.coordinates] : i.geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      return {
        id: p.id,
        kind: ICON[p.iconCategory] || 'Incident',
        icon: p.iconCategory,
        magnitude: p.magnitudeOfDelay, // 0 unknown,1 minor,2 moderate,3 major,4 undefined(closures)
        text: p.events?.map((e) => e.description).join(' · '),
        road: (p.roadNumbers || []).join('/'),
        from: p.from,
        to: p.to,
        delayMin: p.delay ? Math.round(p.delay / 60) : 0,
        lengthKm: p.length ? +(p.length / 1000).toFixed(1) : 0,
        lat: mid[1],
        lon: mid[0],
        line: coords.length > 1 ? coords.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) : null,
      };
    });
    // "Major" means it would change a drive: crashes, real delays, or closures on
    // numbered/long roads. Neighborhood street closures and routine road work
    // (TomTom reports ~150 of those around Tampa at any time) are ignored.
    const km = (i) => Math.hypot((i.lat - h.lat) * 111, (i.lon - h.lon) * 111 * Math.cos((h.lat * Math.PI) / 180));
    const score = (i) => {
      const numbered = !!i.road;
      const mag = i.magnitude >= 1 && i.magnitude <= 3 ? i.magnitude : 0;
      let s = mag * 10 + Math.min(i.delayMin, 45) * 1.5;
      if (i.icon === 1) s += 45; // crash
      if (i.icon === 14) s += 15; // broken-down vehicle
      if (i.icon === 8) s += numbered || i.lengthKm >= 1 ? 35 : -100; // closure
      if (i.icon === 9 || i.icon === 7) s += i.delayMin >= 10 ? 0 : -100; // road work / lane closed
      if (numbered) s += 12;
      s -= km(i) * 0.8; // nearer matters more
      return Math.round(s);
    };
    const seen = new Set();
    const major = list
      .filter((i) => km(i) <= r)
      .map((i) => ({ ...i, score: score(i), distKm: +km(i).toFixed(1) }))
      .filter((i) => i.score >= 25)
      .sort((a, b) => b.score - a.score)
      .filter((i) => {
        // TomTom often lists both directions of one event; keep one.
        const k = [i.icon, [i.from, i.to].sort().join('|')].join(':');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    return { at: Date.now(), center: h, radiusKm: r, incidents: major.slice(0, 10), total: list.length };
  });

  // ---------- storm watch (NOAA nowCOAST rasters) ----------
  // Pulls small WMS images centred on the house and measures the nearest
  // coloured pixel: lightning strike density (15 min) and radar reflectivity.
  async function rasterNearest(service, layer, h, radiusKm, px) {
    const dLat = radiusKm / 111,
      dLon = radiusKm / (111 * Math.cos((h.lat * Math.PI) / 180));
    const bbox = [h.lat - dLat, h.lon - dLon, h.lat + dLat, h.lon + dLon].map((x) => x.toFixed(4)).join(',');
    const url = `https://nowcoast.noaa.gov/geoserver/observations/${service}/ows?service=WMS&version=1.3.0&request=GetMap&layers=${layer}&styles=&crs=EPSG:4326&bbox=${bbox}&width=${px}&height=${px}&format=image/png&transparent=true`;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw Error('nowcoast ' + r.status);
    const png = PNG.sync.read(Buffer.from(await r.arrayBuffer()));
    const kmPerPx = (2 * radiusKm) / px;
    let nearest = Infinity,
      count = 0,
      nx = 0,
      ny = 0;
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        if (png.data[(y * png.width + x) * 4 + 3] < 40) continue;
        count++;
        const d = Math.hypot(x - png.width / 2, y - png.height / 2) * kmPerPx;
        if (d < nearest) (nearest = d), (nx = x - png.width / 2), (ny = png.height / 2 - y);
      }
    const dir = count ? ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360 / 45) % 8] : null;
    return { nearestKm: count ? +nearest.toFixed(1) : null, dir, coverage: +(count / (png.width * png.height)).toFixed(3) };
  }
  const storm = memo(3 * 60e3, async () => {
    const c = await config();
    const h = await home();
    const [lightning, radar, w] = await Promise.all([
      rasterNearest('lightning_detection', 'ldn_lightning_strike_density', h, 60, 120).catch(() => null),
      rasterNearest('weather_radar', 'conus_base_reflectivity_mosaic', h, 60, 120).catch(() => null),
      weather().catch(() => null),
    ]);
    const warnings = (w?.alerts || []).filter((a) => /Warning/.test(a.event)).map((a) => a.event);
    const stormKm = c.storm?.lightningKm ?? 16; // ~10 miles
    const rainKm = c.storm?.rainKm ?? 40;
    const mode = (lightning?.nearestKm != null && lightning.nearestKm <= stormKm) || warnings.length ? 'storm' : radar?.nearestKm != null && radar.nearestKm <= rainKm ? 'rain' : 'clear';
    return { at: Date.now(), mode, lightning, radar, warnings };
  });

  // ---------- morning briefing (Ollama, same model list as the ticker) ----------
  const brief = memo(20 * 60e3, async () => {
    const c = await config();
    const [w, cal, com, inc, st] = await Promise.allSettled([weather(), calendar(), commutes(), incidents(), storm()]);
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const todays = (cal.value?.events || []).filter((e) => (e.allDay ? e.start.slice(0, 10) === today : new Date(e.start).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === today) && new Date(e.end) > now);
    const trip = (com.value?.routes || []).find((r) => r.featured);
    const facts = {
      day: now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }),
      weather: w.value && { now: w.value.now?.tempF, today: w.value.daily?.find((d) => d.day)?.detail, alerts: w.value.alerts?.map((a) => a.event) },
      events: todays.slice(0, 4).map((e) => `${e.allDay ? 'all day' : new Date(e.start).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ${e.title}${e.onsite ? ' (on site)' : ''}`),
      trip: trip && `${trip.event} at ${trip.name}: ${trip.minutes} min drive, leave by ${new Date(trip.leaveBy).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })}`,
      traffic: inc.value?.incidents?.slice(0, 2).map((i) => `${i.kind} ${i.road} ${i.from}`),
      storm: st.value?.mode,
    };
    let text = null;
    for (const m of [].concat(c.ollamaModel || [])) {
      try {
        const r = await fetch((c.ollamaUrl || 'http://127.0.0.1:11434') + '/api/generate', {
          method: 'POST',
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({
            model: m,
            stream: false,
            think: false,
            options: { temperature: 0.5, num_predict: 160 },
            prompt:
              'Write a warm, brief good-morning briefing for John, shown on his living-room TV. Two or three short sentences, under 55 words total, plain text, no emoji, no dollar amounts, no greeting line (the screen already says Good morning). Cover what matters today: weather, the first commitment and when to leave if there is a trip, anything notable on the roads. Use only these facts:\n' +
              JSON.stringify(facts),
          }),
        });
        const j = await r.json();
        text = String(j.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(MONEY, '').replace(/\s+/g, ' ').trim();
        if (text) break;
      } catch {}
    }
    return { at: Date.now(), text, facts, events: todays.slice(0, 4), trip: trip || null, weather: w.value ? { now: w.value.now, today: w.value.daily?.find((d) => d.day), tonight: w.value.daily?.find((d) => !d.day), alerts: w.value.alerts } : null };
  });

  // ---------- guest mode ----------
  async function activeGuest() {
    const c = await config();
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: c.timezone || 'America/New_York' });
    return (c.guests || []).find((g) => g.from <= today && today <= g.to) || null;
  }

  const qrCache = new Map();
  async function wifiQr() {
    const s = secrets();
    if (!s.GUEST_SSID || !s.GUEST_WIFI_PASS) return null;
    const esc = (v) => v.replace(/([\\;,:"])/g, '\\$1');
    const payload = `WIFI:T:WPA;S:${esc(s.GUEST_SSID)};P:${esc(s.GUEST_WIFI_PASS)};;`;
    if (!qrCache.has(payload))
      qrCache.set(payload, await QRCode.toString(payload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#e6f7ff', light: '#00000000' } }));
    return { ssid: s.GUEST_SSID, password: s.GUEST_WIFI_PASS, svg: qrCache.get(payload) };
  }

  // ---------- SITREP line from local Ollama ----------
  const sitrep = memo(20 * 60e3, async () => {
    const c = await config();
    const model = c.ollamaModel;
    if (!model) return { text: null };
    const [w, cal, inc, com] = await Promise.allSettled([weather(), calendar(), incidents(), commutes()]);
    const facts = {
      now: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' }),
      weather: w.value && { now: w.value.now, next: w.value.daily?.slice(0, 2).map((d) => `${d.name}: ${d.short}, ${d.tempF}F, ${d.pop}% rain`), alerts: w.value.alerts?.map((a) => a.event) },
      nextEvents: cal.value?.events.filter((e) => e.end > new Date().toISOString()).slice(0, 3).map((e) => `${e.title} @ ${e.start}`),
      traffic: inc.value?.incidents.slice(0, 3).map((i) => `${i.kind} ${i.road} ${i.from}→${i.to} +${i.delayMin}m`),
      drives: com.value?.routes.map((r) => `${r.name} ${r.minutes}m${r.delayMin ? ` (+${r.delayMin})` : ''}`),
    };
    const prompt =
      'You write the one-line status ticker for a living-room TV in Tampa. Style: calm mission-control briefing, plain English, under 28 words, no emoji, no dollar amounts, no quotes, no preamble. Mention only what matters right now (weather change, a bad traffic spot, the next event). Use only these facts:\n' +
      JSON.stringify(facts) +
      '\nTicker:';
    // ollamaModel may be a list: first is preferred (e.g. a Kimi cloud model),
    // later entries are local fallbacks for when the internet or quota is down.
    let lastErr;
    for (const m of [].concat(model)) {
      try {
        const r = await fetch((c.ollamaUrl || 'http://127.0.0.1:11434') + '/api/generate', {
          method: 'POST',
          signal: AbortSignal.timeout(90000),
          body: JSON.stringify({ model: m, stream: false, think: false, options: { temperature: 0.4, num_predict: 120 }, prompt }),
        });
        if (!r.ok) throw Error('ollama ' + m + ' ' + r.status);
        const j = await r.json();
        const text = String(j.response || '')
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/\s+/g, ' ')
          .replace(MONEY, '')
          .trim()
          .replace(/^(ticker:\s*)/i, '')
          .replace(/^["']|["']$/g, '');
        if (text) return { at: Date.now(), model: m, text };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || Error('no model');
  });

  const safe = (fn) => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await fn(req));
    } catch (e) {
      log.warn?.('[hearth]', req.path, e.message);
      res.status(503).json({ error: 'unavailable' });
    }
  };

  router.get('/weather', safe(weather));
  router.get('/calendar', safe(calendar));
  router.get('/commutes', safe(commutes));
  router.get('/incidents', safe(incidents));
  router.get('/sitrep', safe(sitrep));
  router.get('/storm', safe(storm));
  router.get('/brief', safe(brief));
  router.get(
    '/state',
    safe(async () => {
      const c = await config();
      const g = await activeGuest();
      const notes = await readJson(path.join(hearthDir, 'notes.json'), { lines: [] });
      return {
        home: await home(),
        title: c.title || 'HEARTH',
        countdowns: c.countdowns || [],
        notes: notes.lines || [],
        notesAt: notes.updated || null,
        orbit: c.orbit || {},
        rotate: c.rotate || {},
        wake: { time: '06:45', greetSeconds: 80, ...(c.wake || {}) },
        night: { style: 'surveillance', lateAmberHour: 22, ...(c.night || {}) },
        features: { houseDip: true, planeTags: true, storm: true, ...(c.features || {}) },
        guest: g
          ? { name: g.name, from: g.from, to: g.to, message: g.message || '', schedule: g.schedule || [], houseInfo: c.houseInfo || [], wifi: await wifiQr() }
          : null,
      };
    }),
  );
  // Preview guest mode on demand: /api/hearth/state?guest=preview is not exposed;
  // use /tv?guest=NAME instead, which the client resolves against config.guests.
  router.get(
    '/guest/:name',
    safe(async (req) => {
      const c = await config();
      const g = (c.guests || []).find((x) => x.name.toLowerCase() === String(req.params.name).toLowerCase());
      if (!g) return { guest: null };
      return { guest: { name: g.name, from: g.from, to: g.to, message: g.message || '', schedule: g.schedule || [], houseInfo: c.houseInfo || [], wifi: await wifiQr() } };
    }),
  );

  // Access control: the TV (loopback) needs nothing. Any other device must know
  // HEARTH_TOKEN: open /tv/?k=TOKEN once and a year-long cookie is set. This keeps
  // the calendar and guest Wi-Fi password off the open LAN/Tailscale.
  const isLocal = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
  const cookieOk = (req) => {
    const token = secrets().HEARTH_TOKEN;
    const cookie = /(?:^|;\s*)hearth=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const q = new URL(req.url, 'http://x').searchParams.get('k');
    return token && (cookie === token || q === token) ? (q === token ? 'query' : 'cookie') : null;
  };
  app.use(['/tv', '/api/hearth', '/mirror'], (req, res, next) => {
    if (isLocal(req)) return next();
    // HLS segment/playlist URLs carry a random per-session id issued by the
    // keyed master playlist; Chromecasts send no cookies, so allow those.
    if (req.originalUrl.startsWith('/mirror/api/hls/') && /[?&]id=\w{6,}/.test(req.originalUrl)) return next();
    const ok = cookieOk(req);
    if (!secrets().HEARTH_TOKEN) return res.status(403).send('Remote access is not configured.');
    if (!ok) return res.status(403).send('Not authorized.');
    if (ok === 'query') res.setHeader('Set-Cookie', `hearth=${secrets().HEARTH_TOKEN}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
    next();
  });
  // Screen mirror: go2rtc on 127.0.0.1:1984 (base_path /mirror) serves WebRTC,
  // MP4 and HLS of the TV output. Proxied here so the same key protects it.
  const mirror = createProxyMiddleware({ target: 'http://127.0.0.1:1984', ws: true, pathFilter: '/mirror', logger: undefined });
  app.use(mirror);
  httpServer?.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/mirror')) return;
    if (!isLocal(req) && !cookieOk(req)) return socket.destroy();
    mirror.upgrade(req, socket, head);
  });
  app.use('/api/hearth', router);
  log.log?.('[hearth] TV mode mounted from ' + hearthDir);
}
