import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,plan,validate,addDays,localDate} from '../dist/planner.mjs';
import {normalizeRail} from '../providers.mjs';
const q={from:'上海',to:'成都',date:'2026-10-25',hubs:['武汉'],transport:'all',hourValue:20,buffer:30,stayDays:0,hotel:150,transferMinutes:60,transferFee:30,budget:0,maxHours:0,noOvernight:false,onlyWorth:false,sort:'value'};
const leg=(id,from,to,dep,arr,price,mode='rail')=>({id,from,to,fromStation:from+'站',toStation:to+'站',departure:dep+'+08:00',arrival:arr+'+08:00',price,mode,available:true});
const direct=leg('d','上海','成都','2026-10-25T08:00:00','2026-10-25T11:00:00',610,'flight');
const a=leg('a','上海','武汉','2026-10-25T07:00:00','2026-10-25T10:00:00',160);
const b=leg('b','武汉','成都','2026-10-25T12:00:00','2026-10-25T15:00:00',150);
test('cash and time are separate and connections are not double counted',()=>{const r=evaluate([a,b],q);assert.equal(r.cash,380);assert.equal(r.totalMinutes,600);assert.equal(r.score,580);assert.equal(r.spare,35)});
test('exact buffer boundary and one minute short',()=>{assert(evaluate([a,b],{...q,buffer:65}));assert.equal(evaluate([a,b],{...q,buffer:66}),null)});
test('different stations require longer transfer',()=>{const c={...b,fromStation:'武汉其他站'};assert.equal(evaluate([a,c],{...q,buffer:21}),null);assert(evaluate([a,c],{...q,buffer:20}))});
test('reversed dates never silently roll to next day',()=>{assert.equal(evaluate([b,a],q),null)});
test('threshold measures savings divided by extra travel hours',()=>{const r=plan([direct,a,b],q).options.find(r=>r.legs.length===2);assert.equal(r.saving,270);assert.equal(r.extra,4);assert.equal(r.rate,67.5);assert.equal(r.worthwhile,true);assert.equal(plan([direct,a,b],{...q,hourValue:70,onlyWorth:true}).options.length,1)});
test('higher time value changes the recommendation',()=>{assert.equal(plan([direct,a,b],{...q,hourValue:0}).options[0].legs.length,2);assert.equal(plan([direct,a,b],{...q,hourValue:100}).options[0].legs.length,1)});
test('intentional city stay adds accommodation but excludes leisure time',()=>{const c={...b,departure:'2026-10-27T12:00:00+08:00',arrival:'2026-10-27T15:00:00+08:00'};const r=evaluate([a,c],q,{stayDays:2});assert(r);assert.equal(r.hotelFee,300);assert.equal(r.totalMinutes,3480);assert.equal(r.travelMinutes,640);assert.equal(r.leisure,2840);assert.equal(r.overnight,false)});
test('stopover date based on first arrival, including overnight first leg',()=>{const overnight={...a,arrival:'2026-10-26T01:00:00+08:00'};assert.equal(evaluate([overnight,b],q,{stayDays:2}),null)});
test('overnight rail filtered, optional city holiday not filtered',()=>{const night={...direct,mode:'rail',arrival:'2026-10-26T08:00:00+08:00'};assert.equal(plan([night],{...q,noOvernight:true}).options.length,0);const c={...b,departure:'2026-10-27T12:00:00+08:00',arrival:'2026-10-27T15:00:00+08:00'};assert.equal(plan([a,c],{...q,stayDays:2,noOvernight:true}).options.length,1)});
test('invalid inputs and impossible dates rejected',()=>{for(const bad of [{...q,hourValue:-1},{...q,stayDays:1.5},{...q,date:'2026-02-30'},{...q,hubs:['上海']},{...q,from:'未知城市'}])assert.throws(()=>validate(bad));assert.equal(addDays('2026-12-31',1),'2027-01-01')});
test('unknown or unavailable fares are excluded, never zero-filled',()=>{assert.equal(evaluate([{...direct,price:undefined}],q),null);assert.equal(plan([{...direct,available:false}],q).options.length,0)});
test('live planning excludes a departure when access and preparation time no longer fit',()=>{assert.equal(plan([direct],q,{now:Date.parse('2026-10-25T05:45:00+08:00')}).options.length,1);const r=plan([direct],q,{now:Date.parse('2026-10-25T05:46:00+08:00')});assert.equal(r.options.length,0);assert.equal(r.baseline,null)});
test('rail adapter uses boarding date, parses overnight duration, excludes sold-out and standing',()=>{const row={train_no:'train',start_train_code:'K1',from_station:'上海',to_station:'武汉',from_station_telecode:'SHH',to_station_telecode:'WHN',start_date:'2026-10-24',start_time:'22:00',lishi:'10:30',prices:[{seat_name:'无座',price:5,num:'有'},{seat_name:'硬座',price:100,num:'无'},{seat_name:'硬卧',price:200,num:'3'}]};const [r]=normalizeRail([row],'上海','武汉','2026-10-25');assert.equal(r.price,200);assert.equal(localDate(r.arrival),'2026-10-26');assert.equal(r.departure,'2026-10-25T22:00:00+08:00');assert.equal(normalizeRail([{...row,prices:[]}],'上海','武汉','2026-10-25').length,0)});


test('station selection belongs to its city and constrains routes',()=>{assert.throws(()=>validate({...q,fromStation:'成都东'}));assert.equal(validate({...q,fromStation:'上海虹桥'}).fromStation,'上海虹桥');assert.equal(plan([direct,a,b],{...q,fromStation:'上海虹桥'}).options.length,0)});

test('stay is required and unknown value is excluded',()=>{assert.equal(plan([direct],{...q,stayDays:2}).options.length,0);assert.equal(plan([a,b],{...q,onlyWorth:true}).options.length,0)});
test('baseline respects budget and access is configurable',()=>{assert.equal(plan([direct],{...q,budget:100}).baseline,null);const r=evaluate([direct],{...q,accessMinutes:10,egressMinutes:20,accessFee:5});assert.equal(r.access,10);assert.equal(r.egress,20);assert.equal(r.cash,615)});
