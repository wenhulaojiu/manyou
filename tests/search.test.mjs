import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchCities} from '../dist/city-search.mjs';
import {scanRail} from '../rail-scan.mjs';
import {runSearch} from '../search-engine.mjs';
import {plan,localDate,addDays} from '../dist/planner.mjs';
const date=addDays(localDate(new Date().toISOString()),1);
const q={from:'上海',to:'成都',date,hubs:['武汉'],transport:'rail',hourValue:20,buffer:30,stayDays:0,hotel:150,transferMinutes:60,transferFee:30,budget:0,maxHours:0,noOvernight:false,onlyWorth:false,sort:'value'};
const row=(id,from,to)=>({id,from,to,fromStation:from,toStation:to,departure:date+'T08:00:00+08:00',arrival:date+'T12:00:00+08:00',price:100,mode:'rail',available:true});
test('Chinese, full pinyin and initials find the city',()=>{
 for(const text of ['上海','shanghai','SH','上海市'])assert(searchCities(text).some(c=>c.name==='上海'));
 assert.equal(searchCities('chongqing')[0].name,'重庆');assert.equal(searchCities('notacity').length,0);
});
test('station query keeps successes after a later failure',async()=>{
 let calls=0;const events=[];
 const r=await scanRail('上海','成都',date,{fromStation:'上海虹桥',deadline:Date.now()+10000,onUpdate:e=>events.push(e)},async()=>{calls++;if(calls===1)return [{...row('one','上海','成都'),fromStation:'上海虹桥'}];throw Error('upstream failed')});
 assert.equal(r.rows.length,1);assert.equal(r.complete,false);assert(r.pairs.failed>0);assert(events.some(e=>e.rows.length===1));
});
test('stop preserves collected rows and does not start another station pair',async()=>{
 const controller=new AbortController();let calls=0;
 const r=await scanRail('上海','成都',date,{fromStation:'上海虹桥',signal:controller.signal},async()=>{calls++;controller.abort();return [{...row('one','上海','成都'),fromStation:'上海虹桥'}]});
 assert.equal(calls,1);assert.equal(r.rows.length,1);assert.equal(r.complete,false);
});
test('direct results are emitted before transfers and a failed segment does not disable the source',async()=>{
 const events=[],calls=[];
 const providers={flightConfigured:()=>false,rail:async(from,to,d,opts)=>{
  calls.push(from+'-'+to);if(to==='成都'&&from==='上海')throw Error('direct failure');
  const rows=[row(from+to,from,to)];opts.onUpdate({rows,pairs:{done:1,total:1,failed:0},current:from+'-'+to});return {rows,complete:true,pairs:{done:1,total:1,failed:0}};
 }};
 const result=await runSearch(q,providers,{emit:e=>events.push(e)});
 assert(calls.includes('武汉-成都'));assert(result.segments.length>0);assert.equal(result.partial,true);assert.equal(events[0].type,'start');assert.equal(events.at(-1).type,'done');assert(events.some(e=>e.type==='segments'&&e.segments.length));
});
test('deadline is reported without pretending all hubs were searched',async()=>{
 const result=await runSearch(q,{rail:()=>assert.fail('must not query'),flightConfigured:()=>false},{timeoutMs:-1});
 assert.equal(result.progress.phase,'timeout');assert.equal(result.progress.hubsDone,0);assert.equal(result.partial,true);
});
test('featured choices use all candidates even beyond list limit, and identical winners merge',()=>{
 const rows=Array.from({length:80},(_,i)=>({...row(String(i),'上海','成都'),price:i+1,arrival:date+`T${String(23-Math.floor(i/8)).padStart(2,'0')}:00:00+08:00`}));
 const result=plan(rows,{...q,sort:'price'});
 assert.equal(result.options.length,80);assert(result.featured.some(f=>f.labels.includes('最快')&&Number(f.route.id)>=60));
 const single=plan([rows[0]],q);assert.equal(single.featured.length,1);assert.equal(single.featured[0].labels.length,3);
});

 test('hard deadline ends an unresponsive provider',async()=>{
 const r=await runSearch({...q,hubs:[]},{rail:()=>new Promise(()=>{}),flightConfigured:()=>false},{timeoutMs:20});
 assert.equal(r.progress.phase,'timeout');assert.equal(r.partial,true);
 });
 test('abort ends an unresponsive provider',async()=>{
 const c=new AbortController();setTimeout(()=>c.abort(),10);
 const r=await runSearch(q,{rail:()=>new Promise(()=>{}),flightConfigured:()=>false},{signal:c.signal});assert.equal(r.progress.phase,'stopped');
 });
