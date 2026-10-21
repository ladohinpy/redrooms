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
export function notify(message, error = false) {
  let box = document.getElementById('rr-notice');
  if (!box) { box = el('div', { id: 'rr-notice', role: 'status', class: 'notice' }); document.body.append(box); }
  box.textContent = message; box.classList.toggle('error', error); box.hidden = false;
}
let sdkPromise;
export function telegram() {
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const ready = () => {
      const t = window.Telegram?.WebApp;
      if (!t?.Serverless?.call) { reject(new Error('В этом клиенте нет Telegram Serverless. Обновите Telegram и откройте Mini App через бота.')); return; }
      if (!t.initData) { reject(new Error('Откройте игру внутри Telegram через её бота. Обычная вкладка браузера не даёт авторизации.')); return; }
      t.ready?.(); resolve(t);
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
    try { t.Serverless.call(name, input, callback); } catch (e) { callback(e); }
  });
}
export function launchInput() {
  const p = new URLSearchParams(location.search), input = {};
  for (const key of ['release','game']) if (p.has(key)) input[key] = p.get(key);
  if (p.get('rr_default') === '1') input.default = true;
  return input;
}
/** Keep Telegram's original query parameters and hash verbatim through same-origin navigation. */
export function navigate(path, params = {}) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Недопустимый путь навигации.');
  const next = new URL(path, location.origin), previous = new URLSearchParams(location.search);
  for (const [k,v] of previous) if (k.startsWith('tgWebApp')) next.searchParams.set(k,v);
  for (const [k,v] of Object.entries(params)) next.searchParams.set(k,String(v));
  next.hash = location.hash;
  location.assign(next.href);
}
export function saveFile(name, text, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); notify('Ссылка скопирована.'); }
  catch { const t = el('textarea', { value: text, readOnly: true }); document.body.append(t); t.select(); notify('Автокопирование недоступно: выделенная ссылка готова для копирования.'); }
}
export function launchFailure(container, error, retry) {
  container.replaceChildren(el('p', { class: 'error-text', text: error.message }));
  const join = error.parameters?.joinUrl;
  if (typeof join === 'string' && /^https:\/\/t\.me\/[a-zA-Z0-9_+\-]+$/.test(join)) container.append(el('button', { text: 'Открыть канал', onclick: async () => { const t = await telegram(); t.openTelegramLink(join); } }));
  container.append(el('button', { text: 'Проверить снова', onclick: retry }));
  // No silent fallback to a different release or to a local catalog.
}
