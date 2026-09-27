import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mappable,distanceKm,filterLocations,safeSource} from './model.js';
test('unlocated ATMs never become zero-coordinate markers',()=>{assert.equal(mappable({latitude:null,longitude:null}),false);assert.equal(mappable({latitude:0,longitude:0}),true);assert.equal(mappable({latitude:91,longitude:20}),false);});
test('nearby filters correctly across types without altering location records',()=>{const branch={name:'A',type:'branch',latitude:28,longitude:-82};const atm={name:'ATM',type:'atm',latitude:28.01,longitude:-82};const remote={name:'Far',type:'atm',latitude:30,longitude:-82};assert.ok(distanceKm(branch,atm)>1&&distanceKm(branch,atm)<1.2);assert.deepEqual(filterLocations([branch,atm,remote],{type:'atm',near:branch,radius:5}),[atm]);});
test('imported source URLs cannot escape the official directory',()=>{assert.equal(safeSource('javascript:alert(1)'),null);assert.equal(safeSource('https://evil.example/'),null);assert.equal(safeSource('https://locations.suncoastcreditunion.com/lee'),'https://locations.suncoastcreditunion.com/lee');});
