import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFloridaCameras, loadFloridaSources } from './florida.js';

test('FL511 uses latitude-first coordinates, registered image URLs and honest pose confidence', () => {
  const rows = parseFloridaCameras({ item2: [
    { itemId: '1215', location: [29.18658, -82.180882], title: '' },
    { itemId: '1215', location: [29.18658, -82.180882], title: 'I-75' },
    { itemId: '../bad', location: [28, -81] },
    { itemId: '2', location: [-81, 28] },
    { itemId: '3', location: [null, -81] },
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lat, 29.18658);
  assert.equal(rows[0].lon, -82.180882);
  assert.equal(rows[0].name, 'I-75');
  assert.equal(rows[0].url, 'https://fl511.com/map/Cctv/1215');
  assert.equal(rows[0].headingConfidence, 'low');
});
test('FL511 failures are not reported as a successful empty catalog', async () => {
  await assert.rejects(loadFloridaSources({ fetchImpl: async () => ({ok:false,status:503}) }), /503/);
  assert.throws(() => parseFloridaCameras({}), /Invalid/);
});
