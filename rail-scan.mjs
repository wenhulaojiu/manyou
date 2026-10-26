import {stations} from './dist/locations.mjs';

// Keep successful station pairs even if a later pair fails or the user stops.
export async function scanRail(from,to,date,options={},queryPair){
 const endpoints=(city,selected)=>selected?[selected]:[...new Set(stations.filter(s=>s.city===city).map(s=>s.name))];
 const rank=(list,city)=>list.sort((a,b)=>(options.timetable?.stationScore(b,date)||0)-(options.timetable?.stationScore(a,date)||0)||Number(b.startsWith(city))-Number(a.startsWith(city))||a.localeCompare(b,'zh-CN'));
 const origins=rank(endpoints(from,options.fromStation),from),destinations=rank(endpoints(to,options.toStation),to);
 if(!origins.length||!destinations.length)return {rows:[],complete:false,message:'城市暂无铁路车站数据',pairs:{done:0,total:0,failed:0}};
 const rows=new Map(),pairs={done:0,total:origins.length*destinations.length,failed:0};
 let message='';
 const scores=options.timetable?.pairs(origins,destinations,date);
 const combinations=origins.flatMap((a,i)=>destinations.map((b,j)=>({a,b,order:i+j,score:scores?.get(a+'|'+b)||0}))).sort((a,b)=>b.score-a.score||a.order-b.order);
 pairsLoop: for(const {a,b} of combinations){
  if(options.signal?.aborted||Date.now()>options.deadline){message=options.signal?.aborted?'已停止，保留已查到车次':'达到本区间查询时限，保留已查到车次';break pairsLoop}
  options.onUpdate?.({rows:[],pairs:{...pairs},current:a+' → '+b});
  let added=[];
  try{
   const key=[a,b,date].join('|');let result=options.cache?.get(key);
   if(!result){result=await (options.schedule?options.schedule(()=>queryPair(from,to,date,a,b)):queryPair(from,to,date,a,b));options.cache?.set(key,result)}
   for(const original of result){
    const l={...original,from,to};
    if((options.fromStation&&l.fromStation!==options.fromStation)||(options.toStation&&l.toStation!==options.toStation))continue;
    if(!rows.has(l.id)){rows.set(l.id,l);added.push(l)}
   }
  }catch(e){pairs.failed++;message=e.message}
  pairs.done++;
  options.onUpdate?.({rows:added,pairs:{...pairs},current:a+' → '+b});
 }
 return {rows:[...rows.values()],complete:pairs.done===pairs.total&&!pairs.failed,message,pairs};
}
