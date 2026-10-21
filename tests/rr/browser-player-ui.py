#!/usr/bin/env python3
"""Offline browser regression test of player/admin separation.
Real client modules, real game HTML, synthetic Telegram SDK and an in-memory service.
Browser uses data: modules (network navigation is NOT tested). Do not deploy this harness.
Requires Python Playwright, Chromium, and the local runtime-browser-server on RR_TEST_PORT.
"""
import base64,json,re,urllib.request,os
from pathlib import Path
from functools import lru_cache
from playwright.sync_api import sync_playwright,expect
R=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('RR_TEST_OUTPUT','/tmp/rr-player-ui-browser'));OUT.mkdir(parents=True,exist_ok=True)
PORT=int(os.environ.get('RR_TEST_PORT','4198'))
@lru_cache(None)
def module(name):
 code=(R/'src/rr'/name).read_text()
 code=re.sub(r"(['\"])\./([a-z-]+\.mjs)\1",lambda m:json.dumps(module(m[2])),code)
 if name in ['client.mjs','launcher.mjs','engine-boot.mjs']:code='const location=window.__rrLocation;\n'+code
 return 'data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
def rpc(d):
 req=urllib.request.Request(f'http://127.0.0.1:{PORT}/__test_api',data=json.dumps(d).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=10))
def sdk(uid,start='',pathname='/',search='',mobile=False):
 return '''window.__calls=[];window.__nav=[];window.__texts=[];window.__hang=false;window.__fail=false;
 window.__rrLocation={pathname:PATH,search:SEARCH,hash:'',origin:'https://test.invalid',assign(u){window.__nav.push(u);},replace(u){window.__nav.push(u);}};
 window.Telegram={WebApp:{initData:'SYNTHETIC_LOCAL_TEST_ONLY',platform:PLATFORM,version:'9.6',themeParams:{},isFullscreen:MOBILE,viewportStableHeight:innerHeight,viewportHeight:innerHeight,
 safeAreaInset:{top:TOP,bottom:BOTTOM,right:0,left:0},contentSafeAreaInset:{top:CONTENT,bottom:0,right:0,left:0},
 ready(){},expand(){},isVersionAtLeast(){return true;},onEvent(){},disableVerticalSwipes(){},enableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){},exitFullscreen(){this.isFullscreen=false;},requestFullscreen(){},BackButton:{onClick(){},show(){},hide(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},openTelegramLink(u){window.__join=u;},
 Serverless:{call(name,input,cb){window.__calls.push(name);if(window.__hang)return;
 if(window.__fail){cb({message:'RAW SERVER SQL rr_admin_state SECRET',parameters:{code:'INTERNAL_ERROR'}});return;}
 window.rrRPC({name,input,uid:UID,start:START}).then(r=>cb(r.error||null,r.result)).catch(e=>cb({message:e.message}));}}
 }};
 new MutationObserver(()=>window.__texts.push(document.body.innerText)).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
 '''.replace('PATH',json.dumps(pathname)).replace('SEARCH',json.dumps(search)).replace('PLATFORM',json.dumps('ios' if mobile else 'tdesktop')).replace('MOBILE','true' if mobile else 'false').replace('TOP','44' if mobile else '0').replace('BOTTOM','34' if mobile else '0').replace('CONTENT','48' if mobile else '0').replace('UID',str(uid)).replace('START',json.dumps(start))
def setup(page,name,uid=404,start='',search='',mobile=False,hang=False,fail=False):
 filename='index.html' if name=='launcher' else name+'.html'
 html=(R/'public'/filename).read_text()
 html=re.sub(r'<script type="module"[^>]*></script>','',html)
 html=re.sub(r'<link rel="stylesheet" href="(/rr/[^\"]+)">',lambda m:'<style>'+(R/('public'+m[1])).read_text()+'</style>',html)
 page.expose_function('rrRPC',rpc)
 page.set_content(html)
 page.evaluate(sdk(uid,start,'/' if name=='launcher' else '/'+name,search,mobile))
 page.evaluate(f'window.__hang={str(hang).lower()};window.__fail={str(fail).lower()};')
 page.evaluate('u=>import(u)',module(name+'.mjs'))
def game(page,uid=303,mobile=False):
 page.expose_function('rrRPC',rpc)
 g=next(g for g in json.loads((R/'config/rr-built-games.json').read_text())['games'] if g['id']=='v08-player-ui')
 html=(R/('public'+g['entry'])).read_text()
 boot=re.search(r'import\(("/rr/runtime/[^\"]+/engine-boot.mjs")\)',html);assert boot
 html=html.replace(boot[1],json.dumps(module('engine-boot.mjs')))
 def external(m):
  src=m[1]
  if src.startswith('/rr/frozen/'):return '<script>'+(R/('public'+src)).read_text()+'</script>'
  if src.startswith('https://telegram.org/'):return ''
  return m[0]
 html=re.sub(r'<script\b[^>]*src="([^\"]+)"[^>]*></script>',external,html)
 script=sdk(uid,'',g['entry'].replace('index.html',''),'?release=classic-1',mobile)
 # Register the observer only once body exists; the SDK itself must precede game code.
 script=script[:script.index('new MutationObserver')]
 html=html.replace('<head>','<head><script>'+script+'</script>')
 page.set_content(html,wait_until='domcontentloaded')
 return g
BANNED=re.compile(r'TABLES ADMIN|tables-admin|Telegram ID|SUBSCRIPTION_REQUIRED|TIMEOUT|Этап:|диагностик|управлен|разрешённых аккаунт|нет доступа|RAW SERVER|rr_admin_state|SECRET',re.I)
results=[];errors=[]
def check(name,value=True):
 assert value,name
 results.append(name);print('PASS',name,flush=True)
