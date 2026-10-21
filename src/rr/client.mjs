export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === 'class') node.className = val;
    else if (key === 'text') node.textContent = val;
    else if (val !== undefined && val !== null && val !== false) {
      if (key in node) node[key] = val; else node.setAttribute(key, String(val));
    }
  }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
let noticeTimer;
export function notify(message, error = false) {
  let box = document.getElementById('rr-notice');
  if (!box) { box = el('div', { id: 'rr-notice', role: 'status', class: 'notice' }); document.body.append(box); }
  clearTimeout(noticeTimer);
  box.replaceChildren(el('span',{text:message}),el('button',{text:'×','aria-label':'Закрыть сообщение',onclick:()=>{box.hidden=true;clearTimeout(noticeTimer);}}));
  box.classList.toggle('error', error); box.hidden = false;
  if(!error) noticeTimer=setTimeout(()=>box.hidden=true,7000);
}
let sdkPromise;
export function telegram() {
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const ready = () => {
      const t = window.Telegram?.WebApp;
      if (!t?.Serverless?.call) { reject(new Error('В этом клиенте нет Telegram Serverless. Обновите Telegram и откройте Mini App через бота.')); return; }
      if (!t.initData) { reject(Object.assign(new Error('Откройте игру через Telegram.'), {code:'AUTH_REQUIRED'})); return; }
      t.ready?.(); configureViewport(t); resolve(t);
    };
    if (window.Telegram?.WebApp?.Serverless?.call) { ready(); return; }
    const script = document.createElement('script'); let done = false;
    const finish = error => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else ready(); };
    const timer = setTimeout(() => finish(new Error('Не удалось загрузить Telegram SDK. Проверьте сеть и повторите.')), 12000);
    script.src = 'https://telegram.org/js/telegram-web-app.js?64';
    script.onload = () => finish(); script.onerror = () => finish(new Error('Telegram SDK недоступен.'));
    document.head.append(script);
  });
  return sdkPromise.catch(error => { sdkPromise = undefined; throw error; });
}
export async function call(name, input = {}) {
  const t = await telegram();
  return await new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (done) return; done = true; const e = new Error('Ответ не получен. Запрос мог сохраниться: сначала обновите данные, не повторяйте публикацию вслепую.'); e.code = 'TIMEOUT'; reject(e); }, 15000);
    const callback = (err, result) => {
      if (done) return; done = true; clearTimeout(timer);
      if (err) { const e = new Error(err.message || 'Не удалось выполнить запрос.'); e.code = err.parameters?.code || err.type; e.parameters = err.parameters || {}; reject(e); }
      else resolve(result);
    };
    try { const r=t.Serverless.call(name, input, callback); if(r && typeof r.then==='function') r.then(v=>callback(null,v),callback); } catch (e) { callback(e); }
  });
}
export function launchInput() {
  const p = new URLSearchParams(location.search), input = {};
  for (const key of ['release','game']) if (p.has(key)) input[key] = p.get(key);
  if (p.has('set') && !input.release) input.release=p.get('set');
  const hint=p.get('startapp') || p.get('tgWebAppStartParam');
  if (!input.release && !input.game && hint?.startsWith('set_')) input.release=hint.slice(4);
  if (!input.release && !input.game && hint?.startsWith('release_')) input.release=hint.slice(8);
  if (p.get('rr_default') === '1') input.default = true;
  return input;
}
/** Keep Telegram's original query parameters and hash verbatim through same-origin navigation. */
export function navigate(path, params = {}, replace = false) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Недопустимый путь навигации.');
  const next = new URL(path, location.origin), previous = new URLSearchParams(location.search);
  for (const [k,v] of previous) if (k.startsWith('tgWebApp')) next.searchParams.set(k,v);
  for (const [k,v] of Object.entries(params)) next.searchParams.set(k,String(v));
  next.hash = location.hash;
  // Bound reload loops across canonical redirects. Only paths/release IDs, never auth data.
  const key='rr:navigation-guard', stamp=Date.now(), target=next.pathname+':'+(next.searchParams.get('release')||'');
  try {
    const old=JSON.parse(sessionStorage.getItem(key)||'null');
    const count=old && old.target===target && stamp-old.at<15000 ? old.count+1 : 1;
    if(count>3) { const e=new Error('Остановлен повторяющийся переход. Откройте приложение заново через бота.');e.code='NAVIGATION_LOOP';throw e; }
    sessionStorage.setItem(key,JSON.stringify({target,at:stamp,count}));
  } catch(e) { if(e.code==='NAVIGATION_LOOP')throw e; }
  if (replace) location.replace(next.href); else location.assign(next.href);
}
export function saveFile(name, text, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); notify('Ссылка скопирована.'); }
  catch { const t = el('textarea', { value: text, readOnly: true }); document.body.append(t); t.select(); notify('Автокопирование недоступно: выделенная ссылка готова для копирования.'); }
}
/** Public UI must not render server messages, account details or diagnostic controls.
 * Authorization remains server-side; this is presentation, not an access-control substitute. */
