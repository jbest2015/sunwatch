// Hearth TV client: drives the God's Eye globe in a same-origin iframe and
// renders the glass HUD. No input devices are expected; everything is timed.
const $ = (id) => document.getElementById(id);
const TZ = 'America/New_York';
const qs = new URLSearchParams(location.search);
const api = (p) => fetch('/api/hearth/' + p, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });

let STATE = null;
let INCIDENTS = [];
let CAMERAS = null;

// ---------------------------------------------------------------- clock
function tickClock() {
  const now = new Date();
  const parts = now.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).split(' ');
  $('time').innerHTML = `${parts[0]}<span class="ampm">${parts[1] || ''}</span>`;
  $('date').textContent = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const h = +now.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false });
  document.body.classList.toggle('night', h >= 23 || h < 5);
}

// ---------------------------------------------------------------- weather
async function loadWeather() {
  try {
    const w = await api('weather');
    const now = w.now || {};
    const first = w.hourly[0] || {};
    $('wx-temp').textContent = (now.tempF ?? first.tempF ?? '--') + '°';
    $('wx-text').textContent = now.text || first.short || '';
    const today = w.daily.filter((d) => d.day)[0];
    const tonight = w.daily.filter((d) => !d.day)[0];
    $('wx-hilo').textContent = [today && `H ${today.tempF}°`, tonight && `L ${tonight.tempF}°`, now.humidity != null && `${now.humidity}% RH`, now.windMph != null && `${now.windMph} mph`].filter(Boolean).join('  ·  ');
    $('wx-station').textContent = now.station || '';
    spark(w.hourly);
    $('wx-hours').innerHTML = w.hourly
      .filter((_, i) => i % 2 === 0)
      .slice(0, 6)
      .map((h) => `<div>${new Date(h.t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric' }).replace(' ', '').toLowerCase()}<b>${h.tempF}°</b>${h.pop >= 20 ? `<span style="color:var(--cyan)">${h.pop}%</span>` : '&nbsp;'}</div>`)
      .join('');
    $('wx-alerts').innerHTML = w.alerts
      .slice(0, 2)
      .map((a) => `<div class="alert ${/Extreme|Severe/.test(a.severity) ? 'severe' : ''}">⚠ ${esc(a.event)}</div>`)
      .join('');
    RAIN_SOON = w.hourly.slice(0, 4).some((h) => h.pop >= 50);
    SEVERE = w.alerts.some((a) => /Hurricane|Tropical Storm|Tornado|Severe Thunderstorm Warning/.test(a.event));
    WX_TEXT = [now.tempF != null && `${now.tempF}° ${now.text || ''}`, w.daily[0] && `${w.daily[0].name}: ${w.daily[0].short}, ${w.daily[0].pop || 0}% rain`].filter(Boolean).join(' · ');
  } catch {}
}
let RAIN_SOON = false,
  SEVERE = false,
  WX_TEXT = '';

function spark(hours) {
  const svg = $('wx-spark');
  const t = hours.map((h) => h.tempF);
  const lo = Math.min(...t) - 2,
    hi = Math.max(...t) + 2;
  const x = (i) => (i / (hours.length - 1)) * 400;
  const y = (v) => 80 - ((v - lo) / (hi - lo)) * 64;
  const line = t.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const bars = hours.map((h, i) => (h.pop ? `<rect x="${x(i) - 6}" y="${88 - h.pop * 0.5}" width="12" height="${h.pop * 0.5}" fill="rgba(111,227,255,.35)"/>` : '')).join('');
  svg.innerHTML = `${bars}<path d="${line} L400,90 L0,90Z" fill="rgba(111,227,255,.08)"/><path d="${line}" fill="none" stroke="#6fe3ff" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`;
}

