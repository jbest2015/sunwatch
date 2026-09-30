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
  if (STATE) {
    applyDayNight();
    checkGreeting();
  }
}
const hourNow = () => +new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }) % 24;
const hmNow = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

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
      return `<div class="ev ${live ? 'now' : ''} ${past ? 'past' : ''} ${e.onsite ? 'onsite' : ''}"><div class="t">${e.allDay ? 'ALL DAY' : live ? 'NOW' : fmtTime(e.start).replace(' ', '')}</div><div class="n">${esc(e.title)}${e.location ? `<span class="l">${esc(e.location)}</span>` : ''}</div></div>`;
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
  $('notes-at').textContent = STATE.notesAt ? new Date(String(STATE.notesAt).length === 10 ? STATE.notesAt + 'T12:00:00' : STATE.notesAt).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }).toUpperCase() : '';
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
        if (r.featured)
          return `<div class="cm trip"><div class="ev-name">${r.kind === 'flight' ? '✈ ' : '◆ '}${esc(r.event)}</div><div class="row"><span class="n">${esc(r.name)}</span><span class="m">${r.minutes}<small>MIN</small></span></div><div class="row"><span class="n">${r.delayMin ? '+' + r.delayMin + ' traffic' : 'clear'}</span><span class="leave">LEAVE ${fmtTime(r.leaveBy).replace(' ', '')}</span></div></div>`;
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
  drawIncidents();
  drawHome();
  NIGHT = null;
  applyDayNight();
  updateStorm();
  director();
  if (qs.has('greet')) setTimeout(showGreeting, 6000);
  window.__hearth = { TAGS, camState, G, get STORM() { return STORM; }, refreshPlaneTags, houseDip }; // debug hook for tests
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
    #data-panel, #hud-rec-dot, .panel-collapsible, .panel-glow { display: none !important; }
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
    followTags();
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
  if (qs.get('focus')) {
    const [la, lo] = qs.get('focus').split(',').map(Number);
    h = { lat: la, lon: lo };
  }
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

// ---------------------------------------------------------------- director
// Every cycle: orbit, then one "visit": the worst traffic incident, or every 4th
// cycle a dip to the house, or (when rain is near) a radar pass every 3rd cycle.
let cycle = 0,
  busy = false;
async function director() {
  await sleep(4000);
  let first = qs.has('visit') || qs.has('dip') || qs.has('radar');
  for (;;) {
    await sleep(first ? 3000 : (STATE.rotate.orbitSeconds || 75) * 1000);
    if (GREETING || stormActive) {
      first = false;
      continue;
    }
    cycle++;
    busy = true;
    try {
      if ((first && qs.has('dip')) || (!first && STATE.features.houseDip && cycle % 4 === 0)) await houseDip();
      else if ((first && qs.has('radar')) || (!first && STORM.mode === 'rain' && cycle % 3 === 0)) await radarVisit();
      else {
        const target = INCIDENTS.find((i) => !i._seenAt || Date.now() - i._seenAt > 20 * 60e3) || INCIDENTS[0];
        if (target && !STATE.guest?.quiet) {
          target._seenAt = Date.now();
          await visit(target);
        }
      }
    } catch (e) {
      console.warn('[hearth] director', e.message);
    } finally {
      busy = false;
      first = false;
    }
  }
}

const orbitHome = (ms = 6000) => flyTo({ lat: STATE.home.lat, lon: STATE.home.lon, range: STATE.orbit.range || 11000, pitch: STATE.orbit.pitch || -30 }, ms);

