#!/usr/bin/env node
/** Additive build for an EXISTING redrooms checkout. No network or deployment. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
function stop(message){throw new Error(message);}
function safeSource(p){if(typeof p!=='string'||path.isAbsolute(p)||p.includes('\\')||p.split('/').some(s=>s==='..'||s==='')||!p.startsWith('src/'))stop('Источник сборки должен находиться внутри src/.');const full=path.resolve(root,p);if(fs.existsSync(full)&&!fs.realpathSync(full).startsWith(fs.realpathSync(root)+path.sep))stop('Символическая ссылка источника выходит за проект.');return p;}
function parseJSONC(source){
  let out='',quoted=false,escaped=false;
  for(let i=0;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(quoted){out+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;out+=c;continue;}
    if(c==='/'&&n==='/'){while(i<source.length&&source[i]!=='\n')i++;out+='\n';continue;}
    if(c==='/'&&n==='*'){i+=2;while(i<source.length&&!(source[i]==='*'&&source[i+1]==='/'))i++;if(i>=source.length)stop('Незакрытый комментарий JSONC.');i++;continue;}
    out+=c;
  }
  // Strip only structural trailing commas, never commas inside quoted strings.
  let cleaned='';quoted=false;escaped=false;
  for(let i=0;i<out.length;i++){
    const c=out[i];if(quoted){cleaned+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"')quoted=true;
    if(c===','){let j=i+1;while(/\s/.test(out[j]||'')&&j<out.length)j++;if(out[j]===']'||out[j]==='}')continue;}
    cleaned+=c;
  }return JSON.parse(cleaned);
}
function jsonScript(html,id){
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const blocks=scripts.filter(m=>new RegExp(`\\bid\\s*=\\s*["']${id}["']`,'i').test(m[1]));
  if(blocks.length!==1)stop(`Нужен ровно один JSON-блок ${id}. Игра не изменена.`);
  return JSON.parse(blocks[0][2].replace(/^\uFEFF/,''));
}
function oneReplace(source,re,replacer,label){const matches=[...source.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))];if(matches.length!==1)stop(`Адаптер v06: ${label}, найдено ${matches.length} вместо 1. Не публикуйте: нужен разбор новой структуры игры.`);return source.replace(re,replacer);}
function instrument(source,gameId,bootUrl){
  if(source.includes('RR-INSTRUMENTED-V1'))stop('Источник уже инструментирован. Нужен исходный HTML, а не файл из public/games/.');
  let html=oneReplace(source,/async\s+function\s+launchArchive\s*\(\s*\)\s*\{/g,m=>m+'\n    await window.RRPrepareLaunch();','точка входа launchArchive');
  html=oneReplace(html,/SAVE_KEY\s*=\s*`red-room-v06-pack:/g,'SAVE_KEY = `${window.RR_SAVE_PREFIX}red-room-v06-pack:','ключ сохранения');
  const base=html.match(/<base\b[^>]*>/i);
  if(base&&!/\bhref\s*=\s*["']\/["']/i.test(base[0]))stop('У исходной игры нестандартный <base>. Автоматическая замена запрещена.');
  const injection=`\n<!-- RR-INSTRUMENTED-V1: fixed release/catalog before the existing game starts -->\n${base?'':'<base href="/">\n'}<script>\nwindow.RRPrepareLaunch = function () {\n  if (!window.RRLaunchPromise) window.RRLaunchPromise = import(${JSON.stringify(bootUrl)}).then(function(m) { return m.prepareEngine(${JSON.stringify(gameId)}); });\n  return window.RRLaunchPromise;\n};\n</script>\n`;
  return oneReplace(html,/<head\b[^>]*>/gi,m=>m+injection,'head');
}

// RR-SCHEMA-FIX-1: keep the migration entry point self-contained. The observed
// cloud migration could not resolve lib/rr/schema even after a successful push.
// Only the exact legacy generated export is removed; unrelated tables survive.
const RR_SCHEMA_BEGIN = '// BEGIN RR ADMIN SCHEMA (managed by rr-prepare.cjs)';
const RR_SCHEMA_END = '// END RR ADMIN SCHEMA';
const RR_SCHEMA_BLOCK = `${RR_SCHEMA_BEGIN}
import {
  table as rrSchemaTable,
  text as rrSchemaText,
  integer as rrSchemaInteger,
  json as rrSchemaJson
} from 'sdk/db';

export const rrAdminState = rrSchemaTable('rr_admin_state', {
  id: rrSchemaText('id').primaryKey(),
  revision: rrSchemaInteger('revision').notNull(),
  state: rrSchemaJson('state_json').notNull()
});
${RR_SCHEMA_END}`;
function ensureStandaloneSchema(source) {
  if (typeof source !== 'string') stop('Схема должна быть JavaScript-текстом.');
  const begins = source.split(RR_SCHEMA_BEGIN).length - 1;
  const ends = source.split(RR_SCHEMA_END).length - 1;
  let base = source;
  if (begins || ends) {
    const first = source.indexOf(RR_SCHEMA_BEGIN), last = source.indexOf(RR_SCHEMA_END);
    if (begins !== 1 || ends !== 1 || last < first) {
      stop('Повреждены маркеры RR ADMIN SCHEMA. Схема не изменена; проверьте tgcloud/schema.js.');
    }
    const existing = source.slice(first, last + RR_SCHEMA_END.length);
    if (existing.replace(/\r\n/g, '\n') !== RR_SCHEMA_BLOCK) {
      stop('Управляемый блок RR ADMIN SCHEMA изменён вручную. Автозамена запрещена: проверьте схему.');
    }
    base = source.slice(0, first) + source.slice(last + RR_SCHEMA_END.length);
  }
  const legacy = /^[ \t]*export[ \t]*\{[ \t]*rrAdminState[ \t]*\}[ \t]*from[ \t]*(['"])\.\/lib\/rr\/schema\.js\1[ \t]*;?[ \t]*\r?$/gm;
  const matches = [...base.matchAll(legacy)];
  if (matches.length > 1) stop('Несколько старых экспортов rrAdminState. Схема не изменена.');
  if (begins && matches.length) stop('Смешаны старая и новая схемы rrAdminState. Проверьте tgcloud/schema.js.');
  base = base.replace(legacy, '');
  base = base.replace(/^[ \t]*\/\/ Red Room administration: additive table; data is never reset by deployment\.[ \t]*\r?$/gm, '');
  if (/\b(?:rrAdminState|rrSchemaTable|rrSchemaText|rrSchemaInteger|rrSchemaJson)\b/.test(base)) {
    stop('В tgcloud/schema.js есть нестандартное объявление rrAdminState или занятое служебное имя. Автозамена запрещена.');
  }
  return (base.trimEnd() ? base.trimEnd() + '\n\n' : '') + RR_SCHEMA_BLOCK + '\n';
}

// RR-STATIC-HEADERS-FIX-1: this header was rejected by Telegram at
// /static/prepare (2026-10-21). Check the known incompatibility locally;
// do NOT claim this is a complete replica of Telegram's server validator.
function validateStaticHeaders(cloud) {
  const headers = cloud?.static?.headers;
  if (headers === undefined) return;
  if (!Array.isArray(headers)) stop('tgcloud.jsonc: static.headers должен быть массивом правил.');
  for (const [i, rule] of headers.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) ||
        typeof rule.path !== 'string' || !rule.set ||
        typeof rule.set !== 'object' || Array.isArray(rule.set)) {
      stop(`tgcloud.jsonc: некорректное правило static.headers[${i}].`);
    }
    for (const name of Object.keys(rule.set)) {
      if (name.trim().toLowerCase() === 'x-content-type-options') {
        stop(`tgcloud.jsonc: static.headers[${i}] (${rule.path}): ` +
          'Telegram отклоняет пользовательский X-Content-Type-Options. ' +
          'Удалите это поле из set, не заменяйте его на null. ' +
          'Проверка выполнена локально; запрос публикации не отправлялся.');
      }
    }
  }
}

async function prepare(){
  const domain=await import(pathToFileURL(path.join(root,'src/rr/domain.mjs')).href);
  const production=process.argv.includes('--production');
  // Perform every validation BEFORE changing the running public/index.html.
  if(!exists('public/index.html')||!exists('tgcloud/endpoints/checkAccess.js'))stop('Это пакет обновления. Скопируйте его содержимое в существующий checkout ladohinpy/redrooms (там должны быть public/index.html и checkAccess.js).');
  const pending=new Map(),write=(p,text)=>pending.set(p,text);
  const current=read('public/index.html');
  const legacyPath='src/rr-legacy-v06.html';
  if(!exists(legacyPath)){
    if(/name=["']rr-launcher["']/.test(current))stop('Загрузчик найден, исходная v06 отсутствует. Восстановите src/rr-legacy-v06.html из Git; не используйте другую игру.');
    if(!current.includes('checkAccess')&&!current.includes('access-gate.js'))stop('У этой v06 не обнаружена существующая проверка подписки. Возьмите актуальную ветку Telegram Mini App.');
    write(legacyPath,current);
  }
  const legacy=exists(legacyPath)?read(legacyPath):current;
  const original=jsonScript(legacy,'default-dataset');
  const seed=domain.playableCatalog(domain.normalizeCatalog(original,'approved'));
  let admins=[];
  if(process.env.RR_ADMIN_IDS){
    const v=process.env.RR_ADMIN_IDS.trim();admins=v.startsWith('[')?JSON.parse(v):v.split(',').map(s=>{if(!/^\d+$/.test(s.trim()))stop('RR_ADMIN_IDS: только числовые Telegram ID через запятую.');return Number(s.trim());});
  }else if(exists('config/rr-admins.local.json'))admins=JSON.parse(read('config/rr-admins.local.json')).adminIds;
  if(!Array.isArray(admins)||(admins.length!==0&&admins.length!==2)||admins.some(n=>!Number.isSafeInteger(n)||n<=0)||new Set(admins).size!==admins.length)stop('Нужны ровно два разных положительных числовых Telegram ID. Не usernames, не ID бота и не токены.');
  if(production&&admins.length!==2)stop('Production-сборка остановлена: задайте RR_ADMIN_IDS или config/rr-admins.local.json для Павла и Виталия.');
  const config=JSON.parse(read('config/rr-game-builds.json'));
  if(config.schemaVersion!==1||!Array.isArray(config.games)||!config.games.length)stop('Некорректный config/rr-game-builds.json.');
  const frozen=exists('config/rr-built-games.json')?JSON.parse(read('config/rr-built-games.json')):{schemaVersion:1,games:[]};
  if(frozen.schemaVersion!==1||!Array.isArray(frozen.games))stop('Некорректный реестр готовых сборок.');
  const runtimeSources=['client.mjs','routes.mjs','engine-boot.mjs','contest-client.mjs','rich-text.mjs'].map(n=>[n,read('src/rr/'+n)]);
  const runtimeHash=sha(runtimeSources.map(([n,s])=>n+'\n'+s).join('\n')).slice(0,16);
  const runtimeDir=`rr/runtime/${runtimeHash}`;
  const built=[];
  for(const spec of config.games){
    domain.id(spec.id,'ID сборки');safeSource(spec.source);
    if(spec.adapter!=='v06')stop(`Для ${spec.id} поддерживается адаптер v06. Новая механика требует отдельного интеграционного адаптера, а не переименования HTML.`);
    const source=spec.source===legacyPath?legacy:read(spec.source),sourceHash=sha(source);
    const old=frozen.games.find(g=>g.id===spec.id);
    if(old){
      if(old.sourceHash!==sourceHash)stop(`Исходник ${spec.id} изменён. Старые релизы нельзя подменять: создайте сборку с новым ID.`);
      if(JSON.stringify(old.aliases)!==JSON.stringify(spec.aliases||[])||old.name!==spec.name)stop(`Метаданные ${spec.id} изменены. Сохраните прежние ID/имя/aliases или создайте новую версию.`);
      if(!exists('public'+old.entry)||sha(read('public'+old.entry))!==old.codeHash)stop(`Нет неизменённого файла старой сборки ${spec.id}. Восстановите public${old.entry} из Git.`);
      for(const a of old.runtimeAssets||[])if(!exists('public/'+a.path)||sha(read('public/'+a.path))!==a.hash)stop('Отсутствует или изменён runtime старой сборки. Восстановите его из Git.');
      built.push(old);continue;
    }
    // Freeze local external scripts (notably the original access-gate) too.
    const externalAssets=[];
    const frozenSource=source.replace(/(<script\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi,(all,start,quote,url)=>{
      if(/^(?:https?:)?\/\//i.test(url))return all;
      const relative=url.split(/[?#]/)[0].replace(/^\.?\//,'');
      if(relative.split('/').includes('..')||relative.includes('\\')||!relative.endsWith('.js'))stop('Неподдерживаемый локальный script src: '+url);
      const assetPath='public/'+relative;if(!exists(assetPath))stop('Нет локального script-ресурса '+assetPath);
      const body=read(assetPath),hash=sha(body),asset='rr/frozen/'+hash.slice(0,16)+'/'+path.basename(relative);
      externalAssets.push({path:asset,hash});write('public/'+asset,body);
      return start+quote+'/'+asset+quote;
    });
    const html=instrument(frozenSource,spec.id,`/${runtimeDir}/engine-boot.mjs`),codeHash=sha(html),entry=`/games/${spec.id}/${codeHash.slice(0,16)}/index.html`;
    const g=domain.gameBuild({id:spec.id,name:spec.name,entry,codeHash,catalogSchemaVersion:1,aliases:spec.aliases||[],optionalYear:spec.optionalYear===true,contestEngine:spec.contestEngine===true});
    const runtimeAssets=[...runtimeSources.map(([n,s])=>({path:runtimeDir+'/'+n,hash:sha(s)})),...externalAssets];
    built.push({...g,source:spec.source,sourceHash,runtimeAssets});write('public'+entry,html);
    for(const [n,s]of runtimeSources)write('public/'+runtimeDir+'/'+n,s);
  }
  for(const old of frozen.games)if(!built.some(g=>g.id===old.id))stop(`Нельзя удалить старую сборку ${old.id} из манифеста: на неё могут ссылаться релизы.`);
  const games=built.map(domain.gameBuild);
  domain.createInitialState(seed,games,'validation');
  write('config/rr-built-games.json',JSON.stringify({schemaVersion:1,games:built},null,2)+'\n');
  write('tgcloud/lib/rr/generated.js','// Generated by scripts/rr-prepare.cjs; no secrets.\nexport const GAMES = '+JSON.stringify(games)+';\nexport const SEED = '+JSON.stringify(seed)+';\n');
  const environment=process.env.RR_ENVIRONMENT||'stage';
  if(!['stage','production'].includes(environment))stop('RR_ENVIRONMENT: stage или production.');
  const expectedBot=(process.env.RR_EXPECTED_BOT_USERNAME||'').trim().replace(/^@/,'');
  if(expectedBot&&!/^[a-zA-Z0-9_]{5,32}$/.test(expectedBot))stop('Неверное имя целевого бота.');
  if(production&&environment==='production'&&!expectedBot)stop('Для боевого деплоя требуется RR_EXPECTED_BOT_USERNAME.');
  write('tgcloud/lib/rr/config.js','// Generated server-only allowlist. No secrets.\nexport const ADMIN_IDS = Object.freeze('+JSON.stringify(admins)+');\nexport const DEPLOY_ENV = '+JSON.stringify(environment)+';\nexport const EXPECTED_BOT_USERNAME = '+JSON.stringify(expectedBot)+';\n');
  for(const name of ['domain','admin-access','service','simple','digest','content','contest-domain','contest-service','record-store','backup','backup-service','sdk-bind','sdk-probe'])write(`tgcloud/lib/rr/${name}.js`,read(`src/rr/${name}.mjs`).replace(/(from\s+['"]\.\/[^'"]+)\.mjs(['"])/g,'$1.js$2'));
  for(const name of ['domain','import','simple','routes','client','launcher','admin','admin-advanced','rich-text','admin-contest','contest-client'])write(`public/rr/${name}.mjs`,read(`src/rr/${name}.mjs`));
  for(const name of ['admin','admin-advanced']) {
    write(`public/${name}.html`,read(`src/rr/${name}.html`));
    write(`public/rr/${name}.css`,read(`src/rr/${name}.css`));
  }
  const schema=exists('tgcloud/schema.js')?read('tgcloud/schema.js'):'';
  write('tgcloud/schema.js', require('./rr-contest-schema.cjs').ensureContestSchema(ensureStandaloneSchema(require('./rr-contest-schema.cjs').removeContestSchema(schema))));
  if(!exists('tgcloud.jsonc'))stop('Не найден существующий tgcloud.jsonc. Сначала возьмите актуальную Telegram-ветку.');
  const cloud=parseJSONC(read('tgcloud.jsonc'));
  cloud.static={...(cloud.static||{}),source:'public',spa:false};
  const oldHeaders=Array.isArray(cloud.static.headers)?cloud.static.headers:[];
  // Regenerate the existing managed catch-all rule WITHOUT the rejected header.
  // Editing only tgcloud.jsonc is insufficient: this builder runs before each deploy.
  cloud.static.headers=[...oldHeaders.filter(h=>h.path!=='/*'),{path:'/*',set:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}}];
  validateStaticHeaders(cloud); // Check retained path-specific rules before any files are written.
  delete cloud.static.immutable; // Keep launch/control files fresh; hashed builds remain immutable by convention.
  write('tgcloud.jsonc',JSON.stringify(cloud,null,2)+'\n');
  if(exists('package.json')){
    const pkg=JSON.parse(read('package.json'));pkg.scripts=pkg.scripts||{};
    if(pkg.scripts.check&&pkg.scripts.check!=='node scripts/rr-check.cjs')pkg.scripts['check:legacy']=pkg.scripts.check;
    Object.assign(pkg.scripts,{check:'node scripts/rr-check.cjs','rr:prepare':'node scripts/rr-prepare.cjs','rr:test':'node scripts/rr-check.cjs --tests-only'});
    write('package.json',JSON.stringify(pkg,null,2)+'\n');
  }
  const ignored=['.tgcloud/','node_modules/','config/rr-admins.local.json','tgcloud/lib/rr/config.js','.rr-test/'];
  const gitignore=exists('.gitignore')?read('.gitignore'):'';
  const missingIgnored=ignored.filter(s=>!gitignore.split(/\r?\n/).includes(s));
  if(missingIgnored.length)write('.gitignore',gitignore+'\n# Red Room local credentials/configuration\n'+missingIgnored.join('\n')+'\n');
  const agents=exists('AGENTS.md')?read('AGENTS.md'):'';
  if(!agents.includes('RED ROOM ADMIN V1'))write('AGENTS.md',agents+'\n\n## RED ROOM ADMIN V1\nRead README.md and docs/RELEASE-DEPLOY.md. Preserve src/rr-legacy-v06.html, config/rr-built-games.json and every public/games/ + public/rr/runtime/ asset. Never modify a published game ID in place. Build with scripts/rr-prepare.cjs; use verified ctx.initData for authorization. Do not put secrets in public files. Do not run push/migrate without explicit deployment intent.\n');
  // Root launcher last, after every validation. No recursive deletion or cleaning of public/.
  write('public/index.html',read('src/rr/launcher.html'));
  for(const [p,text]of pending){const full=path.join(root,p);fs.mkdirSync(path.dirname(full),{recursive:true});const tmp=full+'.rr-tmp';fs.writeFileSync(tmp,text);fs.renameSync(tmp,full);}
  console.log(`Prepared ${games.length} game build(s); initial catalog ${seed.directors.reduce((n,d)=>n+d.films.length,0)} films / ${seed.directors.length} directors. Admins: ${admins.length}. No deployment performed.`);
}
if(require.main===module)prepare().catch(e=>{console.error('RR PREPARE FAILED:',e.message);process.exitCode=1;});
module.exports={parseJSONC,jsonScript,instrument,ensureStandaloneSchema,validateStaticHeaders};