export function playerMessage(error) {
  if (error?.code === 'SUBSCRIPTION_REQUIRED') return 'Для входа подпишитесь на канал «Витальное кино» и нажмите «Проверить снова».';
  if (error?.code === 'AUTH_REQUIRED') return 'Откройте «Красную комнату» через бота в Telegram.';
  if (error?.code === 'NOT_FOUND' || error?.code === 'FORBIDDEN') return 'Этот набор сейчас недоступен. Попробуйте открыть игру заново.';
  return 'Не удалось открыть игру. Проверьте подключение к интернету и попробуйте ещё раз.';
}
export function launchFailure(container, error, retry) {
  const subscription = error?.code === 'SUBSCRIPTION_REQUIRED';
  container.replaceChildren(el('p', { class: 'error-text', text: playerMessage(error) }));
  if (container.id === 'rr-engine-overlay') container.prepend(el('small',{text:'ИГРА КАНАЛА «ВИТАЛЬНОЕ КИНО»'}),el('h1',{text:'Красная комната'}));
  const join = error?.parameters?.joinUrl;
  if (subscription && typeof join === 'string' && /^https:\/\/t\.me\/[a-zA-Z0-9_+\-]+$/.test(join)) {
    container.append(el('button', { type: 'button', text: 'Открыть канал «Витальное кино»', onclick: async () => {
      try { const t = await telegram(); t.openTelegramLink(join); }
      catch (e) { launchFailure(container, e, retry); }
    } }));
  }
  container.append(el('button', { type: 'button', text: subscription ? 'Проверить снова' : 'Попробовать снова', onclick: retry }));
  // Technical diagnostics may be inspected by developers, but are not rendered for players.
}
/** Neutral shell until a fresh server response explicitly grants access. */
export function adminChrome(identity = null, heading = 'Наборы кассет') {
  const allowed = identity?.isAdmin === true;
  document.title = allowed ? 'Красная комната — наборы' : 'Красная комната';
  const title = document.querySelector('.topbar h1');
  if (title) title.textContent = allowed ? heading : 'Красная комната';
  const eyebrow = document.querySelector('.topbar .eyebrow');
  if (eyebrow) eyebrow.textContent = allowed ? 'КРАСНАЯ КОМНАТА / УПРАВЛЕНИЕ' : 'ИГРА КАНАЛА «ВИТАЛЬНОЕ КИНО»';
  const label = document.getElementById('identity');
  if (label) { label.textContent = allowed ? `Telegram ID: ${identity.userId}` : ''; label.hidden = !allowed; }
  const footer = document.getElementById('admin-footer');
  if (footer) footer.hidden = !allowed;
}

export function stage(name) { window.RR_DIAGNOSTIC={version:'tables-admin-2',stage:name,path:location.pathname,at:new Date().toISOString()}; }
export function adminRequested() {
  const p=new URLSearchParams(location.search);
  if (p.get('rr_default') === '1') return false; // Do not reopen management from a retained Telegram start parameter.
  return p.get('admin')==='1' || p.get('startapp')==='admin' || p.get('tgWebAppStartParam')==='admin';
}
export function configureViewport(t, mode='game') {
  const sync=()=>{
    for (const edge of ['top','right','bottom','left']) {
      const a=Math.max(0,Number(t.safeAreaInset?.[edge])||0), b=Math.max(0,Number(t.contentSafeAreaInset?.[edge])||0);
      const fallback=edge==='top' && t.isFullscreen && !a && !b ? 88 : 0;
      document.documentElement.style.setProperty('--rr-safe-'+edge,`max(env(safe-area-inset-${edge},0px), ${Math.max(a+b,fallback)}px)`);
    }
    if (t.viewportStableHeight>150) document.documentElement.style.setProperty('--rr-height',Math.round(t.viewportStableHeight)+'px');
  };
  sync();
  if (!t.__rrViewportBound) {
    for(const ev of ['viewportChanged','safeAreaChanged','contentSafeAreaChanged','fullscreenChanged']) t.onEvent?.(ev,sync);
    addEventListener('resize',sync);t.__rrViewportBound=true;
  }
  if(mode==='admin') {
    try { if(t.isFullscreen && t.isVersionAtLeast?.('8.0')) t.exitFullscreen?.(); } catch {}
    try {t.expand?.();t.enableVerticalSwipes?.();}catch{}
  }
}
export async function navigationWait() {
  // Successful navigation destroys this document. A blocked navigation must not wait forever.
  await new Promise((_,reject)=>setTimeout(()=>{const e=new Error('Переход к странице заблокирован. Закройте Mini App и откройте заново.');e.code='NAVIGATION_BLOCKED';reject(e);},5000));
}