// ---------------------------------------------------------------- the house
function homeSvg() {
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="42" fill="none" stroke="#6fe3ff" stroke-width="4" stroke-dasharray="10 6"/><path d="M48 24 L70 44 L64 44 L64 68 L32 68 L32 44 L26 44 Z" fill="#6fe3ff"/></svg>`);
}
function drawHome() {
  if (G.homeEnt) return;
  const h = STATE.home;
  G.homeEnt = G.v.entities.add({
    position: G.C3.fromDegrees(h.lon, h.lat, 20),
    billboard: { image: homeSvg(), scale: 0.45, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    label: { text: 'HOME', font: '700 24px "JetBrains Mono", monospace', fillColor: G.Color.fromCssColorString('#6fe3ff'), outlineColor: G.Color.fromCssColorString('#000'), outlineWidth: 4, style: 2, verticalOrigin: -1, disableDepthTestDistance: Number.POSITIVE_INFINITY, show: false },
  });
}
async function houseDip() {
  const h = STATE.home;
  G.homeEnt.label.show = true;
  G.homeEnt.billboard.scale = 0.7;
  if (G.C2) {
    G.homeEnt.label.verticalOrigin = 1;
    G.homeEnt.label.pixelOffset = new G.C2(0, -42);
  }
  await flyTo({ lat: h.lat, lon: h.lon, range: 850, pitch: -55 }, 7000);
  const saved = orbitSpeed;
  orbitSpeed = 3.5;
  await sleep(16000);
  await orbitHome(7000);
  orbitSpeed = saved;
  G.homeEnt.label.show = false;
  G.homeEnt.billboard.scale = 0.45;
}

// ---------------------------------------------------------------- day / night
// Night-vision globe from dusk to dawn (sun times computed locally), amber HUD late at night.
let NIGHT = null;
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180,
    J1970 = 2440588,
    J2000 = 2451545;
  const toJ = (t) => t / 86400000 - 0.5 + J1970;
  const fromJ = (j) => new Date((j + 0.5 - J1970) * 86400000);
  const noonLocal = new Date(date.toLocaleDateString('en-CA', { timeZone: TZ }) + 'T12:00:00');
  const days = toJ(+noonLocal) - J2000;
  const lw = -lon * rad,
    phi = lat * rad;
  const n = Math.round(days - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const M = rad * (357.5291 + 0.98560028 * ds);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(rad * 23.4397));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: fromJ(Jnoon - (Jset - Jnoon)), set: fromJ(Jset) };
}
function applyDayNight() {
  const now = new Date();
  const { rise, set } = sunTimes(now, STATE.home.lat, STATE.home.lon);
  $('sun').textContent = `SUNRISE ${fmtTime(rise).replace(' ', '')}  ·  SUNSET ${fmtTime(set).replace(' ', '')}`;
  const night = qs.has('night') ? qs.get('night') !== '0' : now < new Date(+rise - 40 * 60e3) || now > new Date(+set + 20 * 60e3);
  const h = hourNow();
  document.body.classList.toggle('late', qs.has('late') || h >= (STATE.night.lateAmberHour ?? 22) || h < 5);
  document.body.classList.toggle('night', h >= 23 || h < 5);
  if (night !== NIGHT && G.gev?.styleManager) {
    NIGHT = night;
    try {
      G.gev.styleManager.setStyle(night ? STATE.night.style || 'surveillance' : 'normal', { applyPreset: true, revealParameters: false });
    } catch (e) {
      console.warn('[hearth] style', e.message);
    }
  }
}

// ---------------------------------------------------------------- storm mode
let STORM = { mode: 'clear' },
  stormActive = false,
  stormSince = 0;
function setLayer(id, on) {
  try {
    G.gev?.dataManager?.setEnabled(id, on, { origin: 'programmatic' });
  } catch (e) {
    console.warn('[hearth] layer', id, e.message);
  }
}
async function loadStorm() {
  try {
    STORM = qs.get('storm') === 'test' ? { mode: 'storm', lightning: { nearestKm: 9.4, dir: 'SW' }, radar: { nearestKm: 2.1, dir: 'W', coverage: 0.3 }, warnings: ['Severe Thunderstorm Warning'] } : await api('storm');
  } catch {
    return;
  }
  updateStorm();
}
function updateStorm() {
  if (!G.v || STATE.features.storm === false) return;
  const hot = STORM.mode === 'storm';
  if (hot) stormSince = Date.now();
  const active = hot || (stormActive && Date.now() - stormSince < 30 * 60e3);
  if (active !== stormActive) {
    stormActive = active;
    setLayer('weather-radar', active);
    setLayer('weather-lightning', active);
    if (active) flyTo({ lat: STATE.home.lat, lon: STATE.home.lon, range: 60000, pitch: -58 }, 7000);
    else orbitHome(7000);
  }
  $('storm').classList.toggle('hidden', !active);
  if (!active) return;
  const L = STORM.lightning,
    R = STORM.radar;
  const mi = (km) => (km * 0.621).toFixed(km < 8 ? 1 : 0);
  $('st-kind').textContent = (STORM.warnings?.[0] || 'Storm watch').toUpperCase();
  $('st-main').textContent = L?.nearestKm != null ? `⚡ LIGHTNING ${mi(L.nearestKm)} MI ${L.dir || ''}` : hot ? 'WARNING IN EFFECT' : 'STORM PASSING';
  $('st-main').classList.toggle('flash', L?.nearestKm != null && L.nearestKm < 16);
  $('st-sub').textContent = R?.nearestKm != null ? (R.nearestKm < 3 ? 'Rain overhead' : `Rain ${mi(R.nearestKm)} mi ${R.dir || ''}`) + ' · live radar and strikes' : 'Live radar and strikes';
  $('st-age').textContent = hot ? 'LIVE' : 'CLEARING';
}
async function radarVisit() {
  setLayer('weather-radar', true);
  $('storm').classList.remove('hidden');
  $('st-kind').textContent = 'RADAR';
  $('st-main').classList.remove('flash');
  $('st-main').textContent = STORM.radar?.nearestKm != null ? `RAIN ${(STORM.radar.nearestKm * 0.621).toFixed(0)} MI ${STORM.radar.dir || ''}` : 'RAIN NEARBY';
  $('st-sub').textContent = 'Live NOAA radar';
  $('st-age').textContent = '';
  await flyTo({ lat: STATE.home.lat, lon: STATE.home.lon, range: 80000, pitch: -62 }, 7000);
  await sleep(20000);
  $('storm').classList.add('hidden');
  await orbitHome(7000);
  if (!stormActive) setLayer('weather-radar', false);
}

// ---------------------------------------------------------------- plane tags
// Labels ride on the flights layer's own billboards (id = ICAO hex), so they sit
// exactly on the rendered aircraft; data comes from the layer's analyst records.
const TAGS = new Map();
let BBC = null;
function findFlightCollection() {
  const walk = (c, d) => {
    for (let i = 0; i < (c.length || 0); i++) {
      const x = c.get(i);
      if (!x) continue;
      if (x._billboards && x.length) {
        const id = x.get(0)?.id;
        if (typeof id === 'string' && /^[0-9a-f]{6}$/i.test(id)) return x;
      } else if (x.get && x.length && d < 3) {
        const r = walk(x, d + 1);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(G.v.scene.primitives, 0);
}
function refreshPlaneTags() {
  if (!G.v || STATE.features.planeTags === false) return;
  const mod = G.gev.dataManager.layers?.get('flights')?.module;
  const recs = mod?.getAnalystRecords?.(800) || [];
  if (!BBC || BBC.isDestroyed?.()) BBC = findFlightCollection();
  if (!BBC) return;
  if (!G.C2) G.C2 = BBC.get(0).pixelOffset.constructor;
  const idx = new Map();
  for (let i = 0; i < BBC.length; i++) {
    const b = BBC.get(i);
    if (b.show !== false) idx.set(b.id, b);
  }
  const R = +qs.get('tagradius') || Math.max(6, (camState.range / 1000) * 1.3);
  const near = recs
    .filter((r) => !r.onGround && r.lat != null && idx.has(r.icao24))
    .map((r) => ({ r, d: Math.hypot((r.lat - camState.lat) * 111, (r.lon - camState.lon) * 97) }))
    .filter((x) => x.d < R)
    .sort((a, b) => a.d - b.d)
    .slice(0, stormActive ? 0 : 6);
  const keep = new Set(near.map((x) => x.r.icao24));
  for (const [k, t] of TAGS)
    if (!keep.has(k)) {
      G.v.entities.remove(t.ent);
      TAGS.delete(k);
    }
  for (const { r } of near) {
    const ft = r.altitudeM != null ? `${Math.round((r.altitudeM * 3.281) / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' ft' : '';
    const kt = r.speedMps != null ? Math.round(r.speedMps * 1.944) + ' kt' : '';
    const route = r.routeOrigin && r.routeDestination ? `\n${r.routeOrigin} → ${r.routeDestination}` : r.operator ? `\n${r.operator}` : '';
    const text = `${r.callsign || r.id}  ${ft}  ${kt}`.trim() + route;
    let t = TAGS.get(r.icao24);
    if (!t) {
      t = {
        ent: G.v.entities.add({
          position: idx.get(r.icao24).position,
          label: { text, font: '600 20px "JetBrains Mono", monospace', fillColor: G.Color.fromCssColorString('#e6f4ff'), showBackground: true, backgroundColor: G.Color.fromCssColorString('rgba(4,12,20,0.62)'), horizontalOrigin: 1, verticalOrigin: 1, pixelOffset: new G.C2(18, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        }),
      };
      TAGS.set(r.icao24, t);
    } else t.ent.label.text = text;
    t.bb = idx.get(r.icao24);
  }
}
function followTags() {
  for (const t of TAGS.values()) if (t.bb && t.ent.position?.setValue) t.ent.position.setValue(t.bb.position);
}

// ---------------------------------------------------------------- morning greeting
let GREETING = false,
  greetedDay = null;
function checkGreeting() {
  const wake = STATE.wake?.time || '06:45';
  const [h, m] = wake.split(':').map(Number);
  const pre = `${String(h).padStart(2, '0')}:${String(Math.max(0, m - 10)).padStart(2, '0')}`;
  if (hmNow() === pre && !checkGreeting.warmed) {
    checkGreeting.warmed = true; // warm the briefing so the model has answered by wake time
    api('brief').catch(() => {});
  }
  if (hmNow() === wake && greetedDay !== dayKey(new Date())) showGreeting();
}
// Fallback when the TV could not be woken at wake time: greet the first time the
// TV is switched on during the morning window (wake time → 11:00).
let tvWasUp = null;
async function watchTv() {
  let up;
  try {
    up = (await api('tv')).up;
  } catch {
    return;
  }
  const wake = STATE?.wake?.time || '06:45';
  const hm = hmNow();
  const inWindow = hm >= wake && hm < (STATE?.wake?.windowEnd || '11:00');
  if (up && tvWasUp === false && inWindow && greetedDay !== dayKey(new Date()) && !GREETING) showGreeting();
  tvWasUp = up;
}
async function showGreeting() {
  greetedDay = dayKey(new Date());
  checkGreeting.warmed = false;
  GREETING = true;
  let b = {};
  try {
    b = await api('brief');
  } catch {}
  $('g-date').textContent = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
  const w = b.weather || {};
  $('g-wx').innerHTML = `<div class="k">WEATHER</div><div class="g-wx-big">${w.now?.tempF ?? w.today?.tempF ?? '--'}°</div><div class="g-wx-line">${esc(w.today?.short || w.now?.text || '')}</div><div class="g-wx-line dim">High ${w.today?.tempF ?? '--'}° · Low ${w.tonight?.tempF ?? '--'}°${w.today?.pop ? ` · ${w.today.pop}% rain` : ''}</div>`;
  const evs = (b.events || []).slice(0, 4);
  $('g-day').innerHTML = `<div class="k">TODAY</div>${evs.length ? evs.map((e) => `<div class="g-ev ${e.onsite ? 'onsite' : ''}"><span class="t">${e.allDay ? 'ALL DAY' : fmtTime(e.start).replace(' ', '')}</span><span>${esc(e.title)}</span></div>`).join('') : '<div class="g-ev"><span class="t">—</span><span>Nothing on the calendar</span></div>'}${b.trip ? `<div class="g-trip">LEAVE BY ${fmtTime(b.trip.leaveBy)} · ${b.trip.minutes} MIN TO ${esc(b.trip.name.toUpperCase())}</div>` : ''}`;
  $('g-text').textContent = b.text || '';
  document.body.classList.add('greeting');
  $('greet').classList.remove('hidden');
  if (G.v) flyTo({ lat: STATE.home.lat, lon: STATE.home.lon, range: 3200, pitch: -42 }, 9000);
  await sleep((STATE.wake?.greetSeconds || 80) * 1000);
  $('greet').classList.add('hidden');
  document.body.classList.remove('greeting');
  if (G.v) orbitHome(8000);
  GREETING = false;
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

// ---------------------------------------------------------------- fit to any screen
// The HUD is authored at 1920x1080 for the TV; laptops and phones get it scaled.
function fit() {
  const z = Math.min(innerWidth / 1920, innerHeight / 1080);
  document.documentElement.style.zoom = Math.abs(z - 1) < 0.01 ? '' : z;
}
addEventListener('resize', fit);

// ---------------------------------------------------------------- boot
async function main() {
  fit();
  if (!/^(127\.|localhost)/.test(location.hostname)) document.body.style.cursor = 'default';
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
  loadStorm();
  setInterval(loadStorm, 3 * 60e3);
  setInterval(refreshPlaneTags, 3000);
  watchTv();
  setInterval(watchTv, 10000);
  // Daily hard refresh at 4:10am keeps WebGL memory fresh on a 24/7 kiosk.
  setInterval(() => {
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    if (t === '04:10') location.reload();
  }, 60e3);
}
main();
