/* Bus Bhai's own offline basemap: Hyderabad roads, lakes, parks, rail and metro
   drawn on canvas tiles from bundled OSM data (data/map.json). No tile server. */
(function () {
  var PAL = {
    light: { bg: '#F1EFEA', water: '#C9D9E4', park: '#E1E7D6', minor: '#FFFFFF', mid: '#FFFFFF', midCase: '#E4E0D8',
      major: '#FFFFFF', majorCase: '#D9D3C8', rail: '#BDB7AC', metro: '#B3A3D6', river: '#C9D9E4' },
    dark: { bg: '#141416', water: '#1C2731', park: '#18201A', minor: '#25252A', mid: '#2E2E34', midCase: '#1B1B1F',
      major: '#3A3A41', majorCase: '#1B1B1F', rail: '#36363C', metro: '#4A3F66', river: '#1C2731' }
  };
  var CELL = 0.02; // degrees per index cell
  var data = null, idx = {}, loading = null;

  function decode(a) { var out = new Float32Array(a.length), x = 0, y = 0; for (var i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; out[i] = x / 1e5; out[i + 1] = y / 1e5; } return out; }
  function bbox(c) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (var i = 0; i < c.length; i += 2) { var x = c[i], y = c[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; }
  function addIdx(f) {
    var b = f.b;
    for (var cx = Math.floor(b[0] / CELL); cx <= Math.floor(b[2] / CELL); cx++)
      for (var cy = Math.floor(b[1] / CELL); cy <= Math.floor(b[3] / CELL); cy++) { var k = cx + ':' + cy; (idx[k] || (idx[k] = [])).push(f); }
  }
  function prepare(j) {
    var all = [];
    j.k.forEach(function (kind, ki) {
      j.f[ki].forEach(function (g, gi) {
        var f = { k: kind, o: ki, id: ki * 1e7 + gi };
        if (kind === 'water' || kind === 'park') { f.r = g.map(decode); f.b = bbox(f.r[0]); }
        else { f.c = decode(g); f.b = bbox(f.c); }
        all.push(f); addIdx(f);
      });
    });
    return { kinds: j.k, n: all.length, places: j.p || [] };
  }
  function load() {
    if (loading) return loading;
    loading = fetch('data/map.json').then(function (r) { return r.json(); }).then(function (j) { data = prepare(j); return data; });
    return loading;
  }

  function widths(z) {
    return {
      river: z < 10 ? 0.8 : z < 13 ? 1.4 : 2.4,
      major: z < 9 ? 0.6 : z < 11 ? 0.8 : z < 12 ? 1.2 : z < 13 ? 1.8 : z < 14 ? 3 : z < 15 ? 4.5 : z < 16 ? 7 : 10,
      mid: z < 10 ? 0 : z < 12 ? 0.5 : z < 13 ? 0.7 : z < 14 ? 1.4 : z < 15 ? 2.6 : z < 16 ? 4.5 : 7,
      minor: z < 14 ? 0 : z < 15 ? 0.9 : z < 16 ? 2 : 4,
      rail: z < 12 ? 0.6 : z < 15 ? 1 : 1.6,
      metro: z < 12 ? 1 : z < 14 ? 1.8 : z < 16 ? 2.6 : 3.6
    };
  }

  var BaseMap = L.GridLayer.extend({
    options: { tileSize: 256, updateWhenIdle: false, keepBuffer: 4, maxZoom: 19, minZoom: 7 },
    setDark: function (d) { if (this._dark === d) return; this._dark = d; this.redraw(); var c = this._map && this._map.getContainer(); if (c) c.style.background = PAL[d ? 'dark' : 'light'].bg; },
    onAdd: function (map) {
      L.GridLayer.prototype.onAdd.call(this, map);
      map.getContainer().style.background = PAL[this._dark ? 'dark' : 'light'].bg;
      var self = this;
      if (!data) load().then(function () { self.redraw(); }).catch(function () {});
    },
    createTile: function (co) {
      var tile = document.createElement('canvas'), r = Math.min(window.devicePixelRatio || 1, 3), S = 256;
      tile.width = S * r; tile.height = S * r;
      if (data) this._draw(tile.getContext('2d'), co, r);
      return tile;
    },
    _draw: function (ctx, co, r) {
      var z = co.z, n = Math.pow(2, z), S = 256, P = PAL[this._dark ? 'dark' : 'light'];
      ctx.scale(r, r);
      ctx.fillStyle = P.bg; ctx.fillRect(0, 0, S, S);
      var ox = co.x * S, oy = co.y * S, W = S * n;
      function X(lon) { return (lon + 180) / 360 * W - ox; }
      function Y(lat) { var s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * W - oy; }
      function lon(px) { return px / W * 360 - 180; }
      function lat(py) { var m = Math.PI - 2 * Math.PI * py / W; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(m) - Math.exp(-m))); }
      var pad = 12, L0 = lon(ox - pad), L1 = lon(ox + S + pad), A0 = lat(oy + S + pad), A1 = lat(oy - pad);
      var seen = {}, list = [];
      for (var cx = Math.floor(L0 / CELL); cx <= Math.floor(L1 / CELL); cx++)
        for (var cy = Math.floor(A0 / CELL); cy <= Math.floor(A1 / CELL); cy++) {
          var b = idx[cx + ':' + cy]; if (!b) continue;
          for (var i = 0; i < b.length; i++) { var f = b[i]; if (seen[f.id]) continue; seen[f.id] = 1;
            if (f.b[2] < L0 || f.b[0] > L1 || f.b[3] < A0 || f.b[1] > A1) continue; list.push(f); }
        }
      if (!list.length) return;
      list.sort(function (a, b) { return a.o - b.o; });
      var w = widths(z);
      function path(c) { ctx.moveTo(X(c[0]), Y(c[1])); for (var i = 2; i < c.length; i += 2) ctx.lineTo(X(c[i]), Y(c[i + 1])); }
      function polys(kind, col) {
        ctx.fillStyle = col; ctx.beginPath();
        list.forEach(function (f) { if (f.k !== kind) return; f.r.forEach(function (ring) { path(ring); ctx.closePath(); }); });
        ctx.fill('evenodd');
      }
      function lines(kind, col, width, dash) {
        if (width <= 0) return;
        ctx.strokeStyle = col; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath();
        list.forEach(function (f) { if (f.k === kind) path(f.c); });
        ctx.stroke();
      }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      polys('park', P.park); polys('water', P.water);
      lines('river', P.river, w.river);
      lines('minor', P.minor, w.minor);
      if (z >= 14) lines('mid', P.midCase, w.mid + 1.5);
      lines('mid', P.mid, w.mid);
      if (z >= 13) lines('major', P.majorCase, w.major + 1.8);
      lines('major', P.major, w.major);
      ctx.lineCap = 'butt';
      lines('rail', P.rail, w.rail, z >= 14 ? [6, 4] : null);
      ctx.lineCap = 'round';
      lines('metro', P.metro, w.metro);
      ctx.setLineDash([]);
    }
  });
  // place names as light HTML labels, shown by importance and zoom
  function Labels(map, langFn) {
    var layer = L.layerGroup().addTo(map), shown = {};
    function minZ(rank) { return rank === 0 ? 7 : rank === 1 ? 9 : rank === 3 ? 12 : 14; }
    function refresh() {
      if (!data) return;
      var z = map.getZoom(), b = map.getBounds().pad(0.2), te = langFn && langFn() === 'te', want = {};
      var boxes = [], order = data.places.map(function (p, i) { return i; }).sort(function (a, c) { return data.places[a][2] - data.places[c][2]; });
      order.forEach(function (i) {
        var p = data.places[i];
        if (z < minZ(p[2]) || !b.contains([p[1], p[0]])) return;
        var pt = map.latLngToContainerPoint([p[1], p[0]]), wdt = Math.min(160, 7 * ((te && p[4]) || p[3]).length) / 2 + 6;
        for (var k = 0; k < boxes.length; k++) { var o = boxes[k]; if (Math.abs(o.x - pt.x) < o.w + wdt && Math.abs(o.y - pt.y) < 18) return; }
        boxes.push({ x: pt.x, y: pt.y, w: wdt });
        want[i] = 1;
        if (shown[i] && shown[i]._te === te) return;
        if (shown[i]) layer.removeLayer(shown[i]);
        var m = L.marker([p[1], p[0]], { interactive: false, keyboard: false, zIndexOffset: -1000,
          icon: L.divIcon({ className: 'plabel r' + p[2], html: '<span>' + ((te && p[4]) || p[3]).replace(/</g, '&lt;') + '</span>', iconSize: null }) });
        m._te = te; shown[i] = m; layer.addLayer(m);
      });
      Object.keys(shown).forEach(function (i) { if (!want[i]) { layer.removeLayer(shown[i]); delete shown[i]; } });
    }
    map.on('zoomend moveend', function () { refresh(); });
    load().then(refresh).catch(function () {});
    return { refresh: function () { Object.keys(shown).forEach(function (i) { layer.removeLayer(shown[i]); }); shown = {}; refresh(); } };
  }
  window.BusBaseMap = { labels: Labels, create: function (dark) { var l = new BaseMap(); l._dark = !!dark; return l; }, load: load, PAL: PAL };
})();
