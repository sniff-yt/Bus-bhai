/* Live layer: anonymous crowd-sourced bus positions over a public MQTT broker (WebSockets).
   Topics: hydbus/v1/r/<ROUTE>/<dir>  (ROUTE with '/' -> '_')   payload JSON, QoS 0, not retained.
           hydbus/v1/reports, hydbus/v1/feedback                 payload JSON, QoS 1. */
(function (root) {
  'use strict';
  var BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  var PREFIX = 'hydbus/v1/';
  function topicFor(routeKey, dir) { return PREFIX + 'r/' + String(routeKey).replace(/\//g, '_') + '/' + (dir == null ? '+' : dir); }

  function Live() {
    this.client = null; this.state = 'idle'; this.subs = {}; this.handlers = []; this.stateHandlers = []; this.brokerIdx = 0;
    this.outbox = []; // queued QoS1 messages for when we're back online
    try { this.outbox = JSON.parse(localStorage.getItem('hb_outbox') || '[]'); } catch (e) {}
  }
  Live.prototype.onMessage = function (fn) { this.handlers.push(fn); };
  Live.prototype.onState = function (fn) { this.stateHandlers.push(fn); };
  Live.prototype.setState = function (s) { if (this.state === s) return; this.state = s; this.stateHandlers.forEach(function (f) { f(s); }); };
  Live.prototype.connect = function () {
    var self = this;
    if (typeof mqtt === 'undefined') { this.setState('unavailable'); return; }
    if (this.client) return;
    this.setState('connecting');
    var id = 'hb_' + Math.random().toString(16).slice(2, 10);
    var c;
    try {
      c = mqtt.connect(BROKERS[this.brokerIdx % BROKERS.length], { clientId: id, clean: true, keepalive: 30, connectTimeout: 9000, reconnectPeriod: 4000, protocolVersion: 4 });
    } catch (e) { this.setState('offline'); return; }
    this.client = c;
    var fails = 0;
    c.on('connect', function () {
      fails = 0; self.setState('online');
      Object.keys(self.subs).forEach(function (t) { c.subscribe(t, { qos: 0 }); });
      self.flush();
    });
    c.on('reconnect', function () { self.setState('connecting'); });
    c.on('offline', function () { self.setState('offline'); });
    c.on('error', function () { });
    c.on('close', function () {
      if (self.state !== 'online') { fails++; }
      if (fails >= 3) { // try the backup broker
        fails = 0; self.brokerIdx++; try { c.end(true); } catch (e) {} self.client = null; setTimeout(function () { self.connect(); }, 1500);
      } else if (self.state === 'online') self.setState('connecting');
    });
    c.on('message', function (topic, buf) {
      var msg; try { msg = JSON.parse(buf.toString()); } catch (e) { return; }
      self.handlers.forEach(function (f) { f(topic, msg); });
    });
  };
  Live.prototype.subscribe = function (t) {
    if (this.subs[t]) { this.subs[t]++; return; }
    this.subs[t] = 1;
    if (this.client && this.state === 'online') this.client.subscribe(t, { qos: 0 });
  };
  Live.prototype.unsubscribe = function (t) {
    if (!this.subs[t]) return;
    if (--this.subs[t] > 0) return;
    delete this.subs[t];
    if (this.client && this.state === 'online') this.client.unsubscribe(t);
  };
  Live.prototype.publish = function (t, obj, durable) {
    if (this.client && this.state === 'online') {
      this.client.publish(t, JSON.stringify(obj), { qos: durable ? 1 : 0, retain: false });
      return true;
    }
    if (durable) { this.outbox.push([t, obj]); this.saveOutbox(); }
    return false;
  };
  Live.prototype.flush = function () {
    var self = this;
    if (!this.outbox.length) return;
    var q = this.outbox; this.outbox = []; this.saveOutbox();
    q.forEach(function (m) { self.publish(m[0], m[1], true); });
  };
  Live.prototype.saveOutbox = function () { try { localStorage.setItem('hb_outbox', JSON.stringify(this.outbox.slice(-200))); } catch (e) {} };

  root.Live = Live; root.topicFor = topicFor; root.LIVE_PREFIX = PREFIX;
})(this);
