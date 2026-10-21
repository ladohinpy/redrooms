import { call, telegram, launchInput, navigate, el, launchFailure } from './client.mjs';
export async function prepareEngine(engineId) {
  const overlay = el('section', { id: 'rr-engine-overlay', role: 'status' });
  Object.assign(overlay.style, { position:'fixed', inset:'0', zIndex:'2147483000', background:'#170a10', color:'#f8eee7', display:'grid', placeContent:'center', padding:'28px', fontFamily:'system-ui', textAlign:'center' });
  overlay.append(el('p', { text: 'Загружаем коллекцию релиза…' })); document.body.append(overlay);
  try {
    await telegram();
    const input = launchInput();
    if (!input.release && !input.game) input.game = engineId;
    const data = await call('rrGetLaunch',input);
    if (data.admin) { navigate('/admin.html'); return await new Promise(() => {}); }
    if (data.game.id !== engineId || data.game.entry !== location.pathname) {
      if (!/^\/games\/[a-z0-9_-]+\/[a-f0-9]{16}\/index\.html$/.test(data.game.entry)) throw new Error('Неверный путь сборки.');
      navigate(data.game.entry, { release: data.release.id }); return await new Promise(() => {});
    }
    const embedded = document.getElementById('default-dataset');
    if (!embedded) throw new Error('В сборке отсутствует место для каталога.');
    embedded.textContent = JSON.stringify(data.catalog);
    window.RR_RELEASE = Object.freeze(data.release);
    window.RR_SAVE_PREFIX = `rr:v1:${data.userId}:${data.game.id}:${data.release.id}:${data.release.catalogVersionId}:`;
    // Copy, never delete, the original v06 local save. Only the original published seed qualifies.
    if (data.release.id === 'classic-1' && data.release.catalogVersionId === 'original-201-v1') {
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith(`red-room-v06-pack:${data.catalog.id}:`) && localStorage.getItem(window.RR_SAVE_PREFIX + key) === null) localStorage.setItem(window.RR_SAVE_PREFIX + key,localStorage.getItem(key));
      } catch { /* Private mode or quota: gameplay still works, persistence may not. */ }
    }
    try { localStorage.setItem(`rr:last-release:${data.userId}`, data.release.id); } catch {}
    const tools = el('div', { id:'rr-game-tools' });
    Object.assign(tools.style,{position:'fixed',top:'calc(env(safe-area-inset-top,0px) + 8px)',right:'8px',zIndex:'6000',display:'flex',gap:'6px',fontFamily:'system-ui',fontSize:'11px'});
    const home = el('button',{text:data.preview ? `ТЕСТ · ${data.release.id}` : data.release.id, title:'Открыть текущую основную игру', onclick:() => { if (confirm('Перейти к основной версии? Прогресс этого релиза останется на устройстве.')) navigate('/',{rr_default:1}); }});
    Object.assign(home.style,{fontSize:'11px',padding:'6px 9px',borderRadius:'10px',background:'#261018',color:'#fff1e8',border:'1px solid #975c66'}); tools.append(home);
    if (data.isAdmin) { const admin = home.cloneNode(false); admin.textContent='Админка'; admin.addEventListener('click',() => navigate('/admin.html')); tools.append(admin); }
    document.body.append(tools); overlay.remove(); return data;
  } catch (e) { launchFailure(overlay,e,() => location.reload()); throw e; }
}
