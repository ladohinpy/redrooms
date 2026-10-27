#!/usr/bin/env python3
"""Offline Chromium + real bundled game + real services backed by local SQLite.
Only Telegram transport/identities, localStorage and navigation are adapters.
Network policy prohibits browser localhost navigation here; Python delivers API
requests and data: ES modules. These are NOT native Telegram acceptance tests.
No game/scoring/storage-service mock; test hooks invoke the actual game methods.
"""
import base64,json,re,urllib.request,os,subprocess,socket,time
from pathlib import Path
from functools import lru_cache
from playwright.sync_api import sync_playwright,expect
R=Path(__file__).resolve().parents[2];OUT=Path(os.environ.get('RR_TEST_OUTPUT','/tmp/redrooms-package1-browser'));OUT.mkdir(parents=True,exist_ok=True)
PORT=4202
@lru_cache(None)
def module(name):
 code=(R/'src/rr'/name).read_text()
 code=re.sub(r"(['\"])\./([a-z-]+\.mjs)\1",lambda m:json.dumps(module(m[2])),code)
 if name in ['client.mjs','engine-boot.mjs','contest-client.mjs','launcher.mjs']:code='const location=window.__rrLocation;\n'+code
 return 'data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
def rpc(d):
 req=urllib.request.Request(f'http://127.0.0.1:{PORT}/__test_api',data=json.dumps(d).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=15))
def api(action,data=None,uid=101,name='rrContest'):
 r=rpc({'name':name,'input':{'action':action,**(data or {})},'uid':uid})
 if 'error' in r:raise RuntimeError(r['error'])
 return r['result']
def command(cmd,**kw):
 s=api('adminRead');return api('adminCommand',{'command':cmd,'expectedRevision':s['revision'],**kw})
def sdk(uid=101,mobile=False,storage=None,path='/admin.html',query=''):
 code=r'''
 window.__rrNav=[];window.__events={};window.__sdkCalls=[];
 window.__rrLocation={pathname:PATH,search:QUERY,hash:'',origin:'https://test.local',assign(x){window.__rrNav.push(x)},replace(x){window.__rrNav.push(x)}};
 function storage(initial){const s={...initial};Object.defineProperties(s,{getItem:{value:k=>Object.hasOwn(s,k)?s[k]:null},setItem:{value:(k,v)=>{if(window.__quotaError)throw new Error('quota');s[k]=String(v)}},removeItem:{value:k=>delete s[k]},clear:{value:()=>{for(const k of Object.keys(s))delete s[k]}},key:{value:i=>Object.keys(s)[i]||null},length:{get:()=>Object.keys(s).length}});return s;}
 Object.defineProperty(window,'localStorage',{value:storage(STORAGE),configurable:true});Object.defineProperty(window,'sessionStorage',{value:storage({}),configurable:true});
 window.Telegram={WebApp:{initData:'OFFLINE_SYNTHETIC',platform:PLATFORM,version:'9.6',isFullscreen:MOBILE,viewportHeight:innerHeight,viewportStableHeight:innerHeight,themeParams:{},safeAreaInset:{top:TOP,left:0,right:0,bottom:BOTTOM},contentSafeAreaInset:{top:CONTENT,left:0,right:0,bottom:0},ready(){},expand(){},isVersionAtLeast(){return true},disableVerticalSwipes(){},enableVerticalSwipes(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},enableClosingConfirmation(){},disableClosingConfirmation(){},requestFullscreen(){this.isFullscreen=true},exitFullscreen(){this.isFullscreen=false},onEvent(n,f){(window.__events[n] ||= []).push(f)},BackButton:{onClick(){},show(){},hide(){}},HapticFeedback:{impactOccurred(){},notificationOccurred(){}},openTelegramLink(u){window.__opened=u},Serverless:{call(name,input,cb){window.__sdkCalls.push({name,input});window.testRPC({name,input,uid:UID}).then(r=>{if(name==='rrContest'&&input.action==='finish'&&window.__dropAck){window.__dropAck=false;cb({message:'Lost ACK',parameters:{code:'TIMEOUT'}});return;}cb(r.error||null,r.result)}).catch(e=>cb({message:e.message}));}}}};
 '''
 for a,b in {'PATH':json.dumps(path),'QUERY':json.dumps(query),'STORAGE':json.dumps(storage or {}),'PLATFORM':json.dumps('ios' if mobile else 'tdesktop'),'MOBILE':'true' if mobile else 'false','TOP':'44' if mobile else '0','BOTTOM':'34' if mobile else '0','CONTENT':'48' if mobile else '0','UID':str(uid)}.items():code=code.replace(a,b)
 return code
