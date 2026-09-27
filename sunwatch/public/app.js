import { STATUS, normalizeLocation, matches, html as h } from './model.js';
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
let custom = read('sunwatch.locations.v1', []),
  updates = read('sunwatch.status.v1', {}),
  locations = [],
  selected = null,
  detailVersion = 0;
const colors = {
  Unknown: '#1d655e',
  Open: '#28865d',
  'Limited service': '#d6942b',
  Closed: '#c65244',
};
const map = L.map('map', { zoomControl: true }).setView([28.2, -82.3], 7);
const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const satellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Tiles © Esri, Maxar, Earthstar Geographics' },
);
const layers = {
  branches: L.layerGroup().addTo(map),
  alerts: L.layerGroup().addTo(map),
  radar: L.layerGroup(),
  storms: L.layerGroup(),
  fires: L.layerGroup(),
};
const feedStates = {};
let toastTimer,
  markers = new Map();
function toast(s) {
  $('#toast').textContent = s;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').hidden = true), 5500);
}
function save() {
  try {
    localStorage.setItem('sunwatch.locations.v1', JSON.stringify(custom));
    localStorage.setItem('sunwatch.status.v1', JSON.stringify(updates));
  } catch {
    toast(
      'Storage is full or unavailable. Export your locations to keep them.',
    );
  }
}
async function api(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  const data = await r.json();
  if (!r.ok || data.unavailable)
    throw Error(data.error || data.reason || 'Source unavailable');
  return data;
}
const time = (value) =>
  value
    ? new Date(value).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : 'time unavailable';
