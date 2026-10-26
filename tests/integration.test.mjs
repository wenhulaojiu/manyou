import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {readSearchStream} from '../dist/search-client.mjs';
import {addDays,localDate} from '../dist/planner.mjs';
const q={from:'上海',to:'成都',date:addDays(localDate(new Date().toISOString()),1),hubs:[],transport:'rail',hourValue:20,buffer:30,stayDays:0,hotel:150,transferMinutes:60,transferFee:30,budget:0,maxHours:0,noOvernight:false,onlyWorth:false,sort:'value'};
async function serve(t,options){const app=createApp(options);await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));t.after(()=>{app.closeAllConnections();return new Promise(resolve=>app.close(resolve))});return 'http://127.0.0.1:'+app.address().port}
const post=(base,id,body=q)=>fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Search-Id':id},body:JSON.stringify(body)});
test('HTTP accepts split UTF-8 Chinese and returns one completed NDJSON stream',async t=>{
 let received;
 const base=await serve(t,{providerFactory:()=>({flightConfigured:()=>false,rail:async from=>{received=from;return []}}),searchOptions:{intervalMs:0}});
 const bytes=Buffer.from(JSON.stringify(q)),split=bytes.indexOf(Buffer.from('上'))+1;
 const response=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/search',{method:'POST',headers:{Accept:'application/x-ndjson'}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({code:res.statusCode,text}))});req.on('error',reject);req.write(bytes.subarray(0,split));setImmediate(()=>req.end(bytes.subarray(split)))});
 assert.equal(response.code,200);assert.equal(received,'上海');const events=response.text.trim().split('\n').map(JSON.parse);assert.equal(events.at(-1).type,'done');assert.equal(events.filter(e=>e.type==='done').length,1);
});
test('busy search, mismatched cancellation and immediate restart are isolated',async t=>{
 let generation=0,oldClosed=false;
 const base=await serve(t,{providerFactory:()=>{const first=++generation===1;return {flightConfigured:()=>false,rail:()=>first?new Promise(()=>{}):Promise.resolve([]),close:async()=>{if(first){await new Promise(r=>setTimeout(r,40));oldClosed=true}}}},searchOptions:{intervalMs:0,timeoutMs:1000}});
 const first=await post(base,'first');const events=[];const consume=readSearchStream(first,e=>events.push(e));
 assert.equal((await post(base,'other')).status,429);
 assert.equal((await fetch(base+'/api/cancel',{method:'POST',headers:{'X-Search-Id':'wrong'}})).status,409);
 assert.equal((await fetch(base+'/api/cancel',{method:'POST',headers:{'X-Search-Id':'first'}})).status,200);
 await consume;assert.equal(events.at(-1).result.progress.phase,'stopped');
 const next=await post(base,'second');assert.equal(next.status,200);await readSearchStream(next,()=>{});
 await new Promise(r=>setTimeout(r,60));assert(oldClosed);
});
test('HTTP rejects foreign origins, oversized bodies, and arbitrary file paths',async t=>{
 const base=await serve(t,{});
 assert.equal((await fetch(base+'/api/status',{headers:{Origin:'https://example.org'}})).status,403);
 assert.equal((await fetch(base+'/api/search',{method:'POST',body:'x'.repeat(8100)})).status,413);
 assert.equal((await fetch(base+'/package.json')).status,404);
 const worker=await fetch(base+'/planner-worker.mjs');assert.equal(worker.status,200);assert(worker.headers.get('content-security-policy').includes("worker-src 'self'"));
 assert.equal((await fetch(base+'/vendor/comlink.mjs')).status,200);
 assert((await (await fetch(base+'/api/airports')).json()).cities['成都'].some(a=>a.iata==='TFU'));
});