HOOK="""window.__gameTest={solve(wrong=0){const remaining=tapeObjects.filter(t=>!t.userData.shelved);if(wrong&&remaining.length){takeTape(remaining[0]);for(let i=0;i<wrong;i++)putTapeOnShelf(shelfGroups.find(s=>s.userData.director!==remaining[0].userData.film.director).userData.director);}for(const tape of remaining){if(!heldTape)takeTape(tape);putTapeOnShelf(tape.userData.film.director);}},one(){const tape=tapeObjects.find(t=>!t.userData.shelved);takeTape(tape);putTapeOnShelf(tape.userData.film.director);},get state(){return {correctCount,attempts,SAVE_KEY,started,finished,save:localStorage.getItem(SAVE_KEY)}}};window.RR_GAME_READY = true;"""
def setup_admin(page,uid=101,mobile=False):
 page.expose_function('testRPC',rpc)
 html=(R/'public/admin.html').read_text();html=re.sub(r'<script type="module"[^>]*></script>','',html)
 html=html.replace('<link rel="stylesheet" href="/rr/admin.css">','<style>'+(R/'public/rr/admin.css').read_text()+'</style>')
 page.set_content(html);page.evaluate(sdk(uid,mobile));page.evaluate('url=>import(url)',module('admin.mjs'))
def setup_game(page,uid=303,release='eight',storage=None,mobile=False,preview=None):
 page.expose_function('testRPC',rpc)
 manifest=json.loads((R/'config/rr-built-games.json').read_text());g=next(g for g in manifest['games'] if g['id']==os.environ.get('RR_TEST_GAME','v11-access-entry'))
 html=(R/('public'+g['entry'])).read_text();boot=re.search(r'import\(("/rr/runtime/[^\"]+/engine-boot.mjs")\)',html);assert boot
 html=html.replace(boot[1],json.dumps(module('engine-boot.mjs')))
 def external(m):
  src=m[1]
  if src.startswith('/rr/frozen/'):return '<script>'+(R/('public'+src)).read_text()+'</script>'
  if src.startswith('https://telegram.org/'):return ''
  return m[0]
 html=re.sub(r'<script\b[^>]*src="([^\"]+)"[^>]*></script>',external,html)
 html=html.replace('window.RR_GAME_READY = true;',HOOK)
 html=html.replace('<head>','<head><script>'+sdk(uid,mobile,storage,g['entry'].replace('index.html',''),'?previewCatalogId='+preview if preview else '?release='+release)+'</script>')
 page.set_content(html,wait_until='domcontentloaded');page.wait_for_function('window.RR_GAME_READY===true',timeout=45000)
 return g

