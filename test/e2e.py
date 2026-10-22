import os
import asyncio, subprocess, time
from playwright.async_api import async_playwright
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8766','-d',ROOT+'/assets'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(.8)
    ok=[];bad=[]
    def check(name,cond): (ok if cond else bad).append(name); print(('PASS ' if cond else 'FAIL ')+name)
    try:
        async with async_playwright() as p:
            b=await p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
            ctx=await b.new_context(viewport={'width':412,'height':915},geolocation={'latitude':17.3713,'longitude':78.5590},permissions=['geolocation'],has_touch=True,is_mobile=True)
            pg=await ctx.new_page(); errs=[]
            pg.on('pageerror',lambda e: errs.append(str(e)))
            await pg.goto('http://localhost:8766/index.html'); await pg.wait_for_function('window.__boot!==undefined')
            await pg.wait_for_timeout(800)
            # search
            await pg.click('#q'); await pg.fill('#q','290U'); await pg.wait_for_timeout(200)
            first=await pg.eval_on_selector('#spInner [data-sroute] .rpill','e=>e.textContent'); check('search 290U first result', first=='290U')
            await pg.fill('#q','koti'); await pg.wait_for_timeout(200)
            n=await pg.eval_on_selector_all('#spInner [data-splace]','e=>e.length'); check('stop search koti', n>0)
            await pg.fill('#q','zzqx'); await pg.wait_for_timeout(100)
            check('no-match message', 'Nothing called' in await pg.inner_text('#spInner'))
            await pg.fill('#q','10H'); await pg.wait_for_timeout(150); await pg.click('#spInner [data-sroute]'); await pg.wait_for_timeout(1200)
            check('route view opened', await pg.is_visible('[data-act=share]'))
            st=await pg.evaluate("(()=>{var m=window.__app;var c=null;return 1})()")
            center0=await pg.evaluate("JSON.stringify([document.querySelector('.leaflet-map-pane').style.transform])")
            inj="""(k)=>{var a=__app,D=a.D,r=D.routeByKey['10H'],p=r.p[0];var s=D.stops[p.s[k]];a.inject('hydbus/v1/r/10H/'+p.dd,{v:1,id:'busA',rk:'10H',d:p.dd,j:p.j,lat:s.lat,lon:s.lon,spd:5,t:Date.now()});}"""
            await pg.evaluate(inj,6); await pg.wait_for_timeout(300)
            c1=await pg.eval_on_selector_all('.bus-mk','e=>e.length')
            pos1=await pg.evaluate("(()=>{var e=document.querySelector('.bus-mk').parentElement;return e.parentElement.style.transform||e.style.transform})()")
            await pg.evaluate(inj,7); await pg.wait_for_timeout(1500)
            c2=await pg.eval_on_selector_all('.bus-mk','e=>e.length')
            pos2=await pg.evaluate("(()=>{var e=document.querySelector('.bus-mk').parentElement;return e.parentElement.style.transform||e.style.transform})()")
            center1=await pg.evaluate("JSON.stringify([document.querySelector('.leaflet-map-pane').style.transform])")
            check('one marker per bus after update', c1==1 and c2==1)
            check('marker moved in place', pos1!=pos2)
            check('no forced re-zoom/pan on live update', center0==center1)
            lbl=await pg.inner_text('.bus-mk'); check('route number on marker', '10H' in lbl)
            # spoof: far-off-route message ignored
            await pg.evaluate("""()=>{__app.inject('hydbus/v1/r/10H/0',{v:1,id:'spam',rk:'10H',d:0,j:0,lat:17.2,lon:78.2,t:Date.now()})}""")
            check('off-route spoof ignored', not await pg.evaluate("!!__app.S.buses.spam"))
            # live ETA shown in timeline
            await pg.click('[data-stop="15"]'); await pg.wait_for_timeout(300)
            check('live ETA on stop', await pg.eval_on_selector_all('.tl-row .eta.live','e=>e.length')>0)
            # wait alarm fires when bus within N stops
            await pg.evaluate("__app.S.alarm=null"); await pg.click('[data-act=alarm]'); await pg.wait_for_timeout(200)
            await pg.click('[data-n="5"]'); await pg.click('[data-mode=wait]'); await pg.wait_for_timeout(200)
            await pg.evaluate(inj,11); await pg.wait_for_timeout(400)
            check('wait alarm fired', 'coming' in await pg.inner_text('#modalCard') and not await pg.is_hidden('#modal'))
            await pg.click('[data-m=close]')
            # sharing: rider at stop 3 of 10H
            await pg.evaluate("(()=>{var D=__app.D,p=D.routeByKey['10H'].p[0],s=D.stops[p.s[3]];__app.setMe(s.lat,s.lon)})()"); await pg.wait_for_timeout(300)
            await pg.click('[data-act=share]'); await pg.click('[data-ty=metroexp]'); await pg.click('[data-m=go]'); await pg.wait_for_timeout(300)
            check('sharing started', await pg.evaluate("!!__app.S.share && __app.S.share.ty==='metroexp'"))
            check('own bus marker', await pg.eval_on_selector_all('.bus-mk.me','e=>e.length')==1)
            await pg.evaluate("__app.S.share.start=Date.now()-91*60000"); await pg.evaluate("(()=>{})()")
            await pg.wait_for_timeout(10500)
            check('auto-stop after 90 min', await pg.evaluate("!__app.S.share"))
            # full day schedule includes night
            await pg.click('[data-stop="0"]'); await pg.wait_for_timeout(200); await pg.click('[data-act=fullday]'); await pg.wait_for_timeout(200)
            check('full-day schedule', 'trips a day' in await pg.inner_text('#modalCard')); await pg.click('[data-m=close]')
            # report stop
            await pg.click('[data-stop="2"]'); await pg.wait_for_timeout(150); await pg.click('[data-act=reportstop]'); await pg.click('[data-kind=wrongname]'); await pg.fill('#rname','Test Name'); await pg.click('[data-m=send]'); await pg.wait_for_timeout(300)
            check('report stored + local fix', await pg.evaluate("JSON.parse(localStorage.hb_reports).length===1 && Object.keys(JSON.parse(localStorage.hb_fixes)).length===1"))
            check('report queued for offline send', await pg.evaluate("JSON.parse(localStorage.hb_outbox||'[]').length>=1"))
            # favourites
            await pg.click('[data-act=favroute]'); check('fav route saved', await pg.evaluate("JSON.parse(localStorage.hb_favRoutes).indexOf('10H')>=0"))
            # back button behaviour
            r=await pg.evaluate("onBack()"); check('back pops view', r=='handled')
            # between from nearest
            await pg.evaluate("__app.S.stack=[];__app.render(true)"); await pg.wait_for_timeout(200)
            await pg.click('[data-act=nearest]'); await pg.wait_for_timeout(500)
            check('buses from nearest stop', await pg.eval_on_selector_all('#sheetBody [data-route]','e=>e.length')>0)
            # feedback
            await pg.click('[data-tab=settings]'); await pg.click('[data-act=feedback]'); await pg.fill('#fbText','Bus 10H skipped Paradise'); await pg.click('[data-m=send]'); await pg.wait_for_timeout(200)
            check('feedback stored', await pg.evaluate("JSON.parse(localStorage.hb_feedback).length===1"))
            await pg.click('[data-set=lang][data-val=te]'); check('telugu toggle', 'సెట్టింగ్‌లు' in await pg.inner_text('#settingsInner'))
            # offline
            await ctx.set_offline(True); await pg.wait_for_timeout(300)
            check('offline banner', await pg.is_visible('#offline'))
            # TalkBack labels: all icon buttons labelled
            unl=await pg.evaluate("[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&!b.textContent.trim()&&!b.getAttribute('aria-label')).length")
            check('icon buttons have labels', unl==0)
            check('no JS errors', not errs); print(errs[:3])
            await b.close()
    finally: srv.terminate()
    print(len(ok),'passed',len(bad),'failed',bad)
asyncio.run(main())