def clean(page,history=False):
 t='\n'.join(page.evaluate('window.__texts')) if history else page.locator('body').inner_text()
 assert not BANNED.search(t),t[:2000]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=False,args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 def make(mobile=False):
  c=b.new_context(viewport={'width':390 if mobile else 1024,'height':844 if mobile else 768},has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
  c.route('**/*',lambda route:route.abort())
  pg=c.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());return pg
 for mobile in [False,True]:
  pg=make(mobile);setup(pg,'launcher',mobile=mobile)
  expect(pg.get_by_role('button',name='Проверить снова',exact=True)).to_be_visible()
  check(('mobile' if mobile else 'desktop')+' nonsubscriber: exactly two public buttons',pg.get_by_role('button').count()==2)
  clean(pg);clean(pg,True);check('no debug/admin text, including intermediate frames '+str(mobile))
  check('no horizontal overflow '+str(mobile),pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  pg.get_by_role('button',name='Открыть канал «Витальное кино»',exact=True).click()
  check('channel button uses the existing server-provided channel, not a guessed address',pg.evaluate('window.__join')=='https://t.me/redrooms_stage')
  before=pg.evaluate('window.__calls.length');pg.get_by_role('button',name='Проверить снова',exact=True).click();pg.wait_for_function('window.__calls.length>'+str(before));clean(pg)
  check('retry is still ordinary subscription check')
  pg.screenshot(path=str(OUT/('player-mobile.png' if mobile else 'player-desktop.png')),full_page=True)
  pg.context.close()
 for route in ['admin','admin-advanced']:
  pg=make();setup(pg,route,uid=404)
  pg.wait_for_function('window.__nav.length===1');clean(pg);clean(pg,True)
  check(route+' denied visitor redirects to ordinary launch with no admin chrome',pg.evaluate('window.__nav[0]')=='https://test.invalid/?rr_default=1')
  check(route+' denied visitor never requests private data',pg.evaluate('window.__calls')==['rrAdminStatus'])
  pg.context.close()
  pg=make();setup(pg,route,hang=True);pg.wait_for_timeout(150);clean(pg);clean(pg,True)
  check(route+' slow authorization never flashes editor or identity');pg.context.close()
  pg=make();setup(pg,route,fail=True);expect(pg.get_by_role('button',name='Попробовать снова')).to_be_visible();clean(pg);clean(pg,True)
  check(route+' authorization failure never displays raw server error');pg.context.close()
 for uid in [101,202]:
  pg=make();setup(pg,'admin',uid=uid)
  expect(pg.get_by_role('heading',name='Наборы кассет',exact=True)).to_be_visible();expect(pg.get_by_role('button',name='+ Новый набор')).to_be_visible()
  check('verified administrator '+str(uid)+' retains editor and default controls',pg.locator('#default-name').is_visible())
  if uid==101:
   pg.get_by_role('button',name='+ Новый набор').click();pg.locator('#set-name').fill('Проверка доступа');pg.locator('#set-id').fill('public-ui-test')
   for i in range(1,5):pg.locator(f'#table-{i}-name').fill('Стол '+str(i));pg.locator(f'#table-{i}-titles').fill('Кассета '+str(i))
   pg.get_by_role('button',name='Сохранить черновик',exact=True).click();expect(pg.locator('#rr-notice')).to_contain_text('Черновик сохранён')
   check('admin save remains functional')
  else:
   expect(pg.get_by_role('button',name=re.compile('Проверка доступа'))).to_be_visible();check('second admin sees saved shared draft')
  pg.context.close()
 # Public URL hint does not send an outsider into management.
 pg=make();setup(pg,'launcher',uid=404,start='admin',search='?tgWebAppStartParam=admin')
 expect(pg.get_by_role('button',name='Проверить снова')).to_be_visible();clean(pg);clean(pg,True)
 check('forged admin launch hint still gives ordinary subscription screen',pg.evaluate('window.__nav.length')==0);pg.context.close()
 # Public failure after network/server error: no echoed raw detail.
 pg=make();setup(pg,'launcher',uid=303,fail=True);expect(pg.get_by_role('button',name='Попробовать снова')).to_be_visible();clean(pg)
 check('public internal error displays only friendly copy');pg.context.close()
 # Real Three.js scene with new engine adapter and unchanged catalog.
 for uid in [303,101]:
  pg=make();game(pg,uid=uid)
  pg.wait_for_function('window.RR_GAME_READY===true',timeout=25000)
  check('real 201-cassette game starts: '+str(uid),pg.locator('canvas').count()>0)
  if uid==303:
   check('subscriber game has no management button',pg.get_by_role('button',name='Управление наборами').count()==0)
   check('subscriber game nav has no admin accessibility label','управлен' not in (pg.locator('#rr-game-tools').get_attribute('aria-label') or '').lower())
  else:
   check('management button exists only after verified admin response',pg.get_by_role('button',name='Управление наборами').count()==1)
  pg.context.close()
 check('no uncaught browser JS errors',not errors)
 b.close()
(OUT/'report.json').write_text(json.dumps({'checks':len(results),'passed':results,'page_errors':errors,'scope':'Offline Chromium DOM/WebGL with real source modules, synthetic SDK and in-memory backend; no native Telegram/production API or actual browser navigation tested.'},ensure_ascii=False,indent=2))
print('TOTAL',len(results))