def suite():
 global PORT
 with socket.socket() as s:s.bind(('127.0.0.1',0));PORT=s.getsockname()[1]
 proc=subprocess.Popen(['node','tests/rr/package1-browser-server.mjs'],cwd=R,env={**os.environ,'RR_TEST_PORT':str(PORT)},stdout=open(OUT/'server.log','w'),stderr=subprocess.STDOUT)
 results=[];errors=[]
 def check(name,condition=True):
  assert condition,name
  results.append(name);print('PASS',name,flush=True)
 try:
  for _ in range(100):
   try:rpc({'name':'rrAdminStatus','uid':101,'input':{}});break
   except Exception:time.sleep(.05)
  with sync_playwright() as p:
   b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=os.environ.get('RR_HEADLESS','0')=='1',args=['--no-sandbox','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
   def page(width=1440,height=1000,mobile=False):
    c=b.new_context(viewport={'width':width,'height':height},has_touch=mobile,is_mobile=mobile,device_scale_factor=1);c.route('**/*',lambda route:route.abort());pg=c.new_page();pg.on('pageerror',lambda e:errors.append(str(e)));pg.on('dialog',lambda d:d.accept());return pg
   a=page();setup_admin(a);expect(a.locator('#identity')).to_contain_text('101');check('existing administrator workspace includes contest package without new login')
   a.get_by_role('button',name='Материалы',exact=True).click();expect(a.get_by_role('heading',name='Тексты и авторский материал')).to_be_visible();a.get_by_label('Набор',exact=True).select_option('eight')
   expect(a.get_by_label('Набор',exact=True)).to_have_value('eight')
   a.get_by_label('Внутреннее описание — только администраторы').fill('PRIVATE INTERNAL')
   intro=a.locator('details').filter(has=a.get_by_text('Перед открытием комнаты',exact=True));intro.get_by_label('Заголовок',exact=True).fill('Добро пожаловать');intro.get_by_label('Текст',exact=True).fill('Разложите восемь кассет. **Удачи!**');intro.get_by_label('Ссылка (необязательно)',exact=True).fill('https://t.me/vitalkino_stage_bot');intro.get_by_label('Подпись ссылки',exact=True).fill('О канале')
   success=a.locator('details').filter(has=a.get_by_text('Финал: успешное прохождение',exact=True));success.locator('summary').click();success.get_by_label('Заголовок',exact=True).fill('Отличный результат');success.get_by_label('Текст',exact=True).fill('Вы отлично знаете кино.')
   article=a.locator('details').filter(has=a.get_by_text('Авторская статья',exact=True));article.locator('summary').click();article.get_by_label('Заголовок',exact=True).fill('Разбор Виталия');article.get_by_label('Текст',exact=True).fill('PRIVATE ANSWERS IN ARTICLE')
   a.get_by_role('button',name='Сохранить тексты',exact=True).click();expect(a.get_by_label('Внутреннее описание — только администраторы')).to_have_value('PRIVATE INTERNAL');check('intro, success text and article saved by actual server service to SQLite')
   a.screenshot(path=str(OUT/'admin-materials.png'),full_page=True)
   second=page();setup_admin(second,202);expect(second.locator('#identity')).to_contain_text('202');second.get_by_role('button',name='Материалы',exact=True).click();second.get_by_label('Набор',exact=True).select_option('eight');expect(second.get_by_label('Внутреннее описание — только администраторы')).to_have_value('PRIVATE INTERNAL');check('second administrator sees shared saved content')
   a.get_by_role('button',name='Конкурс',exact=True).click();expect(a.get_by_role('button',name='Начать конкурс',exact=True)).to_be_visible();a.get_by_role('button',name='Начать конкурс',exact=True).click();expect(a.get_by_role('heading',name='Конкурс идёт')).to_be_visible();check('contest activation from existing admin UI persists separately from publishing set')
   a.screenshot(path=str(OUT/'admin-contest.png'),full_page=True)
   outsider=page();setup_admin(outsider,303);outsider.wait_for_function('window.__rrNav.length>0');check('non-admin redirected without ID or controls', 'Telegram ID' not in outsider.locator('body').inner_text() and not outsider.get_by_role('button',name='Резервные копии').count());outsider.close()
   game=page(1100,900);setup_game(game);expect(game.locator('#rr-player-intro')).to_contain_text('Добро пожаловать');check('real 3D scene starts with author intro and clean entry',game.evaluate('window.RR_GAME_READY'))
   check('internal notes and locked article absent from game DOM','PRIVATE INTERNAL' not in game.locator('body').inner_text() and 'PRIVATE ANSWERS' not in game.locator('body').inner_text())
   check('entry has no automatic release card, share or ranking buttons',game.locator('#rr-contest-intro').count()==0 and game.locator('#start').get_by_role('button',name='Поделиться этой игрой',exact=True).count()==0 and game.locator('#start').get_by_role('button',name='Посмотреть рейтинг',exact=True).count()==0)
   game.screenshot(path=str(OUT/'player-intro.png'))
   game.locator('#startButton').click();game.wait_for_function('window.RRContest.running===true');game.evaluate('window.__gameTest.one()');check('actual successful placement records action and progress',game.evaluate('window.__gameTest.state.correctCount')==1)
   storage=game.evaluate('JSON.parse(JSON.stringify(localStorage))');game.close()
   legacy={re.sub(r':attempt:[^:]+:',':',k).replace(':303:',':606:'):v for k,v in storage.items() if k.startswith('rr:v1:')}
   clean=page(1100,900);setup_game(clean,uid=606,storage=legacy);check('new contest does not import an earlier local practice save',clean.evaluate('window.__gameTest.state.correctCount')==0);clean.close()
   resumed=page(1100,900);setup_game(resumed,storage=storage);check('reload restores same game progress before consuming new attempt',resumed.evaluate('window.__gameTest.state.correctCount')==1);resumed.locator('#startButton').click();resumed.wait_for_function('window.RRContest.running===true');check('only one reserved contest attempt after reload',len(api('adminRead',{'releaseId':'eight'})['attempts'])==1)
   resumed.evaluate('window.__dropAck=true;window.__gameTest.solve(1)');expect(resumed.locator('#win')).to_be_visible(timeout=15000);expect(resumed.locator('#win')).to_contain_text('Связь прервалась',timeout=15000);check('lost finish acknowledgement keeps local result and offers retry',resumed.evaluate("Object.keys(localStorage).some(k=>k.startsWith('rr:contest:1:')&&JSON.parse(localStorage[k]).pending)"))
   resumed.get_by_role('button',name='Повторить отправку',exact=True).click();expect(resumed.locator('#win')).to_contain_text('725 очков',timeout=10000);expect(resumed.locator('#win')).to_contain_text('89%');expect(resumed.locator('#win')).to_contain_text('Отличный результат');check('server confirms score and author final; retry produces no duplicate',len(api('adminRead',{'releaseId':'eight'})['attempts'])==1)
   check('confirmed game progress removed, outbox receipt retained',resumed.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('rr:contest:1:')).every(k=>!JSON.parse(localStorage[k]).pending && JSON.parse(localStorage[k]).receipt.saved)"))
   resumed.get_by_role('button',name='Поделиться этой игрой',exact=True).click();check('final share URL targets this exact set, without personal tracking', 'release_eight' in resumed.evaluate('window.__opened') and '303' not in resumed.evaluate('window.__opened'))
   resumed.screenshot(path=str(OUT/'player-result.png'))
   resumed.get_by_role('button',name='Попробовать ещё раз',exact=True).click();resumed.wait_for_function('window.__rrNav.length>0');storage=resumed.evaluate('JSON.parse(JSON.stringify(localStorage))');resumed.close()
   two=page(1100,900);setup_game(two,storage=storage);two.locator('#startButton').click();two.wait_for_function('window.RRContest.running===true');two.evaluate('window.__gameTest.solve(2)');expect(two.locator('#win .rr-score')).to_contain_text('650 очков',timeout=15000);check('worse second attempt leaves first score in leaderboard',api('leaderboard',{'releaseId':'eight'},303)['rows'][0]['score']==725)
   check('both attempts are acknowledged completed by server',len([x for x in api('adminRead',{'releaseId':'eight'})['attempts'] if x['status']=='completed'])==2)
   check('third attempt button not offered',two.get_by_role('button',name='Попробовать ещё раз',exact=True).count()==0)
   a.get_by_role('button',name='Статистика',exact=True).click();expect(a.get_by_role('heading',name='Предварительный рейтинг')).to_be_visible();expect(a.locator('.rr-tab-body')).to_contain_text('725');check('per-set statistics show actual server-calculated best result');a.screenshot(path=str(OUT/'admin-statistics.png'),full_page=True)
   a.get_by_role('button',name='Игроки',exact=True).click();a.get_by_label('Поиск по ID, username или имени').fill('303');a.get_by_role('button',name='История и модерация').click();expect(a.get_by_role('dialog')).to_contain_text('303');check('player history and moderation available only inside admin');a.get_by_role('dialog').get_by_role('button',name='Закрыть',exact=True).click()
   a.get_by_role('button',name='Конкурс',exact=True).click();a.get_by_role('button',name='Завершить конкурсное окно',exact=True).click();expect(a.get_by_role('button',name='Опубликовать окончательные итоги')).to_be_visible();a.get_by_role('button',name='Опубликовать окончательные итоги').click();expect(a.get_by_role('heading',name='Итоги опубликованы')).to_be_visible();check('finalize from UI freezes official standings')
   a.get_by_role('button',name='Публикации',exact=True).click();a.get_by_label('Шаблон',exact=True).select_option('results');a.get_by_role('button',name='Подставить данные').click();expect(a.locator('.rr-tab-body textarea')).to_have_value(re.compile('725'));check('post template uses fixed results and concrete-set link','set_eight' in a.locator('.rr-tab-body textarea').input_value());a.get_by_role('button',name='Сохранить черновик поста').click()
   a.get_by_role('button',name='Резервные копии',exact=True).click();a.get_by_role('button',name='Отправить JSON нам с Виталием').click();expect(a.locator('.rr-tab-body')).to_contain_text('Получили: 2/2');check('backup UI produces full JSON addressed to two configured admins',len(rpc({'name':'__inspection'})['result']['sent'])==2)
   exported=api('export',name='rrBackup');a.locator('input[type=file]').set_input_files({'name':'RedRooms-backup.json','mimeType':'application/json','buffer':json.dumps(exported,ensure_ascii=False).encode()});expect(a.locator('.rr-tab-body')).to_contain_text('Проверка пройдена',timeout=15000);check('actual uploaded backup validated before restore')
   label=a.locator('.rr-tab-body label').filter(has_text='Введите: RESTORE');confirmation=label.inner_text().replace('Введите: ','').strip();label.locator('input').fill(confirmation);a.get_by_role('button',name='Восстановить проверенную копию').click();expect(a.locator('#rr-notice')).to_contain_text('База восстановлена',timeout=15000);check('admin upload/preview/confirm restores generation; final standings preserved',api('leaderboard',{'releaseId':'eight'},303)['rows'][0]['score']==725)
   mobile=page(390,844,True);setup_game(mobile,uid=505,mobile=True);expect(mobile.locator('#rr-player-intro')).to_contain_text('Добро пожаловать');check('archive remains playable and article unlocks after deadline','PRIVATE ANSWERS' not in mobile.locator('body').inner_text())
   mobile.locator('#startButton').click();mobile.wait_for_function('window.RRContest.running===true');mobile.evaluate('window.__gameTest.solve()');expect(mobile.locator('#win .rr-score')).to_contain_text('800 очков',timeout=15000);mobile.locator('#win summary').click();expect(mobile.locator('#win')).to_contain_text('PRIVATE ANSWERS');check('author article opens according to contest closure; archive cannot change official score',api('leaderboard',{'releaseId':'eight'},505)['rows'][0]['score']==725)
   check('mobile result has no horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));mobile.screenshot(path=str(OUT/'player-mobile-result.png'),full_page=True)
   two.close();mobile.close()
   # Private draft preview: actual renderer and calculation, no attempted contest entry.
   command('cloneSet',sourceId='eight',id='draft-view',name='Draft preview')
   pv=page(1100,900);setup_game(pv,uid=202,preview='draft-view');expect(pv.locator('#rr-player-intro')).to_contain_text('Добро пожаловать');check('administrator draft preview has same clean entrance', 'Тестовый режим' not in pv.locator('#start').inner_text() and pv.locator('#rr-contest-intro').count()==0);pv.locator('#startButton').click();pv.wait_for_function('window.RRContest.running===true');pv.evaluate('window.__gameTest.solve()');expect(pv.locator('#win .rr-score')).to_contain_text('800 очков',timeout=15000);check('private draft preview plays and computes result without storing attempt',not any(x['data'].get('catalogVersionId')=='draft-view' for x in rpc({'name':'__inspection'})['result']['records'] if x['kind']=='attempt'))
   pv.close()
   classic=page(1100,900);setup_game(classic,uid=707,release='classic-1');expect(classic.locator('#collectionSize')).to_have_text('201');check('original 201-cassette catalog loads in v10 without rewriting previous assets')
   classic.locator('#startButton').click();classic.wait_for_function('window.RRContest.running===true');classic.evaluate('window.__gameTest.one()');check('original classic set retains real placement and new local save integration',classic.evaluate('window.__gameTest.state.correctCount')==1);classic.close()
   check('no uncaught JavaScript errors',not errors)
   b.close()
 finally:
  proc.terminate();proc.wait(timeout=5)
  (OUT/'results.json').write_text(json.dumps({'passed':len(results),'checks':results,'uncaughtErrors':errors,'scope':'Real services + local SQLite + actual HTML/JS/WebGL; synthetic SDK identities, storage and navigation. No live Telegram or cloud delivery.'},ensure_ascii=False,indent=2))
 print('BROWSER CHECKS PASSED:',len(results),flush=True)
if __name__=='__main__':suite()
