const CATALOG = 'https://fl511.com/map/mapIcons/Cameras';

// The public FL511 map supplies coordinates and camera IDs. Its camera
// page serves JPEG snapshots at /map/Cctv/{id}; no account key is needed.
export function parseFloridaCameras(payload) {
  if (!Array.isArray(payload?.item2)) throw new Error('Invalid FL511 catalog');
  const cameras = new Map();
  for (const row of payload.item2) {
    const id = String(row.itemId ?? '');
    const [lat, lon] = row.location || [];
    if (!/^\d+$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < 24 || lat > 32 || lon < -88 || lon > -79) continue;
    cameras.set(id, {
      id: `fl511-${id}`, name: row.title?.trim() || `Florida traffic camera ${id}`,
      city: 'Florida', cityId: 'florida', provider: 'FDOT / FL511',
      lat, lon, headingDeg: 0, headingConfidence: 'low', pitchDeg: -18,
      fovDeg: 44, rangeM: 145, mountHeightM: 8, groundElevationM: 0,
      feedType: 'image', url: `https://fl511.com/map/Cctv/${id}`,
      snapshotUrl: `https://fl511.com/map/Cctv/${id}`,
      sourceKind: 'fl511-public', credit: 'Florida Department of Transportation / FL511',
      license: 'Public FL511 traffic snapshot. Camera direction and mounting pose are uncalibrated.',
    });
  }
  return [...cameras.values()];
}

export async function loadFloridaSources({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(CATALOG, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`FL511 catalog HTTP ${response.status}`);
  return parseFloridaCameras(await response.json());
}
