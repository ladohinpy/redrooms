import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const fail = message => { console.error(`ERROR: ${message}`); process.exitCode = 1; };

if (!html.trimStart().startsWith('<!doctype html>')) fail('нет HTML DOCTYPE');
if (!html.includes('</html>')) fail('HTML неполный');

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
if (scripts.length < 4) fail(`ожидались 4 встроенных script, найдено ${scripts.length}`);
let datasetFound = false;
let mainCodeFound = false;
for (const [i, m] of scripts.entries()) {
  const attributes = m[1];
  const body = m[2];
  if (/\btype\s*=\s*["']application\/json["']/i.test(attributes)) {
    try {
      const data = JSON.parse(body);
      if (/\bid\s*=\s*["']default-dataset["']/i.test(attributes)) {
        datasetFound = true;
        const count = (data.directors || []).reduce((n, d) => n + (d.films || []).length, 0);
        if (data.directors?.length !== 4 || count !== 201) {
          fail(`каталог изменён: режиссёров ${data.directors?.length}, кассет ${count}`);
        } else {
          console.log('OK: оригинальный каталог — 4 режиссёра, 201 кассета');
        }
      }
    } catch (e) { fail(`невалидный JSON в script №${i+1}: ${e.message}`); }
  } else {
    try {
      new Script(body, { filename: `inline-script-${i+1}.js` });
      if (body.length > 100_000) mainCodeFound = true;
    } catch (e) { fail(`ошибка JS в script №${i+1}: ${e.message}`); }
  }
}
if (!datasetFound) fail('не найден default-dataset');
if (!mainCodeFound) fail('не найден основной игровой JavaScript');
if (!process.exitCode) console.log('OK: HTML, JSON и JavaScript. Проверка подписки не подключена.');
