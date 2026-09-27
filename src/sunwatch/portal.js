import * as Cesium from 'cesium';
import Papa from 'papaparse';
import {
  html as h,
  normalizeLocation,
  STATUS,
} from '../../sunwatch/public/model.js';
import { mappable, distanceKm, filterLocations, safeSource } from './model.js';
import './portal.css';

export async function mountSunWatch({
  scene: { viewer },
  controls: { styleManager },
  data: { dataManager },
}) {
  const $ = (s) => document.querySelector(s);
  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  };
  let custom = read('sunwatch.locations.v1', []),
    notes = read('sunwatch.status.v1', {}),
    rows = [],
    selected = null,
    near = false,
    version = 0;
  if (!Array.isArray(custom)) custom = [];
  custom = custom.filter(mappable);
  const source = new Cesium.CustomDataSource('SunWatch locations');
  await viewer.dataSources.add(source);
  const entityById = new Map();
  const panel = document.createElement('section');
  panel.id = 'sw-network';
  panel.setAttribute('aria-label', 'Suncoast location portal');
  panel.innerHTML = `<div class="sw-head"><div><span class="sw-kicker">SUNCOAST CREDIT UNION</span><h2>LOCATION WATCH</h2></div><button id="sw-collapse" aria-label="Collapse location panel">−</button></div><div id="sw-body"><div id="sw-summary">Loading network…</div><input id="sw-search" aria-label="Search branches and ATMs" placeholder="Branch, ATM, address, city or ZIP"><div class="sw-filters"><select id="sw-type" aria-label="Location type"><option value="">All locations</option><option value="branch">Branches</option><option value="atm">ATMs</option><option value="custom">My locations</option></select><select id="sw-county" aria-label="County"><option value="">All counties</option></select></div><div class="sw-actions"><button id="sw-all">NETWORK VIEW</button><button id="sw-near" aria-pressed="false">NEARBY</button><select id="sw-radius" aria-label="Nearby radius"><option value="5">5 km</option><option value="10" selected>10 km</option><option value="25">25 km</option><option value="50">50 km</option></select></div><div class="sw-list-head"><span id="sw-count"></span><button id="sw-add">＋ ADD / IMPORT</button></div><div id="sw-list"></div><div id="sw-focus" hidden></div><details id="sw-overlays" open><summary>LIVE LAYERS <span>same globe · keep exploring</span></summary><div id="sw-quick-layers"></div><p class="sw-note">More layers and controls in the original DATA panel. Traffic dots illustrate measured road flow, not individual tracked vehicles.</p></details><div class="sw-footer"><button id="sw-export">EXPORT LOCATIONS</button><span>Notes saved in this browser</span></div></div>`;
  document.body.append(panel);
  const dialog = document.createElement('dialog');
  dialog.id = 'sw-add-dialog';
  dialog.innerHTML = `<div class="sw-head"><h2>ADD A LOCATION</h2><button id="sw-dialog-close" aria-label="Close location import">×</button></div><p>Save any branch, ATM, office or address to your own network.</p><form id="sw-address-form"><label>Name<input id="sw-name" required maxlength="100" placeholder="Location name"></label><label>Type<select id="sw-new-type"><option value="custom">My location</option><option value="branch">Branch</option><option value="atm">ATM</option></select></label><label>Address<input id="sw-address" required maxlength="250" placeholder="Street address, city, state and ZIP"></label><button type="submit">FIND ADDRESS</button></form><div id="sw-results"></div><hr><label>Import CSV, JSON or GeoJSON<input id="sw-import" type="file" accept=".csv,.json,.geojson"></label><p class="sw-note">Columns: name, type (branch/atm/custom), address, city, county, state, zip, latitude, longitude. Address-only rows are reviewed individually. Up to 250 rows.</p><div id="sw-import-review"></div><p id="sw-import-status" role="status"></p>`;
  document.body.append(dialog);
  for (const node of [panel, dialog])
    node.addEventListener('keydown', (e) => {
      if (e.target.matches('input,select,textarea')) e.stopPropagation();
    });
  for (const node of document.querySelectorAll(
    '.hud-classification,.hud-top-bar-left',
  ))
    node.textContent = 'SUNCOAST // SITUATIONAL AWARENESS';
  const toast = (s) => styleManager._showToast?.(s);
  async function api(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const value = await response.json();
    if (!response.ok) throw Error(value.error || 'Source unavailable');
    return value;
  }
  const stamp = (t) =>
    t
      ? new Date(t).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : 'unknown';
  const address = (r) =>
    [r.address_line1, r.city, r.state, r.postal_code]
      .filter(Boolean)
      .join(', ');
  function save() {
    try {
      localStorage.setItem('sunwatch.locations.v1', JSON.stringify(custom));
      localStorage.setItem('sunwatch.status.v1', JSON.stringify(notes));
    } catch {
      toast(
        'Browser storage unavailable. Export your locations to keep a copy.',
      );
    }
  }
  function origin() {
    if (selected && mappable(selected)) return selected;
    const point = viewer.camera.pickEllipsoid(
      new Cesium.Cartesian2(
        viewer.canvas.clientWidth / 2,
        viewer.canvas.clientHeight / 2,
      ),
      viewer.scene.globe.ellipsoid,
    );
    const c = point
      ? Cesium.Cartographic.fromCartesian(point)
      : viewer.camera.positionCartographic;
    return {
      latitude: Cesium.Math.toDegrees(c.latitude),
      longitude: Cesium.Math.toDegrees(c.longitude),
    };
  }
  function visible() {
    return filterLocations(rows, {
      query: $('#sw-search').value,
      type: $('#sw-type').value,
      county: $('#sw-county').value,
      near: near ? origin() : null,
      radius: Number($('#sw-radius').value),
    });
  }
  function render() {
    const list = visible();
    $('#sw-count').textContent = `${list.length} / ${rows.length} LOCATIONS`;
    $('#sw-summary').textContent =
      `${rows.filter((x) => x.type === 'branch').length} BRANCHES / ${rows.filter((x) => x.type === 'atm').length} ATMs${custom.length ? ' / ' + custom.length + ' SAVED' : ''}`;
    $('#sw-list').innerHTML = list.length
      ? list
          .map(
            (r) =>
              `<button class="sw-row ${selected?.id === r.id ? 'selected' : ''}" data-id="${h(r.id)}"><span class="sw-kind ${h(r.type)}">${r.type === 'atm' ? 'ATM' : r.type === 'branch' ? 'BR' : 'MY'}</span><span><strong>${h(r.name.replace(/^ATM · /, ''))}</strong><small>${h(r.city)} · ${h(r.county || r.state || '')}</small><small>${near ? h(distanceKm(origin(), r).toFixed(1)) + ' km · ' : ''}${mappable(r) ? (r.type === 'atm' ? 'Address estimate' : h(r.address_line1)) : 'Locate address →'}</small></span><b>↗</b></button>`,
          )
          .join('')
      : '<p class="sw-note">No matching locations. Try a wider radius or clear the filters.</p>';
    const ids = new Set(list.map((r) => r.id));
    for (const [id, e] of entityById) e.show = ids.has(id);
    viewer.scene.requestRender();
  }
  function addMarker(r) {
    if (!mappable(r)) return;
    const e = source.entities.add({
      id: 'sw-' + r.id,
      name: r.name,
      position: Cesium.Cartesian3.fromDegrees(r.longitude, r.latitude),
      point: {
        pixelSize: r.type === 'atm' ? 7 : 10,
        color: Cesium.Color.fromCssColorString(
          r.type === 'atm' ? '#ffbd61' : '#46e6ed',
        ),
        outlineColor: Cesium.Color.fromCssColorString('#081820'),
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: r.name.replace(/^ATM · /, ''),
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 8000),
      },
    });
    entityById.set(r.id, e);
  }
  function updateCounties() {
    const old = $('#sw-county').value;
    $('#sw-county').innerHTML =
      '<option value="">All counties</option>' +
      [...new Set(rows.map((x) => x.county).filter(Boolean))]
        .sort()
        .map((c) => `<option>${h(c)}</option>`)
        .join('');
    $('#sw-county').value = old;
  }
  function navigate(r, range = 2200) {
    styleManager.runImmediateLocationNavigation(() => {
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(
          Cesium.Cartesian3.fromDegrees(r.longitude, r.latitude),
          10,
        ),
        {
          duration: 1.8,
          offset: new Cesium.HeadingPitchRange(
            0,
            Cesium.Math.toRadians(-48),
            range,
          ),
        },
      );
    });
  }
  async function focus(r) {
    if (!mappable(r)) {
      dialog.showModal();
      $('#sw-name').value = r.name;
      $('#sw-address').value = address(r);
      $('#sw-new-type').value = r.type;
      $('#sw-results').textContent =
        'This ATM address needs a map-position confirmation. Find the address and choose the correct result.';
      return;
    }
    selected = r;
    const request = ++version;
    render();
    navigate(r);
    $('#sw-focus').hidden = false;
    const n = notes[r.id] || {},
      official = safeSource(r.source_url);
    $('#sw-focus').innerHTML =
      `<div class="sw-focus-title"><span>${h(r.type.toUpperCase())} / SELECTED</span><button id="sw-focus-close" aria-label="Close selected location">×</button></div><h3>${h(r.name)}</h3><p>${h(address(r))}</p>${r.type === 'atm' ? '<p class="sw-note">Address-level estimate; exact machine placement and availability are unverified.</p>' : ''}<div class="sw-actions"><button data-range="2200">STREET AREA</button><button data-range="15000">SURROUNDINGS</button><button data-range="45000">AIRSPACE</button></div><div id="sw-point-weather">Checking weather at this location…</div><details><summary>LOCATION NOTES & STATUS</summary><label>Status<select id="sw-status">${STATUS.map((s) => `<option ${n.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><textarea id="sw-notes" maxlength="500" placeholder="Power, access, staffing, next check-in…">${h(n.notes || '')}</textarea><button id="sw-save">SAVE NOTE</button><p class="sw-note" id="sw-note-time">${n.at ? 'User reported ' + h(stamp(n.at)) : 'Operational status unverified.'} · this browser only.</p>${r.lobby_hours ? '<p class="sw-note">Published lobby hours and services: see official location page. Confirm storm openings with operations.</p>' : ''}</details>${official ? `<a href="${h(official)}" target="_blank" rel="noopener">Official location listing ↗</a>` : ''}${r.id.startsWith('custom-') ? '<button id="sw-remove">REMOVE SAVED LOCATION</button>' : ''}`;
    $('#sw-focus-close').onclick = () => {
      $('#sw-focus').hidden = true;
      selected = null;
      ++version;
      render();
    };
    $('#sw-focus')
      .querySelectorAll('[data-range]')
      .forEach((b) => (b.onclick = () => navigate(r, Number(b.dataset.range))));
    $('#sw-save').onclick = () => {
      notes[r.id] = {
        status: $('#sw-status').value,
        notes: $('#sw-notes').value,
        at: Date.now(),
      };
      save();
      $('#sw-note-time').textContent =
        'User reported ' + stamp(notes[r.id].at) + ' · this browser only.';
      toast('Location note saved.');
    };
    if ($('#sw-remove'))
      $('#sw-remove').onclick = () => {
        custom = custom.filter((x) => x.id !== r.id);
        rows = rows.filter((x) => x.id !== r.id);
        source.entities.remove(entityById.get(r.id));
        entityById.delete(r.id);
        delete notes[r.id];
        selected = null;
        ++version;
        save();
        $('#sw-focus').hidden = true;
        updateCounties();
        render();
      };
    const [alerts, forecast] = await Promise.allSettled([
      api(`/api/alerts?lat=${r.latitude}&lon=${r.longitude}`),
      api(`/api/forecast?lat=${r.latitude}&lon=${r.longitude}`),
    ]);
    if (version !== request) return;
    const a = alerts.status === 'fulfilled' ? alerts.value : null,
      f = forecast.status === 'fulfilled' ? forecast.value : null;
    const features = a?.data.features || [];
    const period = f?.data.properties?.periods?.[0];
    $('#sw-point-weather').innerHTML =
      `${period ? `<div class="sw-weather"><strong>${h(period.temperature)}°${h(period.temperatureUnit)} / ${h(period.shortForecast)}</strong><small>${h(period.name)} · Wind ${h(period.windSpeed)} ${h(period.windDirection)}</small><small>${f.stale ? 'CACHED · ' : ''}Forecast issued ${h(stamp(f.data.properties.updateTime))}</small></div>` : '<p class="sw-note">Point forecast unavailable.</p>'}${a ? (features.length ? features.map((v) => `<details class="sw-warning"><summary>${h(v.properties.event)}</summary><p>${h(v.properties.headline)}</p><p>${h(v.properties.instruction || v.properties.description)}</p><small>Expires ${h(stamp(v.properties.expires))}</small></details>`).join('') : '<p class="sw-note">No active NWS alerts returned for this point.</p>') : '<p class="sw-warning">Alert lookup unavailable. Check weather.gov.</p>'}${a ? `<p class="sw-note">${a.stale ? 'CACHED · ' : ''}NWS fetched ${h(stamp(a.at))}</p>` : ''}`;
  }
  const quick = [
    ['flights', 'AIRCRAFT'],
    ['traffic', 'STREET TRAFFIC'],
    ['weather-radar', 'RAIN RADAR'],
    ['weather-cyclones', 'HURRICANES'],
    ['wind', 'WIND'],
    ['cctv', 'CAMERAS'],
    ['local-firms', 'FIRE DETECTIONS'],
  ];
  $('#sw-quick-layers').innerHTML = quick
    .map(
      ([id, label]) =>
        `<label><input type="checkbox" data-sw-layer="${id}"><span>${label}</span><small data-sw-state="${id}">OFF</small></label>`,
    )
    .join('');
  function syncLayers() {
    const all = dataManager.getAll();
    for (const [id] of quick) {
      const r = all.find((x) => x.id === id);
      const input = panel.querySelector(`[data-sw-layer="${id}"]`),
        label = panel.querySelector(`[data-sw-state="${id}"]`);
      if (!r) {
        input.disabled = true;
        label.textContent = 'UNAVAILABLE';
        continue;
      }
      input.checked = r.enabled;
      const s = r.stats || {};
      label.textContent =
        r.lifecycleState === 'enabling'
          ? 'LOADING'
          : r.lifecycleState === 'disabling'
            ? 'STOPPING'
            : r.enabled
              ? (s.status || s.message || 'ON').toString().slice(0, 40)
              : 'OFF';
    }
  }
  panel.querySelectorAll('[data-sw-layer]').forEach(
    (input) =>
      (input.onchange = async () => {
        input.disabled = true;
        try {
          await dataManager.setEnabled(input.dataset.swLayer, input.checked, {
            origin: 'user',
          });
        } catch (e) {
          toast('Layer unavailable: ' + e.message);
        } finally {
          input.disabled = false;
          syncLayers();
        }
      }),
  );
  dataManager.subscribe(syncLayers);
  setInterval(syncLayers, 1500);
  syncLayers();
  $('#sw-collapse').onclick = () => {
    const collapsed = panel.classList.toggle('sw-collapsed');
    $('#sw-collapse').textContent = collapsed ? '+' : '−';
    $('#sw-collapse').setAttribute(
      'aria-label',
      collapsed ? 'Expand location panel' : 'Collapse location panel',
    );
  };
  $('#sw-search').oninput = render;
  $('#sw-type').onchange = render;
  $('#sw-county').onchange = render;
  $('#sw-radius').onchange = render;
  $('#sw-near').onclick = () => {
    near = !near;
    $('#sw-near').setAttribute('aria-pressed', String(near));
    render();
  };
  $('#sw-all').onclick = () => {
    near = false;
    $('#sw-near').setAttribute('aria-pressed', 'false');
    $('#sw-search').value = '';
    $('#sw-type').value = '';
    $('#sw-county').value = '';
    render();
    styleManager.runImmediateLocationNavigation(() =>
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-82.2, 28.0, 420000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: 2,
      }),
    );
  };
  $('#sw-list').onclick = (e) => {
    const b = e.target.closest('[data-id]');
    if (b) focus(rows.find((r) => r.id === b.dataset.id));
  };
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (entity?.id?.startsWith('sw-')) {
      const r = rows.find((x) => 'sw-' + x.id === entity.id);
      if (r) focus(r);
    }
  });
  $('#sw-add').onclick = () => dialog.showModal();
  $('#sw-dialog-close').onclick = () => dialog.close();
  function add(raw) {
    const r = {
      ...normalizeLocation({ ...raw, id: 'custom-' + crypto.randomUUID() }),
      type: ['atm', 'branch', 'custom'].includes(raw.type)
        ? raw.type
        : 'custom',
    };
    if (rows.some((x) => x.name === r.name && distanceKm(x, r) < 0.02)) {
      toast('That location is already in your list.');
      return null;
    }
    custom.push(r);
    rows.push(r);
    addMarker(r);
    save();
    updateCounties();
    render();
    return r;
  }
  $('#sw-address-form').onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('button');
    b.disabled = true;
    $('#sw-results').textContent = 'Finding address candidates…';
    try {
      const v = await api(
        '/api/geocode?q=' + encodeURIComponent($('#sw-address').value),
      );
      $('#sw-results').innerHTML = '<p>Confirm the matching address:</p>';
      for (const match of v.results) {
        const button = document.createElement('button');
        button.className = 'sw-result';
        button.textContent = match.address + ' →';
        button.onclick = () => {
          const r = add({
            ...match,
            name: $('#sw-name').value,
            type: $('#sw-new-type').value,
            address_line1: match.address,
          });
          if (r) {
            dialog.close();
            focus(r);
          }
        };
        $('#sw-results').append(button);
      }
      if (!v.results.length)
        $('#sw-results').textContent =
          'No matches returned. Try a complete street address.';
    } catch (e) {
      $('#sw-results').textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  $('#sw-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('#sw-import-review').replaceChildren();
    try {
      if (file.size > 2000000) throw Error('Use a file under 2 MB.');
      const text = await file.text();
      let incoming;
      if (file.name.endsWith('.csv')) {
        const parsed = Papa.parse(text, {
          header: true,
          skipEmptyLines: 'greedy',
        });
        if (parsed.errors.length)
          throw Error('Check CSV column counts and quotes.');
        incoming = parsed.data;
      } else {
        const value = JSON.parse(text);
        incoming = Array.isArray(value)
          ? value
          : value.locations ||
            value.features?.map((f) => ({
              ...f.properties,
              latitude: f.geometry?.coordinates?.[1],
              longitude: f.geometry?.coordinates?.[0],
            }));
      }
      if (!Array.isArray(incoming) || incoming.length > 250)
        throw Error('Use an array of up to 250 locations.');
      const ready = [],
        lookup = [];
      let invalid = 0;
      for (const raw of incoming) {
        try {
          ready.push({ ...normalizeLocation(raw), type: raw.type || 'custom' });
        } catch {
          if ((raw.name || raw.branch) && (raw.address || raw.address_line1))
            lookup.push(raw);
          else invalid++;
        }
      }
      $('#sw-import-status').textContent =
        `${ready.length} with coordinates · ${lookup.length} addresses to review · ${invalid} invalid.`;
      if (ready.length) {
        const b = document.createElement('button');
        b.textContent = `IMPORT ${ready.length} LOCATIONS`;
        b.onclick = () => {
          for (const r of ready) add(r);
          b.remove();
          $('#sw-import-status').textContent = 'Coordinate locations imported.';
        };
        $('#sw-import-review').append(b);
      }
      for (const raw of lookup) {
        const b = document.createElement('button');
        b.className = 'sw-result';
        b.textContent = `LOCATE ${raw.name || raw.branch}`;
        b.onclick = () => {
          $('#sw-name').value = raw.name || raw.branch;
          $('#sw-address').value = address({
            ...raw,
            address_line1: raw.address_line1 || raw.address,
          });
          $('#sw-new-type').value = ['atm', 'branch', 'custom'].includes(
            raw.type,
          )
            ? raw.type
            : 'custom';
          b.remove();
          $('#sw-address-form').requestSubmit();
        };
        $('#sw-import-review').append(b);
      }
    } catch (e) {
      $('#sw-import-status').textContent = e.message;
    } finally {
      $('#sw-import').value = '';
    }
  };
  $('#sw-export').onclick = () => {
    const a = document.createElement('a'),
      url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              { schema_version: 2, locations: rows, operational_notes: notes },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
    a.href = url;
    a.download = 'sunwatch-network.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  try {
    const data = await api('/api/locations');
    rows = [...data.locations, ...custom];
    for (const r of rows) addMarker(r);
    updateCounties();
    render();
  } catch (e) {
    $('#sw-summary').textContent = 'Network unavailable';
    $('#sw-list').textContent = e.message;
  }
  // Existing layer restoration wins. First visit gets aircraft and traffic ready;
  // traffic acquires nearby road flow only once the camera is below its altitude gate.
  await styleManager.initialRestorePromise;
  if (
    !styleManager.hasShareState &&
    !localStorage.getItem('sunwatch.globe.intro.v1')
  ) {
    localStorage.setItem('sunwatch.globe.intro.v1', '1');
    for (const id of ['flights', 'traffic'])
      dataManager.setEnabled(id, true, { origin: 'user' }).catch(() => {});
  }
}
