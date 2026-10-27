import {downloadFullBackup} from './admin-contest.mjs';
import { el, call, notify, navigate, saveFile, copy, telegram, adminChrome, launchFailure, navigationWait, configureViewport, authorizeEditor } from './client.mjs';
import { clone, normalizeCatalog, catalogWarnings, playableCatalog, totals, LIMITS } from './domain.mjs';
import { importCatalog, exportCSV } from './import.mjs';

window.RR_MODULE_STARTED=true;
const root = document.getElementById('app');
let model, identity, tab = 'overview', selectedId, working, workingName, dirty = false, busy = false;
let search = '', statusFilter = '', directorFilter = '', page = 0;
const statusNames = {pending:'На проверке',approved:'Одобрен',excluded:'Исключён',draft:'Черновик',published:'Опубликован',archived:'Архив'};
const button = (text, onclick, cls = '', disabled = false) => el('button', { type:'button', text, onclick, class: cls, disabled });
const field = (name, node) => el('label', {}, el('span', { text: name }), node);
const input = (value, oninput, props = {}) => el('input', { value, oninput: e => oninput(e.target.value), ...props });
function select(options, value, onChange, props = {}) {
  const n = el('select', { onchange: e => onChange(e.target.value), ...props });
  for (const [v,t] of options) n.append(el('option', { value:v, text:t })); n.value = value ?? ''; return n;
}
function message(error) { notify(error.message || String(error), true); }
function mark() { dirty = true; const n = document.getElementById('dirty-indicator'); if(n) n.textContent = 'Есть несохранённые изменения — сохраните черновик.'; }
function dropAllowed() { return !dirty || confirm('Есть несохранённые изменения. Отбросить их?'); }
function chooseCatalog(cid) {
  selectedId = cid; const c = model.state.catalog_versions.find(c => c.id === cid);
  working = c ? clone(c.catalog) : null; workingName = c?.name || ''; dirty = false; page = 0; render();
}
function selected() { return model.state.catalog_versions.find(c => c.id === selectedId); }
function shell(content) {
  root.replaceChildren(el('nav', {'aria-label':'Разделы'}, ...[['overview','Обзор'],['catalogs','Каталоги'],['releases','Релизы'],['audit','История']].map(([key,title]) => button(title,() => {tab=key;render();},tab===key?'active':''))), content);
  root.setAttribute('aria-busy',String(busy));
}
async function command(action, data, text = 'Изменения сохранены.') {
  if(busy) return false; busy = true;
  // Prevent a second click while the server is doing the atomic update.
  root.querySelectorAll('button,input,select,textarea').forEach(n => n.disabled = true);
  try {
    model = await call('rrAdminCommand', { expectedRevision:model.revision, action, input:data });
    notify(text); return true;
  } catch(e) { message(e); return false; }
  finally { busy = false; render(); }
}
async function refresh() {
  if(!dropAllowed() || busy) return;
  try { model = await call('rrAdminRead'); if(selectedId) chooseCatalog(selectedId); else render(); notify('Данные обновлены.'); }
  catch(e) { message(e); }
}
function dialog(title, fields, submitText, onsubmit) {
  const d = el('dialog'), form = el('form', {}), controls = {};
  form.append(el('h2',{text:title}));
  for(const f of fields) {
    const n = f.options ? select(f.options,f.value,()=>{}) : el('input',{value:f.value || '',required:f.required!==false,maxLength:f.max || 100,placeholder:f.placeholder || ''});
    n.name=f.name; controls[f.name]=n; form.append(field(f.label,n));
  }
  form.append(el('div',{class:'actions'},el('button',{type:'submit',text:submitText,class:'primary'}),button('Отмена',()=>d.close())));
  form.addEventListener('submit',async e=>{e.preventDefault(); const data=Object.fromEntries(Object.entries(controls).map(([k,n])=>[k,n.value])); d.close(); await onsubmit(data);});
  d.append(form); d.addEventListener('close',()=>d.remove()); document.body.append(d); d.showModal();
}
function render() {
  if(!model) return;
  const content = tab==='catalogs'?catalogs():tab==='releases'?releases():tab==='audit'?audit():overview(); shell(content);
}
function overview() {
  const s=model.state, r=s.game_releases.find(r=>r.id===s.app_settings.defaultReleaseId);
  return el('div',{},
    el('section',{class:'panel'},el('div',{class:'row end'},el('h2',{text:'Сейчас для подписчиков'}),el('span',{class:'badge live',text:'ОСНОВНОЙ РЕЛИЗ'})),
      el('h3',{text:r?.name||'Не выбран'}),el('p',{class:'muted',text:`${r?.id||'—'} · игра ${r?.gameVersionId||'—'} · каталог ${r?.catalogVersionId||'—'}`}),
      el('p',{class:'lead',text:'Обычный запуск открывает основной релиз. Публикация коллекции сама по себе ничего не переключает.'}),
      el('div',{class:'actions'},button('Запустить основную игру',()=>navigate('/',{rr_default:1}),'primary'),button('Управлять релизами',()=>{tab='releases';render();}),button('Обновить данные',refresh))),
    el('section',{class:'panel grid three'},...[['Каталогов',s.catalog_versions.length],['Релизов',s.game_releases.length],['Версия данных',model.revision]].map(([l,v])=>el('div',{},el('div',{class:'kpi',text:v}),el('div',{class:'kpi-label',text:l})))),
    el('section',{class:'panel'},el('h3',{text:'Рабочий порядок'}),el('p',{text:'Создать копию каталога → загрузить или отредактировать фильмы → проверить → сохранить → опубликовать каталог → создать и проверить релиз → опубликовать → сделать основным.'}),
      el('p',{class:'muted',text:'У обоих администраторов одинаковые права. Изменения сохраняются явно, без автосохранения. При конфликте чужие правки не перезаписываются.'}),
      el('div',{class:'actions'},button('Каталоги',()=>{tab='catalogs';render();}),button('Экспорт резервной копии',()=>downloadFullBackup()))));
}
function newCatalog(from) {
  if(!dropAllowed()) return;
  dialog(from?'Копия каталога':'Новый каталог',[
    {name:'id',label:'ID версии (латиница, цифры, дефис)',placeholder:'directors-2'},
    {name:'name',label:'Название версии',value:from?`${from.name} — копия`:''}], 'Создать', async data=>{
    const ok=await command(from?'cloneCatalog':'createCatalog',from?{...data,sourceId:from.id}:{...data,catalog:{schemaVersion:1,id:data.id,name:data.name,directors:[]}});
    if(ok) chooseCatalog(data.id);
  });
}
async function saveDraft() {
  try { const catalog=normalizeCatalog(working); const cid=selectedId; if(await command('saveCatalog',{id:cid,name:workingName,catalog})) chooseCatalog(cid); }
  catch(e){message(e);}
}
async function publishCatalog() {
  if(dirty) { notify('Сначала сохраните черновик. Публикация использует только сохранённые данные.',true); return; }
  try { playableCatalog(working); } catch(e){message(e);return;}
  if(!confirm('Зафиксировать этот каталог? После публикации правки возможны только в новой копии. Основная игра пока не изменится.')) return;
  const cid=selectedId; if(await command('publishCatalog',{id:cid},'Каталог опубликован. Теперь создайте релиз.')) chooseCatalog(cid);
}
function catalogs() {
  const options=model.state.catalog_versions.map(c=>[c.id,`${c.name} · ${statusNames[c.status]}`]);
  if(!selectedId&&options.length){selectedId=options[0][0];working=clone(selected().catalog);workingName=selected().name;}
  const c=selected(), readonly=c?.status!=='draft';
  const container=el('div',{},el('section',{class:'panel'},el('h2',{text:'Коллекции фильмов'}),
    field('Версия каталога',select(options,selectedId,value=>{if(dropAllowed())chooseCatalog(value);else render();})),
    el('div',{class:'actions'},button('Новый каталог',()=>newCatalog()),button('Создать копию',()=>newCatalog(c),'',!c),button('Обновить с сервера',refresh))));
  if(!working)return container;
  const count=totals(working);
  container.append(el('section',{class:'panel'},
    el('div',{class:'row end'},el('h3',{text:readonly?'Опубликованная коллекция':'Редактор черновика'}),el('span',{class:'badge',text:`${count.films} фильмов · ${count.directors} режиссёров`})),
    el('p',{class:'muted',text:readonly?'Содержимое этой версии зафиксировано. Для изменений нажмите «Создать копию».':'Импортированные и новые фильмы попадают на проверку. Включите нужных режиссёров; каждый фильм одобрите или исключите.'}),
    el('div',{class:'grid'},field('Название версии',input(workingName,v=>{workingName=v;mark();},{disabled:readonly,maxLength:100})),field('Название набора в игре',input(working.name,v=>{working.name=v;mark();},{disabled:readonly,maxLength:100}))),
    el('div',{id:'dirty-indicator',text:dirty?'Есть несохранённые изменения — сохраните черновик.':''}),
    el('div',{class:'actions'},button('Сохранить черновик',saveDraft,'primary',readonly),button('Опубликовать каталог',publishCatalog,'',readonly),button('Экспорт JSON',()=>saveFile(`${c.id}.json`,JSON.stringify(working,null,2))),button('Экспорт CSV',()=>{try{saveFile(`${c.id}.csv`,exportCSV(working),'text/csv;charset=utf-8');}catch(e){message(e);}})),
    !readonly&&importBox(),
    el('details',{},el('summary',{text:`Режиссёры (${working.directors.length})`}),...working.directors.map(d=>directorCard(d,readonly)),
      !readonly&&button('Добавить режиссёра',()=>dialog('Новый режиссёр',[{name:'id',label:'ID',max:64},{name:'name',label:'Имя',max:64}],'Добавить',async data=>{
        try{const next=clone(working);next.directors.push({...data,enabled:true,films:[]});working=normalizeCatalog(next);mark();render();}catch(e){message(e);}
      }))),
    el('div',{class:'spacer'},...catalogWarnings(working).map(t=>el('p',{class:'error-text',text:t})))));
  container.append(filmList(readonly));return container;
}
function directorCard(d,readonly) {
  return el('div',{class:'record'},el('div',{class:'grid'},field('Имя',input(d.name,v=>{d.name=v;mark();},{disabled:readonly,maxLength:64})),
    el('div',{},el('p',{class:'muted',text:`ID: ${d.id} · ${d.films.length} фильмов`}),el('label',{class:'checkbox'},el('input',{type:'checkbox',checked:d.enabled,disabled:readonly,onchange:e=>{d.enabled=e.target.checked;mark();}}),'Включён в игру'))),
    !readonly&&button('Удалить режиссёра',()=>{if(d.films.length){notify('Сначала перенесите или удалите фильмы этого режиссёра.',true);return;}if(confirm(`Удалить ${d.name}?`)){working.directors=working.directors.filter(x=>x!==d);mark();render();}},'danger mini'));
}
function importBox() {
  return el('div',{class:'import-box'},el('strong',{text:'Загрузить JSON / CSV в этот черновик'}),el('p',{class:'muted',text:'UTF-8, до 1 МиБ. Загрузка заменит только локальное содержимое редактора. На сервере изменения появятся после сохранения. Все импортированные фильмы потребуют модерации.'}),
    el('input',{type:'file',accept:'.json,.csv,.tsv,application/json,text/csv',onchange:async e=>{
      const file=e.target.files[0];if(!file)return;
      try{
        if(file.size>LIMITS.fileBytes)throw new Error('Файл превышает 1 МиБ.');
        const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
        const next=importCatalog(text,/\.json$/i.test(file.name)?'json':'csv',{id:working.id,name:working.name});
        if(!confirm(`Заменить локальный набор? В файле ${totals(next).films} фильмов. Сохранение и публикация выполняются отдельно.`))return;
        working=next;page=0;mark();render();notify('Файл проверен. Проведите модерацию и сохраните черновик.');
      }catch(error){message(error);}finally{e.target.value='';}
    }}));
}
function filteredFilms() {
  const q=search.trim().toLocaleLowerCase('ru');return working.directors.flatMap(d=>d.films.map(f=>({d,f}))).filter(({d,f})=>(!directorFilter||d.id===directorFilter)&&(!statusFilter||f.status===statusFilter)&&(!q||`${f.title} ${f.original} ${f.id} ${f.year} ${d.name}`.toLocaleLowerCase('ru').includes(q)));
}
function filmList(readonly) {
  if(directorFilter&&!working.directors.some(d=>d.id===directorFilter))directorFilter='';
  const films=filteredFilms(),size=25; page=Math.min(page,Math.max(0,Math.ceil(films.length/size)-1));
  const panel=el('section',{class:'panel'},el('div',{class:'row end'},el('h3',{text:'Фильмы и модерация'}),!readonly&&button('Добавить фильм',()=>addFilm(),'primary',!working.directors.length)),
    el('div',{class:'filters'},field('Поиск',input(search,v=>{search=v;page=0;refreshFilmList();},{type:'search',id:'film-search',placeholder:'Название, год, режиссёр…'})),
      field('Статус',select([['','Все статусы'],...['pending','approved','excluded'].map(s=>[s,statusNames[s]])],statusFilter,v=>{statusFilter=v;page=0;render();})),
      field('Режиссёр',select([['','Все режиссёры'],...working.directors.map(d=>[d.id,d.name])],directorFilter,v=>{directorFilter=v;page=0;render();}))),
    !readonly&&el('div',{class:'actions'},button('Одобрить найденные',()=>bulk('approved')),button('Исключить найденные',()=>bulk('excluded'))),
    el('div',{id:'film-results'},el('p',{class:'muted',text:`Найдено: ${films.length}. Страница ${page+1} из ${Math.max(1,Math.ceil(films.length/size))}.`}),...films.slice(page*size,(page+1)*size).map(({d,f})=>filmCard(d,f,readonly)),
      el('div',{class:'actions'},button('Назад',()=>{page--;render();},'',page===0),button('Дальше',()=>{page++;render();},'',(page+1)*size>=films.length))));
  return panel;
}
function refreshFilmList() {
  // Keep the search input/focus; only replace results while typing.
  const replacement=filmList(selected().status!=='draft').querySelector('#film-results');document.getElementById('film-results')?.replaceWith(replacement);
}
function bulk(status) {
  const rows=filteredFilms();if(!rows.length)return;
  if(!confirm(`${statusNames[status]}: изменить статус всех найденных фильмов (${rows.length})? Изменение пока локальное.`))return;
  rows.forEach(({f})=>f.status=status);mark();render();
}
function filmCard(d,f,readonly) {
  return el('article',{class:'record'},el('div',{class:'record-top'},el('h4',{text:f.title}),el('span',{class:'badge',text:statusNames[f.status]})),
    el('div',{class:'film-fields'},field('Название',input(f.title,v=>{f.title=v;mark();},{disabled:readonly,maxLength:140})),field('Оригинальное название',input(f.original,v=>{f.original=v;mark();},{disabled:readonly,maxLength:140})),field('Год',input(f.year,v=>{f.year=v===''?null:Number(v);mark();},{disabled:readonly,type:'number',min:1800,max:2100}))),
    el('div',{class:'film-meta'},field('ID фильма',el('input',{value:f.id,readOnly:true})),field('Режиссёр',select(working.directors.map(d=>[d.id,d.name]),d.id,v=>{
      const dest=working.directors.find(x=>x.id===v);if(dest.films.length>=LIMITS.perDirector){notify('У режиссёра уже 300 фильмов.',true);render();return;}
      d.films=d.films.filter(x=>x!==f);dest.films.push(f);mark();render();
    },{disabled:readonly})),field('Модерация',select(['pending','approved','excluded'].map(s=>[s,statusNames[s]]),f.status,v=>{f.status=v;mark();render();},{disabled:readonly})),
      !readonly&&button('Удалить',()=>{if(confirm(`Удалить «${f.title}» из этого черновика?`)){d.films=d.films.filter(x=>x!==f);mark();render();}},'danger mini')));
}
function addFilm() {
  dialog('Новый фильм',[
    {name:'directorId',label:'Режиссёр',options:working.directors.map(d=>[d.id,d.name]),value:directorFilter||working.directors[0]?.id},
    {name:'id',label:'Уникальный ID',max:64},{name:'title',label:'Название',max:140},{name:'original',label:'Оригинальное название (необязательно)',max:140,required:false},{name:'year',label:'Год',max:4}],
    'Добавить на проверку',async data=>{try{const next=clone(working),d=next.directors.find(d=>d.id===data.directorId);d.films.push({id:data.id,title:data.title,original:data.original||data.title,year:Number(data.year),status:'pending'});working=normalizeCatalog(next);mark();render();}catch(e){message(e);}});
}
function preview(r) { if(!dropAllowed())return;navigate('/',{release:r.id}); }
async function share(r) {
  const web=`${location.origin}/?release=${encodeURIComponent(r.id)}`;
  const bot=identity?.botUsername;
  await copy(bot?`https://t.me/${bot}?startapp=release_${r.id}`:web);
  if(!bot)notify('Скопирован URL Mini App. Для открытия через бота используйте startapp=release_'+r.id+'.');
}
function releases() {
  const s=model.state;
  const panel=el('section',{class:'panel'},el('h2',{text:'Релизы и основная версия'}),el('p',{class:'lead',text:'Релиз — зафиксированная связка кода игры и опубликованного каталога. Виталий и Павел могут переключить её без Git и без перезагрузки текущих партий.'}),
    el('p',{class:'muted',text:'Новые механики сначала добавляет разработчик и загружает на сервер. Здесь нельзя загрузить исполняемый код или открыть произвольную Git-ветку.'}),
    el('div',{class:'actions'},button('Создать релиз',()=>{
      const cats=s.catalog_versions.filter(c=>c.status==='published');
      dialog('Новый релиз',[{name:'id',label:'ID релиза',max:64,placeholder:'classic-2'},{name:'name',label:'Название релиза'},
        {name:'gameVersionId',label:'Сборка игры',options:s.game_versions.map(g=>[g.id,`${g.name} (${g.id})`]),value:s.game_versions[0]?.id},
        {name:'catalogVersionId',label:'Опубликованный каталог',options:cats.map(c=>[c.id,c.name]),value:cats[0]?.id}],
        'Создать черновик',data=>command('createRelease',data));
    },'primary'),button('Обновить список сборок',()=>command('syncGames',{})),button('Обновить данные',refresh)),
    el('div',{class:'spacer'},...s.game_versions.map(g=>el('span',{class:'badge',text:`${g.id}${g.aliases.length?' / '+g.aliases.join(', '):''}`}))));
  const list=el('div',{},panel);
  for(const r of [...s.game_releases].reverse()){
    const main=s.app_settings.defaultReleaseId===r.id,gameDefault=s.app_settings.gameDefaults.some(d=>d.releaseId===r.id);
    list.append(el('article',{class:'panel'},el('div',{class:'record-top'},el('div',{},el('h3',{text:r.name}),el('code',{text:r.id})),el('span',{class:'badge '+(main?'live':''),text:main?'ОСНОВНОЙ':statusNames[r.status]})),
      el('p',{class:'muted',text:`Сборка: ${r.gameVersionId} · каталог: ${r.catalogVersionId} · ${r.visibility==='public'?'Публичный':'По ссылке'}${gameDefault?' · выбран для ?game':''}`}),
      el('div',{class:'actions'},button(r.status==='draft'?'Предпросмотр':'Запустить',()=>preview(r),'',r.status==='archived'),button('Скопировать ссылку',()=>share(r),'',r.status==='archived'),
        r.status==='draft'&&button('Опубликовать',()=>dialog('Публикация релиза',[{name:'visibility',label:'Доступ',options:[['public','Публичный'],['unlisted','По ссылке (не приватный)']],value:'public'}],'Опубликовать',data=>command('publishRelease',{id:r.id,...data},'Релиз опубликован. Основной запуск не изменён.')),'primary'),
        r.status==='published'&&button('Сделать основным',()=>{if(confirm(`Все новые обычные запуски будут открывать «${r.name}». Переключить?`))command('setDefault',{id:r.id},'Основной релиз переключён. Начатые партии не затронуты.');},'primary',main),
        r.status==='published'&&button('Выбрать для ?game',()=>command('setGameDefault',{id:r.id}),'',gameDefault),
        r.status!=='archived'&&button('В архив',()=>{if(confirm('Закрыть этот релиз для новых запусков по ссылке?'))command('archiveRelease',{id:r.id});},'danger',main||gameDefault),
        r.status==='archived'&&button('Вернуть в черновики',()=>command('restoreRelease',{id:r.id})))));
  }
  return list;
}
function audit() {
  return el('section',{class:'panel'},el('div',{class:'row end'},el('h2',{text:'История изменений'}),button('Экспорт резервной копии',()=>downloadFullBackup())),
    el('p',{class:'muted',text:'Последние 200 действий. Идентификаторы авторов берутся из проверенных Telegram-данных. Экспорт содержит каталоги, релизы и историю; автоматического восстановления всей базы в этой версии нет.'}),
    el('ul',{class:'audit'},...[...model.state.audit].reverse().map(a=>el('li',{},el('strong',{text:a.summary}),el('div',{class:'muted',text:`${a.at} · ${a.actor} · ${a.action} · ${a.target}`})))));
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
let starting=null;
async function start() {
 if(starting)return starting;
 root.hidden=true;identity=null;model=null;adminChrome();
 starting=(async()=>{try {
    const t=await telegram();configureViewport(t,'admin');
    const access=await authorizeEditor();identity=access.identity;model=access.model;
    adminChrome(identity,'Управление комнатой');render();root.hidden=false;
  }catch(e){
    identity=null;model=null;root.replaceChildren();adminChrome();
    if(['FORBIDDEN','AUTH_REQUIRED'].includes(e?.code)){try{navigate('/',{rr_default:1},true);await navigationWait();}catch{}}
    const box=el('section',{class:'panel'});root.replaceChildren(box);root.hidden=false;launchFailure(box,e,start);
  }finally{starting=null;}})();return starting;
}
function lockEditor(){identity=null;model=null;root.hidden=true;root.replaceChildren();adminChrome();}
addEventListener('rr-access-denied',lockEditor);addEventListener('pagehide',lockEditor);
addEventListener('pageshow',event=>{if(event.persisted)void start();});
start();
