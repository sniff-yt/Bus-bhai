# Preprocess TGSRTC GTFS -> compact JSON for the app
import csv, json, collections, statistics, re, os
G = os.path.join(os.path.dirname(__file__), '..', 'data', 'gtfs')
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data', 'gtfs.json')
def rd(f): return csv.DictReader(open(os.path.join(G, f), encoding='utf-8-sig'))
def secs(t):
    h, m, s = t.split(':'); return int(h)*3600+int(m)*60+int(s)
stops = list(rd('stops.txt'))
sidx = {}; S = []
for s in stops:
    sidx[s['stop_id']] = len(S)
    S.append([s['stop_name'].strip(), round(float(s['stop_lat']), 5), round(float(s['stop_lon']), 5)])
trips = {t['trip_id']: t for t in rd('trips.txt')}
seq = collections.defaultdict(list)
for r in rd('stop_times.txt'):
    seq[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], secs(r['departure_time'] or r['arrival_time'])))
pats = {}  # (route, dir, stops tuple) -> data
for tid, lst in seq.items():
    t = trips.get(tid)
    if not t or len(lst) < 2: continue
    lst.sort()
    st = tuple(sidx[x[1]] for x in lst if x[1] in sidx)
    if len(st) < 2: continue
    t0 = lst[0][2]
    key = (t['route_id'], t['direction_id'], st)
    p = pats.setdefault(key, {'names': collections.Counter(), 'offs': [], 'deps': []})
    p['names'][t['trip_short_name']] += 1
    # FEED BUG FIX: in this TGSRTC feed each stop's time = previous stop's time + (cumulative
    # travel time from origin). So the true offset from origin is the per-row delta.
    tt = [x[2] for x in lst]
    p['offs'].append([0] + [tt[i]-tt[i-1] for i in range(1, len(tt))])
    p['deps'].append((t0 // 60) % 1440)  # some trips start at 28:00-35:00; fold into day
def headsign(name, route):
    n = name
    if n.upper().startswith(route.upper()+'-'): n = n[len(route)+1:]
    parts = n.split('-')
    kind = ''
    KINDS = {'SILVER':'Ordinary','ORDINARY':'Ordinary','METRO':'Metro Express','EXPRESS':'Express','DELUXE':'Metro Deluxe','LUXURY':'Metro Luxury','AC':'AC','ELECTRIC':'Electric','PUSHPAK':'Pushpak AC','GREEN':'Green Metro','ME':'Metro Express','MD':'Metro Deluxe'}
    while parts and parts[0].upper() in KINDS:
        kind = KINDS[parts[0].upper()] if not kind else kind; parts = parts[1:]
    n = '-'.join(parts)
    if '-TO-' in n.upper():
        i = n.upper().index('-TO-'); a, b = n[:i], n[i+4:]
    else:
        ps = n.split('-'); a, b = (ps[0], '-'.join(ps[1:])) if len(ps) > 1 else (n, '')
    tc = lambda x: ' '.join(w.capitalize() if len(w) > 3 else w.upper() for w in x.replace('-', ' ').split())
    return tc(a), tc(b), kind
R = collections.defaultdict(list)
for (rid, d, st), p in pats.items():
    name = p['names'].most_common(1)[0][0]
    a, b, kind = headsign(name, rid)
    a, b = S[st[0]][0], S[st[-1]][0]  # first/last stop are more reliable than trip names
    n = len(st)
    med = [statistics.median(o[i] for o in p['offs'] if len(o) == n)/60 for i in range(n)]
    # Sanity floor: a city bus averages <= 24 km/h stop-to-stop (+15 s dwell). The feed's times
    # flatten out near the end of long trips, which would otherwise give impossible ETAs.
    import math
    def hv(a, b):
        la1, lo1, la2, lo2 = map(math.radians, (S[a][1], S[a][2], S[b][1], S[b][2]))
        h = math.sin((la2-la1)/2)**2 + math.cos(la1)*math.cos(la2)*math.sin((lo2-lo1)/2)**2
        return 2*6371000*math.asin(math.sqrt(h))
    f = [0.0]
    for i in range(1, n):
        f.append(max(med[i], f[-1] + hv(st[i-1], st[i]) / (24/3.6) / 60 + 0.25))
    offs = [int(round(x)) for x in f]
    R[rid].append({'d': int(d), 'f': a, 't': b, 'k': kind, 's': list(st), 'o': offs, 'x': sorted(set(p['deps']))})
routes = []
for rid in sorted(R, key=lambda r: (int(re.match(r'\d*', r).group() or 99999), r)):
    ps = sorted(R[rid], key=lambda p: -len(p['x']))
    # drop tiny variants that are subsets of bigger ones in same direction with very few trips
    routes.append({'id': rid, 'p': ps})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({'v': '20260201', 'stops': S, 'routes': routes}, open(OUT, 'w'), separators=(',', ':'), ensure_ascii=False)
print('stops', len(S), 'routes', len(routes), 'patterns', sum(len(r['p']) for r in routes), 'bytes', os.path.getsize(OUT))
used = set(i for r in routes for p in r['p'] for i in p['s']); print('used stops', len(used))
