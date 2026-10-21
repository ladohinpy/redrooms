import { clone } from '../../src/rr/domain.mjs';
export const seed={schemaVersion:1,id:'sample',name:'Тестовый набор',directors:[{id:'one',name:'Режиссёр один',films:[{id:'film-a',title:'Первый фильм',original:'First film',year:2001}]},{id:'two',name:'Режиссёр два',films:[{id:'film-b',title:'Второй фильм',original:'Second film',year:2002}]}]};
export const games=[{id:'v06',name:'Classic',codeHash:'a'.repeat(64),entry:'/games/v06/'+ 'a'.repeat(16)+'/index.html',catalogSchemaVersion:1,aliases:['v1']}];
export const ctx=(uid,start)=>({initData:{user:{id:uid},...(start?{start_param:start}:{})}});
export function memoryRepository(){let row=null;return{
 async read(){return row?clone(row):null;},
 async initialize(state){if(!row)row={id:'application',revision:1,state:clone(state)};return clone(row);},
 async compareSwap(revision,state){if(row?.revision!==revision)return null;row={id:'application',revision:revision+1,state:clone(state)};return clone(row);}
};}
// Minimal fixture for integration-marker tests. NOT the real game or a substitute for it.
export function legacyFixture(pack=seed){return `<!doctype html><html><head><script src="access-gate.js"></script><script id="default-dataset" type="application/json">${JSON.stringify(pack)}</script></head><body><div id="boot"></div><div id="error"></div><script>
const dataset=JSON.parse(document.getElementById('default-dataset').textContent);let SAVE_KEY;
function hashText(s){return 'fixture'}
async function launchArchive(){const dataset=JSON.parse(document.getElementById('default-dataset').textContent);const catalogFingerprint=JSON.stringify(dataset);SAVE_KEY = \`red-room-v06-pack:\${dataset.id}:\${hashText(catalogFingerprint)}\`;document.getElementById('boot').textContent=dataset.name;window.fixtureReady=true;}
window.archiveReady=launchArchive().catch(e=>{document.getElementById('error').textContent=e.message;});</script></body></html>`;}
