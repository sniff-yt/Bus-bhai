/* Bus Bhai Hyderabad: UI. */
(function () {
  'use strict';
  var A = window.Android || null;
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var t = function (k, a) { return I18N.t(k, a); };
  var HYD = [17.385, 78.4867];
  var BBOX = [15.75, 77.15, 19.98, 81.4];
  var TYPES = ['ordinary', 'metroexp', 'metrodlx', 'pallevelugu', 'express', 'deluxe', 'superlux', 'electric', 'ac'];

  // ---------- persistent state ----------
  function load(k, d) { try { var v = localStorage.getItem('hb_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem('hb_' + k, JSON.stringify(v)); } catch (e) {} }
  var P = {
    lang: load('lang', 'en'), theme: load('theme', 'system'), text: load('text', 100),
    favRoutes: load('favRoutes', []), favPlaces: load('favPlaces', []), recents: load('recents', []),
    reports: load('reports', []), feedback: load('feedback', []), fixes: load('fixes', {}),
    device: load('device', null), alarmN: load('alarmN', 2)
  };
  if (!P.device) { P.device = 'd' + Math.random().toString(36).slice(2, 12); save('device', P.device); }

  var D = null, map = null, live = new Live();
  var S = { tab: 'map', stack: [], snap: 'half', me: null, meAcc: 0, locState: 'unknown', buses: {}, share: null, alarm: null,
    pick: null, between: { a: null, b: null }, typeFilter: 'all', timeFrom: null, wanted: {}, fitted: false, tick: 0 };
  var L_ = {}; // map layers

  // ---------- helpers ----------
  function vib(ms) { try { if (A && A.vibrate) A.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function toast(msg, ms) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show'); el.setAttribute('role', 'status');
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }
  function mins(m) { m = Math.max(0, Math.round(m)); if (m < 1) return t('now'); if (m < 60) return m + '<small>' + t('min') + '</small>'; var h = Math.floor(m / 60); return h + t('h') + ' ' + (m % 60) + t('m'); }
  function minsTxt(m) { return mins(m).replace(/<[^>]+>/g, ''); }
  function nowM() { return Core.nowMin(); }
  function placeKey(pl) { return pl.stops[0]; }
  function placeByKey(k) { var pi = D.placeOfStop[k]; return pi == null ? null : D.places[pi]; }
  function routeColor() { return getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#141414'; }
  function stopName(si) { return (P.fixes[si] && P.fixes[si].name) || D.stops[si].name; }
  function headsign(p) { return stopName(p.s[p.s.length - 1]); }
  function origin(p) { return stopName(p.s[0]); }
  function short(n) { return n.length > 14 ? n.slice(0, 13) + '…' : n; }
  function headway(p) {
    var now = nowM(), xs = p.x.filter(function (x) { return x >= now - 30 && x <= now + 150; });
    if (xs.length < 3) return null;
    return Math.max(2, Math.round((xs[xs.length - 1] - xs[0]) / (xs.length - 1)));
  }
  function isFavRoute(rk) { return P.favRoutes.indexOf(rk) >= 0; }
  function isFavPlace(pl) { return P.favPlaces.indexOf(placeKey(pl)) >= 0; }
  function addRecent(r) {
    P.recents = P.recents.filter(function (x) { return !(x.k === r.k && x.type === r.type); });
    P.recents.unshift(r); P.recents = P.recents.slice(0, 8); save('recents', P.recents);
  }
  function nearPlaceLabel(pl) {
    // disambiguate same-named places with a nearby distinct stop name
    if (pl._near !== undefined) return pl._near;
    var best = null, bd = 1e9;
    for (var i = 0; i < D.places.length; i++) {
      var q = D.places[i]; if (q.n === pl.n || q.routeCount < 3) continue;
      var d = Core.dist(pl.lat, pl.lon, q.lat, q.lon); if (d < bd && d > 80) { bd = d; best = q; }
    }
    pl._near = best && bd < 2500 ? best.name : '';
    return pl._near;
  }

  // ---------- theme / language / text ----------
  function systemDark() {
    try { if (A && A.isDark) return A.isDark(); } catch (e) {}
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function applyTheme() {
    var dark = P.theme === 'dark' || (P.theme === 'system' && systemDark());
    document.documentElement.classList.toggle('dark', dark);
    try { if (A && A.setBars) A.setBars(dark); } catch (e) {}
    if (map) setTiles(dark);
    if (L_.routeLine) L_.routeLine.setStyle({ color: routeColor() });
  }
  window.onThemeChange = applyTheme;
  function applyLang() {
    I18N.lang = P.lang;
    document.documentElement.lang = P.lang === 'te' ? 'te' : 'en';
    document.documentElement.classList.toggle('te', P.lang === 'te');
    if (typeof L_ !== 'undefined' && L_.labels) L_.labels.refresh();
    document.querySelectorAll('[data-t]').forEach(function (el) { el.textContent = t(el.getAttribute('data-t')); });
    $('#q').placeholder = t('searchPh');
    $('#q').setAttribute('aria-label', t('searchPh'));
    $('#locate').setAttribute('aria-label', t('myLocation'));
  }
  function applyText() {
    try { if (A && A.setTextZoom) { A.setTextZoom(P.text); return; } } catch (e) {}
    document.documentElement.style.zoom = P.text === 100 ? '' : (P.text / 100);
  }

  // ---------- map ----------
  function setTiles(dark) {
    if (L_.tiles) { L_.tiles.setDark(dark); return; }
    L_.tiles = BusBaseMap.create(dark);
    L_.tiles.options.attribution = '© OpenStreetMap contributors · Contains data provided by TGSRTC';
    L_.tiles.addTo(map);
    L_.labels = BusBaseMap.labels(map, function () { return P.lang; });
  }
  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true, center: HYD, zoom: 12, minZoom: 7, maxBounds: [[15.4, 76.8], [20.3, 81.8]], maxBoundsViscosity: 0.8, tap: true, preferCanvas: false });
    map.attributionControl.setPrefix(false);
    setTiles(document.documentElement.classList.contains('dark'));
    L_.near = L.layerGroup().addTo(map);
    L_.route = L.layerGroup().addTo(map);
    L_.buses = L.layerGroup().addTo(map);
    L_.pin = L.layerGroup().addTo(map);
    map.on('click', function (e) {
      if (!S.picking) return;
      S.picking = false; S.manualLoc = true;
      gotFix(e.latlng.lat, e.latlng.lng, 50, null, null);
      setSnap('half'); render(true);
    });
    map.on('zoomend', function () { $('#map').classList.toggle('zfar', map.getZoom() < 14); });
    $('#map').classList.toggle('zfar', map.getZoom() < 14);
    map.on('dragstart', function () { S.follow = false; $('#locate').classList.remove('on'); if (S.snap === 'full') setSnap('half'); });
  }
  function divIcon(cls, size) { return L.divIcon({ className: '', html: '<div class="' + cls + '"></div>', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }); }
  function sheetVisiblePx() {
    var sh = $('#sheet'), h = sh.offsetHeight;
    return h - snapY(S.snap, h);
  }
  function fitTo(latlngs, maxZoom) {
    if (!latlngs.length) return;
    var b = L.latLngBounds(latlngs);
    map.fitBounds(b, { paddingTopLeft: [40, 100], paddingBottomRight: [40, sheetVisiblePx() + 70], maxZoom: maxZoom || 16, animate: true });
  }
  function offsetCenter(ll, zoom) {
    var p = map.project(ll, zoom); p.y += Math.max(0, sheetVisiblePx() / 2 - 30);
    return map.unproject(p, zoom);
  }
  function flyTo(ll, z) {
    // keep the point above the sheet
    var zoom = z || Math.max(map.getZoom(), 15);
    S.flying = true;
    map.once('moveend', function () { S.flying = false; });
    var far = map.getCenter().distanceTo(L.latLng(ll)) > 30000;
    if (far) map.setView(offsetCenter(ll, zoom), zoom, { animate: false }), S.flying = false;
    else map.flyTo(offsetCenter(ll, zoom), zoom, { duration: 0.6 });
  }
  function centerOn(ll) {
    var c = offsetCenter(ll, map.getZoom());
    if (map.getCenter().distanceTo(c) < 8) return;
    map.panTo(c, { animate: true, duration: 0.5, noMoveStart: true });
  }

  // ---------- location ----------
  function gotFix(lat, lon, acc, speed, heading) {
    var first = !S.me, wasApprox = !!S.approx;
    clearTimeout(S.locTimer);
    if (acc < 5000) S.approx = false; else if (S.me && !S.approx) return;
    var nowT = Date.now();
    if (S.me && !S.approx && S.lastFixT && nowT - S.lastFixT < 20000 && acc > Math.max(60, (S.meAcc || 0) * 2.5)) return; // worse source, ignore
    if (S.me && !S.approx && S.lastFixT && nowT - S.lastFixT < 1500) return; // de-dupe bursts from parallel sources
    S.lastFixT = nowT;
    S.me = [lat, lon]; S.meAcc = acc; S.meSpeed = speed; S.meHeading = heading;
    var was = S.locState; S.locState = 'ok';
    if (!L_.me) L_.me = L.marker(S.me, { icon: divIcon('me-dot', 18), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
    else L_.me.setLatLng(S.me);
    if (S.follow && !S.flying) centerOn(S.me);
    onFix();
    if ((first || was !== 'ok' || wasApprox !== !!S.approx) && cur().v === 'home') { if (first && inHyd(S.me)) flyTo(S.me, 15); render(); }
  }
  window.onNativeDiag = function (d) { S.locDiag = d; if (!S.me && cur().v === 'home') render(false); };
  window.onNativeFix = function (lat, lon, acc, speed, heading) { gotFix(lat, lon, acc, speed < 0 ? null : speed, heading < 0 ? null : heading); };
  window.onNativeLocState = function (st) {
    if (st === 'ok') return;
    if (S.me && st === 'slow') return;
    S.locState = st; clearTimeout(S.locTimer);
    if (cur().v === 'home') render();
  };
  function armLocTimer() {
    clearTimeout(S.locTimer);
    S.locTimer = setTimeout(function () {
      if (S.me) return;
      ipLocate();
      S.locTimer = setTimeout(function () { if (!S.me) { S.locState = 'slow'; if (cur().v === 'home') render(); } }, 8000);
    }, 10000);
  }
  window.onIpFix = function (lat, lon) {
    if (lat == null || S.me) return;
    if (!inHyd([lat, lon])) return;
    S.approx = true;
    gotFix(lat, lon, 5000, null, null);
  };
  function ipLocate() {
    if (A && A.ipLocate) { try { A.ipLocate(); return; } catch (e) {} }
    fetch('https://ipwho.is/').then(function (r) { return r.json(); }).then(function (j) { onIpFix(j.latitude, j.longitude); }).catch(function () {});
  }
  function startLocation() {
    if (!S.me) S.locState = 'asking';
    armLocTimer();
    var nativeOk = false;
    if (A && A.startLocation) {
      try {
        A.startLocation(); nativeOk = true;
        var lf = A.lastFix && A.lastFix();
        if (lf) { var q = lf.split(','); gotFix(+q[0], +q[1], +q[2], null, null); }
      } catch (e) {}
    }
    // The WebView's own geolocation runs alongside; whichever answers first wins.
    if (!navigator.geolocation) { if (!nativeOk) S.locState = 'unavailable'; return; }
    if (nativeOk && A.hasPermission && !A.hasPermission()) return;
    if (S.watch != null) { navigator.geolocation.clearWatch(S.watch); S.watch = null; }
    S.watch = navigator.geolocation.watchPosition(function (pos) {
      gotFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed, pos.coords.heading);
    }, function (err) {
      if (nativeOk) return;
      if (err.code === 1) { S.locState = 'denied'; navigator.geolocation.clearWatch(S.watch); S.watch = null; }
      else if (!S.me) S.locState = 'slow';
      if (cur().v === 'home') render();
    }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 });
  }
  window.onLocationPermission = function (granted) { if (granted) startLocation(); else { clearTimeout(S.locTimer); S.locState = 'denied'; if (cur().v === 'home') render(); } };
  function askLocation() {
    if (S.locState === 'off' && A && A.openLocationSettings) { A.openLocationSettings(); return; }
    if (A && A.requestLocation) { A.requestLocation(); } else { startLocation(); }
  }
  function inHyd(ll) { return ll && ll[0] > BBOX[0] && ll[0] < BBOX[2] && ll[1] > BBOX[1] && ll[1] < BBOX[3]; }

  // ---------- view stack ----------
  function cur() { return S.stack[S.stack.length - 1] || { v: 'home' }; }
  function push(v) { S.stack.push(v); S.fitted = false; render(true); }
  function replaceTop(v) { S.stack[S.stack.length - 1] = v; S.fitted = false; render(true); }
  function pop() { S.stack.pop(); S.fitted = false; render(true); }
  function goHome() { S.stack = []; render(true); }

  // ---------- live buses ----------
  live.onState(function (st) { updateOffline(); if (st === 'online') syncSubs(true); });
  live.onMessage(function (topic, m) {
    if (!m || m.v !== 1 || typeof m.lat !== 'number' || typeof m.lon !== 'number' || !m.id || !m.rk) return;
    if (topic.indexOf(LIVE_PREFIX + 'r/') !== 0) return;
    if (topicFor(m.rk, m.d) !== topic) return;
    if (m.id === P.device) return;
    if (!inHyd([m.lat, m.lon])) return;
    if (Math.abs(Date.now() - m.t) > 180000) return;
    var r = D.routeByKey[m.rk]; if (!r) return;
    var p = r.p[m.j] || r.p[0];
    var pr = Core.project(D, p, m.lat, m.lon);
    if (pr.off > 700) return; // ignore riders far off the route
    var b = S.buses[m.id] || (S.buses[m.id] = { id: m.id });
    b.rk = m.rk; b.d = p.dd; b.j = p.j; b.lat = m.lat; b.lon = m.lon; b.spd = m.spd; b.ty = TYPES.indexOf(m.ty) >= 0 ? m.ty : null; b.seen = Date.now(); b.pos = pr.pos;
    renderBuses(); scheduleRender();
    checkWaitAlarm();
  });
  function busesFor(rk, filterType) {
    var out = [], now = Date.now();
    Object.keys(S.buses).forEach(function (id) {
      var b = S.buses[id];
      if (b.rk !== rk || now - b.seen > 90000) return;
      if (filterType && filterType !== 'all' && b.ty !== filterType) return;
      out.push(b);
    });
    // merge riders on the same bus (same route, same direction, within 150 m)
    var merged = [];
    out.forEach(function (b) {
      var m = null;
      for (var i = 0; i < merged.length; i++) if (merged[i].d === b.d && Core.dist(merged[i].lat, merged[i].lon, b.lat, b.lon) < 150) { m = merged[i]; break; }
      if (m) { m.riders++; if (b.seen > m.seen) { m.lat = b.lat; m.lon = b.lon; m.pos = b.pos; m.seen = b.seen; } if (!m.ty) m.ty = b.ty; }
      else merged.push({ id: b.id, rk: b.rk, d: b.d, j: b.j, lat: b.lat, lon: b.lon, pos: b.pos, spd: b.spd, ty: b.ty, seen: b.seen, riders: 1 });
    });
    if (S.share && S.share.rk === rk && S.me) merged.push({ id: 'me', me: true, rk: rk, d: S.share.d, j: S.share.j, lat: S.me[0], lon: S.me[1], pos: S.share.pos || 0, spd: S.meSpeed, riders: 1, seen: now, ty: S.share.ty });
    return merged;
  }
  /** Best live ETA for (route, pattern, stop position). Projects buses of same direction onto this pattern. */
  function liveEtaFor(r, p, pos) {
    var best = null;
    busesFor(r.key, S.typeFilter).forEach(function (b) {
      if (b.d !== p.dd || b.me) return;
      var bp = b.j === p.j ? b.pos : Core.project(D, p, b.lat, b.lon).pos;
      var e = Core.liveEta(p, bp, pos, b.spd);
      if (e != null && (best == null || e < best.m)) best = { m: e, bus: b, stopsAway: Math.max(0, Math.ceil(pos - bp)) };
    });
    return best;
  }
  // Smooth in-place marker movement: tween from current to new position, never reset.
  function tween(marker, to) {
    var from = marker.getLatLng(), t0 = performance.now(), dur = 1200;
    if (Core.dist(from.lat, from.lng, to[0], to[1]) > 2500) { marker.setLatLng(to); return; }
    cancelAnimationFrame(marker._raf);
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur); k = 1 - Math.pow(1 - k, 3);
      marker.setLatLng([from.lat + (to[0] - from.lat) * k, from.lng + (to[1] - from.lng) * k]);
      if (k < 1) marker._raf = requestAnimationFrame(step);
    })(t0);
  }
  var busMarkers = {};
  function renderBuses() {
    var v = cur(), show = {};
    var rks = [];
    if (v.v === 'route') rks = [D.routes[v.r].key];
    else if (v.v === 'place' || v.v === 'between' || v.v === 'home') rks = Object.keys(S.wanted).map(function (t) { return S.wanted[t]; });
    var curPat = v.v === 'route' ? D.routes[v.r].p[v.j] : null;
    rks.forEach(function (rk) {
      busesFor(rk, S.typeFilter).forEach(function (b) {
        var r = D.routeByKey[rk], p = r.p[b.j] || r.p[0];
        var opp = curPat && b.d !== curPat.dd;
        var key = b.id;
        show[key] = 1;
        var label = esc(r.id) + '<span class="hs"> → ' + esc(short(headsign(p))) + '</span>' + (b.riders > 1 ? ' <span style="opacity:.8">·' + b.riders + '</span>' : '');
        if (b.me) label = esc(t('you')) + ' · ' + esc(r.id);
        var html = '<div class="bus-mk' + (b.me ? ' me' : '') + '" style="' + (opp ? 'opacity:.55;' : '') + '" role="img" aria-label="' + esc(t('busAria', { r: r.id, to: headsign(p) })) + '">' + icon('busf') + label + '</div>';
        var m = busMarkers[key];
        if (!m) {
          m = busMarkers[key] = L.marker([b.lat, b.lon], { icon: L.divIcon({ className: '', html: html, iconSize: [0, 0] }), zIndexOffset: 1000, keyboard: false });
          m._html = html; m.addTo(L_.buses);
          m.on('click', function () { var rr = D.routeByKey[rk]; if (cur().v !== 'route' || cur().r !== rr.i) push({ v: 'route', r: rr.i, j: p.j }); });
        } else {
          if (m._html !== html) { m.setIcon(L.divIcon({ className: '', html: html, iconSize: [0, 0] })); m._html = html; }
          tween(m, [b.lat, b.lon]);
        }
      });
    });
    Object.keys(busMarkers).forEach(function (k) { if (!show[k]) { L_.buses.removeLayer(busMarkers[k]); delete busMarkers[k]; } });
  }
  function syncSubs(force) {
    var want = {};
    var add = function (rk) { want[topicFor(rk, null)] = rk; };
    var v = cur();
    if (v.v === 'route') add(D.routes[v.r].key);
    if (v.v === 'place') { var pl = D.places[v.p]; var seen = {}; D.placeRoutes(pl).slice(0, 60).forEach(function (e) { if (!seen[e.route.key]) { seen[e.route.key] = 1; add(e.route.key); } }); }
    if (v.v === 'between' && S.betweenRes) S.betweenRes.direct.slice(0, 25).forEach(function (e) { add(e.route.key); });
    if (S.tab === 'saved') P.favRoutes.forEach(add);
    if (S.share) add(S.share.rk);
    if (S.alarm) add(S.alarm.rk);
    Object.keys(S.wanted).forEach(function (tp) { if (!want[tp]) live.unsubscribe(tp); });
    Object.keys(want).forEach(function (tp) { if (!S.wanted[tp] || force) { if (!S.wanted[tp]) live.subscribe(tp); } });
    S.wanted = want;
  }
  var renderPending = false;
  function scheduleRender() {
    if (renderPending) return; renderPending = true;
    setTimeout(function () { renderPending = false; if (!document.querySelector('.sheet.dragging')) render(false); }, 700);
  }

  // ---------- sharing ("I'm on this bus") ----------
  function startShare(r, p, ty) {
    if (!S.me) { askLocation(); toast(t('needLocation')); return; }
    // choose the pattern the rider is actually on (closest, same route)
    var best = null;
    r.p.forEach(function (q) { var pr = Core.project(D, q, S.me[0], S.me[1]); if (!best || pr.off < best.pr.off - 30 || (q === p && pr.off < best.pr.off + 30)) best = { q: q, pr: pr }; });
    if (best.pr.off > 800) { modalMsg(t('farTitle'), t('farBody', { r: r.id })); return; }
    S.share = { rk: r.key, j: best.q.j, d: best.q.dd, start: Date.now(), off: 0, pos: best.pr.pos, ty: ty || null, sent: 0 };
    try { if (A && A.keepAwake) A.keepAwake(true); } catch (e) {}
    publishShare();
    S.share.timer = setInterval(publishShare, 10000);
    vib(30); toast(t('sharingOn'));
    syncSubs(); render(false);
  }
  function stopShare(reason) {
    if (!S.share) return;
    clearInterval(S.share.timer);
    S.share = null;
    if (!S.alarm) try { if (A && A.keepAwake) A.keepAwake(false); } catch (e) {}
    if (reason) toast(reason, 4000);
    syncSubs(); renderBuses(); render(false);
  }
  function publishShare() {
    var sh = S.share; if (!sh || !S.me) return;
    if (Date.now() - sh.start > 90 * 60000) { stopShare(t('autoStop90')); return; }
    var r = D.routeByKey[sh.rk], p = r.p[sh.j];
    var pr = Core.project(D, p, S.me[0], S.me[1]);
    sh.pos = pr.pos;
    if (pr.off > 600) { sh.off++; if (sh.off >= 4) { stopShare(t('autoStopFar')); return; } } else sh.off = 0;
    if (pr.pos >= p.s.length - 1.05 && Date.now() - sh.start > 120000) { stopShare(t('autoStopEnd')); return; }
    var ok = live.publish(topicFor(sh.rk, sh.d), { v: 1, id: P.device, rk: sh.rk, d: sh.d, j: sh.j, lat: +S.me[0].toFixed(5), lon: +S.me[1].toFixed(5),
      spd: S.meSpeed == null ? null : +(+S.meSpeed).toFixed(1), acc: Math.round(S.meAcc || 0), t: Date.now(), ty: sh.ty }, false);
    if (ok) sh.sent++;
    renderBuses();
  }

  // ---------- alarms ----------
  function setAlarm(a) {
    S.alarm = a; S.alarm.fired = false;
    try { if (A && A.keepAwake) A.keepAwake(true); } catch (e) {}
    if (A && A.requestNotify) try { A.requestNotify(); } catch (e) {}
    if (a.mode === 'ride' && !S.me) askLocation();
    syncSubs(); vib(20); toast(a.mode === 'ride' ? t('alarmRideSet', { s: a.name }) : t('alarmWaitSet', { n: a.n, s: a.name }), 3500);
    render(false);
  }
  function clearAlarm(silent) {
    S.alarm = null;
    if (!S.share) try { if (A && A.keepAwake) A.keepAwake(false); } catch (e) {}
    syncSubs(); if (!silent) toast(t('alarmOff')); render(false);
  }
  function fireAlarm(title, body) {
    S.alarm.fired = true;
    vib(900); setTimeout(function () { vib(900); }, 1300); setTimeout(function () { vib(900); }, 2600);
    try { if (A && A.notify) A.notify(title, body); } catch (e) {}
    modalMsg(title, body, function () { clearAlarm(true); });
  }
  function onFix() {
    var a = S.alarm;
    if (a && !a.fired && a.mode === 'ride') {
      var r = D.routeByKey[a.rk], p = r.p[a.j], s = D.stops[p.s[a.pos]];
      var d = Core.dist(S.me[0], S.me[1], s.lat, s.lon);
      var pr = Core.project(D, p, S.me[0], S.me[1]);
      if (d < 700 || (pr.off < 400 && pr.pos >= a.pos - 1)) fireAlarm(t('alarmRideTitle'), t('alarmRideBody', { s: a.name }));
    }
  }
  function checkWaitAlarm() {
    var a = S.alarm;
    if (!a || a.fired || a.mode !== 'wait') return;
    var r = D.routeByKey[a.rk], p = r.p[a.j];
    var e = liveEtaFor(r, p, a.pos);
    if (e && e.stopsAway <= a.n) fireAlarm(t('alarmWaitTitle', { r: r.id }), t('alarmWaitBody', { n: e.stopsAway, s: a.name, m: minsTxt(e.m) }));
  }

  // ---------- rendering: sheet views ----------
  function render(entering) {
    if (!D) return;
    var v = cur(), body = $('#sheetBody'), html = '';
    if (v.v === 'home') html = viewHome();
    else if (v.v === 'route') html = viewRoute(v);
    else if (v.v === 'place') html = viewPlace(v);
    else if (v.v === 'between') html = viewBetween(v);
    var keep = entering ? 0 : body.scrollTop;
    body.innerHTML = '<div class="' + (entering ? 'view-enter' : '') + '">' + html + '</div>';
    body.scrollTop = keep;
    $('#sbBack').innerHTML = S.stack.length ? icon('back') : icon('search');
    $('#sbBack').setAttribute('aria-label', S.stack.length ? t('back') : t('searchPh'));
    if (!document.activeElement || document.activeElement.id !== 'q') $('#q').value = v.v === 'route' ? D.routes[v.r].id : v.v === 'place' ? D.places[v.p].name : '';
    $('#sbClear').innerHTML = ($('#q').value ? icon('x') : '');
    $('#sbClear').setAttribute('aria-label', t('clear'));
    if (entering) { drawMap(); syncSubs(); }
    renderBuses();
    if (S.tab === 'saved') renderSaved();
  }

  function viewHome() {
    var h = '<div class="sh-head"><div class="grow"><h1 class="h1">' + esc(t('homeTitle')) + '</h1><div class="sub">' + esc(greetingSub()) + '</div></div></div>';
    h += '<div class="chips" style="margin-bottom:16px">' +
      '<button class="chip" data-act="nearest">' + icon('navi') + esc(t('fromNearest')) + '</button>' +
      '<button class="chip" data-act="between">' + icon('route') + esc(t('betweenStops')) + '</button>' + '</div>';
    if (S.alarm || S.share) h += activeCard();
    var origin = S.me || null;
    if (!origin) {
      if (S.locState === 'slow') {
        h += '<div class="card"><div class="empty"><div class="ill">' + icon('locate') + '</div><div class="t1">' + esc(t('locSlowTitle')) + '</div><div>' + esc(t('locSlowBody')) + '</div>' +
          '<button class="btn ink sm" data-act="askloc">' + esc(t('tryAgain')) + '</button>' + (S.locDiag ? '<div class="diag">' + esc(S.locDiag) + '</div>' : '') + '<button class="btn sm" data-act="pickme">' + esc(t('pickOnMap')) + '</button>' + '</div></div>';
      } else if (S.locState === 'off') {
        h += '<div class="card"><div class="empty"><div class="ill">' + icon('pin') + '</div><div class="t1">' + esc(t('locSwitchTitle')) + '</div><div>' + esc(t('locSwitchBody')) + '</div>' +
          '<button class="btn ink sm" data-act="askloc">' + esc(t('openSettings')) + '</button>' + (S.locDiag ? '<div class="diag">' + esc(S.locDiag) + '</div>' : '') + '<button class="btn sm" data-act="pickme">' + esc(t('pickOnMap')) + '</button>' + '</div></div>';
      } else if (S.locState === 'denied' || S.locState === 'error' || S.locState === 'unavailable' || S.locState === 'unknown') {
        h += '<div class="card"><div class="empty"><div class="ill">' + icon('pin') + '</div><div class="t1">' + esc(t('locOffTitle')) + '</div><div>' + esc(t('locOffBody')) + '</div>' +
          '<button class="btn ink sm" data-act="askloc">' + esc(t('turnOnLoc')) + '</button>' + (S.locDiag ? '<div class="diag">' + esc(S.locDiag) + '</div>' : '') + '<button class="btn sm" data-act="pickme">' + esc(t('pickOnMap')) + '</button>' + '</div></div>';
      } else {
        h += '<div class="card"><div class="empty"><div class="ill">' + icon('locate') + '</div><div class="t1">' + esc(t('finding')) + '</div>' + (S.locDiag ? '<div class="diag">' + esc(S.locDiag) + '</div>' : '') + '<button class="btn sm" data-act="pickme">' + esc(t('pickOnMap')) + '</button></div></div>';
      }
      h += '<div class="section-label">' + esc(t('popular')) + '</div><div class="card">';
      ['Secunderabad', 'Koti', 'Mehdipatnam', 'Dilsukhnagar', 'Ameerpet', 'Uppal X Roads'].forEach(function (n) {
        var pl = D.search(n, 1).places[0]; if (pl) h += placeRow(pl, null);
      });
      return h + '</div>' + footer();
    }
    if (S.approx) h += '<div class="status"><div class="ic">' + icon('info') + '</div><div class="grow"><div class="t2">' + esc(t('approxLoc')) + '</div></div><button class="btn sm" data-act="pickme">' + esc(t('pickOnMap')) + '</button></div>';
    if (!inHyd(S.me)) h += '<div class="status"><div class="ic">' + icon('info') + '</div><div class="grow"><div class="t2">' + esc(t('outsideHyd')) + '</div></div></div>';
    var nb = D.nearby(origin[0], origin[1], 1500, 12);
    h += '<div class="section-label">' + esc(t('nearby')) + '</div>';
    if (!nb.length) h += '<div class="card"><div class="empty"><div class="t1">' + esc(t('noNearby')) + '</div></div></div>';
    else { h += '<div class="card">'; nb.forEach(function (x) { h += placeRow(x.place, x.d); }); h += '</div>'; }
    return h + footer();
  }
  function greetingSub() {
    var hr = new Date().getHours();
    if (hr >= 23 || hr < 5) return t('subNight');
    return t('subDay');
  }
  function footer() { return '<div class="foot">' + esc(t('attrib')) + '</div>'; }
  function activeCard() {
    var h = '';
    if (S.share) { var r = D.routeByKey[S.share.rk]; h += '<div class="status live"><div class="ic">' + icon('live') + '</div><div class="grow"><div class="t1">' + esc(t('sharingOnRoute', { r: r.id })) + '</div><div class="t2">' + esc(t('sharingNote')) + '</div></div><button class="btn soft sm" data-act="stopshare">' + esc(t('stop')) + '</button></div>'; }
    if (S.alarm) { var a = S.alarm; h += '<div class="status"><div class="ic">' + icon('bellon') + '</div><div class="grow"><div class="t1">' + esc(a.mode === 'ride' ? t('alarmRideShort', { s: a.name }) : t('alarmWaitShort', { n: a.n, s: a.name })) + '</div><div class="t2">' + esc(t('route') + ' ' + D.routeByKey[a.rk].id) + '</div></div><button class="btn soft sm" data-act="clearalarm">' + esc(t('off')) + '</button></div>'; }
    return h;
  }
  function nextDepartures(pl, limit) {
    var now = S.timeFrom != null ? S.timeFrom : nowM();
    var out = [];
    D.placeRoutes(pl).forEach(function (e) {
      var lv = S.timeFrom == null ? liveEtaFor(e.route, e.pat, e.pos) : null;
      var sc = Core.scheduledAt(e.pat, e.pos, now, 2);
      var m = lv ? lv.m : sc.length ? sc[0] : null;
      if (m == null) return;
      out.push({ e: e, live: lv, m: m, sc: sc });
    });
    // one row per route+direction: earliest
    var by = {};
    out.forEach(function (x) { var k = x.e.route.key + ':' + x.e.pat.dd; if (!by[k] || x.m < by[k].m) by[k] = x; });
    out = Object.keys(by).map(function (k) { return by[k]; });
    out.sort(function (a, b) { return (b.live ? 1 : 0) - (a.live ? 1 : 0) || a.m - b.m; });
    return limit ? out.slice(0, limit) : out;
  }
  function placeRow(pl, d) {
    var deps = nextDepartures(pl, 8), seenR = {};
    var pills = deps.filter(function (x) { if (seenR[x.e.route.id]) return false; seenR[x.e.route.id] = 1; return true; }).slice(0, 4).map(function (x) { return '<span class="rpill sm">' + esc(x.e.route.id) + '</span>'; }).join('');
    var meta = d == null ? '' : d <= 1500 ? t('walk', { m: Math.max(1, Math.round(d / 75)) }) + ' · ' : (d / 1000).toFixed(1) + ' km · ';
    meta += t('nRoutes', { n: pl.routeCount });
    var near = d == null ? nearPlaceLabel(pl) : '';
    if (near) meta += ' · ' + t('near', { p: near });
    var first = deps[0];
    var trail = first ? '<div class="eta' + (first.live ? ' live' : '') + '">' + mins(first.m) + '</div><div class="tag' + (first.live ? ' live' : '') + '">' + (first.live ? '<span class="pulse"></span>' + esc(t('live')) : esc(t('sched'))) + '</div>' : '';
    return '<button class="row" data-place="' + pl.id + '" aria-label="' + esc(stopName(pl.stops[0]) + ', ' + meta) + '"><div class="lead">' + icon('pin') + '</div><div class="grow"><div class="title">' + esc(stopName(pl.stops[0])) + '</div><div class="meta">' + esc(meta) + '</div>' + (pills ? '<div class="rpills">' + pills + '</div>' : '') + '</div><div class="trail">' + trail + '</div></button>';
  }

  function typeChips() {
    var h = '<div class="chips" role="group" aria-label="' + esc(t('busType')) + '" style="margin:0 0 6px">';
    ['all'].concat(TYPES).forEach(function (ty) { h += '<button class="chip' + (S.typeFilter === ty ? ' on' : '') + '" data-type="' + ty + '" aria-pressed="' + (S.typeFilter === ty) + '">' + esc(t('ty_' + ty)) + '</button>'; });
    h += '</div>';
    if (S.typeFilter !== 'all') h += '<div class="sub" style="margin:2px 4px 10px;font-size:12px">' + esc(t('typeNote')) + '</div>';
    return h;
  }
  function timeChip() {
    return '<button class="chip' + (S.timeFrom != null ? ' on' : '') + '" data-act="time">' + icon('clock') + esc(S.timeFrom == null ? t('leaveNow') : t('leaveAt', { t: Core.fmtClock(S.timeFrom) })) + '</button>';
  }

  function viewPlace(v) {
    var pl = D.places[v.p], fav = isFavPlace(pl);
    var h = '<div class="sh-head"><div class="grow"><h1 class="h1">' + esc(stopName(pl.stops[0])) + '</h1><div class="sub">' + esc(t('nRoutes', { n: pl.routeCount }) + (pl.stops.length > 1 ? ' · ' + t('nPlatforms', { n: pl.stops.length }) : '') + (nearPlaceLabel(pl) ? ' · ' + t('near', { p: nearPlaceLabel(pl) }) : '')) + '</div></div>' +
      '<button class="round-btn' + (fav ? ' on' : '') + '" data-act="favplace" aria-pressed="' + fav + '" aria-label="' + esc(fav ? t('unsave') : t('save')) + '">' + icon(fav ? 'starf' : 'star') + '</button></div>';
    h += '<div class="chips" style="margin-bottom:10px">' + timeChip() + '<button class="chip" data-act="betweenFrom">' + icon('route') + esc(t('goSomewhere')) + '</button><button class="chip" data-act="reportplace">' + icon('flag') + esc(t('report')) + '</button></div>';
    h += typeChips();
    var deps = nextDepartures(pl);
    var anyLive = deps.some(function (x) { return x.live; });
    h += liveStatus(anyLive, deps.length, live.state);
    if (!deps.length) return h + '<div class="card"><div class="empty"><div class="t1">' + esc(t('noSchedHere')) + '</div><div>' + esc(t('noSchedHereBody')) + '</div></div></div>' + footer();
    h += '<div class="card">';
    deps.forEach(function (x) {
      var e = x.e, more = x.sc.filter(function (m) { return !x.live || m > x.m + 2; }).slice(x.live ? 0 : 1, x.live ? 1 : 2);
      var meta = (more.length ? t('then', { m: minsTxt(more[0]) }) : t('nStops', { n: e.pat.s.length - e.pos - 1 }));
      if (x.live && x.live.bus.ty) meta += ' · ' + t('ty_' + x.live.bus.ty);
      h += '<button class="row" data-route="' + e.route.i + '" data-pat="' + e.pat.j + '" data-pos="' + e.pos + '" aria-label="' + esc(t('route') + ' ' + e.route.id + ', ' + meta + ', ' + minsTxt(x.m) + (x.live ? ' ' + t('live') : ' ' + t('sched'))) + '"><span class="rpill">' + esc(e.route.id) + '</span><div class="grow"><div class="title">' + esc(headsign(e.pat)) + '</div><div class="meta">' + esc(meta) + '</div></div><div class="trail"><div class="eta' + (x.live ? ' live' : '') + '">' + (S.timeFrom != null ? esc(Core.fmtClock(S.timeFrom + x.m)) : mins(x.m)) + '</div><div class="tag' + (x.live ? ' live' : '') + '">' + (x.live ? '<span class="pulse"></span>' + esc(x.live.stopsAway === 0 ? t('arriving') : t('stopsAway', { n: x.live.stopsAway })) : esc(t('sched'))) + '</div></div></button>';
    });
    return h + '</div>' + footer();
  }
  function liveStatus(anyLive, n, state) {
    if (anyLive) return '<div class="status live" role="status"><div class="ic">' + icon('live') + '</div><div class="grow"><div class="t1">' + esc(t('liveNow')) + '</div><div class="t2">' + esc(t('liveNowBody')) + '</div></div></div>';
    var off = state !== 'online';
    return '<div class="status" role="status"><div class="ic">' + icon(off ? 'wifioff' : 'clock') + '</div><div class="grow"><div class="t1">' + esc(off ? t('liveOffline') : t('noLiveYet')) + '</div><div class="t2">' + esc(off ? t('liveOfflineBody') : t('noLiveBody')) + '</div></div></div>';
  }

  function viewRoute(v) {
    var r = D.routes[v.r], p = r.p[v.j] || r.p[0], fav = isFavRoute(r.key);
    var hw = headway(p), dur = p.o[p.o.length - 1];
    var sameDir = r.p.filter(function (q) { return q.dd === p.dd; }), other = r.p.filter(function (q) { return q.dd !== p.dd; });
    var h = '<div class="sh-head"><div class="grow"><span class="big-route">' + esc(r.id) + '</span><h1 class="h1">' + esc(origin(p)) + ' <span class="arrow">→</span> ' + esc(headsign(p)) + '</h1>' +
      '<div class="sub">' + esc(t('nStops', { n: p.s.length }) + ' · ~' + minsTxt(dur) + (hw ? ' · ' + t('every', { m: hw }) : '') + ' · ' + (p.dd === 0 ? t('dirUp') : t('dirDown'))) + '</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:8px"><button class="round-btn' + (fav ? ' on' : '') + '" data-act="favroute" aria-pressed="' + fav + '" aria-label="' + esc(fav ? t('unsave') : t('save')) + '">' + icon(fav ? 'starf' : 'star') + '</button>' +
      (other.length || r.p.length > 1 ? '<button class="round-btn" data-act="swapdir" aria-label="' + esc(t('swapDir')) + '">' + icon('swap') + '</button>' : '') + '</div></div>';
    if (sameDir.length > 1) {
      h += '<div class="chips variants" role="group" aria-label="' + esc(t('variants')) + '">';
      sameDir.slice(0, 8).forEach(function (q) { h += '<button class="chip' + (q === p ? ' on' : '') + '" data-pat="' + q.j + '" data-act="variant">' + esc(origin(q) === origin(p) || q === p ? t('toShort', { s: short(headsign(q)) }) : t('fromShort', { s: short(origin(q)) })) + '</button>'; });
      h += '</div>';
    }
    var buses = busesFor(r.key, S.typeFilter);
    var mine = buses.filter(function (b) { return b.d === p.dd && !b.me; });
    var oppN = buses.filter(function (b) { return b.d !== p.dd && !b.me; }).length;
    var sel = v.sel != null ? v.sel : null;
    var selEta = sel != null ? liveEtaFor(r, p, sel) : null;
    if (mine.length) {
      h += '<div class="status live" role="status"><div class="ic">' + icon('live') + '</div><div class="grow"><div class="t1">' + esc(t('nLive', { n: mine.length })) + '</div><div class="t2">' + esc(sel != null && selEta ? t('nearestTo', { m: minsTxt(selEta.m), s: stopName(p.s[sel]) }) : t('tapStop')) + (oppN ? ' · ' + esc(t('oppLive', { n: oppN })) : '') + '</div></div></div>';
    } else h += liveStatus(false, 1, live.state).replace(esc(t('noLiveBody')), esc(t('noLiveRouteBody')) + (oppN ? ' ' + esc(t('oppLive', { n: oppN })) : ''));
    if (S.alarm && S.alarm.rk === r.key) h += activeCard();
    // share button
    var sharingThis = S.share && S.share.rk === r.key;
    h += '<div class="share-wrap">' + (sharingThis
      ? '<button class="btn live block" data-act="stopshare">' + icon('live') + esc(t('sharingStop')) + '</button><div class="share-note">' + esc(t('sharingNote')) + '</div>'
      : '<button class="btn ink block" data-act="share">' + icon('busf') + esc(t('onThisBus')) + '</button><div class="share-note">' + esc(t('shareHint')) + '</div>') + '</div>';
    // timeline
    var now = S.timeFrom != null ? S.timeFrom : nowM();
    var meBus = buses.filter(function (b) { return b.d === p.dd; });
    var busAt = {};
    meBus.forEach(function (b) { var bp = b.j === p.j ? b.pos : Core.project(D, p, b.lat, b.lon).pos; var k = Math.max(0, Math.min(p.s.length - 1, Math.round(bp))); (busAt[k] = busAt[k] || []).push(b); });
    var passedUntil = sharingThis ? Math.floor(S.share.pos) : -1;
    h += '<div class="tl" role="list">';
    p.s.forEach(function (si, i) {
      var lv = mine.length ? liveEtaFor(r, p, i) : null;
      var sc = Core.scheduledAt(p, i, now, 1);
      var right = lv ? '<div class="eta live">' + mins(lv.m) + '</div>' : sc.length ? '<div class="clock">' + esc(Core.fmtClock(now + sc[0])) + '</div>' : '<div class="clock">—</div>';
      var cls = 'tl-row' + (i === sel ? ' sel' : '') + (i <= passedUntil ? ' passed' : '');
      var busHtml = (busAt[i] || []).map(function (b) { return '<div class="tl-bus' + (b.me ? ' me' : '') + '" style="top:50%" aria-hidden="true">' + icon('busf') + '</div>'; }).join('');
      h += '<button class="' + cls + '" role="listitem" data-stop="' + i + '" aria-label="' + esc(stopName(si) + ', ' + (lv ? minsTxt(lv.m) + ' ' + t('live') : sc.length ? Core.fmtClock(now + sc[0]) + ' ' + t('sched') : '')) + ((busAt[i] || []).length ? ', ' + t('busHere') : '') + '"><div class="tl-rail"><i></i>' + busHtml + '</div><div class="tname">' + esc(stopName(si)) + (P.fixes[si] ? ' <span class="tag">' + esc(t('fixedByYou')) + '</span>' : '') + '</div><div class="trail">' + right + '</div></button>';
      if (i === sel) {
        var alarmHere = S.alarm && S.alarm.rk === r.key && S.alarm.pos === i;
        h += '<div class="sel-actions"><button class="chip' + (alarmHere ? ' on' : '') + '" data-act="alarm">' + icon(alarmHere ? 'bellon' : 'bell') + esc(t('alertMe')) + '</button><button class="chip" data-act="fullday">' + icon('clock') + esc(t('fullDay')) + '</button><button class="chip" data-act="openstop">' + icon('pin') + esc(t('allBuses')) + '</button><button class="chip" data-act="reportstop">' + icon('flag') + esc(t('report')) + '</button></div>';
      }
    });
    h += '</div>';
    h += '<button class="link-row" data-act="missing">' + icon('plus') + esc(t('missingStop')) + '</button>';
    return h + footer();
  }

  function viewBetween(v) {
    var a = S.between.a, b = S.between.b;
    var field = function (which, pl, ph) {
      return '<button class="row" data-act="pick" data-which="' + which + '"><div class="lead">' + icon(which === 'a' ? 'navi' : 'pin') + '</div><div class="grow"><div class="meta" style="margin:0 0 2px">' + esc(which === 'a' ? t('from') : t('toLbl')) + '</div><div class="title" style="' + (pl ? '' : 'color:var(--faint);font-weight:450') + '">' + esc(pl ? stopName(pl.stops[0]) : ph) + '</div></div></button>';
    };
    var h = '<div class="sh-head"><div class="grow"><h1 class="h1">' + esc(t('betweenStops')) + '</h1><div class="sub">' + esc(t('betweenSub')) + '</div></div><button class="round-btn" data-act="swapab" aria-label="' + esc(t('swapDir')) + '">' + icon('swap') + '</button></div>';
    h += '<div class="card" style="margin-bottom:12px">' + field('a', a, t('pickFrom')) + field('b', b, t('pickTo')) + '</div>';
    if (!a && S.me) h += '<div class="chips" style="margin-bottom:12px"><button class="chip" data-act="useNearest">' + icon('locate') + esc(t('useNearest')) + '</button></div>';
    if (!a || !b) return h + footer();
    if (a === b) return h + '<div class="card"><div class="empty"><div class="t1">' + esc(t('sameStop')) + '</div></div></div>';
    var res = S.betweenRes = D.between(a, b);
    h += '<div class="chips" style="margin-bottom:10px">' + timeChip() + '</div>';
    var now = S.timeFrom != null ? S.timeFrom : nowM();
    if (res.direct.length) {
      var rows = res.direct.map(function (x) {
        var lv = S.timeFrom == null ? liveEtaFor(x.route, x.pat, x.from) : null;
        var sc = Core.scheduledAt(x.pat, x.from, now, 1);
        return { x: x, lv: lv, m: lv ? lv.m : sc.length ? sc[0] : 1e9 };
      }).sort(function (p, q) { return (q.lv ? 1 : 0) - (p.lv ? 1 : 0) || p.m - q.m; });
      h += '<div class="section-label">' + esc(t('directBuses')) + '</div><div class="card">';
      rows.forEach(function (y) {
        var x = y.x, meta = t('rideMins', { m: x.mins, n: x.to - x.from }) + ' · ' + t('to', { s: headsign(x.pat) });
        h += '<button class="row" data-route="' + x.route.i + '" data-pat="' + x.pat.j + '" data-pos="' + x.from + '"><span class="rpill">' + esc(x.route.id) + '</span><div class="grow"><div class="title">' + esc(x.route.id + ' · ' + headsign(x.pat)) + '</div><div class="meta">' + esc(meta) + '</div></div><div class="trail">' + (y.m < 1e9 ? '<div class="eta' + (y.lv ? ' live' : '') + '">' + (S.timeFrom != null ? esc(Core.fmtClock(now + y.m)) : mins(y.m)) + '</div><div class="tag' + (y.lv ? ' live' : '') + '">' + (y.lv ? '<span class="pulse"></span>' + esc(t('live')) : esc(t('sched'))) + '</div>' : '') + '</div></button>';
      });
      h += '</div>';
    } else if (res.transfer.length) {
      h += '<div class="section-label">' + esc(t('oneChange')) + '</div><div class="card">';
      res.transfer.forEach(function (o) {
        h += '<button class="row" data-route="' + o.legs[0].route.i + '" data-pat="' + o.legs[0].pat.j + '" data-pos="' + o.legs[0].from + '"><div class="grow"><div class="title"><span class="rpill sm">' + esc(o.legs[0].route.id) + '</span> → <span class="rpill sm">' + esc(o.legs[1].route.id) + '</span></div><div class="meta">' + esc(t('changeAt', { s: o.via.name }) + ' · ~' + minsTxt(o.mins)) + '</div></div>' + icon('chev', 'chev') + '</button>';
      });
      h += '</div>';
    } else h += '<div class="card"><div class="empty"><div class="t1">' + esc(t('noBetween')) + '</div><div>' + esc(t('noBetweenBody')) + '</div></div></div>';
    return h + footer();
  }

  // ---------- map drawing per view ----------
  function drawMap() {
    L_.route.clearLayers(); L_.near.clearLayers(); L_.pin.clearLayers();
    var v = cur();
    if (v.v === 'route') {
      var r = D.routes[v.r], p = r.p[v.j] || r.p[0];
      var lls = p.s.map(function (si) { var f = P.fixes[si]; return f && f.lat ? [f.lat, f.lon] : [D.stops[si].lat, D.stops[si].lon]; });
      L_.routeLine = L.polyline(lls, { color: routeColor(), weight: 5, opacity: .9, lineJoin: 'round', interactive: false }).addTo(L_.route);
      lls.forEach(function (ll, i) {
        var end = i === 0 || i === lls.length - 1;
        var m = L.marker(ll, { icon: divIcon('stop-dot' + (end ? ' end' : '') + (i === v.sel ? ' sel' : ''), end ? 16 : (i === v.sel ? 18 : 12)), keyboard: false, title: stopName(p.s[i]) }).addTo(L_.route);
        m.on('click', function () { selectStop(i, true); });
      });
      if (!S.fitted) { S.fitted = true; if (v.sel != null) flyTo(lls[v.sel], 15); else fitTo(lls); }
    } else if (v.v === 'place') {
      var pl = D.places[v.p];
      L.marker([pl.lat, pl.lon], { icon: divIcon('place-dot', 14), keyboard: false }).addTo(L_.pin);
      if (!S.fitted) { S.fitted = true; flyTo([pl.lat, pl.lon], 16); }
    } else if (v.v === 'between') {
      [S.between.a, S.between.b].forEach(function (pl) { if (pl) L.marker([pl.lat, pl.lon], { icon: divIcon('place-dot', 14), keyboard: false }).addTo(L_.pin); });
      if (!S.fitted && S.between.a && S.between.b) { S.fitted = true; fitTo([[S.between.a.lat, S.between.a.lon], [S.between.b.lat, S.between.b.lon]], 15); }
    } else {
      if (S.me && inHyd(S.me)) D.nearby(S.me[0], S.me[1], 1500, 12).forEach(function (x) {
        var m = L.marker([x.place.lat, x.place.lon], { icon: divIcon('near-dot', 10), keyboard: false, title: x.place.name }).addTo(L_.near);
        m.on('click', function () { openPlace(x.place); });
      });
    }
  }
  function selectStop(i, fromMap) {
    var v = cur(); if (v.v !== 'route') return;
    v.sel = v.sel === i && !fromMap ? null : i;
    render(false); drawMap();
    var r = D.routes[v.r], p = r.p[v.j];
    if (v.sel != null) {
      var s = D.stops[p.s[i]]; flyTo([s.lat, s.lon], Math.max(map.getZoom(), 15));
      if (fromMap) { if (S.snap === 'peek') setSnap('half'); setTimeout(function () { var el = document.querySelector('.tl-row.sel'); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60); }
    }
  }

  // ---------- open things ----------
  function openRoute(r, j, sel) {
    addRecent({ type: 'route', k: r.key });
    if (j == null) j = 0;
    var v = { v: 'route', r: r.i, j: j, sel: sel == null ? null : sel };
    if (cur().v === 'route') replaceTop(v); else push(v);
    if (S.snap === 'peek') setSnap('half');
  }
  function openPlace(pl) {
    addRecent({ type: 'place', k: placeKey(pl) });
    S.timeFrom = null;
    var v = { v: 'place', p: pl.id };
    if (cur().v === 'place') replaceTop(v); else push(v);
    if (S.snap === 'peek') setSnap('half');
  }

  // ---------- search ----------
  function openSearch(pickWhich) {
    S.pick = pickWhich || null;
    $('#searchPanel').hidden = false; $('#q').focus();
    if (pickWhich) { $('#q').value = ''; $('#q').placeholder = pickWhich === 'a' ? t('pickFrom') : t('pickTo'); }
    $('#sbBack').innerHTML = icon('back');
    renderSearch();
  }
  function closeSearch() {
    $('#searchPanel').hidden = true; $('#q').blur(); S.pick = null; $('#q').placeholder = t('searchPh');
    render(false);
  }
  function routeRow(r) {
    var p = r.p[0], hw = headway(p);
    var meta = t('nStops', { n: p.s.length }) + (hw ? ' · ' + t('every', { m: hw }) : '');
    return '<button class="row" data-sroute="' + r.i + '" aria-label="' + esc(t('route') + ' ' + r.id + ', ' + origin(p) + ' ' + t('toLbl') + ' ' + headsign(p)) + '"><span class="rpill">' + esc(r.id) + '</span><div class="grow"><div class="title">' + esc(origin(p)) + ' → ' + esc(headsign(p)) + '</div><div class="meta">' + esc(meta) + '</div></div>' + icon('chev', 'chev') + '</button>';
  }
  function splaceRow(pl) {
    var near = nearPlaceLabel(pl);
    var meta = t('nRoutes', { n: pl.routeCount }) + (near ? ' · ' + t('near', { p: near }) : '');
    if (S.me && inHyd(S.me)) meta = (Core.dist(S.me[0], S.me[1], pl.lat, pl.lon) / 1000).toFixed(1) + ' km · ' + meta;
    return '<button class="row" data-splace="' + pl.id + '" aria-label="' + esc(stopName(pl.stops[0]) + ', ' + meta) + '"><div class="lead">' + icon('pin') + '</div><div class="grow"><div class="title">' + esc(stopName(pl.stops[0])) + '</div><div class="meta">' + esc(meta) + '</div></div>' + icon('chev', 'chev') + '</button>';
  }
  function renderSearch() {
    var q = $('#q').value.trim(), h = '';
    $('#sbClear').innerHTML = q ? icon('x') : '';
    if (!q) {
      if (S.pick && S.me && inHyd(S.me)) {
        h += '<div class="card" style="margin-top:8px"><button class="row" data-act="pickNearest"><div class="lead">' + icon('locate') + '</div><div class="grow"><div class="title">' + esc(t('useNearest')) + '</div></div></button></div>';
      }
      var rec = P.recents.filter(function (x) { return !S.pick || x.type === 'place'; });
      if (rec.length) {
        h += '<div class="section-label">' + esc(t('recent')) + '</div><div class="card">';
        rec.forEach(function (x) { if (x.type === 'route' && D.routeByKey[x.k]) h += routeRow(D.routeByKey[x.k]); else if (x.type === 'place') { var pl = placeByKey(x.k); if (pl) h += splaceRow(pl); } });
        h += '</div>';
      }
      if (!S.pick) {
        h += '<div class="section-label">' + esc(t('tryThese')) + '</div><div class="chips" style="flex-wrap:wrap">';
        ['10H', '218', '290U', '300', '5K', '113M', 'Koti', 'Ameerpet', 'Charminar'].forEach(function (s) { h += '<button class="chip" data-q="' + s + '">' + esc(s) + '</button>'; });
        h += '</div>';
      }
      $('#spInner').innerHTML = h; return;
    }
    var res = D.search(q, 25);
    if (S.pick) res.routes = [];
    if (res.routes.length) { h += '<div class="section-label">' + esc(t('routes')) + '</div><div class="card">' + res.routes.slice(0, 12).map(routeRow).join('') + '</div>'; }
    if (res.places.length) { h += '<div class="section-label">' + esc(t('stops')) + '</div><div class="card">' + res.places.slice(0, 20).map(splaceRow).join('') + '</div>'; }
    if (!res.routes.length && !res.places.length) h += '<div class="empty"><div class="ill">' + icon('search') + '</div><div class="t1">' + esc(t('noMatch', { q: q })) + '</div><div>' + esc(t('noMatchBody')) + '</div></div>';
    $('#spInner').innerHTML = h;
  }

  // ---------- modals ----------
  var modalOnClose = null;
  function modal(html, onClose) {
    $('#modalCard').innerHTML = '<div class="sheet-grip"><span></span></div>' + html;
    $('#modal').hidden = false; modalOnClose = onClose || null;
    $('#modal').setAttribute('role', 'dialog'); $('#modal').setAttribute('aria-modal', 'true');
    var f = $('#modalCard').querySelector('h3'); if (f) { f.setAttribute('tabindex', '-1'); setTimeout(function () { try { f.focus({ preventScroll: true }); } catch (e) {} }, 50); }
  }
  function closeModal() { $('#modal').hidden = true; var f = modalOnClose; modalOnClose = null; if (f) f(); }
  function modalMsg(title, body, onClose) {
    modal('<h3>' + esc(title) + '</h3><p>' + esc(body) + '</p><div class="btns"><button class="btn ink block" data-m="close">' + esc(t('ok')) + '</button></div>', onClose);
  }
  function shareModal(r, p) {
    var ty = null;
    var h = '<h3>' + esc(t('shareTitle', { r: r.id })) + '</h3><p>' + esc(t('shareBody')) + '</p><ul class="points">' +
      '<li>' + icon('shield') + '<span>' + esc(t('sharePt1')) + '</span></li><li>' + icon('timer') + '<span>' + esc(t('sharePt2')) + '</span></li><li>' + icon('info') + '<span>' + esc(t('sharePt3')) + '</span></li></ul>' +
      '<div class="section-label" style="margin-left:0">' + esc(t('whatBus')) + '</div><div class="chips" style="flex-wrap:wrap" id="tyPick">' +
      TYPES.map(function (x) { return '<button class="chip" data-ty="' + x + '">' + esc(t('ty_' + x)) + '</button>'; }).join('') + '</div>' +
      '<div class="btns"><button class="btn ink block" data-m="go">' + icon('live') + esc(t('startSharing')) + '</button><button class="btn soft block" data-m="close">' + esc(t('cancel')) + '</button></div>';
    modal(h);
    $('#modalCard').onclick = function (e) {
      var c = e.target.closest('[data-ty]');
      if (c) { ty = ty === c.dataset.ty ? null : c.dataset.ty; document.querySelectorAll('#tyPick .chip').forEach(function (x) { x.classList.toggle('on', x.dataset.ty === ty); }); return; }
      var m = e.target.closest('[data-m]'); if (!m) return;
      if (m.dataset.m === 'go') { $('#modalCard').onclick = null; closeModal(); startShare(r, p, ty); }
    };
  }
  function alarmModal(r, p, pos) {
    var n = P.alarmN, name = stopName(p.s[pos]);
    var draw = function () {
      return '<h3>' + esc(t('alarmTitle')) + '</h3><p>' + esc(t('alarmBody', { s: name })) + '</p>' +
        '<button class="opt" data-mode="ride">' + icon('bell') + '<div><div class="t1">' + esc(t('alarmRide')) + '</div><div class="t2">' + esc(t('alarmRideDesc')) + '</div></div></button>' +
        '<button class="opt" data-mode="wait">' + icon('busf') + '<div><div class="t1">' + esc(t('alarmWait', { n: n })) + '</div><div class="t2">' + esc(t('alarmWaitDesc')) + '</div></div></button>' +
        '<div class="section-label" style="margin-left:0">' + esc(t('stopsBefore')) + '</div><div class="seg" id="nseg">' + [1, 2, 3, 4, 5].map(function (k) { return '<button class="' + (k === n ? 'on' : '') + '" data-n="' + k + '" aria-pressed="' + (k === n) + '">' + k + '</button>'; }).join('') + '</div>' +
        '<p style="margin-top:14px;font-size:12.5px">' + esc(t('alarmNote')) + '</p>' +
        (S.alarm ? '<div class="btns"><button class="btn soft block" data-m="off">' + esc(t('turnOffAlarm')) + '</button></div>' : '');
    };
    modal(draw());
    $('#modalCard').onclick = function (e) {
      var nb = e.target.closest('[data-n]');
      if (nb) { n = +nb.dataset.n; P.alarmN = n; save('alarmN', n); $('#modalCard').innerHTML = '<div class="sheet-grip"><span></span></div>' + draw(); return; }
      var o = e.target.closest('[data-mode]');
      if (o) { $('#modalCard').onclick = null; closeModal(); setAlarm({ mode: o.dataset.mode, rk: r.key, j: p.j, pos: pos, n: n, name: name }); if (o.dataset.mode === 'wait') checkWaitAlarm(); return; }
      var m = e.target.closest('[data-m="off"]'); if (m) { $('#modalCard').onclick = null; closeModal(); clearAlarm(); }
    };
  }
  function fullDayModal(r, p, pos) {
    var times = Core.dayTimes(p, pos), now = nowM();
    var byH = {};
    times.forEach(function (m) { var hr = Math.floor(m / 60); (byH[hr] = byH[hr] || []).push(m); });
    var nextIdx = times.findIndex(function (m) { return m >= now; });
    var h = '<h3>' + esc(r.id + ' · ' + stopName(p.s[pos])) + '</h3><p>' + esc(t('fullDaySub', { n: times.length, s: headsign(p) })) + '</p>';
    var order = []; for (var k = 0; k < 24; k++) order.push((k + 4) % 24); // day starts 4 AM; night buses at the end
    order.forEach(function (hr) {
      if (!byH[hr]) return;
      h += '<div style="display:flex;gap:12px;padding:10px 0;border-top:1px solid var(--line)"><div style="width:58px;flex:none;color:var(--sub);font-size:13px;font-weight:600;padding-top:6px">' + esc(Core.fmtClock(hr * 60).replace(':00', '')) + (hr < 4 || hr >= 23 ? '<br><span style="font-weight:500;font-size:11px">' + esc(t('night')) + '</span>' : '') + '</div><div style="display:flex;flex-wrap:wrap;gap:6px">' +
        byH[hr].map(function (m) { var past = m < now - 1, nx = times[nextIdx] === m; return '<span class="rpill sm" style="' + (nx ? 'background:var(--ink);color:var(--on-ink)' : past ? 'opacity:.4' : '') + '">' + esc(Core.fmtClock(m).replace(/ (AM|PM)/, '')) + '</span>'; }).join('') + '</div></div>';
    });
    h += '<p style="margin-top:12px;font-size:12px">' + esc(t('schedDisclaimer')) + '</p><div class="btns"><button class="btn ink block" data-m="close">' + esc(t('done')) + '</button></div>';
    modal(h);
  }
  function timeModal() {
    var d = new Date(), v = S.timeFrom != null ? S.timeFrom : d.getHours() * 60 + d.getMinutes();
    var hh = ('0' + Math.floor(v / 60)).slice(-2), mm = ('0' + Math.floor(v % 60)).slice(-2);
    modal('<h3>' + esc(t('leaveWhen')) + '</h3><p>' + esc(t('leaveWhenBody')) + '</p><input class="field" type="time" id="tpick" value="' + hh + ':' + mm + '" aria-label="' + esc(t('leaveWhen')) + '">' +
      '<div class="chips" style="margin-top:12px;flex-wrap:wrap">' + [['early', 5 * 60], ['morning', 9 * 60], ['evening', 18 * 60], ['late', 22 * 60]].map(function (x) { return '<button class="chip" data-tm="' + x[1] + '">' + esc(t('tm_' + x[0])) + '</button>'; }).join('') + '</div>' +
      '<div class="btns"><button class="btn ink block" data-m="set">' + esc(t('showTimes')) + '</button><button class="btn soft block" data-m="now">' + esc(t('leaveNow')) + '</button></div>');
    $('#modalCard').onclick = function (e) {
      var c = e.target.closest('[data-tm]'); if (c) { var m = +c.dataset.tm; $('#tpick').value = ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); return; }
      var b = e.target.closest('[data-m]'); if (!b) return;
      if (b.dataset.m === 'set') { var p = ($('#tpick').value || '').split(':'); if (p.length === 2) S.timeFrom = (+p[0]) * 60 + (+p[1]); }
      else if (b.dataset.m === 'now') S.timeFrom = null;
      $('#modalCard').onclick = null; closeModal(); render(false);
    };
  }
  function reportModal(ctx) {
    // ctx: {stop: si, route: r?} or {missing: true, route: r, pat: p}
    var kinds = ctx.missing ? ['missing'] : ['wrongloc', 'wrongname', 'notexist', 'notstopping'];
    var kind = kinds[0];
    var draw = function () {
      var h = '<h3>' + esc(ctx.missing ? t('missingStop') : t('reportTitle', { s: stopName(ctx.stop) })) + '</h3><p>' + esc(t('reportBody')) + '</p>';
      if (!ctx.missing) kinds.forEach(function (k) { h += '<button class="opt' + (k === kind ? ' on' : '') + '" data-kind="' + k + '" aria-pressed="' + (k === kind) + '">' + icon(k === 'wrongloc' ? 'pin' : k === 'wrongname' ? 'edit' : k === 'notexist' ? 'trash' : 'busf') + '<div><div class="t1">' + esc(t('rk_' + k)) + '</div><div class="t2">' + esc(t('rkd_' + k)) + '</div></div></button>'; });
      if (kind === 'wrongname' || kind === 'missing') h += '<input class="field" id="rname" placeholder="' + esc(kind === 'missing' ? t('missingName') : t('correctName')) + '" aria-label="' + esc(t('correctName')) + '">';
      if (kind === 'wrongloc' || kind === 'missing') h += '<p style="margin:10px 0 0;font-size:12.5px">' + esc(S.me ? t('useMyLoc', { a: Math.round(S.meAcc || 0) }) : t('needLocation')) + '</p>';
      h += '<div class="btns"><button class="btn ink block" data-m="send">' + esc(t('sendReport')) + '</button><button class="btn soft block" data-m="close">' + esc(t('cancel')) + '</button></div>';
      return h;
    };
    modal(draw());
    $('#modalCard').onclick = function (e) {
      var k = e.target.closest('[data-kind]'); if (k) { kind = k.dataset.kind; $('#modalCard').innerHTML = '<div class="sheet-grip"><span></span></div>' + draw(); return; }
      var b = e.target.closest('[data-m="send"]'); if (!b) return;
      var name = $('#rname') ? $('#rname').value.trim() : '';
      if ((kind === 'wrongname' || kind === 'missing') && !name) { $('#rname').focus(); toast(t('enterName')); return; }
      if ((kind === 'wrongloc' || kind === 'missing') && !S.me) { askLocation(); toast(t('needLocation')); return; }
      var rep = { v: 1, id: 'r' + Date.now().toString(36), dev: P.device, kind: kind, t: Date.now(), feed: D.version,
        stop: ctx.stop != null ? { idx: ctx.stop, name: D.stops[ctx.stop].name, lat: D.stops[ctx.stop].lat, lon: D.stops[ctx.stop].lon } : null,
        route: ctx.route ? ctx.route.id : null, name: name || null, at: S.me ? { lat: +S.me[0].toFixed(5), lon: +S.me[1].toFixed(5), acc: Math.round(S.meAcc || 0) } : null };
      P.reports.unshift(rep); save('reports', P.reports.slice(0, 200));
      if (ctx.stop != null && (kind === 'wrongname' || kind === 'wrongloc')) {
        var f = P.fixes[ctx.stop] || {}; if (kind === 'wrongname') f.name = name; else { f.lat = rep.at.lat; f.lon = rep.at.lon; }
        P.fixes[ctx.stop] = f; save('fixes', P.fixes);
      }
      var sent = live.publish(LIVE_PREFIX + 'reports', rep, true);
      $('#modalCard').onclick = null; closeModal(); drawMap(); render(false);
      toast(sent ? t('reportSent') : t('reportQueued'), 3200);
    };
  }
  function feedbackModal() {
    var cats = ['app', 'timing', 'nobus', 'staff', 'idea'], cat = 'app';
    var draw = function () {
      return '<h3>' + esc(t('fbTitle')) + '</h3><p>' + esc(t('fbBody')) + '</p><div class="chips" style="flex-wrap:wrap;margin-bottom:12px">' +
        cats.map(function (c) { return '<button class="chip' + (c === cat ? ' on' : '') + '" data-cat="' + c + '" aria-pressed="' + (c === cat) + '">' + esc(t('fb_' + c)) + '</button>'; }).join('') + '</div>' +
        '<input class="field" id="fbRoute" placeholder="' + esc(t('fbRoute')) + '" autocapitalize="characters" aria-label="' + esc(t('fbRoute')) + '">' +
        '<textarea class="field" id="fbText" rows="4" style="height:auto;padding:12px 14px;margin-top:10px;resize:none" placeholder="' + esc(t('fbText')) + '" aria-label="' + esc(t('fbText')) + '"></textarea>' +
        '<div class="btns"><button class="btn ink block" data-m="send">' + esc(t('send')) + '</button><button class="btn soft block" data-m="close">' + esc(t('cancel')) + '</button></div>';
    };
    modal(draw());
    $('#modalCard').onclick = function (e) {
      var c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; document.querySelectorAll('[data-cat]').forEach(function (x) { x.classList.toggle('on', x.dataset.cat === cat); x.setAttribute('aria-pressed', x.dataset.cat === cat); }); return; }
      var b = e.target.closest('[data-m="send"]'); if (!b) return;
      var txt = $('#fbText').value.trim(); if (!txt) { $('#fbText').focus(); toast(t('fbEmpty')); return; }
      var fb = { v: 1, id: 'f' + Date.now().toString(36), dev: P.device, cat: cat, route: $('#fbRoute').value.trim().toUpperCase() || null, text: txt.slice(0, 2000), t: Date.now(), lang: P.lang, app: (A && A.version) ? A.version() : 'web' };
      P.feedback.unshift(fb); save('feedback', P.feedback.slice(0, 100));
      var sent = live.publish(LIVE_PREFIX + 'feedback', fb, true);
      $('#modalCard').onclick = null; closeModal(); toast(sent ? t('fbSent') : t('fbQueued'), 3200); if (S.tab === 'settings') renderSettings();
    };
  }

  // ---------- pages ----------
  function renderSaved() {
    var h = '<h2>' + esc(t('savedTitle')) + '</h2><div class="lede">' + esc(t('savedSub')) + '</div>';
    if (!P.favRoutes.length && !P.favPlaces.length) {
      h += '<div class="card"><div class="empty"><div class="ill">' + icon('star') + '</div><div class="t1">' + esc(t('savedEmpty')) + '</div><div>' + esc(t('savedEmptyBody')) + '</div></div></div>';
    }
    if (P.favPlaces.length) {
      h += '<div class="section-label">' + esc(t('stops')) + '</div><div class="card">';
      P.favPlaces.forEach(function (k) { var pl = placeByKey(k); if (pl) h += placeRow(pl, S.me ? Core.dist(S.me[0], S.me[1], pl.lat, pl.lon) : null); });
      h += '</div>';
    }
    if (P.favRoutes.length) {
      h += '<div class="section-label">' + esc(t('routes')) + '</div><div class="card">';
      P.favRoutes.forEach(function (k) {
        var r = D.routeByKey[k]; if (!r) return;
        var n = busesFor(k).filter(function (b) { return !b.me; }).length;
        var row = routeRow(r);
        if (n) row = row.replace('</div></div>', ' · <span style="color:var(--live)">' + esc(t('nLive', { n: n })) + '</span></div></div>');
        h += row;
      });
      h += '</div>';
    }
    $('#savedInner').innerHTML = h;
  }
  function renderSettings() {
    var seg = function (name, opts, val) { return '<div class="seg" role="radiogroup">' + opts.map(function (o) { return '<button role="radio" aria-checked="' + (o[0] === val) + '" class="' + (o[0] === val ? 'on' : '') + '" data-set="' + name + '" data-val="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') + '</div>'; };
    var h = '<h2>' + esc(t('settingsTitle')) + '</h2><div class="lede">' + esc(t('settingsSub')) + '</div><div class="card">' +
      '<div class="set-row"><div class="lbl">' + icon('globe') + esc(t('language')) + '</div>' + seg('lang', [['en', 'English'], ['te', 'తెలుగు']], P.lang) + '</div>' +
      '<div class="set-row"><div class="lbl">' + icon('moon') + esc(t('theme')) + '</div>' + seg('theme', [['system', t('system')], ['light', t('light')], ['dark', t('dark')]], P.theme) + '</div>' +
      '<div class="set-row"><div class="lbl">' + icon('text') + esc(t('textSize')) + '</div>' + seg('text', [[100, t('tsDefault')], [118, t('tsLarge')], [135, t('tsLarger')]], P.text) + '</div></div>';
    h += '<div class="section-label">' + esc(t('helpUs')) + '</div><div class="card">' +
      '<button class="row" data-act="feedback"><div class="lead">' + icon('msg') + '</div><div class="grow"><div class="title">' + esc(t('fbTitle')) + '</div><div class="meta">' + esc(t('fbRowSub')) + '</div></div>' + icon('chev', 'chev') + '</button>' +
      '<div class="row"><div class="lead">' + icon('flag') + '</div><div class="grow"><div class="title">' + esc(t('yourReports')) + '</div><div class="meta">' + esc(t('yourReportsSub', { n: P.reports.length, f: P.feedback.length })) + '</div></div></div></div>';
    h += '<div class="section-label">' + esc(t('privacy')) + '</div><div class="card"><div class="set-row"><div class="desc">' + esc(t('privacyBody')) + '</div></div></div>';
    h += '<div class="section-label">' + esc(t('about')) + '</div><div class="card"><div class="set-row"><div class="desc">' + esc(t('aboutBody', { v: '1 Feb 2026', r: D.routes.length, s: D.stops.length })) + '</div></div></div>';
    h += '<div class="foot">Bus Bhai Hyderabad ' + esc((A && A.version) ? A.version() : '') + '</div>';
    $('#settingsInner').innerHTML = h;
  }
  function setTab(tab) {
    S.tab = tab;
    document.querySelectorAll('.tab').forEach(function (b) { var on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('#page-saved').hidden = tab !== 'saved'; $('#page-settings').hidden = tab !== 'settings';
    if (tab === 'saved') renderSaved();
    if (tab === 'settings') renderSettings();
    if (tab !== 'map' && !$('#searchPanel').hidden) closeSearch();
    syncSubs();
  }

  // ---------- sheet drag ----------
  function snapY(s, h) { h = h || $('#sheet').offsetHeight; return s === 'full' ? 0 : s === 'half' ? Math.round(h * 0.42) : h - 150; }
  function setSnap(s) {
    S.snap = s; var sh = $('#sheet'), h = sh.offsetHeight, y = snapY(s, h);
    sh.style.setProperty('--sheet-y', y + 'px');
    sh.dataset.snap = s;
    var vis = h - y;
    document.documentElement.style.setProperty('--sheet-peek', vis + 'px');
    var f = $('#fabs'); f.style.bottom = 'calc(var(--tabh) + ' + (vis + 14) + 'px)'; f.style.opacity = s === 'full' ? 0 : 1; f.style.pointerEvents = s === 'full' ? 'none' : '';
    $('#grip').setAttribute('aria-label', t('sheetHandle')); $('#grip').setAttribute('role', 'button');
  }
  function initSheet() {
    var sh = $('#sheet'), body = $('#sheetBody'), y0, startY, dragging = false, fromBody = false, lastY, lastT, vel = 0;
    function start(e, isBody) {
      var p = e.touches ? e.touches[0] : e;
      startY = p.clientY; y0 = snapY(S.snap); dragging = false; fromBody = isBody; lastY = startY; lastT = Date.now();
    }
    function move(e) {
      if (startY == null) return;
      var p = e.touches ? e.touches[0] : e, dy = p.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 6) return;
        if (fromBody && (body.scrollTop > 0 || (dy < 0 && S.snap === 'full'))) { startY = null; return; }
        dragging = true; sh.classList.add('dragging');
      }
      var now = Date.now(); vel = (p.clientY - lastY) / Math.max(1, now - lastT); lastY = p.clientY; lastT = now;
      var y = Math.max(0, Math.min(sh.offsetHeight - 110, y0 + dy));
      sh.style.setProperty('--sheet-y', y + 'px');
      if (e.cancelable) e.preventDefault();
    }
    function end() {
      if (startY == null) return;
      startY = null; if (!dragging) return; dragging = false; sh.classList.remove('dragging');
      var h = sh.offsetHeight, y = parseFloat(sh.style.getPropertyValue('--sheet-y')) || 0;
      var states = ['full', 'half', 'peek'];
      var target;
      if (Math.abs(vel) > 0.5) { var i = states.indexOf(S.snap); target = vel > 0 ? states[Math.min(2, i + 1)] : states[Math.max(0, i - 1)]; }
      else target = states.reduce(function (a, s) { return Math.abs(snapY(s, h) - y) < Math.abs(snapY(a, h) - y) ? s : a; }, 'half');
      setSnap(target);
    }
    $('#grip').addEventListener('touchstart', function (e) { start(e, false); }, { passive: true });
    body.addEventListener('touchstart', function (e) { start(e, true); }, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end); document.addEventListener('touchcancel', end);
    $('#grip').addEventListener('click', function () { setSnap(S.snap === 'full' ? 'half' : S.snap === 'half' ? 'full' : 'half'); });
    window.addEventListener('resize', function () { setSnap(S.snap); });
  }

  // ---------- offline ----------
  function updateOffline() {
    var off = !navigator.onLine;
    var b = $('#offline');
    if (off) { b.innerHTML = icon('wifioff') + esc(t('offlineBanner')); b.hidden = false; }
    else b.hidden = true;
  }

  // ---------- events ----------
  function bind() {
    $('#q').addEventListener('focus', function () { if ($('#searchPanel').hidden) openSearch(S.pick); });
    $('#q').addEventListener('input', renderSearch);
    $('#q').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = $('#spInner').querySelector('[data-sroute],[data-splace]'); if (first) first.click();
      }
    });
    $('#sbBack').addEventListener('click', function () {
      if (!$('#searchPanel').hidden) { closeSearch(); return; }
      if (S.stack.length) pop(); else $('#q').focus();
    });
    $('#sbClear').addEventListener('click', function () { $('#q').value = ''; if ($('#searchPanel').hidden) { goHome(); } else { renderSearch(); $('#q').focus(); } });
    $('#locate').addEventListener('click', function () {
      if (!S.me || S.approx) { askLocation(); if (S.locState !== 'off') { S.locState = S.me ? 'ok' : 'asking'; armLocTimer(); } toast(t('finding')); if (!S.me) return; }
      S.follow = true; $('#locate').classList.add('on'); flyTo(S.me, Math.max(map.getZoom(), 16));
    });
    $('#searchPanel').addEventListener('click', function (e) {
      var q = e.target.closest('[data-q]'); if (q) { $('#q').value = q.dataset.q; renderSearch(); return; }
      var r = e.target.closest('[data-sroute]'); if (r) { var rr = D.routes[+r.dataset.sroute]; closeSearch(); openRoute(rr, 0); return; }
      var pn = e.target.closest('[data-act="pickNearest"]');
      var p = e.target.closest('[data-splace]');
      if (p || pn) {
        var pl = p ? D.places[+p.dataset.splace] : nearestPlace();
        if (S.pick) { S.between[S.pick] = pl; addRecent({ type: 'place', k: placeKey(pl) }); S.fitted = false; closeSearch(); drawMap(); render(false); return; }
        closeSearch(); openPlace(pl);
      }
    });
    $('#sheetBody').addEventListener('click', onSheetClick);
    $('#savedInner').addEventListener('click', function (e) {
      var r = e.target.closest('[data-sroute]'), p = e.target.closest('[data-place]');
      if (r) { setTab('map'); openRoute(D.routes[+r.dataset.sroute], 0); }
      if (p) { setTab('map'); openPlace(D.places[+p.dataset.place]); }
    });
    $('#settingsInner').addEventListener('click', function (e) {
      var s = e.target.closest('[data-set]');
      if (s) {
        var k = s.dataset.set, v = s.dataset.val;
        if (k === 'text') v = +v;
        P[k] = v; save(k, v);
        if (k === 'lang') { applyLang(); render(false); }
        if (k === 'theme') applyTheme();
        if (k === 'text') applyText();
        renderSettings(); return;
      }
      if (e.target.closest('[data-act="feedback"]')) feedbackModal();
    });
    document.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });
    $('#modal').addEventListener('click', function (e) {
      if (e.target.id === 'modal' || e.target.closest('[data-m="close"]')) { $('#modalCard').onclick = null; closeModal(); }
    });
    window.addEventListener('online', function () { updateOffline(); live.connect(); });
    window.addEventListener('offline', updateOffline);
  }
  function nearestPlace() { if (!S.me) return null; var n = D.nearby(S.me[0], S.me[1], 3000, 1); return n.length ? n[0].place : null; }
  function onSheetClick(e) {
    var v = cur();
    var ty = e.target.closest('[data-type]'); if (ty) { S.typeFilter = ty.dataset.type; render(false); renderBuses(); return; }
    var act = e.target.closest('[data-act]'), a = act && act.dataset.act;
    if (a === 'variant') { v.j = +act.dataset.pat; v.sel = null; S.fitted = false; render(false); drawMap(); return; }
    if (a) {
      var r = v.v === 'route' ? D.routes[v.r] : null, p = r ? r.p[v.j] : null;
      switch (a) {
        case 'pickme': S.picking = true; setSnap('peek'); toast(t('pickHint')); return;
        case 'askloc': var wasOff = S.locState === 'off'; askLocation(); if (!wasOff) { S.locState = 'asking'; armLocTimer(); } render(false); return;
        case 'nearest': var np = nearestPlace(); if (np) openPlace(np); else { askLocation(); toast(t('needLocation')); } return;
        case 'between': S.betweenRes = null; if (!S.between.a && S.me) S.between.a = nearestPlace(); push({ v: 'between' }); if (S.snap === 'peek') setSnap('half'); return;
        case 'betweenFrom': S.between = { a: D.places[v.p], b: null }; push({ v: 'between' }); return;
        case 'pick': openSearch(act.dataset.which); return;
        case 'useNearest': S.between.a = nearestPlace(); render(false); drawMap(); return;
        case 'swapab': var tmp = S.between.a; S.between.a = S.between.b; S.between.b = tmp; S.fitted = false; render(false); drawMap(); return;
        case 'favplace': var k = placeKey(D.places[v.p]); var i = P.favPlaces.indexOf(k); if (i >= 0) P.favPlaces.splice(i, 1); else { P.favPlaces.unshift(k); vib(15); toast(t('savedToast')); } save('favPlaces', P.favPlaces); render(false); return;
        case 'favroute': var ir = P.favRoutes.indexOf(r.key); if (ir >= 0) P.favRoutes.splice(ir, 1); else { P.favRoutes.unshift(r.key); vib(15); toast(t('savedToast')); } save('favRoutes', P.favRoutes); render(false); return;
        case 'swapdir':
          var opp = r.p.filter(function (q) { return q.dd !== p.dd; });
          var cand = (opp.length ? opp : r.p.filter(function (q) { return q !== p; })).sort(function (x, y) { return y.x.length - x.x.length; })[0];
          if (cand) { v.j = cand.j; v.sel = null; S.fitted = false; render(true); drawMap(); }
          return;
        case 'share': shareModal(r, p); return;
        case 'stopshare': stopShare(t('sharingOff')); return;
        case 'clearalarm': clearAlarm(); return;
        case 'alarm': alarmModal(r, p, v.sel); return;
        case 'fullday': fullDayModal(r, p, v.sel); return;
        case 'openstop': openPlace(D.places[D.placeOfStop[p.s[v.sel]]]); return;
        case 'reportstop': reportModal({ stop: p.s[v.sel], route: r }); return;
        case 'reportplace': reportModal({ stop: D.places[v.p].stops[0], route: null }); return;
        case 'missing': reportModal({ missing: true, route: r, pat: p }); return;
        case 'time': timeModal(); return;
      }
    }
    var st = e.target.closest('[data-stop]'); if (st) { selectStop(+st.dataset.stop, false); return; }
    var pl = e.target.closest('[data-place]'); if (pl) { openPlace(D.places[+pl.dataset.place]); return; }
    var ro = e.target.closest('[data-route]'); if (ro) { var rr = D.routes[+ro.dataset.route]; addRecent({ type: 'route', k: rr.key }); push({ v: 'route', r: rr.i, j: +ro.dataset.pat, sel: +ro.dataset.pos }); }
  }

  // Android back button
  window.onBack = function () {
    if (!$('#modal').hidden) { $('#modalCard').onclick = null; closeModal(); return 'handled'; }
    if (!$('#searchPanel').hidden) { closeSearch(); return 'handled'; }
    if (S.tab !== 'map') { setTab('map'); return 'handled'; }
    if (S.stack.length) { pop(); return 'handled'; }
    if (S.snap === 'full') { setSnap('half'); return 'handled'; }
    return 'exit';
  };
  window.onAppResume = function () { if (!S.me && S.locState !== 'denied') startLocation(); updateOffline(); if (live.state !== 'online') live.connect(); render(false); };

  // ---------- boot ----------
  function boot() {
    try { var top = A && A.insetTop ? A.insetTop() : 0; if (top) document.documentElement.style.setProperty('--top', (top + 4) + 'px'); } catch (e) {}
    applyLang(); applyTheme(); applyText();
    document.querySelectorAll('.tab').forEach(function (b) { b.querySelector('i').innerHTML = icon(b.dataset.tab === 'map' ? 'map' : b.dataset.tab === 'saved' ? 'star' : 'gear'); b.setAttribute('role', 'tab'); });
    $('#tabbar').setAttribute('role', 'tablist');
    $('#locate').innerHTML = icon('locate');
    $('#sbBack').innerHTML = icon('search');
    $('#sheetBody').innerHTML = '<div class="empty" style="padding-top:40px"><div class="t1">' + esc(t('loading')) + '</div></div>';
    initMap(); initSheet(); bind(); setSnap('half'); updateOffline();
    // Data is bundled: no network needed for timetable, search or stops.
    var started = Date.now();
    fetch('data/gtfs.json').then(function (r) { return r.json(); }).then(function (raw) {
      D = new Core.Data(raw);
      Object.keys(P.fixes).forEach(function (si) { var f = P.fixes[si], s = D.stops[si]; if (s && f.lat) { s.lat = f.lat; s.lon = f.lon; } });
      window.__boot = Date.now() - started;
      render(true);
      startLocation();
      setTimeout(function () { live.connect(); }, 300);
      setInterval(function () { // expire stale buses, refresh ETAs every 20 s
        var now = Date.now(), ch = false;
        Object.keys(S.buses).forEach(function (id) { if (now - S.buses[id].seen > 120000) { delete S.buses[id]; ch = true; } });
        renderBuses(); if (!document.querySelector('.sheet.dragging') && $('#modal').hidden) render(false);
      }, 20000);
    }).catch(function (e) {
      $('#sheetBody').innerHTML = '<div class="empty"><div class="t1">' + esc(t('loadFail')) + '</div><div>' + esc(String(e)) + '</div></div>';
    });
  }
  window.__app = { S: S, P: P, get D() { return D; }, openRoute: openRoute, openPlace: openPlace, setTab: setTab, setSnap: setSnap, live: live, render: render,
    inject: function (topic, m) { live.handlers.forEach(function (f) { f(topic, m); }); }, setMe: function (lat, lon) { S.me = [lat, lon]; S.locState = 'ok'; if (!L_.me) L_.me = L.marker(S.me, { icon: divIcon('me-dot', 18), interactive: false }).addTo(map); else L_.me.setLatLng(S.me); render(true); },
    alarmModal: function () { var v = cur(); var r = D.routes[v.r]; alarmModal(r, r.p[v.j], v.sel); }, fullDay: function () { var v = cur(); var r = D.routes[v.r]; fullDayModal(r, r.p[v.j], v.sel); }, push: push, between: S.between };
  document.addEventListener('DOMContentLoaded', boot);
})();
