import {addDays,localDate} from './dist/planner.mjs';
import PQueue from 'p-queue';
import {abortable,deadlineScope} from './async-utils.mjs';
export const automaticHubs=['郑州','武汉','西安','长沙','南京','合肥','徐州','济南','石家庄','太原','南昌','杭州','上海','北京','广州','深圳','重庆','成都','贵阳','昆明','南宁','柳州','衡阳','株洲','怀化','襄阳','宜昌','九江','阜阳','蚌埠','商丘','洛阳','宝鸡','兰州','西宁','银川','呼和浩特','沈阳','长春','哈尔滨','天津','青岛','福州','厦门','温州','宁波','南通','苏州','无锡','常州','盐城','连云港','淮安','赣州','上饶','鹰潭','绵阳','遵义','曲靖','大理','乌鲁木齐','拉萨'];

export async function runSearch(q,providers,{emit=()=>{},signal:externalSignal,timeoutMs=180000,timetable=null,intervalMs=500}={}) {
 const scope=deadlineScope(externalSignal,timeoutMs),signal=scope.signal,started=Date.now();
 const deadline=started+timeoutMs;
 const today=localDate(new Date().toISOString());
 const queue=new PQueue({concurrency:3,interval:intervalMs,intervalCap:2});
 const hubQueue=new PQueue({concurrency:4});
 const initial=timetable?.hubs(q.from,q.to,q.date,automaticHubs)||automaticHubs;
 let hubs=q.autoSearch?[...new Set([...q.hubs,...initial])].filter(c=>c!==q.from&&c!==q.to):[...q.hubs];
 const segments=new Map(),checks=[],cache=new Map(),pairCache=new Map();
 const search={hubs,exhaustiveNationwide:false,timetable:timetable?.status(q.date)||{available:false},discovery:null};
 const progress={phase:'direct',hubsDone:0,hubsTotal:hubs.length,current:'正在准备直达查询',elapsedSeconds:0};
 let finished=false;
 const event=(type,extra={})=>{if(finished)return;progress.elapsedSeconds=Math.round((Date.now()-started)/1000);emit({type,progress:{...progress},...extra})};
 const add=rows=>{if(finished||signal.aborted)return [];const fresh=[];for(const l of rows)if(!segments.has(l.id)){segments.set(l.id,l);fresh.push(l)}return fresh};
 const query=(from,to,date,phase)=>{
  const key=[from,to,date].join('|');if(cache.has(key))return cache.get(key);
  const pending=(async()=>{
   const found=[];
   for(const mode of q.transport==='all'?['rail','flight']:[q.transport]) {
    const check={from,to,date,mode,state:'ok',count:0};
    const finish=()=>{checks.push(check);event('check',{check})};
    if(signal.aborted||Date.now()>=deadline){check.state='skipped';check.message='已停止或达到总时限';finish();continue}
    if(mode==='rail'&&(date<today||date>addDays(today,14))){check.state='skipped';check.message='超出铁路 15 天查询窗口';finish();continue}
    if(mode==='flight'&&((from===q.from&&q.fromStation)||(to===q.to&&q.toStation))){check.state='excluded';check.message='所选火车站不包含航空出行';finish();continue}
    if(mode==='flight'&&!providers.flightConfigured()){check.state='unconfigured';check.message='机票授权账号未配置';finish();continue}
    const segmentScope=deadlineScope(signal,Math.min(deadline-Date.now(),phase==='direct'?30000:15000));
    let accepting=true;
    const receive=rows=>{if(!accepting||finished||segmentScope.signal.aborted)return;event('segments',{segments:add(rows)})};
    progress.current=from+' → '+to+' · '+date;event('progress');
    try {
     const options={signal:segmentScope.signal,deadline:Date.now()+Math.min(deadline-Date.now(),phase==='direct'?30000:15000),cache:pairCache,timetable,fromStation:from===q.from?q.fromStation:null,toStation:to===q.to?q.toStation:null};
     let result;
     // Each station/airport pair queues separately so concurrent city scans take turns.
     options.schedule=work=>queue.add(()=>abortable(work,segmentScope.signal),{signal:segmentScope.signal,priority:phase==='direct'?10:0});
     if(mode==='rail') {
      options.onUpdate=u=>{if(accepting&&!segmentScope.signal.aborted){progress.pairs=u.pairs;progress.current=u.current+' · '+date;receive(u.rows)}};
      result=await abortable(()=>providers.rail(from,to,date,options),segmentScope.signal);
     } else {
      options.onUpdate=receive;
      result=await abortable(()=>providers.flight(from,to,date,options),segmentScope.signal);
     }
     const rows=Array.isArray(result)?result:result.rows;
     found.push(...rows);receive(rows);check.count=rows.length;
     if(!Array.isArray(result)){check.pairs=result.pairs;check.coverage=result.coverage;if(!result.complete){check.state='partial';check.message=result.message||'部分站点或机场尚未完成'}}
    } catch(e) {check.state=segmentScope.signal.aborted?'partial':'failed';check.message=segmentScope.signal.aborted?'已停止或达到区间时限，保留已返回数据':e.message}
    finally {accepting=false;segmentScope.dispose()}
    // Include successful increments even if this segment timed out later.
    for(const l of segments.values())if(l.from===from&&l.to===to&&localDate(l.departure)===date&&!found.some(x=>x.id===l.id))found.push(l);
    finish();
   }
   return found;
  })();cache.set(key,pending);return pending;
 };
 event('start',{search});
 try {
  await query(q.from,q.to,q.date,'direct');
  if(q.autoSearch&&q.transport!=='flight'&&providers.discoverHubs&&!signal.aborted&&q.date<=addDays(today,14)) {
   progress.phase='discovery';progress.current='查询铁路中转建议';event('progress');
   const discoverScope=deadlineScope(signal,Math.min(8000,deadline-Date.now()));
   try {
    const discovered=await abortable(()=>providers.discoverHubs(q.from,q.to,q.date,{signal:discoverScope.signal,deadline:Date.now()+8000,fromStation:q.fromStation,toStation:q.toStation}),discoverScope.signal);
    hubs=[...new Set([...q.hubs,...discovered,...hubs])].filter(c=>c!==q.from&&c!==q.to);
    search.hubs=hubs;search.discovery={state:'ok',hubs:discovered};progress.hubsTotal=hubs.length;
   }catch(e){search.discovery={state:'failed',message:e.message}}
   finally{discoverScope.dispose()}
   event('scope',{search});
  }
  progress.phase='transfers';
  const tasks=hubs.map(hub=>hubQueue.add(async()=>{
   if(signal.aborted||Date.now()>=deadline)return;
   const first=await query(q.from,hub,q.date,'transfers');
   const dates=[...new Set(first.map(l=>addDays(localDate(l.arrival),q.stayDays)))];
   for(const date of dates){if(signal.aborted)break;await query(hub,q.to,date,'transfers');if(!q.stayDays&&!signal.aborted)await query(hub,q.to,addDays(date,1),'transfers')}
   if(!signal.aborted){progress.hubsDone++;event('progress')}
  },{signal,priority:q.hubs.includes(hub)?10:0}));
  await Promise.allSettled(tasks);
 } finally {scope.dispose()}
 progress.phase=externalSignal?.aborted?'stopped':signal.aborted||Date.now()>=deadline?'timeout':'done';progress.pairs=null;
 progress.current=progress.phase==='done'?'本次搜索结束':'搜索已结束，保留已查到的结果';
 const result={segments:[...segments.values()],checks,queriedAt:new Date().toISOString(),partial:checks.some(c=>!['ok','excluded'].includes(c.state))||progress.hubsDone<hubs.length,mode:'live',search,progress:{...progress},payment:{charged:false}};
 event('done',{result});finished=true;return result;
}
