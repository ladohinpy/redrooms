"""Offline DOM variant: no browser navigation/network; actual UI modules + local Node test service.
Start browser-server.mjs first. Python communicates only with its loopback test API.
"""
import base64,json,os,re,urllib.request
from functools import lru_cache
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(os.environ.get('RR_TEST_OUTPUT','/mnt/data/rr-browser-results'));OUT.mkdir(parents=True,exist_ok=True)
@lru_cache(None)
def module_url(name):
    code=(ROOT/'src/rr'/name).read_text()
    code=re.sub(r"(['\"])\./([a-z-]+\.mjs)\1",lambda m:json.dumps(module_url(m.group(2))),code)
    return 'data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
def rpc(payload):
    request=urllib.request.Request('http://127.0.0.1:4186/__test_api',data=json.dumps(payload).encode(),headers={'content-type':'application/json'})
    return json.loads(urllib.request.urlopen(request,timeout=5).read())
checks=[]
def ok(s):checks.append(s);print('OK:',s,flush=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=b.new_context(viewport={'width':1280,'height':960});page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
    def setup(page,uid):
        page.expose_function('rrTestCall',rpc)
        html=(ROOT/'public/admin.html').read_text()
        html=re.sub(r'<script type="module"[^>]*></script>','',html)
        html=html.replace('<link rel="stylesheet" href="/rr/admin.css">','<style>'+(ROOT/'public/rr/admin.css').read_text()+'</style>')
        page.set_content(html)
        page.evaluate('''uid=>{window.rrUid=uid;window.Telegram={WebApp:{initData:'OFFLINE_TEST_ONLY',ready(){},Serverless:{call(name,input,callback){window.rrTestCall({name,input,uid:window.rrUid}).then(r=>callback(r.error||null,r.result));}}}};}''',uid)
        page.evaluate('url=>import(url)',module_url('admin.mjs'))
    setup(page,101);expect(page.get_by_role('heading',name='Сейчас для подписчиков')).to_be_visible();ok('Administrator identity and overview render')
    page.screenshot(path=str(OUT/'admin-overview-desktop.png'),full_page=True)
    page.get_by_role('button',name='Каталоги',exact=True).first.click();page.get_by_role('button',name='Создать копию',exact=True).click()
    page.locator('dialog input[name=id]').fill('ui-catalog-2');page.locator('dialog input[name=name]').fill('Подборка для проверки');page.locator('dialog button[type=submit]').click()
    expect(page.get_by_role('heading',name='Редактор черновика')).to_be_visible();ok('Clone published catalog into draft')
    page.locator('input[type=file]').set_input_files(str(ROOT/'examples/films.csv'))
    expect(page.get_by_text('Файл проверен. Проведите модерацию и сохраните черновик.')).to_be_visible();ok('CSV file upload and parsing in actual editor')
    page.get_by_role('button',name='Одобрить найденные').click();page.get_by_role('button',name='Сохранить черновик').click();expect(page.locator('#dirty-indicator')).to_have_text('');ok('Bulk moderation and explicit save')
    page.screenshot(path=str(OUT/'catalog-editor-desktop.png'),full_page=True)
    page.get_by_role('button',name='Опубликовать каталог').click();expect(page.get_by_role('heading',name='Опубликованная коллекция')).to_be_visible();ok('Publish freezes catalog editing')
    page.get_by_role('button',name='Релизы',exact=True).click();page.get_by_role('button',name='Создать релиз',exact=True).click()
    page.locator('dialog input[name=id]').fill('ui-release-2');page.locator('dialog input[name=name]').fill('Новая подборка');page.locator('dialog select[name=catalogVersionId]').select_option('ui-catalog-2');page.locator('dialog button[type=submit]').click()
    expect(page.get_by_role('heading',name='Новая подборка')).to_be_visible();ok('Create draft release bound to code/catalog')
    article=page.locator('article').filter(has=page.get_by_role('heading',name='Новая подборка'))
    article.get_by_role('button',name='Опубликовать',exact=True).click();page.locator('dialog button[type=submit]').click()
    expect(article.get_by_role('button',name='Сделать основным')).to_be_visible();article.get_by_role('button',name='Сделать основным').click();expect(article.get_by_text('ОСНОВНОЙ',exact=True)).to_be_visible();ok('Separate publication and default switching')
    page.screenshot(path=str(OUT/'releases-desktop.png'),full_page=True)
    denied=context.new_page();setup(denied,303);expect(denied.get_by_role('heading',name='Нет доступа к управлению')).to_be_visible();ok('Unlisted user denied by actual admin UI')
    mc=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);mp=mc.new_page();setup(mp,202);expect(mp.get_by_role('heading',name='Сейчас для подписчиков')).to_be_visible();mp.get_by_role('button',name='Релизы',exact=True).click();expect(mp.get_by_role('heading',name='Новая подборка')).to_be_visible()
    assert mp.evaluate('document.documentElement.scrollWidth <= innerWidth');mp.screenshot(path=str(OUT/'releases-mobile.png'),full_page=True);ok('390px mobile layout without horizontal overflow')
    page.get_by_role('button',name='Каталоги',exact=True).first.click();page.get_by_role('button',name='Создать копию',exact=True).click();page.locator('dialog input[name=id]').fill('xss-draft');page.locator('dialog input[name=name]').fill('<img src=x onerror=window.injected=1>');page.locator('dialog button[type=submit]').click();expect(page.get_by_role('heading',name='Редактор черновика')).to_be_visible()
    assert page.evaluate('window.injected') is None;assert page.locator('#app img').count()==0;ok('Untrusted text does not become executable HTML')
    page.get_by_label('Название версии',exact=True).fill('Несохранённая правка')
    read=rpc({'name':'rrAdminRead','uid':202,'input':{}})['result'];write=rpc({'name':'rrAdminCommand','uid':202,'input':{'expectedRevision':read['revision'],'action':'setDefault','input':{'id':'classic-1'}}});assert 'error' not in write
    page.get_by_role('button',name='Сохранить черновик').click();expect(page.locator('#rr-notice')).to_contain_text('Другой администратор');expect(page.get_by_label('Название версии',exact=True)).to_have_value('Несохранённая правка');ok('CAS conflict leaves unsaved editor text intact')
    assert not errors,errors;ok('No uncaught browser JavaScript errors in this workflow')
    b.close()
(OUT/'report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'mode':'Offline Chromium DOM + loopback Node service','limitations':['Browser localhost navigation blocked by environment policy; no navigation/deeplink browser test claimed','Synthetic Telegram identities/SDK; memory repository, not Telegram cloud','Original 3D game not available as raw bytes; not visually exercised']},ensure_ascii=False,indent=2),encoding='utf-8')
print('OFFLINE DOM CHECKS:',len(checks),flush=True)