// ---------------------------------------------------------------- calendar
async function loadCalendar() {
  try {
    const c = await api('calendar');
    const now = new Date();
    const today = dayKey(now);
    const tomorrow = dayKey(new Date(+now + 86400e3));
    const groups = { [today]: [], [tomorrow]: [] };
    for (const e of c.events) {
      if (new Date(e.end) < new Date(+now - 3600e3)) continue;
      const k = e.allDay ? e.start.slice(0, 10) : dayKey(e.start);
      if (groups[k]) groups[k].push(e);
      else if (e.allDay && e.start.slice(0, 10) <= today && e.end.slice(0, 10) > today) groups[today].push(e);
    }
    const row = (e) => {
      const live = !e.allDay && new Date(e.start) <= now && new Date(e.end) > now;
      const past = !e.allDay && new Date(e.end) <= now;
      return `<div class="ev ${live ? 'now' : ''} ${past ? 'past' : ''}"><div class="t">${e.allDay ? 'ALL DAY' : live ? 'NOW' : fmtTime(e.start).replace(' ', '')}</div><div class="n">${esc(e.title)}${e.location ? `<span class="l">${esc(e.location)}</span>` : ''}</div></div>`;
    };
    let html = '';
    for (const [k, label] of [
      [today, 'TODAY'],
      [tomorrow, 'TOMORROW'],
    ]) {
      html += `<div class="day-label">${label}</div>`;
      html += groups[k].length ? groups[k].slice(0, label === 'TODAY' ? 5 : 3).map(row).join('') : `<div class="empty">Nothing scheduled</div>`;
    }
    $('cal').innerHTML = html;
    $('cal-stale').textContent = c.stale ? 'CACHED' : '';
    NEXT_EVENT = c.events.find((e) => !e.allDay && new Date(e.start) > now);
  } catch {}
}
let NEXT_EVENT = null;

