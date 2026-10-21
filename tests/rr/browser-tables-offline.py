#!/usr/bin/env python3
"""Offline DOM/WebGL integration tests. Requires Python Playwright + Chromium + display (Xvfb).
Uses real project modules and bundled Three.js, synthetic Telegram SDK, in-memory local backend.
No production auth/API, no native Telegram or actual HTTP browser-navigation claim.
The data: module wrapper substitutes only module delivery and location; no game logic is mocked.
Run: DISPLAY=:99 RR_TEST_OUTPUT=/tmp/rr-result python tests/rr/browser-tables-offline.py
"""
import base64,json,re,urllib.request,os,subprocess,socket,time,sys
from pathlib import Path
from functools import lru_cache
from playwright.sync_api import sync_playwright,expect
R=Path(__file__).resolve().parents[2];OUT=Path(os.environ.get('RR_TEST_OUTPUT','/tmp/redrooms-browser-report'));OUT.mkdir(parents=True,exist_ok=True)
PORT=int(os.environ.get('RR_TEST_PORT','4198'))
@lru_cache(None)
def module(name,engine=False):
 code=(R/'src/rr'/name).read_text()
 code=re.sub(r"(['\"])\./([a-z-]+\.mjs)\1",lambda m:json.dumps(module(m[2],engine)),code)
 if engine and name in ['engine-boot.mjs','client.mjs']:code='const location=window.__rrLocation;\n'+code
 return 'data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
def rpc(d):
 req=urllib.request.Request(f'http://127.0.0.1:{PORT}/__test_api',data=json.dumps(d).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=10))
def sdk(uid=101,mobile=False,start=''):
 return '''window.rrUid=UID;window.rrStart=START;window.__events={};window.__rrNav=[];
 window.__rrLocation={pathname:PATH,search:'',hash:'',origin:'http://test.local',assign(x){window.__rrNav.push(x);},replace(x){window.__rrNav.push(x);}};
 window.Telegram={WebApp:{initData:'OFFLINE_TEST_ONLY',platform:PLATFORM,version:'9.6',isFullscreen:MOBILE,viewportHeight:innerHeight,viewportStableHeight:innerHeight,themeParams:{},safeAreaInset:{top:TOP,left:0,right:0,bottom:BOTTOM},contentSafeAreaInset:{top:CONTENT,left:0,right:0,bottom:0},
 ready(){},expand(){},isVersionAtLeast(){return true},disableVerticalSwipes(){},enableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){},requestFullscreen(){this.isFullscreen=true;},exitFullscreen(){this.isFullscreen=false;},
 onEvent(n,f){(window.__events[n] ||= []).push(f)},BackButton:{onClick(){},show(){},hide(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},openTelegramLink(u){window.__opened=u},
 Serverless:{call(name,input,cb){window.rrTestCall({name,input,uid:window.rrUid,start:window.rrStart}).then(r=>cb(r.error||null,r.result)).catch(e=>cb({message:e.message}));}}
 }};'''.replace('UID',str(uid)).replace('START',json.dumps(start)).replace('PLATFORM',json.dumps('ios' if mobile else 'tdesktop')).replace('MOBILE','true' if mobile else 'false').replace('TOP','44' if mobile else '0').replace('BOTTOM','34' if mobile else '0').replace('CONTENT','48' if mobile else '0')
def setup_admin(page,uid=101,mobile=False):
 page.expose_function('rrTestCall',rpc)
 html=(R/'public/admin.html').read_text()
 html=re.sub(r'<script type="module"[^>]*></script>','',html)
 html=html.replace('<link rel="stylesheet" href="/rr/admin.css">','<style>'+(R/'public/rr/admin.css').read_text()+'</style>')
 page.set_content(html)
 page.evaluate(sdk(uid,mobile).replace('PATH',json.dumps('/admin')))
 page.evaluate('url=>import(url)',module('admin.mjs',True))
def setup_game(page,uid=101,mobile=False,release='classic-1'):
 page.expose_function('rrTestCall',rpc)
 manifest=json.loads((R/'config/rr-built-games.json').read_text());game=next(g for g in manifest['games'] if g['id']=='v07-tables')
 html=(R/('public'+game['entry'])).read_text()
 boot=re.search(r'import\(("/rr/runtime/[^"]+/engine-boot.mjs")\)',html)
 assert boot
 html=html.replace(boot[1],json.dumps(module('engine-boot.mjs',True)))
 def external(m):
  src=m[1]
  if src.startswith('/rr/frozen/'):return '<script>'+(R/('public'+src)).read_text()+'</script>'
  if src.startswith('https://telegram.org/'):return '' # synthetic SDK replaces remote SDK only in test harness
  return m[0]
 html=re.sub(r'<script\b[^>]*src="([^"]+)"[^>]*></script>',external,html)
 script=sdk(uid,mobile).replace('PATH',json.dumps(game['entry'].replace('index.html','')))+f"\nwindow.__rrLocation.search='?release={release}';"
 script=script.replace('viewportHeight:innerHeight,viewportStableHeight:innerHeight',f"viewportHeight:{page.viewport_size['height']},viewportStableHeight:{page.viewport_size['height']}")
 html=html.replace('<head>','<head><script>'+script+'</script>')
 print('SET GAME CONTENT',mobile,flush=True);page.set_content(html,wait_until='domcontentloaded');print('CONTENT SET',mobile,flush=True)
 page.wait_for_function('window.RR_GAME_READY===true',timeout=25000)
 return game

