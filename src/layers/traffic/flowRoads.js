const ROAD_TYPES = {
  Motorway: 'motorway',
  'International road': 'trunk',
  'Major road': 'primary',
  'Secondary road': 'secondary',
  'Major local road': 'tertiary',
  'Connecting road': 'unclassified',
  'Local road': 'residential',
  'Minor local road': 'residential',
};

// Traffic tiles already carry road geometry. Keep each directional flow
// segment separate so parallel carriageways cannot inherit each other's flow.
export function roadsFromFlowSegments(segments, bounds) {
  return segments.filter(({ coords }) => {
    if (!Array.isArray(coords) || coords.length < 2) return false;
    const xs = coords.map(p => p[0]);
    const ys = coords.map(p => p[1]);
    return Math.max(...xs) >= bounds.west && Math.min(...xs) <= bounds.east &&
      Math.max(...ys) >= bounds.south && Math.min(...ys) <= bounds.north;
  }).map(segment => ({
    coordinates: segment.coords,
    type: ROAD_TYPES[segment.roadType] || 'unclassified',
    oneway: 1,
    directFlow: { level: segment.trafficLevel, closure: segment.closure },
  }));
}
