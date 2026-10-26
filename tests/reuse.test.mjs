import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTimetable,loadTimetable} from '../timetable.mjs';
import {createPlannerStore} from '../dist/planner-store.mjs';
import {plan,evaluate,addDays,localDate} from '../dist/planner.mjs';
import {demo} from '../dist/demo.mjs';
import {runSearch} from '../search-engine.mjs';
const date=addDays(localDate(new Date().toISOString()),1);
const q={from:'上海',to:'成都',date,hubs:['武汉'],transport:'all',hourValue:20,buffer:30,stayDays:0,hotel:150,transferMinutes:60,transferFee:30,budget:0,maxHours:0,noOvernight:false,onlyWorth:false,sort:'value'};
test('sleeper preference keeps flights and demo never labels an airport as a chosen station',()=>{
 const rows=demo(q);assert(plan(rows,{...q,seatPreference:'sleeper'}).options.some(r=>r.legs.every(l=>l.mode==='flight')));
 const selected={...q,fromStation:'上海虹桥'};assert(demo(selected).filter(l=>l.mode==='flight').every(l=>l.fromStation!=='上海虹桥'));
 assert(plan(demo(selected),selected).options.every(r=>r.legs[0].mode==='rail'));
});
test('indexed departure windows match exhaustive combinations for transfers and stays',()=>{
 const first=Array.from({length:12},(_,i)=>({id:'a'+i,from:'上海',to:'武汉',fromStation:'上海',toStation:'武汉',mode:i%2?'rail':'flight',price:100,departure:date+'T06:00:00+08:00',arrival:new Date(Date.parse(date+'T08:00:00+08:00')+i*3600000).toISOString()}));
 const second=Array.from({length:96},(_,i)=>({id:'b'+i,from:'武汉',to:'成都',fromStation:i%2?'武汉':'汉口',toStation:'成都',mode:i%3?'rail':'flight',price:100,departure:new Date(Date.parse(date+'T08:00:00+08:00')+i*3600000).toISOString(),arrival:new Date(Date.parse(date+'T09:00:00+08:00')+i*3600000).toISOString()}));
 for(const stayDays of [0,1,2]){
  const expected=first.flatMap(a=>second.map(b=>evaluate([a,b],q,{stayDays}))).filter(Boolean).map(r=>r.id).sort();
  assert.deepEqual(plan([...first,...second],{...q,stayDays}).options.map(r=>r.id).sort(),expected);
 }
});
test('planner keeps full recommendations in worker cache while returning only requested page',()=>{
 let calls=0;const store=createPlannerStore((...args)=>{calls++;return plan(...args)}),rows=demo(q);
 const request={segments:rows,revision:1,query:q,now:null,limit:0,selectedIds:[]};
 const first=store.page(request);assert(first.total>first.featured.length);assert.equal(first.options.length,0);
 const next=store.page({...request,segments:undefined,limit:6,query:{...q,sort:'price'},selectedIds:[first.featured[0].route.id]});assert.equal(calls,1);assert.equal(next.selected.length,1);assert(next.options.length<=6);
 store.page({...request,query:{...q,budget:100}});assert.equal(calls,2);
});
test('timetable handles GTFS times after midnight and stale data falls back',()=>{
 const service=addDays(date,-1).replaceAll('-','');
 const data={metadata:{start:service,end:date.replaceAll('-',''),importedAt:new Date().toISOString()},stops:[{name:'甲',city:'上海',calls:9},{name:'乙',city:'成都',calls:2}],trips:[{dates:[service],stops:[['甲',1500,1500],['乙',1800,1800]]}]};
 assert.equal(createTimetable(data).pairs(['甲'],['乙'],date).get('甲|乙'),1);
 const stale=createTimetable({...data,metadata:{...data.metadata,importedAt:'2020-01-01T00:00:00Z'}});assert.equal(stale.status(date).available,false);assert.equal(stale.stationScore('甲',date),0);assert.deepEqual(stale.hubs('上海','成都',date,['武汉','重庆']),['武汉','重庆']);
});
test('imported timetable prioritizes actual Shanghai to Chengdu service pairs',async()=>{
 const index=await loadTimetable();assert(index);const scores=index.pairs(['练塘','上海虹桥'],['成都东'],date);if(index.status(date).available)assert(scores.get('上海虹桥|成都东')>scores.get('练塘|成都东'));
});
test('late callbacks after abort cannot add events or alter the completed result',async()=>{
 const events=[];let update;const controller=new AbortController();
 const promise=runSearch({...q,hubs:[],transport:'rail'},{rail:(_f,_t,_d,opts)=>{update=opts.onUpdate;return new Promise(()=>{})},flightConfigured:()=>false},{signal:controller.signal,emit:e=>events.push(e),intervalMs:0});
 await new Promise(r=>setImmediate(r));controller.abort();const result=await promise,count=events.length;
 update({rows:demo(q),pairs:{done:1,total:1,failed:0},current:'late'});assert.equal(events.length,count);assert.equal(result.segments.length,0);
});
test('queued station work respects concurrency and abort removes pending work',async()=>{
 let running=0,maximum=0,started=0;const controller=new AbortController();
 const providers={flightConfigured:()=>false,rail:async(_from,_to,_date,opts)=>{
  const jobs=Array.from({length:12},()=>opts.schedule(async()=>{started++;maximum=Math.max(maximum,++running);try{await new Promise(resolve=>setTimeout(resolve,40));return []}finally{running--}}));
  const settled=await Promise.allSettled(jobs);return {rows:[],complete:settled.every(j=>j.status==='fulfilled')};
 }};
 const result=runSearch({...q,transport:'rail',hubs:[]},providers,{signal:controller.signal,intervalMs:50});
 setTimeout(()=>controller.abort(),25);await result;const atAbort=started;await new Promise(r=>setTimeout(r,80));assert.equal(started,atAbort);assert(started<=2);assert(maximum<=3);
});
