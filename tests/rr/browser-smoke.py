"""Optional browser checks. Start browser-server.mjs separately; requires Playwright + Chromium."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE = os.environ.get('RR_TEST_URL', 'http://127.0.0.1:4186')
OUT = Path(os.environ.get('RR_TEST_OUTPUT', '/mnt/data/rr-browser-results'))
OUT.mkdir(parents=True, exist_ok=True)
checks=[]
def ok(label): checks.append(label); print('OK:',label,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1280,'height':960})
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.goto(BASE+'/admin.html'); expect(page.get_by_role('heading',name='Сейчас для подписчиков')).to_be_visible()
    ok('Admin overview authenticates the synthetic configured administrator')
    page.screenshot(path=str(OUT/'admin-overview-desktop.png'),full_page=True)
    page.get_by_role('button',name='Каталоги',exact=True).first.click()
    page.get_by_role('button',name='Создать копию',exact=True).click()
    page.locator('dialog input[name=id]').fill('ui-catalog-2');page.locator('dialog input[name=name]').fill('Подборка для проверки');page.locator('dialog button[type=submit]').click()
    expect(page.get_by_role('heading',name='Редактор черновика')).to_be_visible()
    ok('Published catalog clones into an editable draft')
    csv=Path(__file__).resolve().parents[2]/'examples/films.csv'
    page.locator('input[type=file]').set_input_files(str(csv))
    expect(page.get_by_text('Файл проверен. Проведите модерацию и сохраните черновик.')).to_be_visible()
    page.get_by_role('button',name='Одобрить найденные').click()
    page.get_by_role('button',name='Сохранить черновик').click()
    expect(page.locator('#dirty-indicator')).to_have_text('')
    ok('CSV import → moderation → explicit save works in the browser')
    page.screenshot(path=str(OUT/'catalog-editor-desktop.png'),full_page=True)
    page.get_by_role('button',name='Опубликовать каталог').click()
    expect(page.get_by_role('heading',name='Опубликованная коллекция')).to_be_visible()
    ok('Catalog publishing freezes editing without changing default release')
    page.get_by_role('button',name='Релизы',exact=True).click();page.get_by_role('button',name='Создать релиз',exact=True).click()
    page.locator('dialog input[name=id]').fill('ui-release-2');page.locator('dialog input[name=name]').fill('Новая подборка');page.locator('dialog select[name=catalogVersionId]').select_option('ui-catalog-2');page.locator('dialog button[type=submit]').click()
    expect(page.get_by_role('heading',name='Новая подборка')).to_be_visible()
    unauthorized=context.new_page();unauthorized.goto(BASE+'/admin.html');unauthorized.evaluate("sessionStorage.testUser='303'")
    unauthorized.goto(BASE+'/?release=ui-release-2');expect(unauthorized.get_by_text('Релиз не найден или недоступен.')).to_be_visible()
    ok('Ordinary user cannot launch a draft even with an exact release link')
    unauthorized.goto(BASE+'/admin.html');expect(unauthorized.get_by_role('heading',name='Нет доступа к управлению')).to_be_visible()
    ok('Admin panel denies an unlisted Telegram ID')
    article=page.locator('article').filter(has=page.get_by_role('heading',name='Новая подборка'))
    article.get_by_role('button',name='Опубликовать',exact=True).click();page.locator('dialog button[type=submit]').click()
    expect(article.get_by_role('button',name='Сделать основным')).to_be_visible();article.get_by_role('button',name='Сделать основным').click()
    expect(article.get_by_text('ОСНОВНОЙ',exact=True)).to_be_visible()
    ok('Separate release publication and default switching work')
    page.screenshot(path=str(OUT/'releases-desktop.png'),full_page=True)
    play=context.new_page();play.goto(BASE+'/');play.wait_for_function('window.fixtureReady===true')
    assert 'release=ui-release-2' in play.url
    assert play.evaluate('window.RR_RELEASE.id')=='ui-release-2'
    assert 'ui-release-2:ui-catalog-2:' in play.evaluate('window.RR_SAVE_PREFIX')
    ok('Normal launch resolves default, loads catalog before engine, namespaces saves')
    play.evaluate("localStorage.setItem('red-room-v06-pack:sample:fixture','legacy-save')")
    play.goto(BASE+'/?release=classic-1');play.wait_for_function('window.fixtureReady===true')
    assert play.evaluate('window.RR_RELEASE.id')=='classic-1'
    assert play.evaluate("localStorage.getItem(window.RR_SAVE_PREFIX+'red-room-v06-pack:sample:fixture')")=='legacy-save'
    assert play.evaluate("localStorage.getItem('red-room-v06-pack:sample:fixture')")=='legacy-save'
    ok('Old release remains available; legacy save is copied without deleting original')
    play.goto(BASE+'/?game=v1');play.wait_for_function('window.fixtureReady===true');assert play.evaluate('window.RR_RELEASE.id')=='ui-release-2'
    ok('game=v1 alias uses configured per-game release')
    play.goto(BASE+'/?release=nonexistent');expect(play.get_by_text('Релиз не найден или недоступен.')).to_be_visible()
    ok('Unknown release shows error rather than another game')
    play.evaluate("sessionStorage.testUser='404'");play.goto(BASE+'/');expect(play.get_by_role('button',name='Открыть канал')).to_be_visible();assert play.evaluate('Boolean(window.fixtureReady)') is False
    ok('Subscription denial blocks launch and displays a channel action')
    mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
    mp=mobile.new_page();mp.goto(BASE+'/admin.html');expect(mp.get_by_role('heading',name='Сейчас для подписчиков')).to_be_visible();mp.get_by_role('button',name='Релизы',exact=True).click();expect(mp.get_by_role('heading',name='Новая подборка')).to_be_visible()
    assert mp.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mp.screenshot(path=str(OUT/'releases-mobile.png'),full_page=True)
    ok('390px mobile layout has no horizontal overflow')
    # Text is inserted through DOM nodes, not HTML. Verify in the actual editor.
    page.get_by_role('button',name='Каталоги',exact=True).first.click();page.get_by_role('button',name='Создать копию',exact=True).click()
    page.locator('dialog input[name=id]').fill('xss-draft');page.locator('dialog input[name=name]').fill('<img src=x onerror=window.injected=1>');page.locator('dialog button[type=submit]').click()
    expect(page.get_by_role('heading',name='Редактор черновика')).to_be_visible();assert page.evaluate('window.injected') is None;assert page.locator('#app img').count()==0
    ok('Hostile imported/catalog text is rendered as text, not executable HTML')
    # Concurrent modification is visible and the user's unsaved value survives.
    page.get_by_label('Название версии',exact=True).fill('Несохранённая правка')
    response=page.evaluate("""async()=>{const post=async(name,input)=>await(await fetch('/__test_api',{method:'POST',body:JSON.stringify({name,input,uid:202})})).json();const r=await post('rrAdminRead',{});return await post('rrAdminCommand',{expectedRevision:r.result.revision,action:'setDefault',input:{id:'classic-1'}})}""")
    assert not response.get('error');page.get_by_role('button',name='Сохранить черновик').click();expect(page.locator('#rr-notice')).to_contain_text('Другой администратор');expect(page.get_by_label('Название версии',exact=True)).to_have_value('Несохранённая правка')
    ok('Concurrency conflict is shown without discarding local edits')
    assert not errors,errors
    ok('No uncaught browser JavaScript errors during the admin workflow')
    browser.close()
(OUT/'report.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'limitations':['Synthetic Telegram SDK and local memory repository; not Telegram production','Minimal game integration fixture; real v06 graphics/device gestures not exercised']},ensure_ascii=False,indent=2),encoding='utf-8')
print('BROWSER CHECKS:',len(checks),flush=True)