function feed(name, message) {
  feedStates[name] = message;
  $('#feed-status').textContent = Object.entries(feedStates)
    .map(([k, v]) => k + ': ' + v)
    .join(' · ');
}
function address(r) {
  return [
    r.address_line1,
    [r.city, r.state, r.postal_code].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
}
function status(r) {
  return updates[r.id]?.status || 'Unknown';
}
function visible() {
  return locations.filter((r) =>
    matches(
      r,
      $('#search').value,
      $('#county').value,
      $('#status-filter').value,
      updates,
    ),
  );
}
function render() {
  const rows = visible();
  $('#shown').textContent = `${rows.length} OF ${locations.length} LOCATIONS`;
  $('#total').textContent = locations.length;
  $('#county-count').textContent = new Set(
    locations.map((r) => r.county).filter(Boolean),
  ).size;
  $('#branches').innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<button class="branch ${selected === r.id ? 'selected' : ''}" data-id="${h(r.id)}"><span class="branch-symbol">⌂</span><span class="branch-copy"><strong>${h(r.name)}</strong><small>${h(r.city)} · ${h(r.county || 'County not supplied')}</small><small><i class="status-dot ${h(status(r).split(' ')[0])}"></i>${h(status(r))}${updates[r.id] ? ' · user reported' : ''}</small></span><span aria-hidden="true">↗</span></button>`,
        )
        .join('')
    : '<p class="empty">No locations match these filters.</p>';
  layers.branches.clearLayers();
  markers.clear();
  for (const r of rows) {
    const active = selected === r.id;
    const marker = L.marker([r.latitude, r.longitude], {
      icon: L.divIcon({
        className: 'branch-marker' + (active ? ' active' : ''),
        iconSize: active ? [17, 17] : [12, 12],
        iconAnchor: active ? [8, 8] : [6, 6],
        html: '',
      }),
      title: r.name,
    })
      .bindTooltip(h(r.name))
      .on('click', () => select(r.id));
    marker.addTo(layers.branches);
    markers.set(r.id, marker);
    if (!active)
      marker.getElement()?.style.setProperty('background', colors[status(r)]);
  }
}
function counties() {
  const old = $('#county').value;
  $('#county').innerHTML =
    '<option value="">All counties</option>' +
    [...new Set(locations.map((r) => r.county).filter(Boolean))]
      .sort()
      .map((c) => `<option>${h(c)}</option>`)
      .join('');
  $('#county').value = old;
}
function fit() {
  const rows = visible();
  if (rows.length)
    map.fitBounds(
      rows.map((r) => [r.latitude, r.longitude]),
      { padding: [45, 65], maxZoom: 14 },
    );
  else toast('No matching locations to show.');
}
function officialLink(url) {
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
function hours(r) {
  const days = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  if (!r.lobby_hours)
    return '<p class="hint">Published hours are not available for this location.</p>';
  return (
    days
      .map((d) => {
        const v = r.lobby_hours[d];
        return `<div class="hours-row"><span>${d[0].toUpperCase() + d.slice(1)}</span><span>${v?.isClosed ? 'Closed' : v?.openIntervals?.map((t) => `${h(t.start)}–${h(t.end)}`).join(', ') || 'Not supplied'}</span></div>`;
      })
      .join('') +
    '<p class="hint">Published regular lobby hours. Holidays and storm closures may differ.</p>'
  );
}
async function select(id) {
  const r = locations.find((x) => x.id === id);
  if (!r) return;
  selected = id;
  const version = ++detailVersion;
  render();
  map.flyTo([r.latitude, r.longitude], 13, { duration: 1 });
  $('#layers').hidden = true;
  const u = updates[id] || {},
    link = officialLink(r.source_url);
  $('#detail').innerHTML =
    `<div class="panel-title"><span class="eyebrow">LOCATION BRIEF</span><button id="detail-close" aria-label="Close location">×</button></div><h2>${h(r.name)}</h2><div class="address">${h(r.address_line1)}<br>${h([r.city, r.state, r.postal_code].filter(Boolean).join(' '))}</div>${link ? `<p><a href="${h(link)}" target="_blank" rel="noopener">Official branch page ↗</a></p>` : ''}<hr><h3>Operational status</h3><p class="hint">Manual note for this browser. Weather feeds do not confirm branch operations.</p><label>Status<select id="branch-status">${STATUS.map((s) => `<option ${u.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label>Notes<textarea id="branch-notes" maxlength="500" placeholder="Power, connectivity, access, next check-in…">${h(u.notes || '')}</textarea></label><button id="save-status" class="primary">Save status</button><p class="hint" id="status-time">${u.at ? 'Last entered ' + time(u.at) : 'No operational confirmation recorded.'}</p><hr><h3>Weather at this location</h3><div id="location-alerts"><p>Checking active alerts…</p></div><div id="forecast"><p>Loading forecast…</p></div><hr><h3>Published lobby hours</h3>${hours(r)}<h3>Services</h3>${(r.services || []).map((s) => `<span class="badge">${h(s.replaceAll('_', ' ').toLowerCase())}</span>`).join('') || '<p class="hint">Not supplied.</p>'}${r.atm_information ? `<p>${h(r.atm_information)}</p>` : ''}${id.startsWith('custom-') ? '<hr><button id="delete-location" class="quiet">Remove this location</button>' : ''}<p class="hint">Situational awareness preview. Follow official notices and your continuity procedures.</p>`;
  $('#detail').hidden = false;
  $('#detail-close').onclick = () => {
    $('#detail').hidden = true;
    selected = null;
    ++detailVersion;
    render();
  };
  $('#save-status').onclick = () => {
    updates[id] = {
      status: $('#branch-status').value,
      notes: $('#branch-notes').value,
      at: Date.now(),
    };
    save();
    render();
    $('#status-time').textContent = 'Last entered ' + time(updates[id].at);
    toast('Status saved in this browser.');
  };
  if ($('#delete-location'))
    $('#delete-location').onclick = () => {
      custom = custom.filter((x) => x.id !== id);
      locations = locations.filter((x) => x.id !== id);
      delete updates[id];
      save();
      $('#detail').hidden = true;
      selected = null;
      ++detailVersion;
      counties();
      render();
    };
  await Promise.allSettled([
    (async () => {
      try {
        const v = await api(`/api/alerts?lat=${r.latitude}&lon=${r.longitude}`);
        if (version !== detailVersion) return;
        const alerts = v.data.features || [];
        $('#location-alerts').innerHTML =
          (alerts.length
            ? alerts
                .map(
                  (a) =>
                    `<div class="warning"><strong>${h(a.properties.event)}</strong><br>${h(a.properties.headline)}<details><summary>Details & instructions</summary><p>${h(a.properties.description)}</p><p>${h(a.properties.instruction)}</p></details><small>Expires ${h(time(a.properties.expires))}</small></div>`,
                )
                .join('')
            : '<p>No active NWS alerts returned for this point.</p>') +
          `<p class="hint">${v.stale ? 'Cached · ' : ''}NWS fetched ${h(time(v.at))}. <a href="https://www.weather.gov/" target="_blank" rel="noopener">Official weather information ↗</a></p>`;
      } catch {
        $('#location-alerts') &&
          version === detailVersion &&
          ($('#location-alerts').innerHTML =
            '<div class="warning">Alert lookup unavailable. Check the <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a>.</div>');
      }
    })(),
    (async () => {
      try {
        const v = await api(
          `/api/forecast?lat=${r.latitude}&lon=${r.longitude}`,
        );
        if (version !== detailVersion) return;
        $('#forecast').innerHTML =
          (v.data.properties?.periods || [])
            .slice(0, 3)
            .map(
              (p) =>
                `<div class="weather-card"><strong>${h(p.name)} · ${h(p.temperature)}°${h(p.temperatureUnit)}</strong>${h(p.shortForecast)}<br>Wind ${h(p.windSpeed)} ${h(p.windDirection)}</div>`,
            )
            .join('') +
          `<p class="hint">${v.stale ? 'Cached · ' : ''}Forecast issued ${h(time(v.data.properties?.updateTime))}</p>`;
      } catch {
        if (version === detailVersion)
          $('#forecast').innerHTML =
            '<p class="hint">Forecast unavailable. Try again shortly.</p>';
      }
    })(),
  ]);
}
const loading = new Set();
async function loadLayer(name) {
  if (loading.has(name)) return;
  loading.add(name);
  feed(name, 'loading');
  try {
    if (name === 'alerts') {
      const v = await api('/api/alerts');
      layers.alerts.clearLayers();
      const features = v.data.features || [];
      $('#alert-count').textContent = features.length;
      L.geoJSON(
        features.filter((f) => f.geometry),
        {
          style: (f) => ({
            color: f.properties.severity === 'Extreme' ? '#c65244' : '#d9902b',
            weight: 1.5,
            fillOpacity: 0.14,
          }),
          onEachFeature: (f, l) =>
            l.bindPopup(
              `<strong>${h(f.properties.event)}</strong><br>${h(f.properties.headline)}<br>Expires ${h(time(f.properties.expires))}`,
            ),
        },
      ).addTo(layers.alerts);
      feed(
        name,
        `${features.length} in FL · ${v.stale ? 'cached ' : ''}${time(v.at)}${features.some((f) => !f.geometry) ? ' · some alerts have no map boundary' : ''}`,
      );
    }
    if (name === 'radar') {
      const v = await api('/api/weather/manifest?product=radar');
      layers.radar.clearLayers();
      L.tileLayer
        .wms(
          'https://nowcoast.noaa.gov/geoserver/observations/weather_radar/wms',
          {
            layers: 'conus_base_reflectivity_mosaic',
            format: 'image/png',
            transparent: true,
            version: '1.1.1',
            time: v.latest,
            opacity: 0.55,
            attribution: 'NOAA MRMS / nowCOAST',
          },
        )
        .on('tileerror', () => feed('radar', 'some tiles unavailable'))
        .addTo(layers.radar);
      feed(name, `${v.stale ? 'cached ' : ''}observed ${time(v.latest)}`);
    }
    if (name === 'storms') {
      const v = await api('/api/cyclones');
      layers.storms.clearLayers();
      for (const s of v.storms) {
        const label = `<strong>${h(s.name)}</strong><br>${h(s.classification)} · ${h(s.windKt)} kt<br>Advisory ${h(time(s.issuedAt))}<br>${h(s.geometryStatus)} geometry<br>Hazards extend beyond the forecast cone.`;
        if (s.cone)
          L.geoJSON(s.cone, {
            style: { color: '#8d70ae', weight: 1.5, fillOpacity: 0.16 },
          })
            .bindPopup(label)
            .addTo(layers.storms);
        if (s.track)
          L.geoJSON(s.track, {
            style: { color: '#775397', weight: 2, dashArray: '5 5' },
          })
            .bindPopup(label)
            .addTo(layers.storms);
        L.circleMarker([s.position.latitude, s.position.longitude], {
          radius: 8,
          color: '#765294',
          fillOpacity: 0.8,
        })
          .bindPopup(label)
          .addTo(layers.storms);
      }
      feed(
        name,
        `${v.storms.length} active · ${v.stale ? 'cached ' : ''}${time(v.fetchedAt)}`,
      );
    }
    if (name === 'fires') {
      const v = await api('/api/fires');
      layers.fires.clearLayers();
      for (const f of v.detections)
        L.circleMarker([f.lat, f.lon], {
          radius: 4,
          color: '#cc5933',
          weight: 1,
          fillOpacity: 0.65,
        })
          .bindPopup(
            `<strong>Satellite heat detection</strong><br>${h(f.acqDate)} ${h(String(f.acqTime).padStart(4, '0'))} UTC<br>${h(f.source)}<br>May be fire or another heat source; not a fire perimeter.`,
          )
          .addTo(layers.fires);
      feed(
        name,
        `${v.detections.length} detections in FL region · ${v.partial ? 'partial sources · ' : ''}${v.stale ? 'cached ' : ''}${time(v.at)}`,
      );
    }
  } catch (e) {
    feed(name, 'unavailable — try refresh');
    if (name === 'alerts') $('#alert-count').textContent = '—';
    toast(`${name[0].toUpperCase() + name.slice(1)}: ${e.message}`);
  } finally {
    loading.delete(name);
  }
}
$$('[data-layer]').forEach(
  (c) =>
    (c.onchange = () => {
      const name = c.dataset.layer;
      if (c.checked) {
        layers[name].addTo(map);
        if (name !== 'branches') loadLayer(name);
      } else {
        map.removeLayer(layers[name]);
        delete feedStates[name];
        $('#feed-status').textContent =
          Object.entries(feedStates)
            .map(([k, v]) => k + ': ' + v)
            .join(' · ') || 'Weather overlays off';
      }
    }),
);
$('#satellite').onchange = (e) => {
  if (e.target.checked) {
    map.removeLayer(streets);
    satellite.addTo(map);
    satellite.bringToBack();
  } else {
    map.removeLayer(satellite);
    streets.addTo(map);
    streets.bringToBack();
  }
};
$('#refresh').onclick = () =>
  $$('[data-layer]:checked')
    .filter((x) => x.dataset.layer !== 'branches')
    .forEach((x) => loadLayer(x.dataset.layer));
setInterval(() => $('#refresh').click(), 300000);
$('#search').oninput = render;
$('#county').onchange = render;
$('#status-filter').onchange = render;
$('#fit').onclick = fit;
$('#branches').onclick = (e) => {
  const row = e.target.closest('[data-id]');
  if (row) select(row.dataset.id);
};
$('#layers-open').onclick = () => {
  $('#layers').hidden = !$('#layers').hidden;
  $('#detail').hidden = true;
};
$('#layers-close').onclick = () => ($('#layers').hidden = true);
$('#add').onclick = () => $('#add-dialog').showModal();
$('#dialog-close').onclick = () => $('#add-dialog').close();
function addRows(rows) {
  let added = 0;
  for (const raw of rows) {
    const r = normalizeLocation({
      ...raw,
      id: 'custom-' + crypto.randomUUID(),
    });
    if (
      locations.some(
        (x) =>
          x.name.toLowerCase() === r.name.toLowerCase() &&
          Math.abs(x.latitude - r.latitude) < 0.0001 &&
          Math.abs(x.longitude - r.longitude) < 0.0001,
      )
    )
      continue;
    custom.push(r);
    locations.push(r);
    added++;
  }
  save();
  counties();
  render();
  toast(`${added} locations added; duplicates skipped.`);
  return added;
}
$('#address-form').onsubmit = async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button');
  button.disabled = true;
  $('#address-results').textContent = 'Finding matching addresses…';
  try {
    const v = await api(
      '/api/geocode?q=' + encodeURIComponent($('#new-address').value),
    );
    $('#address-results').innerHTML = '<p>Confirm the correct address:</p>';
    for (const r of v.results) {
      const b = document.createElement('button');
      b.className = 'result';
      b.textContent = r.address + ' · Add location ↗';
      b.onclick = () => {
        const item = {
          ...r,
          name: $('#new-name').value,
          address_line1: r.address,
        };
        addRows([item]);
        $('#add-dialog').close();
        fit();
      };
      $('#address-results').append(b);
    }
    if (!v.results.length)
      $('#address-results').textContent =
        'No matches. Try a more complete address.';
  } catch (e) {
    $('#address-results').textContent = e.message;
  } finally {
    button.disabled = false;
  }
};
$('#import').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2000000) {
    toast('Use a file under 2 MB.');
    return;
  }
  $('#import-review').replaceChildren();
  $('#import-status').textContent = 'Reading file…';
  try {
    const text = await file.text();
    let rows;
    if (file.name.toLowerCase().endsWith('.csv')) {
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: 'greedy',
      });
      if (parsed.errors.length)
        throw Error('CSV could not be read. Check column counts and quotes.');
      rows = parsed.data;
    } else {
      const value = JSON.parse(text);
      rows = Array.isArray(value)
        ? value
        : value.locations ||
          value.features?.map((f) => ({
            ...f.properties,
            longitude: f.geometry?.coordinates?.[0],
            latitude: f.geometry?.coordinates?.[1],
          }));
    }
    if (!Array.isArray(rows) || !rows.length)
      throw Error('No locations found. Use the template columns.');
    if (rows.length > 250) throw Error('Import up to 250 locations at a time.');
    const ready = [],
      lookup = [];
    let rejected = 0;
    for (const r of rows) {
      try {
        ready.push(normalizeLocation(r));
      } catch {
        if (
          (r.name || r.branch) &&
          (r.address || r.address_line1) &&
          !(r.latitude || r.lat || r.longitude || r.lon)
        )
          lookup.push(r);
        else rejected++;
      }
    }
    $('#import-status').textContent =
      `${ready.length} ready · ${lookup.length} need address lookup · ${rejected} invalid rows skipped.`;
    if (ready.length) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = `Import ${ready.length} locations with coordinates`;
      b.onclick = () => {
        addRows(ready);
        b.remove();
        fit();
      };
      $('#import-review').append(b);
    }
    if (lookup.length) {
      const b = document.createElement('button');
      b.className = 'result';
      b.textContent = `Review ${lookup.length} addresses one at a time`;
      let index = 0;
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = lookup[index];
          const q = [
            r.address_line1 || r.address,
            r.city,
            r.state || 'FL',
            r.postal_code || r.zip,
          ]
            .filter(Boolean)
            .join(', ');
          const v = await api('/api/geocode?q=' + encodeURIComponent(q));
          const box = document.createElement('div');
          box.innerHTML = `<p><strong>${h(r.name || r.branch)}</strong> · ${h(q)}</p>`;
          const next = () => {
            box.remove();
            index++;
            b.disabled = false;
            b.textContent =
              index < lookup.length
                ? `Review next address (${index + 1}/${lookup.length})`
                : 'All addresses reviewed';
            if (index >= lookup.length) b.remove();
          };
          for (const match of v.results) {
            const option = document.createElement('button');
            option.className = 'result';
            option.textContent = match.address + ' · Confirm & add';
            option.onclick = () => {
              addRows([
                {
                  ...r,
                  ...match,
                  name: r.name || r.branch,
                  address_line1: match.address,
                },
              ]);
              next();
            };
            box.append(option);
          }
          const skip = document.createElement('button');
          skip.className = 'text-button';
          skip.textContent = 'Skip this address';
          skip.onclick = next;
          box.append(skip);
          $('#import-review').append(box);
        } catch (e) {
          toast(e.message);
          b.disabled = false;
        }
      };
      $('#import-review').append(b);
    }
  } catch (e) {
    $('#import-status').textContent = e.message;
  } finally {
    $('#import').value = '';
  }
};
$('#export').onclick = () => {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          schema_version: 1,
          exported_at: new Date().toISOString(),
          locations,
          operational_notes: updates,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sunwatch-locations.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('#today').textContent = new Date().toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
try {
  const seed = await api('/api/branches');
  custom = Array.isArray(custom)
    ? custom.flatMap((r) => {
        try {
          return [normalizeLocation(r)];
        } catch {
          return [];
        }
      })
    : [];
  locations = [...seed.locations, ...custom];
  counties();
  render();
  fit();
  loadLayer('alerts');
} catch (e) {
  $('#branches').innerHTML =
    '<p class="empty">Locations could not load. Refresh to retry.</p>';
  toast(e.message);
}
