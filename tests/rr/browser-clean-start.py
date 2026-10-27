#!/usr/bin/env python3
"""Clean entry + neutral category feedback, using real game/services/SQLite.
Synthetic Telegram identity/transport, same offline harness as the regression suite.
Run under xvfb-run on Linux. Nothing in this file is deployed to public/.
"""
import importlib.util,json,os,socket,subprocess,time
from pathlib import Path
P=Path(__file__).with_name('browser-package1.py')
spec=importlib.util.spec_from_file_location('package1_browser',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OUT=Path(os.environ.get('RR_CLEAN_OUTPUT','/tmp/redrooms-clean-start'));OUT.mkdir(parents=True,exist_ok=True)
m.HOOK=m.HOOK.replace('window.__gameTest={',"window.__gameTest={wrong(){const t=tapeObjects.find(t=>!t.userData.shelved);if(!heldTape)takeTape(t);putTapeOnShelf(shelfGroups.find(s=>s.userData.director!==t.userData.film.director).userData.director);},")
results=[];errors=[]
def check(name,value=True):
 assert value,name
 results.append(name);print('PASS',name,flush=True)
with socket.socket() as sock:sock.bind(('127.0.0.1',0));m.PORT=sock.getsockname()[1]
proc=subprocess.Popen(['node','tests/rr/package1-browser-server.mjs'],cwd=m.R,env={**os.environ,'RR_TEST_PORT':str(m.PORT)},stdout=open(OUT/'server.log','w'),stderr=subprocess.STDOUT)
try:
 for _ in range(100):
  try:m.rpc({'name':'rrAdminStatus','uid':101,'input':{}});break
  except Exception:time.sleep(.05)
 model=m.rpc({'name':'rrAdminRead','uid':101,'input':{}})['result']
 out=m.rpc({'name':'rrAdminCommand','uid':101,'input':{'action':'publishSimpleSet','expectedRevision':model['revision'],'input':{'id':'entry-test','name':'тест1','makeDefault':False,'tables':[{'name':str(2020+i),'titles':'\n'.join(f'Кассета {i+1}.{j+1}' for j in range(3)),'delimiter':'lines'} for i in range(4)]}}})
 assert 'error' not in out,out
 check('new sets choose v11 renderer',next(r for r in out['result']['state']['game_releases'] if r['id']=='entry-test')['gameVersionId']=='v11-access-entry')
 with m.sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=False,args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
  def page(uid,mobile=False):
   c=browser.new_context(viewport={'width':390 if mobile else 1200,'height':844 if mobile else 900},has_touch=mobile,is_mobile=mobile,device_scale_factor=1)
   c.route('**/*',lambda r:r.abort());pg=c.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept())
   m.setup_game(pg,uid=uid,release='entry-test',mobile=mobile)
   return pg,c
  def clean(pg,tag):
   text=pg.locator('#start').inner_text()
   check(tag+': no name or automatic mode text',all(s not in text for s in ['тест1','Тестовый режим','Свободное прохождение','Конкурс для этого набора','Две конкурсные попытки']))
   check(tag+': no pre-game share/copy/ranking buttons',all(not pg.locator('#start').get_by_role('button',name=s,exact=True).count() for s in ['Поделиться этой игрой','Копировать ссылку','Посмотреть рейтинг']))
   check(tag+': old card and floating name badge absent',pg.locator('#rr-contest-intro').count()==0 and not pg.locator('#rr-game-tools').is_visible())
   m.expect(pg.locator('#collectionSize')).to_have_text('12')
   check(tag+': count and start remain',pg.locator('#startButton').is_enabled())
   check(tag+': no horizontal overflow',pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
  for uid,mobile in [(303,False),(304,True),(101,True)]:
   pg,c=page(uid,mobile);tag=('admin' if uid==101 else 'player')+('-mobile' if mobile else '-desktop')
   clean(pg,tag)
   check(tag+': empty author field leaves no placeholder',pg.locator('#rr-player-intro').is_hidden() and pg.locator('#rr-player-intro').inner_text()=='')
   check(tag+': only start button is visible on entry',pg.locator('#start button:visible').count()==1)
   if uid==304:pg.wait_for_timeout(550);pg.screenshot(path=str(OUT/'start-mobile-empty.png'))
   if uid==101:
    pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');pg.locator('#pauseButton').click();m.expect(pg.locator('#pause')).to_be_visible();check('confirmed administrator retains management button in pause',pg.locator('#pause').get_by_role('button',name='Управление наборами',exact=True).is_visible())
   c.close()
  authored='Разложите фильмы по годам выхода. **Смотрите на подписи столов** — правильный ответ только один.'
  m.command('saveContent',catalogId='entry-test',content={'internalNote':'PRIVATE INTERNAL','intro':{'text':authored},'success':{'text':'Спасибо за игру!'},'article':{'mode':'hidden','text':'PRIVATE ANSWERS'}})
  for uid,mobile in [(305,False),(306,True)]:
   pg,c=page(uid,mobile);tag='authored'+('-mobile' if mobile else '-desktop');clean(pg,tag)
   m.expect(pg.locator('#rr-player-intro')).to_contain_text('Разложите фильмы по годам выхода.')
   check(tag+': configured formatting in main description',pg.locator('#rr-player-intro strong').inner_text()=='Смотрите на подписи столов')
   check(tag+': intro is between h1 and cassette count',pg.evaluate("(()=>{const a=document.querySelector('#start h1').getBoundingClientRect(),b=document.querySelector('#rr-player-intro').getBoundingClientRect(),c=document.querySelector('.rr-collection-count').getBoundingClientRect();return a.bottom<=b.top && b.bottom<=c.top;})()"))
   check(tag+': no private material exposed','PRIVATE' not in pg.locator('body').inner_text())
   if mobile:
    check('mobile title is below Telegram safe area',pg.locator('#start .start-card').bounding_box()['y']>=92)
    pg.wait_for_timeout(550);pg.screenshot(path=str(OUT/'start-mobile-authored.png'))
   else:
    pg.wait_for_timeout(550);pg.screenshot(path=str(OUT/'start-desktop-authored.png'))
    pg.locator('#startButton').click();pg.wait_for_function('window.RRContest.running===true');pg.evaluate('window.__gameTest.wrong()')
    m.expect(pg.locator('#toast')).to_have_text('Неправильно. Точность снижена.')
    check('years/categories use neutral wrong-table feedback', 'режисс' not in pg.locator('#toast').inner_text().lower())
    check('wrong placement still applies minus 75',pg.locator('#scoreValue').inner_text()=='−75 оч.' or '-75' in pg.locator('#scoreValue').inner_text())
    check('wrong placement still reduces accuracy',pg.locator('#accuracyValue').inner_text()=='0%')
    pg.evaluate('window.__gameTest.solve()');m.expect(pg.locator('#win .rr-score')).to_contain_text('1125 очков',timeout=15000)
    m.expect(pg.locator('#win .rr-score')).to_contain_text('92%')
    check('server confirms unchanged score and accuracy after finish')
    pg.locator('#win').get_by_role('button',name='Поделиться этой игрой',exact=True).click()
    check('sharing stays on final and points to exact set','release_entry-test' in pg.evaluate('window.__opened'))
    check('final ranking button remains',pg.locator('#win').get_by_role('button',name='Таблица результатов',exact=True).is_visible())
   c.close()
  # Activating a contest does not repopulate the entry with automatic technical text.
  m.command('activate',releaseId='entry-test')
  pg,c=page(307,True);clean(pg,'active-contest');c.close()
  m.api('start',{'releaseId':'entry-test','requestId':'missing-local-progress'},uid=308)
  pg,c=page(308,False)
  check('genuine lost-progress recovery is retained',pg.locator('#rr-attempt-recovery').get_by_role('button',name='Завершить потерянную попытку без результата',exact=True).is_visible())
  check('lost-progress recovery does not restore lobby card or sharing',pg.locator('#rr-contest-intro').count()==0 and not pg.locator('#start').get_by_role('button',name='Поделиться этой игрой',exact=True).count())
  c.close();check('no uncaught browser errors',not errors);browser.close()
finally:
 proc.terminate();proc.wait(timeout=5)
 (OUT/'results.json').write_text(json.dumps({'passed':len(results),'checks':results,'uncaughtErrors':errors,'scope':'Actual game, editorial renderer and services with local SQLite; synthetic Telegram identities, transport and browser storage. Not a native Telegram test.'},ensure_ascii=False,indent=2))
print('CLEAN START BROWSER CHECKS:',len(results),flush=True)
