const assert = require('assert');
const C = require('../assets/js/core.js');
const raw = require('../assets/data/gtfs.json');
let t0 = Date.now();
const D = new C.Data(raw);
console.log('index built in', Date.now() - t0, 'ms; places', D.places.length);
// search by route
for (const q of ['10H', '218', '290U', '10h', ' 300 ']) {
  const r = D.search(q).routes; assert(r.length, 'no result ' + q); assert.strictEqual(r[0].key, C.routeKey(q)); }
assert(D.search('10').routes.length > 5);
// search by stop
for (const q of ['charminar', 'Mehdi', 'secunderabad', 'koti', 'jbs', 'uppal x', 'kondapur']) {
  const p = D.search(q).places; assert(p.length, 'no place ' + q); console.log(q, '->', p.slice(0,3).map(x => x.name + '(' + x.routeCount + ')').join(', ')); }
assert.strictEqual(D.search('zzzzqq').places.length, 0);
// nearby (Nagole)
const nb = D.nearby(17.3713, 78.5590, 1200, 5); assert(nb.length); console.log('near Nagole:', nb.map(x => x.place.name + ' ' + Math.round(x.d) + 'm').join(', '));
// scheduled ETAs
const r10h = D.routeByKey['10H'], p = r10h.p[0];
const s = C.scheduledAt(p, 10, 8 * 60, 3); assert.strictEqual(s.length, 3); assert(s[0] >= 0 && s[1] >= s[0]);
const late = C.scheduledAt(p, 0, 23 * 60 + 55, 2); console.log('after 23:55 next', late.map(Math.round));
assert(late.every(m => m >= 0));
// offsets monotonic, sane total durations (feed bug fixed)
let bad = 0, durs = [];
D.routes.forEach(r => r.p.forEach(pp => { for (let i = 1; i < pp.o.length; i++) if (pp.o[i] < pp.o[i-1]) bad++; durs.push(pp.o[pp.o.length-1]); }));
durs.sort((a,b)=>a-b); console.log('trip duration p50/p95 min', durs[durs.length>>1], durs[Math.floor(durs.length*.95)]);
assert.strictEqual(bad, 0); assert(durs[durs.length>>1] < 120);
// projection + live ETA
const mid = D.stops[p.s[5]], nxt = D.stops[p.s[6]];
const lat = (mid.lat + nxt.lat) / 2, lon = (mid.lon + nxt.lon) / 2;
const pr = C.project(D, p, lat, lon); assert(pr.off < 60, 'off ' + pr.off); assert(pr.pos > 5 && pr.pos < 6, 'pos ' + pr.pos);
const e = C.liveEta(p, pr.pos, 15, 0); assert(e > 0 && e < 120); console.log('live ETA stop15 from pos', pr.pos.toFixed(2), '=', e, 'min');
assert.strictEqual(C.liveEta(p, 12, 3, 5), null);
assert(C.liveEta(p, pr.pos, 15, 6) > 0);
const far = C.project(D, p, 17.2, 78.2); assert(far.off > 5000);
assert.strictEqual(C.fmtClock(0), '12:00 AM'); assert.strictEqual(C.fmtClock(13*60+5), '1:05 PM'); assert.strictEqual(C.fmtClock(1440+65), '1:05 AM');
// placeRoutes
const ch = D.search('charminar').places[0]; const pr2 = D.placeRoutes(ch); assert(pr2.length); console.log('charminar routes', [...new Set(pr2.map(x=>x.route.id))].slice(0,10).join(' '));
console.log('ALL CORE TESTS PASSED');
const A = D.search('mehdipatnam').places[0], B = D.search('koti').places[0];
const bw = D.between(A, B); console.log('Mehdipatnam->Koti direct', bw.direct.slice(0,6).map(x => x.route.id + ' ' + x.mins + 'm').join(', '));
assert(bw.direct.length > 0);
const N = D.search('nagole x road').places[0], H = D.search('hitex').places[0];
const bw2 = D.between(N, H); console.log('Nagole->Hitex direct', bw2.direct.length, 'transfer', bw2.transfer.slice(0,3).map(o => o.legs[0].route.id + ' > ' + o.via.name + ' > ' + o.legs[1].route.id + ' ~' + o.mins + 'm').join(' | '));
assert(bw2.direct.length + bw2.transfer.length > 0);
const dt = C.dayTimes(p, 3); assert(dt.length === p.x.length && dt[0] <= dt[dt.length-1]);
// 290U-like: every route id must be found by its own key
let miss = D.routes.filter(r => !D.search(r.id).routes.some(x => x === r)).map(r => r.id); console.log('route ids not findable:', miss.length, miss.slice(0,10)); assert.strictEqual(miss.length, 0);
// night wrap: at 00:20 a trip departing 23:50 arriving later should be counted
console.log('BETWEEN + SEARCH TESTS PASSED');
