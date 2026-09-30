const g = window.__godsEyeView;
const mod = g.dataManager.layers.get("flights")?.module;
const recs = mod?.getAnalystRecords?.(500) || [];
const modKeys = mod ? Object.keys(mod).filter((k) => /^_|state|bill/i.test(k)).slice(0, 30) : null;
const bcs = [];
const walk = (c, d) => { for (let i = 0; i < (c.length || 0); i++) { const x = c.get(i); if (!x) continue; if (x._billboards && x.length) { let id0; try { const bb = x.get(0); id0 = typeof bb.id === "object" ? JSON.stringify(bb.id).slice(0, 200) : String(bb.id); } catch (e) { id0 = String(e); } bcs.push({ n: x.constructor.name, len: x.length, id0 }); } if (x.get && x.length && d < 3 && !x._billboards) walk(x, d + 1); } };
walk(g.viewer.scene.primitives, 0);
const near = recs.filter((r) => r.lat && Math.hypot(r.lat - 28.0999, (r.lon + 82.5386) * 0.88) < 0.25).slice(0, 3);
return { nrecs: recs.length, near, modKeys, bcs };
