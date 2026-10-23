#!/usr/bin/env python3
"""Hyderabad Metro (HMRL GTFS, July 2026, public domain via data.opencity.in) -> assets/data/metro.json
Usage: python3 tools/prep_metro.py path/to/unzipped_gtfs_dir"""
import csv, json, sys, os, collections
G = sys.argv[1] if len(sys.argv) > 1 else 'data/metro'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'data', 'metro.json')
rd = lambda f: list(csv.DictReader(open(os.path.join(G, f), encoding='utf-8-sig')))
TE = {'MYP':'మియాపూర్','JNT':'జేఎన్‌టీయూ కాలేజ్','KPH':'కేపీహెచ్‌బీ కాలనీ','KUK':'కూకట్‌పల్లి','BLR':'బాలానగర్','MSP':'మూసాపేట్',
'BTN':'భరత్ నగర్','ERA':'ఎర్రగడ్డ','ESI':'ఈఎస్ఐ హాస్పిటల్','SRN':'ఎస్.ఆర్. నగర్','AME':'అమీర్‌పేట్','PUN':'పంజాగుట్ట','IRM':'ఎర్రమంజిల్',
'KHA':'ఖైరతాబాద్','LKP':'లక్డీకాపూల్','ASM':'అసెంబ్లీ','NAM':'నాంపల్లి','GAB':'గాంధీ భవన్','OMC':'ఉస్మానియా మెడికల్ కాలేజ్',
'MGB':'మహాత్మా గాంధీ బస్ స్టేషన్','MKL':'మలక్‌పేట్','NEM':'న్యూ మార్కెట్','MSB':'మూసారాంబాగ్','DSN':'దిల్‌సుఖ్‌నగర్','CHP':'చైతన్యపురి',
'VOM':'విక్టోరియా మెమోరియల్','LBN':'ఎల్.బి. నగర్','SUB':'సుల్తాన్ బజార్','NAR':'నారాయణగూడ','CDP':'చిక్కడపల్లి','RTC':'ఆర్టీసీ క్రాస్ రోడ్స్',
'MSH':'ముషీరాబాద్','GNH':'గాంధీ హాస్పిటల్','SCR':'సికింద్రాబాద్ వెస్ట్','JBS':'జేబీఎస్ పరేడ్ గ్రౌండ్','NAG':'నాగోల్','UPL':'ఉప్పల్',
'STD':'స్టేడియం','NGR':'ఎన్‌జీఆర్ఐ','HSG':'హబ్సిగూడ','TAR':'తార్నాక','MET':'మెట్టుగూడ','SEC_E':'సికింద్రాబాద్ ఈస్ట్','PRG':'పరేడ్ గ్రౌండ్',
'PAR':'ప్యారడైజ్','ROP':'రసూల్‌పురా','PRN':'ప్రకాష్ నగర్','BEG':'బేగంపేట్','MUN':'మధురానగర్','YUG':'యూసుఫ్‌గూడ','JR5':'రోడ్ నం. 5 జూబ్లీ హిల్స్',
'JCP':'జూబ్లీ హిల్స్ చెక్‌పోస్ట్','PED':'పెద్దమ్మ గుడి','MAD':'మాదాపూర్','DGC':'దుర్గం చెరువు','HTC':'హైటెక్ సిటీ','RDG':'రాయదుర్గం'}
LN = {'RED': ('Red Line', 'రెడ్ లైన్'), 'GREEN': ('Green Line', 'గ్రీన్ లైన్'), 'BLUE': ('Blue Line', 'బ్లూ లైన్')}
stops = rd('stops.txt')
parent = {s['stop_id']: (s['parent_station'] or s['stop_id']) for s in stops}
stn = {s['stop_id']: s for s in stops if s['location_type'] == '1'}
assert set(stn) <= set(TE), set(stn) - set(TE)
trips = {t['trip_id']: t for t in rd('trips.txt')}
st = collections.defaultdict(list)
for r in rd('stop_times.txt'): st[r['trip_id']].append(r)
def mins(x): h, m, s = map(int, x.split(':')); return round(h * 60 + m + s / 60) % 1440
shapes = collections.defaultdict(list)
for r in rd('shapes.txt'): shapes[r['shape_id']].append((int(r['shape_pt_sequence']), round(float(r['shape_pt_lat']), 5), round(float(r['shape_pt_lon']), 5)))
# station order per line: longest direction-0 trip
order, dep, heads = {}, {}, {}
for tid, rows in st.items():
    rows.sort(key=lambda r: int(r['stop_sequence']))
    t = trips[tid]; L, d = t['route_id'], int(t['direction_id'])
    seq = [parent[r['stop_id']] for r in rows]
    if d == 0 and len(seq) > len(order.get(L, [])): order[L] = seq
    k = '%s:%d:%s' % (L, d, t['service_id'])
    for r, code in zip(rows[:-1], seq[:-1]):   # can't board at a trip's last stop
        dep.setdefault(k, {}).setdefault(code, []).append((mins(r['departure_time']), t['trip_headsign']))
lines = []
for L in ['RED', 'GREEN', 'BLUE']:
    r = next(x for x in rd('routes.txt') if x['route_id'] == L)
    seq = order[L]
    sh = [[p[1], p[2]] for p in sorted(shapes[L + '1'])]
    lines.append({'id': L, 'en': LN[L][0], 'te': LN[L][1], 'c': '#' + r['route_color'], 's': seq, 'sh': sh,
                  'h0': stn[seq[-1]]['stop_name'], 'h1': stn[seq[0]]['stop_name']})
# compress departures: {key: {code: [[mins...], {idx: headsign}]}}
D = {}
for k, byc in dep.items():
    L, d, _ = k.split(':'); line = next(x for x in lines if x['id'] == L)
    default = line['h0'] if d == '0' else line['h1']
    D[k] = {}
    for code, lst in byc.items():
        lst.sort()
        D[k][code] = [[m for m, _ in lst], {str(i): h for i, (_, h) in enumerate(lst) if h != default}]
stations = {c: [s['stop_name'], TE[c], round(float(s['stop_lat']), 6), round(float(s['stop_lon']), 6),
                [l['id'] for l in lines if c in l['s']]] for c, s in stn.items()}
fares = {}
for r in rd('fare_rules.txt'): fares[r['origin_id'] + '>' + r['destination_id']] = int(r['fare_id'].split('_')[1])
out = {'v': 'HMRL GTFS 2026-07-03', 'lines': lines, 'st': stations, 'dep': D, 'fare': fares}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print('stations', len(stations), 'keys', len(D), 'fares', len(fares), 'bytes', os.path.getsize(OUT))
