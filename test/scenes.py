import json, subprocess, sys
INJ10 = "var a=__app,D=a.D,r=D.routeByKey['10H'];a.openRoute(r,0);;WAIT900;;var a=__app,D=a.D,r=D.routeByKey['10H'],p=r.p[0];[[6.5,'x1',0],[14.3,'x2',0],[20,'x3',1]].forEach(function(z){var q=z[2]?r.p.filter(function(k){return k.dd!==p.dd})[0]:p;var s=D.stops[q.s[Math.floor(z[0])]];a.inject('hydbus/v1/r/10H/'+q.dd,{v:1,id:z[1],rk:'10H',d:q.dd,j:q.j,lat:s.lat,lon:s.lon,spd:5,t:Date.now(),ty:'ordinary'})});;WAIT300;;var v=__app.S.stack[__app.S.stack.length-1];v.sel=18;__app.render(false)"
S = {
 'route2': (False, INJ10),
 'route2_dark': (True, INJ10),
 'home_light': (False, ''),
 'share': (False, "var a=__app,D=a.D,r=D.routeByKey['10H'];a.openRoute(r,0);;WAIT500;;document.querySelector('[data-act=share]').click()"),
 'saved': (False, "var k=__app.D.search('koti').places[0].stops[0];__app.P.favRoutes.push('10H','290U');__app.P.favPlaces.push(k);__app.setTab('saved')"),
 'settings_te': (False, "document.querySelector('[data-tab=settings]').click();;WAIT200;;document.querySelector('[data-set=lang][data-val=te]').click()"),
 'home_dark': (True, ""),
 'route_te': (False, "__app.P.lang='te';document.querySelector('[data-tab=settings]').click();;WAIT100;;document.querySelector('[data-set=lang][data-val=te]').click();;document.querySelector('[data-tab=map]').click();;" + INJ10),
 'route_zoom': (False, INJ10 + ";;WAIT500;;__app.S.snap='peek';__app.setSnap('peek')"),
 'place_live': (False, "var a=__app,D=a.D,pl=D.search('secunderabad').places[0];a.openPlace(pl);;WAIT500;;var a=__app,D=a.D,pl=D.search('secunderabad').places[0];var e=D.placeRoutes(pl)[0];var p=e.pat;var s=D.stops[p.s[Math.max(0,e.pos-3)]];a.inject('hydbus/v1/r/'+e.route.key.replace(/\\//g,'_')+'/'+p.dd,{v:1,id:'z1',rk:e.route.key,d:p.dd,j:p.j,lat:s.lat,lon:s.lon,spd:4,t:Date.now(),ty:'metroexp'});a.render(false)"),
 'large_text': (False, "document.documentElement.style.zoom=1.35"),
 'feedback': (False, "document.querySelector('[data-tab=settings]').click();;WAIT200;;document.querySelector('[data-act=feedback]').click()"),
 'report': (False, INJ10 + ";;WAIT300;;document.querySelector('[data-act=reportstop]').click()"),
}
names = sys.argv[2:]
arg = json.dumps([[n, S[n][0], S[n][1]] for n in names])
subprocess.run(['python3', 'shot.py', arg], check=True)
subprocess.run(['python3', 'montage.py', sys.argv[1]] + names, check=True)
