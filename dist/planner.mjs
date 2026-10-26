// All durations are minutes. Dates include +08:00; fees and time are separate.
import {cities,stations} from './locations.mjs';
export {cities};
export const minutes = (a,b) => (Date.parse(b)-Date.parse(a))/60000;
export function addDays(date,days){return new Date(Date.parse(date+'T12:00:00+08:00')+days*86400000).toISOString().slice(0,10)}
export function localDate(iso){return new Date(Date.parse(iso)+8*3600000).toISOString().slice(0,10)}
export function fmt(iso){return new Date(iso).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}
export function hours(min){return (min/60).toFixed(1)}
export function validate(q){
 if(!stations.some(s=>s.city===q.from)||!stations.some(s=>s.city===q.to)||q.from===q.to)throw Error('请选择不同的、已支持的出发和目的城市');
 for(const side of ['from','to'])if(q[side+'Station']&&!stations.some(s=>s.city===q[side]&&s.name===q[side+'Station']))throw Error('所选车站不属于'+q[side]);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(q.date)||!Number.isFinite(Date.parse(q.date+'T00:00:00+08:00'))||localDate(q.date+'T00:00:00+08:00')!==q.date)throw Error('出发日期无效');
 for(const [k,min,max] of [['hourValue',0,1000],['buffer',0,180],['stayDays',0,7],['hotel',0,2000],['transferMinutes',15,300],['transferFee',0,500],['budget',0,100000],['maxHours',0,240]])if(!Number.isFinite(q[k])||q[k]<min||q[k]>max)throw Error('请检查'+k+'的范围');
 if(!Number.isInteger(q.stayDays))throw Error('停留天数必须为整数');
 if(!Array.isArray(q.hubs)||q.hubs.length>2||q.hubs.some(c=>!cities.includes(c)||c===q.from||c===q.to)||new Set(q.hubs).size!==q.hubs.length)throw Error('最多选择两个不同中转城市，且不能与起终点相同');
 if(!['all','rail','flight'].includes(q.transport))throw Error('交通方式无效');
 for(const k of ['accessMinutes','egressMinutes','accessFee'])if(q[k]!==undefined&&(!Number.isFinite(q[k])||q[k]<0||q[k]>2000))throw Error('接驳参数无效');
 if(q.seatPreference&&!['any','seat','sleeper'].includes(q.seatPreference))throw Error('席别偏好无效');
 return q;
}
export function evaluate(legs,q,{stayDays=0,baseline=null}={}){
 if(!legs.length||legs.length>2)return null;
 if(legs.some(l=>!Number.isFinite(Date.parse(l.departure))||!Number.isFinite(Date.parse(l.arrival))||minutes(l.departure,l.arrival)<=0||!Number.isFinite(l.price)||l.price<0))return null;
 const access=q.accessMinutes??45,egress=q.egressMinutes??45,initial=legs[0].mode==='flight'?90:30;
 const ride=legs.reduce((n,l)=>n+minutes(l.departure,l.arrival),0);
 let gap=0,transfer=0,board=0,exit=0,buffer=0,leisure=0,spare=0;
 if(legs.length===2){
  if(legs[0].to!==legs[1].from)return null;
  gap=minutes(legs[0].arrival,legs[1].departure);
  if(gap<0)return null;
  transfer=legs[0].toStation===legs[1].fromStation?15:q.transferMinutes;
  if(stayDays)transfer=Math.max(transfer,90); // station→city→station allowance
  exit=legs[0].mode==='flight'?45:10;board=legs[1].mode==='flight'?90:30;buffer=q.buffer;
  const required=transfer+exit+board+buffer;
  if(gap<required)return null;
  if(stayDays){
   if(localDate(legs[1].departure)!==addDays(localDate(legs[0].arrival),stayDays))return null;
   leisure=gap-required;
  }else{if(gap>12*60)return null;spare=gap-required;}
 }
 const totalMinutes=ride+gap+access+egress+initial;
 const travelMinutes=totalMinutes-leisure; // optional sightseeing is excluded, mandatory handling remains
 const departure=new Date(Date.parse(legs[0].departure)-(access+initial)*60000).toISOString();
 const arrival=new Date(Date.parse(legs.at(-1).arrival)+egress*60000).toISOString();
 const overnight=legs.some(l=>localDate(l.departure)!==localDate(l.arrival))||localDate(departure)!==localDate(legs[0].departure)||localDate(arrival)!==localDate(legs.at(-1).arrival)||(!stayDays&&legs.length===2&&localDate(legs[0].arrival)!==localDate(legs[1].departure));
 const ticket=legs.reduce((n,l)=>n+l.price,0),accessFee=q.accessFee??40;
 const hotelNights=stayDays;const hotelFee=hotelNights*q.hotel;
 const transferFee=legs.length===2?q.transferFee:0;
 const cash=ticket+accessFee+transferFee+hotelFee;
 const score=cash+travelMinutes/60*q.hourValue;
 const saving=baseline?baseline.cash-cash:null,extra=baseline?(travelMinutes-baseline.travelMinutes)/60:null;
 const rate=saving!==null&&extra>0?saving/extra:null;
 const worthwhile=baseline?(extra<=0?saving>=0:saving>=q.hourValue*extra):null;
 return {id:legs.map(l=>l.id).join('|'),legs,departure,arrival,totalMinutes,travelMinutes,ride,access,egress,initial,gap,transfer,exit,board,buffer,spare,leisure,stayDays,hotelNights,overnight,ticket,accessFee,transferFee,hotelFee,cash,score,saving,extra,rate,worthwhile,estimated:true};
}
export function plan(segments,q,{now=null}={}){
 const usable=segments.filter(l=>Number.isFinite(Date.parse(l.departure))&&Number.isFinite(Date.parse(l.arrival))&&(l.mode!=='rail'||!q.seatPreference||q.seatPreference==='any'||(q.seatPreference==='sleeper'?/卧/.test(l.seat):!/卧/.test(l.seat)))&&(q.transport==='all'||l.mode===q.transport)&&l.available!==false);
 const direct=usable.filter(l=>l.from===q.from&&l.to===q.to&&localDate(l.departure)===q.date).map(l=>evaluate([l],q)).filter(r=>r&&(!q.fromStation||r.legs[0].fromStation===q.fromStation)&&(!q.toStation||r.legs[0].toStation===q.toStation)&&(now===null||Date.parse(r.departure)>=now));
 const eligible=r=>(!q.budget||r.cash<=q.budget)&&(!q.maxHours||r.travelMinutes<=q.maxHours*60)&&(!q.noOvernight||!r.overnight);
 const baseline=[...direct.filter(eligible)].sort((a,b)=>a.travelMinutes-b.travelMinutes||a.cash-b.cash)[0]||null;
 let options=q.stayDays?[]:direct.map(r=>evaluate(r.legs,q,{baseline}));
 for(const hub of q.hubs){
  const first=usable.filter(l=>l.from===q.from&&l.to===hub&&localDate(l.departure)===q.date);
  const second=usable.filter(l=>l.from===hub&&l.to===q.to).map(l=>({leg:l,time:Date.parse(l.departure)})).sort((a,b)=>a.time-b.time);
  const lowerBound=time=>{let lo=0,hi=second.length;while(lo<hi){const mid=(lo+hi)>>>1;if(second[mid].time<time)lo=mid+1;else hi=mid}return lo};
  for(const a of first){
   const arrival=Date.parse(a.arrival);
   const day=q.stayDays?addDays(localDate(a.arrival),q.stayDays):null;
   const start=day?Date.parse(day+'T00:00:00+08:00'):arrival;
   const end=day?start+86400000-1:arrival+12*3600000;
   // Only compatible departure windows enter the exact transfer calculation.
   for(let i=lowerBound(start);i<second.length&&second[i].time<=end;i++){
    const r=evaluate([a,second[i].leg],q,{stayDays:q.stayDays,baseline});if(r)options.push(r);
   }
  }
 }
 const seen=new Set();options=options.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return (!q.fromStation||r.legs[0].fromStation===q.fromStation)&&(!q.toStation||r.legs.at(-1).toStation===q.toStation)&&(now===null||Date.parse(r.departure)>=now)&&(!q.budget||r.cash<=q.budget)&&(!q.maxHours||r.travelMinutes<=q.maxHours*60)&&(!q.noOvernight||!r.overnight)&&(!q.onlyWorth||r.worthwhile===true)});
 options.sort((a,b)=>q.sort==='price'?a.cash-b.cash:q.sort==='time'?a.travelMinutes-b.travelMinutes:a.score-b.score);
 const featured=new Map();
 for(const [label,key] of [['最符合时薪偏好','score'],['最省钱','cash'],['最快','travelMinutes']]){
  const best=options.reduce((best,r)=>!best||r[key]<best[key]||(r[key]===best[key]&&r.cash<best.cash)?r:best,null);
  if(best){if(!featured.has(best.id))featured.set(best.id,{route:best,labels:[]});featured.get(best.id).labels.push(label)}
 }
 return {options,total:options.length,baseline,featured:[...featured.values()]};
}
