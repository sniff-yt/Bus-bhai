const fs=require('fs');
const src=fs.readFileSync(__dirname+'/../assets/js/app.js','utf8');
const a=src.indexOf('// ---------- Hyderabad Metro'), b=src.indexOf('// ---------- search ----------');
const Core=require('../assets/js/core.js'); const I18N=require('../assets/js/i18n.js');
const raw=JSON.parse(fs.readFileSync(__dirname+'/../assets/data/gtfs.json'));
const D=new Core.Data(raw);
let M=JSON.parse(fs.readFileSync(__dirname+'/../assets/data/metro.json'));
const P={lang:'en',fixes:{}};
const t=(k,x)=>I18N.t(k,x), esc=s=>String(s), nowM=()=>Core.nowMin(), icon=()=>'', mins=m=>Math.round(m)+'m', minsTxt=mins;
const placeRow=(pl,d)=>`[bus ${pl.name} ${Math.round(d)}m]`, footer=()=>'';
const strip=h=>h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
eval(src.slice(a,b));
for (const lang of ['en','te']) { P.lang=lang; I18N.lang=lang;
  console.log(strip(viewStation({c:'AME'})).slice(0,900)); }
P.lang='en';I18N.lang='en';
console.log(strip(viewStation({c:'NAG'})).slice(0,500));
console.log('search ameer', searchMetro('ameer'), searchMetro('hitec'), searchMetro('metro').length, searchMetro('అమీర్'), searchMetro('raidurg metro'));
const pl=D.search('Uppal X Roads',1).places[0]; console.log(strip(metroNearPlace(pl)));
console.log(nearestStations(17.3713,78.559,2));
// every station/dir should have trains for every service
let miss=[];for(const l of M.lines)for(const c of l.s)for(const d of [0,1])for(const sv of ['WK','SA','SU']){const term=d==0?l.s[l.s.length-1]:l.s[0]; if(c!==term&&!depList(c,l.id,d,sv))miss.push([l.id,c,d,sv]);}
console.log('missing',miss.length,miss.slice(0,5));