// ---------------------------------------------------------------- state: countdowns, notes, guest
async function loadState() {
  try {
    STATE = await api('state');
    if (qs.get('guest')) {
      const g = await api('guest/' + encodeURIComponent(qs.get('guest')));
      if (g.guest) STATE.guest = g.guest;
    }
  } catch {
    return;
  }
  $('title').textContent = STATE.title;
  const today = dayKey(new Date());
  const days = (d) => Math.round((new Date(d + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400e3);
  $('countdowns').innerHTML = STATE.countdowns
    .map((c) => ({ ...c, n: days(c.date) }))
    .filter((c) => c.n >= 0 && c.n <= (c.showWithinDays || 120))
    .sort((a, b) => a.n - b.n)
    .slice(0, 4)
    .map((c) => `<div class="cd ${c.n === 0 ? 'today' : ''}"><div class="d">${c.n === 0 ? 'TODAY' : c.n}${c.n ? `<small>${c.n === 1 ? 'DAY' : 'DAYS'}</small>` : ''}</div><div class="lbl">${esc(c.label)}</div></div>`)
    .join('');
  const g = STATE.guest;
  document.body.classList.toggle('guest', !!g);
  $('guest').classList.toggle('hidden', !g);
  $('notes').classList.toggle('hidden', !!g || !STATE.notes.length);
  $('notes-list').innerHTML = STATE.notes.slice(0, 4).map((l) => `<li>${esc(l)}</li>`).join('');
  $('notes-at').textContent = STATE.notesAt ? new Date(STATE.notesAt).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).toUpperCase() : '';
  if (g) {
    $('guest-name').textContent = g.name;
    $('guest-msg').textContent = g.message;
    if (g.wifi) {
      $('wifi-qr').innerHTML = g.wifi.svg;
      $('wifi-ssid').textContent = g.wifi.ssid;
      $('wifi-pass').textContent = g.wifi.password;
    }
    $('guest-sched').innerHTML = g.schedule.length ? `<div class="day-label">THE PLAN</div>` + g.schedule.map((s) => `<div class="gi"><div class="k">${esc(s.when)}</div><div>${esc(s.what)}</div></div>`).join('') : '';
    $('house-info').innerHTML = g.houseInfo.length ? `<div class="day-label">HOUSE</div>` + g.houseInfo.map((s) => `<div class="gi"><div class="k">${esc(s.k)}</div><div>${esc(s.v)}</div></div>`).join('') : '';
  }
}

// ---------------------------------------------------------------- traffic
async function loadCommutes() {
  try {
    const c = await api('commutes');
    $('commutes').innerHTML = c.routes
      .map((r) => {
        if (r.error) return `<div class="cm"><span class="n">${esc(r.name)}</span><span class="m">—</span></div>`;
        const cls = r.delayMin >= 12 ? 'bad' : r.delayMin >= 5 ? 'slow' : 'ok';
        return `<div class="cm ${cls}"><span class="n">${esc(r.name)}</span><span><span class="m">${r.minutes}<small>MIN</small></span><span class="dl">${r.delayMin ? '+' + r.delayMin : 'CLEAR'}</span></span></div>`;
      })
      .join('');
  } catch {}
}

async function loadIncidents() {
  try {
    const j = await api('incidents');
    INCIDENTS = j.incidents;
    drawIncidents();
  } catch {}
}

let SITREP = '';
async function loadSitrep() {
  try {
    const s = await api('sitrep');
    if (s.text) SITREP = s.text;
  } catch {}
}

function renderTicker() {
  const items = [];
  if (SITREP) items.push(esc(SITREP));
  else if (WX_TEXT) items.push(esc(WX_TEXT));
  if (NEXT_EVENT && !STATE?.guest) items.push(`Next: ${esc(NEXT_EVENT.title)} at ${fmtTime(NEXT_EVENT.start)}`);
  for (const i of INCIDENTS.slice(0, 5)) items.push(`<span class="${i.score >= 50 ? 'hot' : ''}">${esc(i.kind.toUpperCase())}</span> ${esc(i.road || '')} ${esc(i.from || '')}${i.to ? ' → ' + esc(i.to) : ''}${i.delayMin ? ` <b>+${i.delayMin} min</b>` : ''}`);
  if (!INCIDENTS.length) items.push('No major traffic incidents nearby');
  const el = $('ticker-text');
  const html = items.join('<span class="sep">◆</span>');
  el.classList.remove('scroll');
  el.innerHTML = html;
  const track = el.parentElement.clientWidth;
  if (el.scrollWidth > track) {
    el.innerHTML = html + '<span class="sep">◆</span>' + html + '<span class="sep">◆</span>';
    el.style.animationDuration = Math.max(30, el.scrollWidth / 2 / 70) + 's';
    el.classList.add('scroll');
  }
}

// ---------------------------------------------------------------- globe control
const G = { win: null, v: null, C3: null, M4: null, Color: null, ents: [], cam: null };

function globeUrl(h) {
  const layers = ['t', 'f', ...(qs.get('layers') ? qs.get('layers').split('.') : [])];
  const p = new URLSearchParams({ lat: h.lat.toFixed(5), lon: h.lon.toFixed(5), alt: '9000', heading: '0', pitch: '-35', v: '2', l: [...new Set(layers)].join('.') });
  return '/#' + p.toString();
}

async function bootGlobe() {
  const f = $('globe');
  f.src = globeUrl(STATE.home);
  await new Promise((res) => f.addEventListener('load', res, { once: true }));
  G.win = f.contentWindow;
  for (let i = 0; i < 240 && !G.win.__godsEyeView?.viewer; i++) await sleep(500);
  const gev = G.win.__godsEyeView;
  if (!gev) return console.warn('globe did not expose viewer');
  G.v = gev.viewer;
  G.gev = gev;
  G.C3 = G.v.camera.position.constructor;
  G.M4 = G.v.camera.transform.constructor;
  G.Color = G.v.scene.backgroundColor.constructor;
  hideGlobeChrome(f.contentDocument);
  G.v.scene.requestRenderMode = false;
  startOrbit(STATE.home);
  director();
}

// Hide the interactive SunWatch UI; keep the canvas and attribution.
function hideGlobeChrome(doc) {
  const s = doc.createElement('style');
  s.textContent = `
    body > *:not(#cesiumContainer):not(script):not(style) { visibility: hidden !important; }
    #cesiumContainer, #cesiumContainer * { visibility: visible !important; }
    .cesium-viewer-toolbar, .cesium-viewer-animationContainer, .cesium-viewer-timelineContainer,
    .cesium-viewer-fullscreenContainer, .cesium-viewer-bottom .cesium-credit-logoContainer { display: none !important; }
    .cesium-viewer-bottom { opacity: .55; transform: scale(.85); transform-origin: left bottom; }
    * { cursor: none !important; }`;
  doc.head.appendChild(s);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Camera = look at `center` from range/heading/pitch. Everything tweens through this.
const camState = { lat: 0, lon: 0, range: 9000, heading: 0, pitch: -32 };
function applyCamera() {
  const { C3, v } = G;
  const target = C3.fromDegrees(camState.lon, camState.lat, 0);
  const h = (camState.heading * Math.PI) / 180,
    p = (camState.pitch * Math.PI) / 180;
  const horiz = camState.range * Math.cos(p);
  const offset = new C3(-horiz * Math.sin(h), -horiz * Math.cos(h), -camState.range * Math.sin(p));
  v.camera.lookAt(target, offset);
}

let orbitSpeed = 2.2; // deg/sec
let lastFrame = performance.now();
let tween = null;
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (G.v) {
    if (tween) {
      const t = Math.min(1, (now - tween.t0) / tween.ms);
      const k = ease(t);
      for (const key of Object.keys(tween.to)) camState[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * k;
      if (t >= 1) {
        const done = tween.done;
        tween = null;
        done?.();
      }
    }
    camState.heading = (camState.heading + orbitSpeed * dt) % 360;
    applyCamera();
    pulseIncidents(now);
  }
  requestAnimationFrame(frame);
}

function flyTo(to, ms) {
  return new Promise((done) => {
    const from = { ...camState };
    // take the short way around for heading
    if (to.heading != null) {
      let d = ((to.heading - from.heading + 540) % 360) - 180;
      to = { ...to, heading: from.heading + d };
    }
    tween = { from, to, t0: performance.now(), ms, done };
  });
}

function startOrbit(h) {
  Object.assign(camState, { lat: h.lat, lon: h.lon, range: STATE.orbit.range || 11000, pitch: STATE.orbit.pitch || -30, heading: 20 });
  orbitSpeed = STATE.orbit.speed || 2.2;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- incident markers
function ringSvg(color) {
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="40" fill="none" stroke="${color}" stroke-width="5"/><circle cx="48" cy="48" r="12" fill="${color}"/></svg>`);
}
function drawIncidents() {
  if (!G.v) return;
  for (const e of G.ents) G.v.entities.remove(e);
  G.ents = [];
  const { C3, Color } = G;
  for (const i of INCIDENTS) {
    const hot = i.score >= 50;
    const col = hot ? '#ff4d5e' : '#ffb547';
    G.ents.push(
      G.v.entities.add({
        position: C3.fromDegrees(i.lon, i.lat, 30),
        billboard: { image: ringSvg(col), scale: 0.5, verticalOrigin: -1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: `${i.kind.toUpperCase()}${i.delayMin ? ' +' + i.delayMin + 'm' : ''}`,
          font: '600 26px "Chakra Petch", sans-serif',
          fillColor: Color.fromCssColorString(col),
          outlineColor: Color.fromCssColorString('#000'),
          outlineWidth: 4,
          style: 2, // FILL_AND_OUTLINE
          verticalOrigin: 1, // BOTTOM: label sits above the point
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        _pulse: hot ? 1 : 0.6,
      }),
    );
    if (i.line && i.line.length > 1)
      G.ents.push(
        G.v.entities.add({
          polyline: { positions: C3.fromDegreesArray(i.line.flat()), width: 7, material: Color.fromCssColorString(col).withAlpha(0.85), clampToGround: true },
        }),
      );
  }
}
function pulseIncidents(now) {
  const s = 0.45 + 0.18 * (0.5 + 0.5 * Math.sin(now / 280));
  for (const e of G.ents) if (e.billboard) e.billboard.scale = s * (e._pulse || 1);
}

// ---------------------------------------------------------------- FL511 camera near a point
async function nearestCamera(lat, lon, maxKm = 2.5) {
  if (!CAMERAS) {
    try {
      const j = await fetch('/api/cctv/sources').then((r) => r.json());
      CAMERAS = (j.sources || j).filter((s) => Number.isFinite(+s.lat ?? +s.latitude)).map((s) => ({ id: s.id, lat: +(s.lat ?? s.latitude), lon: +(s.lon ?? s.lng ?? s.longitude) }));
    } catch {
      CAMERAS = [];
    }
  }
  let best = null,
    bd = Infinity;
  for (const c of CAMERAS) {
    const dy = (c.lat - lat) * 111,
      dx = (c.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const d = Math.hypot(dx, dy);
    if (d < bd) (bd = d), (best = c);
  }
  return bd <= maxKm ? best : null;
}

// ---------------------------------------------------------------- director: orbit ⇄ visit incidents
async function director() {
  await sleep(4000);
  for (;;) {
    await sleep((STATE.rotate.orbitSeconds || 75) * 1000);
    const target = INCIDENTS.find((i) => !i._seenAt || Date.now() - i._seenAt > 20 * 60e3) || INCIDENTS[0];
    if (!target || STATE.guest?.quiet) continue;
    target._seenAt = Date.now();
    await visit(target);
  }
}

async function visit(i) {
  const home = STATE.home;
  $('co-kind').textContent = i.kind.toUpperCase();
  $('co-delay').textContent = i.delayMin ? `+${i.delayMin} MIN` : '';
  $('co-road').textContent = [i.road, i.from].filter(Boolean).join(' · ') || 'Nearby';
  $('co-text').textContent = [i.to && 'toward ' + i.to, i.text].filter(Boolean).join(' — ');
  const cam = await nearestCamera(i.lat, i.lon);
  $('co-cam').classList.toggle('hidden', !cam);
  if (cam) {
    $('co-img').src = `/api/cctv/frame/${encodeURIComponent(cam.id)}?t=${Date.now()}`;
    $('co-camid').textContent = String(cam.id).replace('fl511-', '#');
  }
  const saved = orbitSpeed;
  orbitSpeed = 4;
  await flyTo({ lat: i.lat, lon: i.lon, range: 2600, pitch: -38 }, 5000);
  $('callout').classList.remove('hidden');
  const refresh = cam ? setInterval(() => ($('co-img').src = `/api/cctv/frame/${encodeURIComponent(cam.id)}?t=${Date.now()}`), 8000) : null;
  await sleep((STATE.rotate.visitSeconds || 22) * 1000);
  clearInterval(refresh);
  $('callout').classList.add('hidden');
  await flyTo({ lat: home.lat, lon: home.lon, range: STATE.orbit.range || 11000, pitch: STATE.orbit.pitch || -30 }, 6000);
  orbitSpeed = saved;
}

// ---------------------------------------------------------------- boot
async function main() {
  tickClock();
  setInterval(tickClock, 1000);
  await loadState();
  if (!STATE) {
    await sleep(5000);
    return location.reload();
  }
  await Promise.all([loadWeather(), loadCalendar(), loadCommutes(), loadIncidents()]);
  renderTicker();
  bootGlobe();
  loadSitrep().then(renderTicker);
  setInterval(loadState, 60e3);
  setInterval(loadWeather, 10 * 60e3);
  setInterval(loadCalendar, 5 * 60e3);
  setInterval(loadCommutes, 8 * 60e3);
  setInterval(loadIncidents, 3 * 60e3);
  setInterval(() => loadSitrep().then(renderTicker), 20 * 60e3);
  setInterval(renderTicker, 3 * 60e3);
  // Daily hard refresh at 4:10am keeps WebGL memory fresh on a 24/7 kiosk.
  setInterval(() => {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    if (t === '04:10') location.reload();
  }, 60e3);
}
main();
