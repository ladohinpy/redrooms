import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {setLink} from '../../src/rr/simple.mjs';
const src=fs.readFileSync(new URL('../../tgcloud/lib/rr/runtime.js',import.meta.url),'utf8');
function sandbox(uid=101,{published=true,forbidden=false,sendFails=false}={}){let reads=0;const sent=[];class EndpointError extends Error{constructor(message,parameters){super(message);this.parameters=parameters;}}
 const context=vm.createContext({EndpointError,setLink,ADMIN_IDS:[101,202],GAMES:[],SEED:{},repository:{},checkAccess(){},createService:()=>({read:async()=>{reads++;if(forbidden){const e=new Error('Forbidden');e.name='DomainError';e.code='FORBIDDEN';throw e;}return {state:{game_releases:[{id:'test-set',name:'Test',status:published?'published':'draft'}]}};}}),api:{getMe:async()=>({username:'RedRoomTestBot'}),sendMessage:async x=>{if(sendFails)throw Error('Secret internal error');sent.push(x);}}});
 vm.runInContext(src.replace(/^import .*;\n/gm,'').replace('export async function invoke','async function invoke')+'\nglobalThis.invokeFn=invoke;',context);
 return {run:input=>context.invokeFn('sendLink',input,{initData:{user:{id:uid}}}),sent,get reads(){return reads;}};
}
test('actual send-link endpoint takes recipient ONLY from verified context',async()=>{const x=sandbox(202);assert.equal((await x.run({releaseId:'test-set',chat_id:999,userId:999})).sent,true);assert.equal(x.sent[0].chat_id,202);assert.equal(x.sent[0].text,'Test\n\nhttps://t.me/RedRoomTestBot?startapp=set_test-set');assert.equal(x.reads,1);});
test('actual send-link endpoint checks admin before Bot API write',async()=>{const x=sandbox(303,{forbidden:true});await assert.rejects(x.run({releaseId:'test-set'}),e=>e.parameters.code==='FORBIDDEN');assert.equal(x.sent.length,0);});
test('actual send-link endpoint refuses unpublished release',async()=>{const x=sandbox(101,{published:false});await assert.rejects(x.run({releaseId:'test-set'}),e=>e.parameters.code==='NOT_FOUND');assert.equal(x.sent.length,0);});
test('actual send-link endpoint hides underlying Bot API error',async()=>{const x=sandbox(101,{sendFails:true});await assert.rejects(x.run({releaseId:'test-set'}),e=>e.parameters.code==='BOT_MESSAGE_UNAVAILABLE'&&!e.message.includes('Secret'));});
