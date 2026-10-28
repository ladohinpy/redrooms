#!/usr/bin/env python3
"""Built HTML/frozen modules and real SQLite/services in offline Chromium.
The environment disallows browser localhost navigation. Python forwards test API calls;
SDK identities, storage and navigation are adapters. No cloud or native Telegram claims.
"""
import base64, importlib.util, json, os, re, socket, subprocess, time
from pathlib import Path
from functools import lru_cache
spec=importlib.util.spec_from_file_location('suite',Path(__file__).with_name('browser-package1.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(os.environ.get('RR_ATTEMPT_OUTPUT','/tmp/redrooms-attempt-state'));OUT.mkdir(parents=True,exist_ok=True)
os.environ['RR_TEST_GAME']='v12-attempt-state'
g=next(x for x in json.loads((m.R/'config/rr-built-games.json').read_text())['games'] if x['id']=='v12-attempt-state')
frozen={Path(x['path']).name:x['path'] for x in g['runtimeAssets']}
@lru_cache(None)
def compiled_module(name):
 file=m.R/'public'/frozen[name] if name in frozen else m.R/'public/rr'/name
 code=file.read_text();code=re.sub(r"(['\"])\./([a-z-]+\.mjs)\1",lambda x:json.dumps(compiled_module(x[2])),code)
 if name in ['client.mjs','engine-boot.mjs','contest-client.mjs','launcher.mjs']:code='const location=window.__rrLocation;\n'+code
 return 'data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
m.module=compiled_module
with socket.socket() as s:s.bind(('127.0.0.1',0));m.PORT=s.getsockname()[1]
checks=[];errors=[]
def check(label,ok=True):
 assert ok,label
 checks.append(label);print('PASS',label,flush=True)
server=subprocess.Popen(['node','tests/rr/package1-browser-server.mjs'],cwd=m.R,env={**os.environ,'RR_TEST_PORT':str(m.PORT)},stdout=open(OUT/'server.log','w'),stderr=subprocess.STDOUT)
try:
 for _ in range(100):
  try:m.api('adminRead');break
  except Exception:time.sleep(.05)
 with m.sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=False,args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  def page(mobile=False):
   c=browser.new_context(viewport={'width':390 if mobile else 1100,'height':844 if mobile else 900},is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
   c.route('**/*',lambda r:r.abort());pg=c.new_page();pg.set_default_timeout(10000);pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());return pg,c
  def stale(a,req):return json.dumps({'version':1,'releaseId':'eight','requestId':req,'attemptId':a['id'],'mode':a['mode'],'startedAt':a['startedAt'],'actions':[],'pending':None,'receipt':None})
  def stored(pg):return pg.evaluate('JSON.parse(JSON.stringify(localStorage))')
  req='browser-closed-admin';a=m.api('start',{'releaseId':'eight','requestId':req},101)['attempt'];m.api('abandon',{'attemptId':a['id']},101)
  pg,c=page();m.setup_game(pg,uid=101,storage={'rr:contest:1:101:eight':stale(a,req)})
  m.expect(pg.locator('#startButton')).to_have_text('Начать следующую игру');check('closed preview is recognized from server on entry')
  m.expect(pg.locator('#rr-start-admin')).to_be_visible();check('admin button remains on clean first screen')
  pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');check('stale closed preview enters actual room',pg.locator('#start').is_hidden())
  pg.evaluate('window.__gameTest.one()');check('real cassette placement works',pg.evaluate('window.__gameTest.state.correctCount')==1)
  pg.screenshot(path=str(OUT/'admin-playing.png'))
  player=next(x for x in m.api('adminRead',{'includeAdminTests':True})['players'] if x['userId']==101)
  check('server keeps both admin records separate from player counts',player['totalAttemptCount']==0 and player['testAttemptCount']==2 and player['previewCount']==2 and player['attemptCount']==0)
  c.close()
  a=m.api('start',{'releaseId':'eight','requestId':'mobile-closed-1'},303)['attempt'];m.api('abandon',{'attemptId':a['id']},303)
  pg,c=page(True);m.setup_game(pg,uid=303,storage={'rr:contest:1:303:eight':stale(a,'mobile-closed-1')},mobile=True)
  check('ordinary player has no admin entry',pg.locator('#rr-start-admin').count()==0)
  pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');pg.evaluate('window.__gameTest.solve()');m.expect(pg.locator('#win .rr-score')).to_contain_text('800 очков',timeout=15000)
  check('ordinary mobile practice finishes and saves server score');pg.screenshot(path=str(OUT/'player-result-390.png'));c.close()
  # A closed practice save must not carry already-shelved tapes into the next game.
  pg,c=page();m.setup_game(pg,uid=606);pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');pg.evaluate('window.__gameTest.one()');saved=stored(pg)
  previous=json.loads(saved['rr:contest:1:606:eight']);m.api('abandon',{'attemptId':previous['attemptId']},606);c.close()
  pg,c=page();m.setup_game(pg,uid=606,storage=saved);check('closed practice cannot restore cassette positions into the next attempt',pg.evaluate('window.__gameTest.state.correctCount')==0)
  pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');check('closed practice starts fresh while old attempt remains recorded',json.loads(stored(pg)['rr:contest:1:606:eight'])['attemptId']!=previous['attemptId']);c.close()
  # Complete on the server while the saved client state still points to the start.
  a=m.api('start',{'releaseId':'eight','requestId':'browser-done-1'},202)['attempt']
  records=m.rpc({'name':'__inspection'})['result']['records'];admin=next(x['data'] for x in records if x['key']=='admin');catalog=next(x for x in admin['catalog_versions'] if x['id']=='eight')['playable']
  answers=[{'filmId':f['id'],'tableId':d['id']} for d in catalog['directors'] for f in d['films']]
  m.api('finish',{'attemptId':a['id'],'answers':answers,'actions':[dict(x,seq=i+1) for i,x in enumerate(answers)],'counters':{'placements':len(answers)}},202)
  pg,c=page();m.setup_game(pg,uid=202,storage={'rr:contest:1:202:eight':stale(a,'browser-done-1')});m.expect(pg.locator('#win .rr-score')).to_contain_text('800 очков')
  check('lost receipt restored as a result rather than an entry error')
  pg.locator('#win').get_by_role('button',name='Сыграть ещё раз',exact=True).click();pg.wait_for_function('window.__rrNav.length>0');after=stored(pg);c.close()
  pg,c=page();m.setup_game(pg,uid=202,storage=after);pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');check('administrator can play again without changing prior result');c.close()
  pg,c=page(True);m.setup_admin(pg,uid=101,mobile=True);m.expect(pg.get_by_role('heading',name='Наборы кассет',exact=True)).to_be_visible(timeout=15000);pg.get_by_role('button',name='Игроки',exact=True).click();m.expect(pg.get_by_role('heading',name='Игроки',exact=True)).to_be_visible();m.expect(pg.get_by_label('Показать проверки администраторов',exact=True)).not_to_be_checked();pg.get_by_label('Показать проверки администраторов',exact=True).check();m.expect(pg.locator('.rr-tab-body')).to_contain_text('Проверки');m.expect(pg.locator('.rr-tab-body')).to_contain_text('Игровых попыток');check('players table shows test history only with the explicit filter');pg.screenshot(path=str(OUT/'players-390.png'),full_page=True);c.close()
  m.command('activate',releaseId='eight')
  for i in range(2):
   a=m.api('start',{'releaseId':'eight','requestId':f'used-slot-000{i}'},909)['attempt'];m.api('abandon',{'attemptId':a['id']},909)
  storage={'rr:contest:1:909:eight':stale(a,'used-slot-0001')}
  pg,c=page();m.setup_game(pg,uid=909,storage=storage)
  if not pg.locator('#startButton').is_disabled():
   pg.locator('#startButton').click();m.expect(pg.locator('#rr-start-status')).to_contain_text('Обе конкурсные попытки')
  check('two-used-slot player cannot start third competitive game',not pg.evaluate('window.RRContest.running'));c.close()
  m.command('close',releaseId='eight');pg,c=page();m.setup_game(pg,uid=909,storage=storage);pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');check('same user can enter archive after contest closes');c.close()
  check('no uncaught browser errors',not errors);browser.close()
finally:
 server.terminate();server.wait(timeout=5)
 (OUT/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'scope':'Built HTML/frozen modules + real WebGL/SQLite/services; synthetic Telegram SDK, browser storage and navigation. Browser localhost is blocked; no live Telegram or production writes.'},ensure_ascii=False,indent=2))
print('CHECKS PASSED',len(checks),flush=True)
