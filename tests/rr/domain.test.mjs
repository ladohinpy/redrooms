import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clone,normalizeCatalog,playableCatalog,catalogWarnings,byteLength,gameBuild,createInitialState,applyCommand,parseSelector,resolveLaunch,LIMITS} from '../../src/rr/domain.mjs';
import {seed,games} from './helpers.mjs';
const initial=()=>createInitialState(seed,games,'2026-10-19');
const apply=(s,action,input={})=>applyCommand(s,{action,input},101,games,'2026-10-20');
const bad=(fn,code='VALIDATION')=>assert.throws(fn,e=>e.code===code);
function draft(s=initial()){return apply(s,'cloneCatalog',{sourceId:'original-201-v1',id:'catalog-2',name:'Вторая коллекция'});}
function released(){let s=draft();s=apply(s,'publishCatalog',{id:'catalog-2'});s=apply(s,'createRelease',{id:'classic-2',name:'Вторая',gameVersionId:'v06',catalogVersionId:'catalog-2'});return apply(s,'publishRelease',{id:'classic-2',visibility:'public'});}

test('initial catalog and game survive without changing seed',()=>{const before=clone(seed),s=initial();assert.deepEqual(seed,before);assert.equal(s.app_settings.defaultReleaseId,'classic-1');assert.deepEqual(s.catalog_versions[0].playable,normalizeOriginal(seed));});
function normalizeOriginal(p){return {schemaVersion:1,id:p.id,name:p.name,directors:p.directors.map(d=>({id:d.id,name:d.name,films:d.films.map(f=>({id:f.id,title:f.title,year:f.year,original:f.original}))}))};}
test('imports default to pending, not approved',()=>assert.equal(normalizeCatalog(seed).directors[0].films[0].status,'pending'));
test('unreviewed catalog cannot be published',()=>bad(()=>playableCatalog(normalizeCatalog(seed)),'PENDING_REVIEW'));
test('excluded films and disabled directors are not playable',()=>{const p=normalizeCatalog(seed,'approved');p.directors[0].enabled=false;assert.equal(playableCatalog(p).directors.length,1);p.directors[1].films[0].status='excluded';bad(()=>playableCatalog(p));});
test('empty catalog allowed only in draft',()=>{const p={...seed,directors:[]};assert.equal(normalizeCatalog(p).directors.length,0);bad(()=>playableCatalog(p));});
for(const [name,edit,code]of[
 ['duplicate director ID',p=>p.directors[1].id='one','DUPLICATE'],
 ['duplicate film ID globally',p=>p.directors[1].films[0].id='film-a','DUPLICATE'],
 ['invalid ID',p=>p.id='../attack'],['string year',p=>p.directors[0].films[0].year='2000'],['fractional year',p=>p.directors[0].films[0].year=2000.1],['too old year',p=>p.directors[0].films[0].year=1799],['far future year',p=>p.directors[0].films[0].year=2101],['empty title',p=>p.directors[0].films[0].title='  '],['long title',p=>p.directors[0].films[0].title='a'.repeat(141)],['bad film state',p=>p.directors[0].films[0].status='published'],['schema mismatch',p=>p.schemaVersion=2],['nonboolean director',p=>p.directors[0].enabled='false'],['too many directors',p=>p.directors=Array(13).fill(p.directors[0])],['too many films per director',p=>p.directors[0].films=Array(301).fill(p.directors[0].films[0])]
])test('reject '+name,()=>{const p=clone(seed);edit(p);bad(()=>normalizeCatalog(p),code||'VALIDATION');});
test('500 films maximum across directors',()=>{const p=clone(seed);p.directors.forEach((d,i)=>d.films=Array.from({length:i?251:250},(_,j)=>({id:`f-${i}-${j}`,title:'t',year:2000})));bad(()=>normalizeCatalog(p));});
test('unknown fields are stripped; hostile text stays data',()=>{const p=clone(seed);p.attack='x';p.directors[0].films[0].title='<img src=x onerror=alert(1)>';p.directors[0].films[0].script='execute';const n=normalizeCatalog(p);assert.equal(n.attack,undefined);assert.equal(n.directors[0].films[0].script,undefined);assert.equal(n.directors[0].films[0].title,p.directors[0].films[0].title);});
test('title/year possible duplicates produce warnings, not silent deletion',()=>{const p=clone(seed);p.directors[1].films[0].title=p.directors[0].films[0].title;p.directors[1].films[0].year=p.directors[0].films[0].year;assert.equal(catalogWarnings(normalizeCatalog(p)).length,1);});
test('UTF-8 counting equals Node for Cyrillic and emoji',()=>{for(const s of ['abc','кино','🎥','混合'])assert.equal(byteLength(s),Buffer.byteLength(s));});
test('reject oversized file even in unused fields',()=>bad(()=>normalizeCatalog({...seed,extra:'x'.repeat(LIMITS.fileBytes)}),'TOO_LARGE'));
test('reject arbitrary game URL',()=>bad(()=>gameBuild({...games[0],entry:'https://evil.test/a.js'})));
test('reject initial alias collisions',()=>bad(()=>createInitialState(seed,[games[0],{...games[0],id:'v2'}],'now'),'DUPLICATE'));
test('published catalog is immutable',()=>bad(()=>apply(initial(),'saveCatalog',{id:'original-201-v1',name:'bad',catalog:seed}),'IMMUTABLE'));
test('clone edits never mutate original',()=>{let s=draft();const next=clone(s.catalog_versions[1].catalog);next.name='Another';s=apply(s,'saveCatalog',{id:'catalog-2',name:'Another',catalog:next});assert.equal(s.catalog_versions[0].catalog.name,seed.name);assert.equal(s.catalog_versions[1].catalog.name,'Another');});
test('publish catalog and release do not switch global default',()=>{const s=released();assert.equal(s.app_settings.defaultReleaseId,'classic-1');assert.equal(s.game_releases[1].status,'published');});
test('explicit default switch updates game pointer and audit together',()=>{const s=apply(released(),'setDefault',{id:'classic-2'});assert.equal(s.app_settings.defaultReleaseId,'classic-2');assert.equal(s.app_settings.gameDefaults[0].releaseId,'classic-2');assert.equal(s.audit.at(-1).action,'setDefault');});
test('published release cannot be recreated under same ID',()=>bad(()=>apply(released(),'createRelease',{id:'classic-2',name:'Again',gameVersionId:'v06',catalogVersionId:'catalog-2'}),'DUPLICATE'));
test('draft catalog cannot be bound to a release',()=>bad(()=>apply(draft(),'createRelease',{id:'x',name:'x',gameVersionId:'v06',catalogVersionId:'catalog-2'}),'INCOMPATIBLE'));
test('draft release hidden from players and previewable by admin',()=>{let s=released();s=apply(s,'createRelease',{id:'preview',name:'Preview',gameVersionId:'v06',catalogVersionId:'catalog-2'});bad(()=>resolveLaunch(s,{kind:'release',value:'preview'},false,games),'NOT_FOUND');assert.equal(resolveLaunch(s,{kind:'release',value:'preview'},true,games).preview,true);bad(()=>apply(s,'setDefault',{id:'preview'}),'NOT_PUBLISHED');});
test('default release cannot be archived',()=>bad(()=>apply(initial(),'archiveRelease',{id:'classic-1'}),'DEFAULT_IN_USE'));
test('old release can be archived after both pointers switch',()=>{const s=apply(apply(released(),'setDefault',{id:'classic-2'}),'archiveRelease',{id:'classic-1'});bad(()=>resolveLaunch(s,{kind:'release',value:'classic-1'},true,games),'NOT_FOUND');const restored=apply(s,'restoreRelease',{id:'classic-1'});assert.equal(restored.game_releases[0].status,'draft');});
test('old release still resolves after new default chosen',()=>{const s=apply(released(),'setDefault',{id:'classic-2'});assert.equal(resolveLaunch(s,{kind:'release',value:'classic-1'},false,games).release.id,'classic-1');assert.equal(resolveLaunch(s,{kind:'default'},false,games).release.id,'classic-2');});
test('game override uses selected published release; v1 aliases v06',()=>assert.equal(resolveLaunch(released(),{kind:'game',value:'v1'},false,games).release.id,'classic-1'));
test('missing release errors instead of falling back',()=>bad(()=>resolveLaunch(initial(),{kind:'release',value:'missing'},false,games),'NOT_FOUND'));
test('missing code hash does not load another build',()=>bad(()=>resolveLaunch(initial(),{kind:'default'},false,[{...games[0],codeHash:'b'.repeat(64)}]),'BUILD_UNAVAILABLE'));
test('sync refuses replacing deployed code under existing ID',()=>bad(()=>applyCommand(initial(),{action:'syncGames',input:{}},101,[{...games[0],codeHash:'b'.repeat(64)}]),'IMMUTABLE'));
test('audit keeps latest 200 actions',()=>{let s=initial();for(let i=0;i<205;i++)s=apply(s,'setDefault',{id:'classic-1'});assert.equal(s.audit.length,200);});
for(const [args,expected]of[
 [{},{kind:'default'}], [{startParam:'admin'},{kind:'admin'}], [{startParam:'release_classic-1'},{kind:'release',value:'classic-1'}], [{startParam:'game_v06'},{kind:'game',value:'v06'}], [{startParam:'campaign42'},{kind:'default'}], [{game:'v1',startParam:'release_other'},{kind:'game',value:'v1'}], [{release:'a',game:'b',startParam:'admin'},{kind:'release',value:'a'}]
])test('selector '+JSON.stringify(args),()=>assert.deepEqual(parseSelector(args),expected));
for(const args of [{release:''},{release:'../x'},{game:'<script>'},{startParam:'release_'},{startParam:'game_'}])test('invalid selector '+JSON.stringify(args),()=>bad(()=>parseSelector(args)));
