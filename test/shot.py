import asyncio, sys, json, subprocess, time, os
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
async def main(scenes):
    srv = subprocess.Popen(['python3', '-m', 'http.server', '8765', '-d', ROOT + '/assets'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            for name, dark, script in scenes:
                ctx = await b.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, color_scheme='dark' if dark else 'light',
                    geolocation={'latitude': 17.3713, 'longitude': 78.5590}, permissions=['geolocation'], has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                errs = []
                pg.on('pageerror', lambda e: errs.append(str(e)))
                pg.on('response', lambda r: errs.append('404:'+r.url) if r.status==404 else None)
                pg.on('console', lambda m: errs.append('console:' + m.text) if m.type == 'error' else None)
                await pg.goto('http://localhost:8765/index.html')
                await pg.wait_for_function('window.__boot !== undefined', timeout=15000)
                await pg.wait_for_timeout(1500)
                if script: 
                    for step in script.split(';;'):
                        if step.startswith('WAIT'): await pg.wait_for_timeout(int(step[4:]))
                        else: await pg.evaluate(step)
                    await pg.wait_for_timeout(1500)
                out = f'{ROOT}/test/shots/{name}.png'
                os.makedirs(os.path.dirname(out), exist_ok=True)
                await pg.screenshot(path=out)
                boot = await pg.evaluate('window.__boot')
                print(name, 'boot', boot, 'ms', 'errors:', [e for e in errs if '407' not in e and 'ERR_' not in e][:5])
                await ctx.close()
            await b.close()
    finally:
        srv.terminate()
scenes = json.loads(sys.argv[1])
asyncio.run(main(scenes))
