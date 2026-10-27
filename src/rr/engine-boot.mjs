import {call,telegram,launchInput,navigate,el,launchFailure,stage,navigationWait} from './client.mjs';
import {samePage,transportPath} from './routes.mjs';
import {createContestClient} from './contest-client.mjs';
export async function prepareEngine(engineId) {
  const overlay=el('section',{id:'rr-engine-overlay',role:'status'});
  Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'2147483000',background:'#170a10',color:'#f8eee7',display:'grid',alignContent:'center',justifyItems:'center',padding:'calc(var(--rr-safe-top,0px) + 24px) 24px 24px',fontFamily:'system-ui',textAlign:'center',overflow:'auto'});
  const status=el('p',{text:'Открываем комнату…'});overlay.append(el('small',{text:'ИГРА КАНАЛА «ВИТАЛЬНОЕ КИНО»'}),el('h1',{text:'Красная комната'}),status);document.body.append(overlay);
  const update=text=>{stage(text);status.textContent='Открываем комнату…';};
  try {
    update('Подключаем Telegram…');await telegram();
    update('Проверяем доступ и загружаем набор…');
    // A bare game URL uses the global default, NOT an accidental per-build default.
    let data=await call('rrGetLaunch',launchInput());
    if(data.admin) {
      if(data.isAdmin === true){navigate('/admin.html',{},true);await navigationWait();return;}
      data=await call('rrGetLaunch',{default:true});
    }
    const runtime=data.runtime || data.game;
    update('Проверяем адрес комнаты…');
    transportPath(runtime?.entry);
    if(runtime.id!==engineId || !samePage(runtime.entry,location.pathname)) {
      navigate(runtime.entry,data.previewCatalogId?{previewCatalogId:data.previewCatalogId}:{release:data.release.id},true);await navigationWait();return;
    }
    const embedded=document.getElementById('default-dataset');
    if(!embedded) throw new Error('В сборке нет места для набора кассет.');
    embedded.textContent=JSON.stringify(data.catalog);
    window.RR_RELEASE=Object.freeze(data.release);
    // Preserve the logical release/game save namespace when repairing the v06 renderer.
    window.RR_SAVE_PREFIX=`rr:v1:${data.userId}:${data.game.id}:${data.release.id}:${data.release.catalogVersionId}:`;
    if(data.release.id==='classic-1' && data.release.catalogVersionId==='original-201-v1') {
      try {for(const k of Object.keys(localStorage))if(k.startsWith(`red-room-v06-pack:${data.catalog.id}:`) && localStorage.getItem(window.RR_SAVE_PREFIX+k)===null)localStorage.setItem(window.RR_SAVE_PREFIX+k,localStorage.getItem(k));}catch{}
    }
    if(runtime.contestEngine===true)window.RRContest=await createContestClient(data);
    try {sessionStorage.removeItem('rr:navigation-guard');}catch{}
    if (data.isAdmin === true) {
      const pauseCard=document.getElementById('pause')?.querySelector?.('.start-card');
      if(pauseCard && !document.getElementById('rr-game-tools')) {
        const tools=el('nav',{id:'rr-game-tools','aria-label':'Управление игрой'});
        tools.append(el('button',{type:'button',class:'secondary',text:'Управление наборами',onclick:()=>navigate('/admin.html')}));
        pauseCard.append(tools);
      }
    }
    update('Создаём 3D-комнату…');overlay.remove();return data;
  } catch(e) {launchFailure(overlay,e,()=>location.reload());throw e;}
}
