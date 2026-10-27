#!/usr/bin/env python3
"""Focused real-DOM/WebGL checks. Synthetic Telegram transport + local real services/SQLite.
Navigation targets verified, not native Telegram window navigation. No live API writes.
"""
import importlib.util,json,os,socket,subprocess,time
from pathlib import Path
P=Path(__file__).with_name('browser-package1.py');spec=importlib.util.spec_from_file_location('suite',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(os.environ.get('RR_ENTRY_OUTPUT','/tmp/redrooms-access-entry'));OUT.mkdir(parents=True,exist_ok=True)
checks=[];errors=[]
def check(name,value=True):
 assert value,name
 checks.append(name);print('PASS',name,flush=True)
with socket.socket() as s:s.bind(('127.0.0.1',0));m.PORT=s.getsockname()[1]
proc=subprocess.Popen(['node','tests/rr/package1-browser-server.mjs'],cwd=m.R,env={**os.environ,'RR_TEST_PORT':str(m.PORT)},stdout=open(OUT/'server.log','w'),stderr=subprocess.STDOUT)
try:
 for _ in range(80):
  try:m.rpc({'name':'rrAdminStatus','uid':101,'input':{}});break
  except Exception:time.sleep(.05)
 with m.sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=False,args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  def page(width=390,height=844,mobile=True):
   c=browser.new_context(viewport={'width':width,'height':height},has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
   c.route('**/*',lambda r:r.abort());pg=c.new_page();pg.set_default_timeout(10000);pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());return pg,c
  for uid in [303,404]:
   pg,c=page();m.setup_admin(pg,uid,True);pg.wait_for_function('window.__rrNav.length>0')
   check('direct admin URL denies user '+str(uid),pg.locator('#app button').count()==0 and pg.locator('#identity').is_hidden())
   check('no protected read on unauthorized UI '+str(uid),not any(x['name']=='rrAdminRead' for x in pg.evaluate('window.__sdkCalls')))
   check('denied URL goes to player in same webview '+str(uid),'/index.html' not in pg.evaluate('window.__rrNav[0]') and 'rr_default=1' in pg.evaluate('window.__rrNav[0]'))
   c.close()
  for uid,width,mobile in [(101,390,True),(202,360,True),(101,1280,False)]:
   pg,c=page(width,844,mobile);m.setup_admin(pg,uid,mobile)
   m.expect(pg.get_by_role('heading',name='Наборы кассет',exact=True)).to_be_visible()
   m.expect(pg.locator('#identity')).to_contain_text(str(uid))
   check('configured admin gets editor '+str(uid)+' width '+str(width))
   check('no horizontal overflow '+str(width),pg.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   check('same editor theme retained '+str(width),pg.evaluate("getComputedStyle(document.body).color")=='rgb(255, 241, 244)')
   pg.screenshot(path=str(OUT/('admin-'+str(width)+'.png')),full_page=True)
   # Simulate runtime revocation after initial data render: actual wrapper emits lock event.
   pg.evaluate("() => {window.Telegram.WebApp.Serverless.call=(n,i,cb)=>cb({parameters:{code:'FORBIDDEN'}});}")
   pg.get_by_role('button',name='Обновить',exact=True).click();pg.wait_for_timeout(100)
   check('revoked response clears editor '+str(uid)+' '+str(width),pg.locator('#app button').count()==0 and pg.locator('#identity').is_hidden())
   c.close()
  print('GAME CASES',flush=True)
  for uid in [101,202,303]:
   pg,c=page(1000,850,False);m.setup_game(pg,uid=uid)
   m.expect(pg.locator('#startButton')).to_be_enabled()
   if uid in [101,202]:
    m.expect(pg.get_by_role('button',name='Админка',exact=True).first).to_be_visible()
    check('admin button available before play '+str(uid))
    pg.locator('#rr-start-admin').click();pg.wait_for_function('window.__rrNav.length>0')
    check('button rechecks role and uses internal navigation '+str(uid),'/admin.html' in pg.evaluate('window.__rrNav[0]') and pg.evaluate('window.__opened') is None)
   else:
    pg.wait_for_timeout(100);check('ordinary player has no admin DOM',pg.locator('#rr-start-admin').count()==0 and pg.locator('#rr-pause-admin').count()==0)
   pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true')
   check('start request enters real game '+str(uid),pg.locator('#start').is_hidden())
   c.close()
  print('NETWORK FAILURE CASE',flush=True)
  pg,c=page(1000,850,False);m.setup_game(pg,uid=507)
  pg.evaluate("""(()=>{const original=Telegram.WebApp.Serverless.call;let once=true;Telegram.WebApp.Serverless.call=(n,i,cb)=>original(n,i,(e,r)=>{if(n==='rrContest'&&i.action==='start'&&once){once=false;cb({message:'PRIVATE SQL detail',parameters:{code:'TIMEOUT'}});return;}cb(e,r);});})()""")
  pg.locator('#startButton').click();m.expect(pg.locator('#rr-start-status')).to_be_visible()
  m.expect(pg.locator('#rr-start-status')).to_contain_text('Связь прервалась')
  check('start failure visible outside HUD',not pg.locator('#start').is_hidden() and pg.locator('#hud').is_hidden())
  check('raw server details not exposed','PRIVATE SQL' not in pg.locator('body').inner_text())
  check('failed start not marked running',pg.evaluate('window.RRContest.running') is False)
  pg.screenshot(path=str(OUT/'visible-start-error.png'))
  pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true')
  calls=[x['input'] for x in pg.evaluate('window.__sdkCalls') if x['name']=='rrContest' and x['input'].get('action')=='start']
  check('retry keeps request ID after lost server ACK',len(calls)==2 and calls[0]['requestId']==calls[1]['requestId'])
  a=m.api('adminRead',{'releaseId':'eight'})['attempts'];check('one persisted attempt after retry',len([x for x in a if x['userId']==507])==1)
  c.close();check('no uncaught JavaScript errors',not errors);browser.close()
finally:
 proc.terminate();proc.wait(timeout=5)
 (OUT/'results.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'errors':errors,'scope':'Real UI/game + local SQLite; synthetic Telegram identities/transport/navigation, not live cloud or native apps.'},ensure_ascii=False,indent=2))
print('CHECKS PASSED',len(checks),flush=True)
