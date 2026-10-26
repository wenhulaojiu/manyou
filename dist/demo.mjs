import {addDays} from './planner.mjs';
// Explicit, synthetic fixtures. They are never returned by a live provider.
export function demo(q){
 const all=[];let id=0;
 const add=(from,to,date,start,duration,price,mode='rail')=>{const departure=date+'T'+start+':00+08:00';all.push({id:'demo-'+(++id),from,to,fromStation:mode==='rail'&&from===q.from&&q.fromStation?q.fromStation:from+(mode==='flight'?'机场':'东站'),toStation:mode==='rail'&&to===q.to&&q.toStation?q.toStation:to+(mode==='flight'?'机场':'东站'),departure,arrival:new Date(Date.parse(departure)+duration*60000).toISOString(),price,mode,number:mode==='flight'?'演示航班':'演示列车',seat:mode==='flight'?'经济舱':'二等座',source:'演示数据',observedAt:null,available:true})};
 add(q.from,q.to,q.date,'08:00',180,610,'flight');add(q.from,q.to,q.date,'08:00',660,685);add(q.from,q.to,q.date,'09:00',1560,310);
 q.hubs.forEach((hub,i)=>{add(q.from,hub,q.date,'07:00',180,160+i*20);add(q.from,hub,q.date,'08:00',120,220+i*30,'flight');
 const date=addDays(q.date,q.stayDays);add(hub,q.to,date,'12:00',180,150+i*20);add(hub,q.to,date,'15:00',120,200+i*25,'flight');add(hub,q.to,date,'17:30',240,130+i*20)});return all;
}
