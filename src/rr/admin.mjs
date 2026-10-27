import {mountAdminTools,extraHasChanges,cloneWholeSet,downloadFullBackup} from './admin-contest.mjs';
import {el,call,telegram,configureViewport,authorizeEditor,navigate,notify,saveFile,copy,stage,launchFailure,adminChrome,navigationWait} from './client.mjs';
import {catalogToRows,splitTitles,simpleCatalog,setLink,SIMPLE_VERSION} from './simple.mjs';
import {normalizeCatalog,LIMITS} from './domain.mjs';
window.RR_MODULE_STARTED=true;
const app=document.getElementById('app');
let identity={},model=null,selectedId=null,form=null,dirty=false,busy=false;
const names={published:'Опубликован',draft:'Черновик',archived:'В архиве'};
const button=(text,fn,cls='',disabled=false)=>el('button',{type:'button',text,class:cls,disabled,onclick:async()=>{if(busy)return;try{await fn();}catch(e){notify(e.message,true);}}});
const field=(caption,control)=>el('label',{},caption,control);
const input=(value,oninput,props={})=>el('input',{value,...props,oninput:e=>oninput(e.target.value)});
const current=()=>model?.state.catalog_versions.find(c=>c.id===selectedId);
const linked=()=>model?.state.game_releases.find(r=>r.catalogVersionId===selectedId && r.status==='published');
const freshId=()=>`set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
function mark(){dirty=true;document.getElementById('dirty')?.replaceChildren('Есть несохранённые изменения.');try{window.Telegram.WebApp.enableClosingConfirmation?.();}catch{}updateReview();}
function leave(){return !(dirty||extraHasChanges()) || confirm('Есть несохранённый текст. Перед выходом можно скачать его кнопкой «Скачать черновик». Продолжить без сохранения?');}
addEventListener('beforeunload',e=>{if(dirty||extraHasChanges()){e.preventDefault();e.returnValue='';}});
function choose(id){selectedId=id;const c=current();form=c?{id:c.id,name:c.name,tables:catalogToRows(c.catalog)}:null;dirty=false;try{window.Telegram.WebApp.disableClosingConfirmation?.();}catch{}render();}
function newSet(from){if(!leave())return;if(from){return cloneWholeSet(from,async id=>{selectedId=id;await fetchData();});}selectedId=null;form={id:freshId(),name:from?`${from.name} — копия`.slice(0,100):'',tables:from?catalogToRows(from.catalog):Array.from({length:4},()=>({name:'',titles:'',delimiter:'auto'}))};dirty=false;render();}
function setBusy(value){busy=value;app.classList.toggle('busy',value);for(const x of app.querySelectorAll('fieldset'))x.disabled=value;}
async function refresh(){if(!leave())return;await fetchData();}
async function fetchData(){setBusy(true);try{model=await call('rrAdminRead');const id=selectedId || model.state.catalog_versions[0]?.id;if(id)choose(id);else render();}finally{setBusy(false);}}
async function command(action,data){setBusy(true);try{const next=await call('rrAdminCommand',{expectedRevision:model.revision,action,input:data});model={...next,access:model.access};dirty=false;try{window.Telegram.WebApp.disableClosingConfirmation?.();}catch{}return true;}catch(e){notify(e.code==='CONFLICT'?e.message+'\nВаш текст остался в редакторе. Скачайте черновик перед обновлением.':e.message,true);return false;}finally{setBusy(false);}}
function payload(){const clean={id:form.id.trim(),name:form.name.trim(),tables:form.tables.map(r=>({...r}))};normalizeCatalog(simpleCatalog(clean,current()?.catalog,false));return clean;}
async function save(){const data=payload();if(await command('saveSimpleSet',data)){choose(data.id);notify('Черновик сохранён. Основной набор не изменился.');}}
async function publish(makeDefault){const data=payload();normalizeCatalog(simpleCatalog(data,current()?.catalog,true));if(!confirm(makeDefault?'Опубликовать этот набор и запускать его по умолчанию для всех новых игроков?':'Опубликовать набор по отдельной ссылке? Основной набор останется прежним.'))return;
 if(await command('publishSimpleSet',{...data,makeDefault})){choose(data.id);notify(makeDefault?'Набор опубликован и выбран основным.':'Готово. Ссылка на набор показана ниже; основной набор не менялся.');}}
async function makeDefault(release){if(!confirm(`Сделать «${release.name}» основным для новых запусков?`))return;if(await command('setDefault',{id:release.id})){render();notify('Основной набор изменён. Уже открытые партии не затронуты.');}}
function downloadDraft(){saveFile(`${form.id||'draft'}-tables.json`,JSON.stringify({format:'red-room-tables',version:1,...form},null,2));}
function updateReview(){const node=document.getElementById('review');if(!node || !form)return;node.replaceChildren();node.classList.remove('error');try{const c=simpleCatalog(form,current()?.catalog,false);const total=c.directors.reduce((n,d)=>n+d.films.length,0);node.append(el('strong',{text:`${total} кассет · 4 стола`}),...c.directors.map((d,i)=>el('p',{text:`${i+1}. ${form.tables[i].name || 'Название не задано'}: ${d.films.length} — ${d.films.slice(0,3).map(f=>f.title).join(' / ')}${d.films.length>3?'…':''}`})));}catch(e){node.classList.add('error');node.append(el('p',{class:'error-text',text:e.message}));}}
async function loadFile(file){if(!file)return;if(file.size>LIMITS.fileBytes)throw new Error('Файл больше 1 МиБ.');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());let value;try{value=JSON.parse(text);}catch{throw new Error('Нужен JSON-файл. Для обычной работы достаточно вставить названия в поля.');}
 let rows;
 if(value.format==='red-room-tables' && value.version===1){rows=value.tables;simpleCatalog({id:form.id,name:form.name||value.name||'Импорт',tables:rows},null,false);}
 else {const clean=normalizeCatalog(value);rows=catalogToRows(clean);}
 if(!confirm('Заменить текст четырёх столов в текущем черновике? На сервере ничего не изменится до сохранения.'))return;
 form.tables=rows;form.name=form.name || value.name || 'Новый набор';mark();render();notify('Список загружен. Проверьте названия и сохраните или опубликуйте.');}
function linkPanel(release){if(!release)return el('p',{class:'help',text:'После публикации здесь появится отдельная Telegram-ссылка. Черновик другим игрокам недоступен.'});
 let url='';try{url=setLink(identity.botUsername,release.id);}catch{}
 const box=el('section',{class:'link-box'},el('h3',{text:'Ссылка на этот набор'}));
 if(!url){box.append(el('p',{class:'help',text:'Не удалось получить имя бота. Введите его username (не канал подписки). Это используется только для формирования ссылки.'}),field('Имя бота без @',input(identity.botUsername||'',v=>{identity.botUsername=v.trim().replace(/^@/,'');},{id:'bot-name'})),button('Сформировать ссылку',()=>render()));return box;}
 box.append(el('input',{value:url,readOnly:true,'aria-label':'Ссылка на набор',onclick:e=>e.target.select()}),el('div',{class:'actions'},
 button('Копировать ссылку',()=>copy(url)),button('Открыть набор',()=>{if(leave())navigate('/',{release:release.id});}),
 button('Отправить ссылку мне в бота',async()=>{try{await call('rrSendSetLink',{releaseId:release.id});notify('Ссылка отправлена в личный чат с ботом.');}catch(e){notify(e.message+' Откройте чат с ботом, нажмите «Начать» и повторите. Ссылку также можно скопировать.',true);}})));
 return box;
}
function editor(){if(!form)return el('section',{class:'panel empty',text:'Создайте новый набор или выберите существующий.'});const c=current(),readonly=c?.status==='published',r=linked();
 const controls=el('fieldset',{},el('div',{class:'metadata'},field('Название набора',input(form.name,v=>{form.name=v;mark();},{id:'set-name',maxLength:100,readOnly:readonly,placeholder:'Оскар: четыре номинации'})),field('Код набора в ссылке',input(form.id,v=>{form.id=v;mark();},{id:'set-id',maxLength:56,readOnly:!!c,placeholder:'oscar-2027'}))));
 controls.append(el('p',{class:'help',text:'Подписи столов — любые: режиссёры, годы премии, номинации. Кассеты вводите по одной на строке. JSON и годы не нужны. У каждой кассеты — один правильный стол.'}),el('div',{class:'table-head'},el('span',{text:'Надпись на столе'}),el('span',{text:'Какие кассеты подходят'})));
 form.tables.forEach((row,i)=>{
 const select=el('select',{'aria-label':`Разделитель стола ${i+1}`,disabled:readonly,onchange:e=>{row.delimiter=e.target.value;mark();}},...Object.entries({auto:'Авто: строки или ;',lines:'Одна кассета на строку',semicolon:'Точка с запятой ;',comma:'Запятая (выбрать явно)'}).map(([v,l])=>el('option',{value:v,text:l,selected:row.delimiter===v})));
 controls.append(el('section',{class:'table-row','data-table':i+1},el('div',{},field(`Стол ${i+1}`,input(row.name,v=>{row.name=v;mark();},{id:`table-${i+1}-name`,maxLength:64,readOnly:readonly,placeholder:i===0?'Например: Лучший фильм':'Название категории'})),select),field(`Кассеты стола ${i+1}`,el('textarea',{id:`table-${i+1}-titles`,value:row.titles,readOnly:readonly,placeholder:'Название первой кассеты\nНазвание второй кассеты',oninput:e=>{row.titles=e.target.value;mark();}}))));
 });
 const panel=el('section',{class:'panel'},el('div',{class:'toolbar'},el('h2',{text:readonly?'Опубликованный набор':'Редактор набора'}),el('span',{class:'badge',text:readonly?'Версия зафиксирована':'Черновик'})),controls,el('div',{id:'review',class:'review'}),el('div',{id:'dirty',class:'dirty',text:dirty?'Есть несохранённые изменения.':''}));
 if(readonly){panel.append(el('p',{class:'help',text:'Чтобы изменить опубликованный набор, создайте копию. Старая ссылка и сохранения останутся прежними.'}),el('div',{class:'actions'},button('Создать копию',()=>newSet(c)),r && button('Сделать основным',()=>makeDefault(r),'primary',model.state.app_settings.defaultReleaseId===r.id)));}
 else panel.append(el('div',{class:'actions'},button('Сохранить черновик',save),button('Опубликовать по ссылке',()=>publish(false),'primary'),button('Опубликовать и сделать основным',()=>publish(true))),el('p',{class:'help',text:'Публикация подтверждает весь список кассет. Набор и релиз сохраняются одной операцией: промежуточных полуопубликованных версий нет.'}));
 panel.append(linkPanel(r),el('details',{},el('summary',{text:'Файлы, резервная копия и дополнительные инструменты'}),el('div',{class:'actions'},button('Скачать черновик',downloadDraft),button('Подробный редактор',()=>{if(leave())navigate('/admin-advanced.html');})),!readonly && field('Импорт JSON (необязательно)',el('input',{type:'file',accept:'.json,application/json',class:'import-line',onchange:async e=>{try{await loadFile(e.target.files[0]);}catch(er){notify(er.message,true);}finally{e.target.value='';}}}))));return panel;
}
function render(){
 if(identity?.isAdmin!==true||model?.access?.isAdmin!==true||model.access.userId!==identity.userId)return;if(!model)return;const s=model.state,def=s.game_releases.find(r=>r.id===s.app_settings.defaultReleaseId);
 const top=el('section',{class:'panel current'},el('div',{},el('span',{class:'badge default-badge',text:'ЗАПУСКАЕТСЯ ПО УМОЛЧАНИЮ'}),el('strong',{id:'default-name',text:def?.name||'Не выбран'}),el('p',{class:'help',text:def?`Код: ${def.id}`:''})),el('div',{class:'actions'},button('Открыть основную игру',()=>{if(leave())navigate('/',{rr_default:1});}),button('Обновить',refresh)));
 const sidebar=el('aside',{class:'panel sidebar'},button('+ Новый набор',()=>newSet(),'primary'),el('p',{class:'help',text:'Сохранённые версии'}),el('div',{class:'list'},...s.catalog_versions.map(c=>{const release=s.game_releases.find(r=>r.catalogVersionId===c.id && r.status==='published');const b=button('',()=>{if(!leave())return;try{choose(c.id);}catch(e){notify(e.message,true);}},selectedId===c.id?'selected':'');b.append(el('strong',{text:c.name}),el('small',{text:release?.id===s.app_settings.defaultReleaseId?'Основной набор':names[c.status]||c.status}));return b;})),button('Резервная копия базы',downloadFullBackup));
 const history=el('details',{class:'panel'},el('summary',{text:'История действий'}),...s.audit.slice(-15).reverse().map(a=>el('div',{class:'history-row',text:`${a.at} · ID ${a.actor} · ${a.summary} (${a.target})`})));
 app.replaceChildren(top,el('div',{class:'layout'},sidebar,el('div',{},editor(),history)));mountAdminTools(app,{model,current,identity,choose,onReload:fetchData});updateReview();
}
let booting=null;
async function boot(){
 if(booting)return booting;
 app.hidden=true;adminChrome();identity={};model=null;
 booting=(async()=>{try {
   const t=await telegram();configureViewport(t,'admin');
   const access=await authorizeEditor();identity=access.identity;model=access.model;
   adminChrome(identity);
   const id=selectedId||model.state.catalog_versions[0]?.id;
   if(id)choose(id);else render();app.hidden=false;
 } catch(e) {
   identity={};model=null;app.replaceChildren();adminChrome();
   if(['FORBIDDEN','AUTH_REQUIRED'].includes(e?.code)){
     try{navigate('/',{rr_default:1},true);await navigationWait();}catch{}
   }
   const box=el('section',{class:'panel'});app.replaceChildren(box);app.hidden=false;launchFailure(box,e,boot);
 }finally{booting=null;}})();return booting;
}
function lockEditor(){identity={};model=null;app.hidden=true;app.replaceChildren();adminChrome();}
addEventListener('rr-access-denied',lockEditor);
addEventListener('pagehide',lockEditor);
addEventListener('pageshow',event=>{if(event.persisted)void boot();});
boot();
