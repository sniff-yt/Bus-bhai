/* Bus Bhai core: data index, search, geometry and ETA math. Pure JS, no DOM (tested in Node). */
(function (root) {
  'use strict';
  var R = 6371000;
  function rad(d) { return d * Math.PI / 180; }
  function dist(aLat, aLon, bLat, bLon) {
    var dLa = rad(bLat - aLat), dLo = rad(bLon - aLon);
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function routeKey(s) { return String(s || '').toUpperCase().replace(/\s+/g, ''); }

  /** Build in-memory indexes from the bundled JSON. */
  function Data(raw) {
    var self = this;
    this.version = raw.v;
    this.stops = raw.stops.map(function (s, i) { return { i: i, name: s[0], lat: s[1], lon: s[2], n: norm(s[0]) }; });
    this.routes = raw.routes.map(function (r, i) {
      r.i = i; r.key = routeKey(r.id);
      r.p.forEach(function (p, j) { p.j = j; p.cum = cumDist(self.stops, p.s); });
      return r;
    });
    // The feed's direction_id is inconsistent within a route, so derive direction from endpoints:
    // dd=0 runs like the most frequent pattern, dd=1 runs the opposite way.
    this.routes.forEach(function (r) {
      var b = r.p.slice().sort(function (x, y) { return y.x.length - x.x.length; })[0];
      var bo = self.stops[b.s[0]], bh = self.stops[b.s[b.s.length - 1]];
      r.p.forEach(function (q) {
        var qo = self.stops[q.s[0]], qh = self.stops[q.s[q.s.length - 1]];
        var same = dist(qo.lat, qo.lon, bo.lat, bo.lon) + dist(qh.lat, qh.lon, bh.lat, bh.lon);
        var opp = dist(qo.lat, qo.lon, bh.lat, bh.lon) + dist(qh.lat, qh.lon, bo.lat, bo.lon);
        q.dd = same <= opp ? 0 : 1;
      });
    });
    this.routeByKey = {};
    this.routes.forEach(function (r) { self.routeByKey[r.key] = r; });
    // stop -> [routeIdx, patIdx, pos]
    this.stopRoutes = this.stops.map(function () { return []; });
    this.routes.forEach(function (r) {
      r.p.forEach(function (p) {
        p.s.forEach(function (si, pos) { self.stopRoutes[si].push([r.i, p.j, pos]); });
      });
    });
    // Places = same-name stops clustered within 450 m (a "stop" to a rider is usually both sides of the road)
    var byName = {};
    this.stops.forEach(function (s) { (byName[s.n] = byName[s.n] || []).push(s); });
    this.places = [];
    this.placeOfStop = new Array(this.stops.length);
    Object.keys(byName).forEach(function (n) {
      var list = byName[n], clusters = [];
      list.forEach(function (s) {
        var c = null;
        for (var k = 0; k < clusters.length; k++) {
          if (dist(clusters[k].lat, clusters[k].lon, s.lat, s.lon) < 450) { c = clusters[k]; break; }
        }
        if (!c) { c = { name: s.name, n: n, stops: [], lat: s.lat, lon: s.lon }; clusters.push(c); }
        c.stops.push(s.i);
        c.lat = c.stops.reduce(function (a, i) { return a + self.stops[i].lat; }, 0) / c.stops.length;
        c.lon = c.stops.reduce(function (a, i) { return a + self.stops[i].lon; }, 0) / c.stops.length;
      });
      clusters.forEach(function (c) {
        c.id = self.places.length;
        var rs = {};
        c.stops.forEach(function (si) { self.placeOfStop[si] = c.id; self.stopRoutes[si].forEach(function (e) { rs[e[0]] = 1; }); });
        c.routeCount = Object.keys(rs).length;
        self.places.push(c);
      });
    });
  }
  function cumDist(stops, seq) {
    var out = [0];
    for (var i = 1; i < seq.length; i++) {
      var a = stops[seq[i - 1]], b = stops[seq[i]];
      out.push(out[i - 1] + dist(a.lat, a.lon, b.lat, b.lon));
    }
    return out;
  }

  /** Search routes by number and places by name. */
  Data.prototype.search = function (q, limit) {
    limit = limit || 30;
    var res = { routes: [], places: [] };
    var k = routeKey(q), n = norm(q);
    if (!n) return res;
    if (/\d/.test(k) || k.length <= 4) {
      var scored = [];
      this.routes.forEach(function (r) {
        var s = -1;
        if (r.key === k) s = 100;
        else if (r.key.indexOf(k) === 0) s = 80 - (r.key.length - k.length);
        else if (r.key.split('/').some(function (part) { return part === k; })) s = 70;
        else if (r.key.split('/').some(function (part) { return part.indexOf(k) === 0; })) s = 50;
        if (s >= 0) scored.push([s, r]);
      });
      scored.sort(function (a, b) { return b[0] - a[0] || a[1].key.length - b[1].key.length || (a[1].key < b[1].key ? -1 : 1); });
      res.routes = scored.slice(0, limit).map(function (x) { return x[1]; });
    }
    if (n.length >= 2) {
      var toks = n.split(' ');
      var ps = [];
      this.places.forEach(function (p) {
        var words = p.n.split(' ');
        var ok = toks.every(function (t) { return words.some(function (w) { return w.indexOf(t) === 0; }) || (t.length >= 4 && p.n.indexOf(t) >= 0); });
        if (!ok) return;
        var s = (p.n === n ? 100 : p.n.indexOf(n) === 0 ? 60 : 30) + Math.min(p.routeCount, 40) / 2;
        ps.push([s, p]);
      });
      ps.sort(function (a, b) { return b[0] - a[0]; });
      res.places = ps.slice(0, limit).map(function (x) { return x[1]; });
    }
    return res;
  };

  /** Places near a point, sorted by distance. */
  Data.prototype.nearby = function (lat, lon, radius, limit) {
    radius = radius || 1200; limit = limit || 20;
    var out = [];
    this.places.forEach(function (p) {
      var d = dist(lat, lon, p.lat, p.lon);
      if (d <= radius) out.push({ place: p, d: d });
    });
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, limit);
  };

  /** Routes serving a place: [{route, pat, pos, stop}] one entry per route+pattern (first matching stop). */
  Data.prototype.placeRoutes = function (place) {
    var self = this, seen = {}, out = [];
    place.stops.forEach(function (si) {
      self.stopRoutes[si].forEach(function (e) {
        var key = e[0] + ':' + e[1];
        if (seen[key]) return; seen[key] = 1;
        var p = self.routes[e[0]].p[e[1]];
        if (e[2] === p.s.length - 1) return; // terminating here: not useful for boarding
        out.push({ route: self.routes[e[0]], pat: p, pos: e[2], stop: si });
      });
    });
    return out;
  };

  /**
   * Buses between two places. Direct trips first: [{route, pat, from, to, mins}] (from<to positions).
   * If no direct bus, one-change options: [{legs:[a,b], via: place, mins}].
   */
  Data.prototype.between = function (A, B, limit) {
    limit = limit || 25;
    var self = this, bset = {}, direct = [], seen = {};
    B.stops.forEach(function (s) { bset[s] = 1; });
    A.stops.forEach(function (sa) {
      self.stopRoutes[sa].forEach(function (e) {
        var r = self.routes[e[0]], p = r.p[e[1]];
        for (var k = e[2] + 1; k < p.s.length; k++) {
          if (bset[p.s[k]]) {
            var key = r.i + ':' + p.d + ':' + k;
            var prev = seen[r.i];
            var item = { route: r, pat: p, from: e[2], to: k, mins: p.o[k] - p.o[e[2]], trips: p.x.length };
            if (prev == null) { seen[r.i] = direct.length; direct.push(item); }
            else if (direct[prev].mins > item.mins + 10 || (direct[prev].trips < item.trips && item.mins <= direct[prev].mins + 10)) direct[prev] = item; // prefer the most frequent variant
            break;
          }
        }
      });
    });
    direct.sort(function (a, b) { return a.mins - b.mins || b.trips - a.trips; });
    var res = { direct: direct.slice(0, limit), transfer: [] };
    if (direct.length) return res;
    // one change: places reachable from A (after) x places that reach B (before)
    var fromA = {}; // placeId -> best leg
    A.stops.forEach(function (sa) {
      self.stopRoutes[sa].forEach(function (e) {
        var p = self.routes[e[0]].p[e[1]];
        for (var k = e[2] + 1; k < p.s.length; k++) {
          var pl = self.placeOfStop[p.s[k]], m = p.o[k] - p.o[e[2]];
          if (!fromA[pl] || fromA[pl].mins > m) fromA[pl] = { route: self.routes[e[0]], pat: p, from: e[2], to: k, mins: m };
        }
      });
    });
    var opts = [];
    B.stops.forEach(function (sb) {
      self.stopRoutes[sb].forEach(function (e) {
        var p = self.routes[e[0]].p[e[1]];
        for (var k = e[2] - 1; k >= 0; k--) {
          var pl = self.placeOfStop[p.s[k]];
          var l1 = fromA[pl];
          if (l1 && l1.route !== self.routes[e[0]]) {
            var m2 = p.o[e[2]] - p.o[k];
            opts.push({ legs: [l1, { route: self.routes[e[0]], pat: p, from: k, to: e[2], mins: m2 }], via: self.places[pl], mins: l1.mins + m2 + 8 });
          }
        }
      });
    });
    opts.sort(function (a, b) { return a.mins - b.mins; });
    var uniq = {}, out = [];
    opts.forEach(function (o) { var k = o.legs[0].route.id + '>' + o.legs[1].route.id; if (!uniq[k] && out.length < 12) { uniq[k] = 1; out.push(o); } });
    res.transfer = out;
    return res;
  };

  /** Full-day arrival times (minutes of day, sorted) at position pos of pattern p. */
  function dayTimes(p, pos) {
    var off = p.o[pos];
    return p.x.map(function (x) { return (x + off) % 1440; }).sort(function (a, b) { return a - b; });
  }

  // ---------- time ----------
  function nowMin(d) { d = d || new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

  /** Next scheduled arrivals at position `pos` of pattern p, in minutes-from-now. Handles midnight wrap. */
  function scheduledAt(p, pos, now, count) {
    count = count || 3;
    var off = p.o[pos], out = [];
    for (var day = -1; day < 2 && out.length < count; day++) {
      for (var i = 0; i < p.x.length && out.length < count; i++) {
        var arr = p.x[i] + off + day * 1440;
        var m = arr - now;
        if (m >= -0.5) out.push(m);
      }
    }
    return out.filter(function (m) { return m < 18 * 60; });
  }

  /** Project a GPS point onto the pattern polyline. Returns {pos: fractional stop index, along (m), off (m)}. */
  function project(data, p, lat, lon) {
    var best = { off: Infinity, pos: 0, along: 0 };
    var kx = Math.cos(rad(lat)) * R * Math.PI / 180, ky = R * Math.PI / 180;
    for (var i = 0; i < p.s.length - 1; i++) {
      var a = data.stops[p.s[i]], b = data.stops[p.s[i + 1]];
      var ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky, bx = (b.lon - lon) * kx, by = (b.lat - lat) * ky;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      var t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
      if (d < best.off - 1e-6) best = { off: d, pos: i + t, along: p.cum[i] + t * (p.cum[i + 1] - p.cum[i]) };
    }
    return best;
  }

  /** Scheduled minutes from origin at a fractional position along a pattern. */
  function offsetAt(p, pos) {
    var i = Math.floor(pos), f = pos - i;
    if (i >= p.o.length - 1) return p.o[p.o.length - 1];
    return p.o[i] + f * (p.o[i + 1] - p.o[i]);
  }

  /**
   * Live ETA (minutes) for a bus at fractional position busPos to reach stop index `pos`.
   * Uses schedule travel time between the two points, blended with the bus's observed speed when moving.
   * Returns null if the bus has already passed the stop.
   */
  function liveEta(p, busPos, pos, speedMps) {
    if (busPos > pos + 0.15) return null;
    var sched = Math.max(0, offsetAt(p, pos) - offsetAt(p, busPos));
    var i = Math.floor(busPos), f = busPos - i;
    var along = i >= p.cum.length - 1 ? p.cum[p.cum.length - 1] : p.cum[i] + f * (p.cum[i + 1] - p.cum[i]);
    var meters = Math.max(0, p.cum[pos] - along);
    if (speedMps && speedMps > 2 && speedMps < 25) {
      var obs = meters / speedMps / 60;
      return Math.round(0.6 * sched + 0.4 * obs);
    }
    // Floor: never faster than 30 km/h through city traffic
    return Math.round(Math.max(sched, meters / 8.3 / 60));
  }

  function fmtClock(minOfDay) {
    minOfDay = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
    var h = Math.floor(minOfDay / 60), m = minOfDay % 60, ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  var api = { Data: Data, dist: dist, norm: norm, routeKey: routeKey, nowMin: nowMin, scheduledAt: scheduledAt,
    project: project, offsetAt: offsetAt, dayTimes: dayTimes, liveEta: liveEta, fmtClock: fmtClock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Core = api;
})(this);
