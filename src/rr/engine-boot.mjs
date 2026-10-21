import {call,telegram,launchInput,navigate,el,launchFailure,stage,navigationWait} from './client.mjs';
import {samePage,transportPath} from './routes.mjs';
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
      navigate(runtime.entry,{release:data.release.id},true);await navigationWait();return;
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
    try {sessionStorage.removeItem('rr:navigation-guard');}catch{}
    const tools=el('nav',{id:'rr-game-tools','aria-label':'Набор кассет'});
    Object.assign(tools.style,{position:'fixed',top:'calc(var(--rr-safe-top,0px) + 8px)',left:'calc(var(--rr-safe-left,0px) + 12px)',right:'calc(var(--rr-safe-right,0px) + 12px)',zIndex:'6000',display:'flex',justifyContent:'space-between',gap:'8px',fontFamily:'system-ui',pointerEvents:'none'});
    const button=(text,handler)=>{const b=el('button',{text,onclick:handler});Object.assign(b.style,{fontSize:'12px',padding:'9px 12px',borderRadius:'10px',background:'#261018ed',color:'#fff1e8',border:'1px solid #975c66',pointerEvents:'auto',maxWidth:'48%',minWidth:'0',textOverflow:'ellipsis',overflow:'hidden',whiteSpace:'nowrap',minHeight:'38px'});return b;};
    tools.append(button(data.release.name,()=>{if(confirm('Открыть основной набор? Прогресс текущего набора сохранится.'))navigate('/',{rr_default:1});}));
    if(data.isAdmin === true)tools.append(button('Управление наборами',()=>navigate('/admin.html')));
    document.body.append(tools);
    update('Создаём 3D-комнату…');overlay.remove();return data;
  } catch(e) {launchFailure(overlay,e,()=>location.reload());throw e;}
}