def run_suite():
 global PORT
 with socket.socket() as s:s.bind(('127.0.0.1',0));PORT=s.getsockname()[1]
 proc=subprocess.Popen(['node','tests/rr/runtime-browser-server.mjs'],cwd=R,env={**os.environ,'RR_TEST_PORT':str(PORT),'RR_CANONICAL':'1'},stdout=subprocess.DEVNULL)
 results=[];pages=[];errors=[]
 def check(name,condition=True):
  assert condition,name
  results.append(name);print('PASS',name,flush=True)
 try:
  for _ in range(100):
   try:rpc({'name':'rrAdminStatus','uid':101,'input':{}});break
   except Exception:time.sleep(.05)
  with sync_playwright() as p:
   b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=False,args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
   def page(width=1280,height=900,mobile=False):
    c=b.new_context(viewport={'width':width,'height':height},has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
    c.route('**/*',lambda route:route.abort()) # no external services in offline test
    pg=c.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());pages.append(pg);return pg
   a=page();setup_admin(a);expect(a.get_by_role('heading',name='Наборы кассет')).to_be_visible();expect(a.locator('#identity')).to_contain_text('101');check('Admin 101 authenticated in synthetic SDK; separate editor is displayed')
   a.get_by_role('button',name='+ Новый набор').click();a.locator('#set-id').fill('browser-set');a.locator('#set-name').fill('Оскар — четыре категории')
   labels=['Лучший фильм','Режиссура','Сценарий','Музыка']
   titles=['Фильм один\nФильм два','Кассета три; Кассета четыре','Пятый фильм\nШестой фильм','Седьмая кассета\nВосьмая кассета']
   for i in range(1,5):a.locator(f'#table-{i}-name').fill(labels[i-1]);a.locator(f'#table-{i}-titles').fill(titles[i-1])
   expect(a.locator('#review')).to_contain_text('8 кассет');check('Four arbitrary captions, newline and automatic semicolon parsing, no year fields')
   a.get_by_role('button',name='Сохранить черновик',exact=True).click();expect(a.locator('#rr-notice')).to_contain_text('Черновик сохранён');check('Save draft succeeds without JSON input')
   v=page();setup_admin(v,202);expect(v.locator('#identity')).to_contain_text('202');v.get_by_role('button',name='Оскар — четыре категории Черновик').click();expect(v.locator('#table-1-titles')).to_have_value('Фильм один\nФильм два');check('Admin 202 reads the same persisted draft')
   a.locator('#set-name').fill('Оскар — версия Павла');a.get_by_role('button',name='Сохранить черновик',exact=True).click();expect(a.locator('#rr-notice')).to_contain_text('Черновик сохранён')
   v.locator('#set-name').fill('Оскар — версия Виталия');v.get_by_role('button',name='Сохранить черновик',exact=True).click();expect(v.locator('#rr-notice')).to_contain_text('Другой администратор');expect(v.locator('#set-name')).to_have_value('Оскар — версия Виталия');check('Stale second-admin save rejected; unsaved text retained')
   v.get_by_role('button',name='Обновить',exact=True).click();expect(v.locator('#set-name')).to_have_value('Оскар — версия Павла');v.locator('#set-name').fill('Оскар — четыре категории');v.get_by_role('button',name='Сохранить черновик',exact=True).click();expect(v.locator('#rr-notice')).to_contain_text('Черновик сохранён');check('Second admin can save after intentional refresh')
   v.get_by_role('button',name='Опубликовать по ссылке',exact=True).click();expect(v.get_by_role('heading',name='Опубликованный набор')).to_be_visible();expect(v.get_by_label('Ссылка на набор')).to_have_value('https://t.me/RedRoomTestBot?startapp=set_browser-set');expect(v.locator('#default-name')).to_contain_text('Классическая');check('Atomic publication by link does not switch global default')
   expect(v.locator('#set-name')).to_have_attribute('readonly','');v.get_by_role('button',name='Закрыть сообщение').click();check('Published version is read-only; notifications can be dismissed')
   v.screenshot(path=str(OUT/'admin-desktop.png'),full_page=True)
   r=rpc({'name':'rrGetLaunch','uid':303,'input':{},'start':'set_browser-set'});assert r['result']['release']['id']=='browser-set';check('Signed-context set_ selector resolves the public set')
   bad=rpc({'name':'rrGetLaunch','uid':404,'input':{'release':'browser-set'}});check('Non-subscriber denied by real service',bad['error']['parameters']['code']=='SUBSCRIPTION_REQUIRED')
   stranger=page();setup_admin(stranger,303);expect(stranger.get_by_role('heading',name='Нет доступа к управлению')).to_be_visible();check('Ordinary account cannot open administration')
   v.get_by_role('button',name='Сделать основным',exact=True).click();expect(v.locator('#default-name')).to_have_text('Оскар — четыре категории');check('Make default switches future ordinary launches')
   state=rpc({'name':'rrAdminRead','uid':101,'input':{}})['result'];check('Original catalog and classic release preserved',state['state']['catalog_versions'][0]['id']=='original-201-v1' and any(x['id']=='classic-1' for x in state['state']['game_releases']))
   v.get_by_role('button',name='Создать копию',exact=True).click();expect(v.locator('#set-id')).not_to_have_value('browser-set');check('Editing published set starts a distinct copy')
   # Import is optional; exercise the actual file input with title-only table data.
   imported={'format':'red-room-tables','version':1,'name':'Импорт','tables':[{'name':f'Стол {i}','titles':f'Кассета {i}','delimiter':'lines'} for i in range(1,5)]}
   v.locator('input[type=file]').set_input_files({'name':'four-tables.json','mimeType':'application/json','buffer':json.dumps(imported).encode()});expect(v.locator('#table-1-titles')).to_have_value('Кассета 1');check('Optional JSON file input fills table fields without publication')
   v.locator('#table-2-titles').fill('Кассета 1');expect(v.locator('#review')).to_contain_text('повторяется');check('Ambiguous duplicate answers are visible before publication')
   for width,height,mobile in [(800,600,False),(390,844,True)]:
    m=page(width,height,mobile);setup_admin(m,101,mobile);expect(m.locator('#set-name')).to_be_visible();check(f'Admin {width}x{height}: no horizontal overflow',m.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
    if mobile:
     check('Mobile topbar below simulated Telegram safe+content area',m.locator('.topbar').bounding_box()['y']>=91)
     check('Admin does not keep fullscreen request active',m.evaluate('Telegram.WebApp.isFullscreen')==False)
     m.screenshot(path=str(OUT/'admin-mobile.png'),full_page=True)
    else:m.screenshot(path=str(OUT/'admin-small-desktop.png'))
   # REAL Three.js scene, data, geometry and controls. Only SDK/location are adapted.
   for release,width,height,mobile,total in [('browser-set',1000,800,False,8),('classic-1',1100,850,False,201),('browser-set',390,844,True,8)]:
    print('BEGIN GAME',release,width,flush=True);g=page(width,height,mobile);print('PAGE CREATED',flush=True);setup_game(g,101,mobile,release);check(f'Real WebGL game ready: {release} {width}x{height}',g.evaluate('window.RR_GAME_READY===true'))
    check(f'Canonical directory path does not redirect again: {width}x{height}',g.evaluate('window.__rrNav.length')==0)
    expect(g.locator('#collectionSize')).to_have_text(str(total))
    text=g.locator('body').inner_text();check(f'No fabricated/null years on page: {width}x{height}','null' not in text and 'undefined' not in text)
    card=g.locator('#start .start-card').bounding_box();check(f'Start card fits viewport width: {width}',card['x']>=0 and card['x']+card['width']<=width+1)
    if mobile:check('Game toolbar below Telegram safe area',g.locator('#rr-game-tools').bounding_box()['y']>=100)
    g.screenshot(path=str(OUT/f'game-start-{width}.png'))
    g.locator('#startButton').click();g.wait_for_timeout(350);check(f'Start button enters game: {width}x{height}',g.locator('#start').evaluate('n=>n.hidden'))
    if mobile:
     for control in ['#mobileAction','#joystick']:
      bb=g.locator(control).bounding_box();check(f'Mobile control {control} visible within viewport',bb is not None and bb['y']>=0 and bb['y']+bb['height']<=height+1)
    g.screenshot(path=str(OUT/f'game-playing-{width}.png'));g.close()
   check('No uncaught browser Javascript errors',not errors)
   b.close()
 finally:
  proc.terminate();proc.wait(timeout=5)
  (OUT/'results.json').write_text(json.dumps({'passed':len(results),'checks':results,'uncaughtErrors':errors,'scope':'Offline DOM/WebGL; actual JS/HTML, synthetic SDK and memory service. No live Telegram auth or actual browser HTTP navigation.'},ensure_ascii=False,indent=2))
 print('BROWSER CHECKS PASSED:',len(results),flush=True)

if __name__=='__main__':run_suite()
