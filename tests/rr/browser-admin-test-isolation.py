#!/usr/bin/env python3
"""Built game + admin UI + actual services and local SQLite, synthetic Telegram transport.
No live Telegram, deployment or production database calls.
"""
import base64,importlib.util,json,os,re,socket,subprocess,time
from pathlib import Path
from functools import lru_cache
spec=importlib.util.spec_from_file_location('suite',Path(__file__).with_name('browser-package1.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(os.environ.get('RR_ADMIN_TEST_OUTPUT','/tmp/redrooms-admin-test-isolation'));OUT.mkdir(parents=True,exist_ok=True)
os.environ['RR_TEST_GAME']='v12-attempt-state'
g=next(x for x in json.loads((m.R/'config/rr-built-games.json').read_text())['games'] if x['id']=='v12-attempt-state')
frozen={Path(x['path']).name:x['path'] for x in g['runtimeAssets']}
@lru_cache(None)
def compiled_module(name):
 p=m.R/'public'/frozen[name] if name in frozen else m.R/'public/rr'/name
 code=p.read_text();code=re.sub(r"(['\"])\./([a-z-]+\.mjs)\1",lambda x:json.dumps(compiled_module(x[2])),code)
 if name in ['client.mjs','engine-boot.mjs','contest-client.mjs','launcher.mjs']:code='const location=window.__rrLocation;\n'+code
 return 'data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
m.module=compiled_module
with socket.socket() as s:s.bind(('127.0.0.1',0));m.PORT=s.getsockname()[1]
checks=[];errors=[]
def check(label,ok=True):
 assert ok,label
 checks.append(label);print('PASS',label,flush=True)
proc=subprocess.Popen(['node','tests/rr/package1-browser-server.mjs'],cwd=m.R,env={**os.environ,'RR_TEST_PORT':str(m.PORT)},stdout=open(OUT/'server.log','w'),stderr=subprocess.STDOUT)
try:
 for _ in range(100):
  try:m.api('adminRead');break
  except Exception:time.sleep(.05)
 m.command('activate',releaseId='eight')
 with m.sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=False,args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  def page(mobile=False):
   c=browser.new_context(viewport={'width':390 if mobile else 1100,'height':844 if mobile else 900},has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
   c.route('**/*',lambda r:r.abort());pg=c.new_page();pg.set_default_timeout(12000);pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());return pg,c
  # Existing frozen client, not a newly mocked contestant controller. Four full runs per administrator.
  for uid in [101,202]:
   storage={}
   for n in range(4):
    pg,c=page(uid==202);m.setup_game(pg,uid=uid,mobile=uid==202,storage=storage)
    m.expect(pg.locator('#rr-start-admin')).to_be_visible()
    pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true')
    pg.evaluate('window.__gameTest.solve()');m.expect(pg.locator('#win .rr-score')).to_contain_text('800 очков',timeout=15000)
    m.expect(pg.locator('#win')).to_contain_text('Предпросмотр администратора')
    pg.locator('#win').get_by_role('button',name='Сыграть ещё раз',exact=True).click();pg.wait_for_function('window.__rrNav.length>0')
    storage=pg.evaluate('JSON.parse(JSON.stringify(localStorage))');c.close()
    check(f'admin {uid}: real game completion and restart {n+1}/4')
   row=next(x for x in m.api('adminRead',{'includeAdminTests':True})['players'] if x['userId']==uid)
   check(f'admin {uid}: zero player attempts, four retained test records',row['totalAttemptCount']==0 and row['testAttemptCount']==4)
  data=m.api('adminRead',{'releaseId':'eight'})
  check('zero participants/attempts/rankings after eight admin tests',data['stats']['participants']==0 and data['stats']['attempts']==0 and not data['rankings'] and not data['players'])
  # Actual ordinary client still gets two attempts and cannot start a third.
  storage={}
  for n in range(2):
   pg,c=page();m.setup_game(pg,uid=303,storage=storage)
   check(f'ordinary game {n+1}: no administrator button',pg.locator('#rr-start-admin').count()==0)
   pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');pg.evaluate('window.__gameTest.solve()');m.expect(pg.locator('#win .rr-score')).to_contain_text('800 очков',timeout=15000)
   check(f'ordinary completion {n+1}: saved in server statistics',m.api('adminRead',{'releaseId':'eight'})['stats']['attempts']==n+1)
   if n==0:
    pg.locator('#win').get_by_role('button',name='Попробовать ещё раз',exact=True).click();pg.wait_for_function('window.__rrNav.length>0')
   else:check('ordinary client offers no third contest attempt',pg.locator('#win').get_by_role('button',name='Попробовать ещё раз',exact=True).count()==0)
   storage=pg.evaluate('JSON.parse(JSON.stringify(localStorage))');c.close()
  reply=m.rpc({'name':'rrContest','input':{'action':'start','releaseId':'eight','requestId':'blocked-third-browser'},'uid':303})
  check('ordinary third request also denied by server',reply.get('error',{}).get('parameters',{}).get('code')=='ATTEMPTS_EXHAUSTED')
  # The filter changes only the private history listing, not statistical totals.
  for mobile in [False,True]:
   pg,c=page(mobile);m.setup_admin(pg,uid=101,mobile=mobile)
   m.expect(pg.get_by_role('heading',name='Наборы кассет',exact=True)).to_be_visible(timeout=15000)
   pg.get_by_role('button',name='Игроки',exact=True).click();m.expect(pg.get_by_role('heading',name='Игроки',exact=True)).to_be_visible()
   body=pg.locator('.rr-tab-body');m.expect(body).to_contain_text('@player_303')
   check(('mobile' if mobile else 'desktop')+' players: both admins hidden initially','@player_101' not in body.inner_text() and '@player_202' not in body.inner_text())
   pg.get_by_label('Показать проверки администраторов',exact=True).check();m.expect(body).to_contain_text('@player_101');m.expect(body).to_contain_text('@player_202')
   check(('mobile' if mobile else 'desktop')+' opt-in history displays admin test records','Администратор — вне статистики' in body.inner_text())
   row=body.locator('tr').filter(has_text='@player_101');row.get_by_role('button',name='История и модерация').click();m.expect(pg.get_by_role('dialog')).to_contain_text('preview')
   check(('mobile' if mobile else 'desktop')+' raw test history still accessible')
   pg.get_by_role('dialog').get_by_role('button',name='Закрыть',exact=True).click()
   pg.get_by_label('Показать проверки администраторов',exact=True).uncheck();m.expect(body.locator('tr').filter(has_text='@player_101')).to_have_count(0)
   check(('mobile' if mobile else 'desktop')+' whole page has no horizontal overflow',pg.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   pg.screenshot(path=str(OUT/('players-mobile.png' if mobile else 'players-desktop.png')),full_page=True);c.close()
  r=m.api('adminRead',{'releaseId':'eight'})
  check('two real attempts / one participant, eight tests excluded',r['stats']['participants']==1 and r['stats']['attempts']==2 and len(r['rankings'])==1)
  outsider=m.rpc({'name':'rrContest','input':{'action':'adminRead','includeAdminTests':True},'uid':303})
  check('test-history filter cannot grant administrative access',outsider.get('error',{}).get('parameters',{}).get('code')=='FORBIDDEN')
  check('no uncaught browser errors',not errors);browser.close()
finally:
 proc.terminate();proc.wait(timeout=5)
 (OUT/'results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'errors':errors,'scope':'Actual frozen v12 game, built admin UI, server services and local SQLite. Test Telegram identities/transport, browser storage and navigation; no live server.'},ensure_ascii=False,indent=2))
print('CHECKS PASSED',len(checks),flush=True)
