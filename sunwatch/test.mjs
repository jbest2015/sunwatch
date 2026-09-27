import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  normalizeLocation,
  matches,
  insideGeometry,
  html,
} from './public/model.js';
test('import rejects blank, missing and out-of-range coordinates instead of plotting at zero', () => {
  for (const value of [
    { name: 'Branch', latitude: '', longitude: '' },
    { name: 'Branch', latitude: 91, longitude: 0 },
    { name: 'Branch', latitude: 'hello', longitude: 2 },
  ])
    assert.throws(() => normalizeLocation(value));
  assert.equal(
    normalizeLocation({ name: 'Equator', lat: 0, lon: 0 }).latitude,
    0,
  );
});
test('untrusted imported text cannot create markup', () =>
  assert.equal(
    html('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
  ));
test('status filtering keeps unknown distinct from operational', () => {
  const r = { id: '1', name: 'Tampa', county: 'Hillsborough' };
  assert.equal(matches(r, 'tampa', '', 'Unknown', {}), true);
  assert.equal(matches(r, '', '', 'Open', {}), false);
  assert.equal(
    matches(r, '', 'Hillsborough', 'Open', { 1: { status: 'Open' } }),
    true,
  );
});
test('polygon holes and missing boundaries do not claim a location is within alert', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [4, 4],
        [6, 4],
        [6, 6],
        [4, 6],
        [4, 4],
      ],
    ],
  };
  assert.equal(insideGeometry({ latitude: 2, longitude: 2 }, geometry), true);
  assert.equal(insideGeometry({ latitude: 5, longitude: 5 }, geometry), false);
  assert.equal(insideGeometry({ latitude: 2, longitude: 2 }, null), false);
});
test('official seed has 81 unique valid Florida locations and no inferred operating status', async () => {
  const data = JSON.parse(
    await fs.readFile(new URL('./data/branches.json', import.meta.url)),
  );
  assert.equal(data.locations.length, 81);
  assert.equal(new Set(data.locations.map((x) => x.id)).size, 81);
  for (const r of data.locations) {
    normalizeLocation(r);
    assert.equal(r.state, 'FL');
    assert.equal(r.operating_status, 'unknown');
    assert.match(
      r.source_url,
      /^https:\/\/locations\.suncoastcreditunion\.com\//,
    );
  }
});
