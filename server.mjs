import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validate,localDate} from './dist/planner.mjs';
import {createProviders,railStatus,flightConfigured,flightEnvironment,closeRail,airportCities,airportMetadata} from './providers.mjs';
import {runSearch} from './search-engine.mjs';
import {loadTimetable} from './timetable.mjs';

const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
export function createApp({providerFactory=createProviders,search=runSearch,timetable=null,searchOptions={}}={}) {
 let active=null;
 const app=http.createServer(async(req,res)=>{
  try {
   const port=app.address()?.port;
   if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host))return json(res,403,{error:'仅允许本地访问'});
   if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return json(res,403,{error:'来源不受支持'});
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/api/status'&&req.method==='GET')return json(res,200,{rail:railStatus,flight:{state:flightConfigured()?'configured':'unconfigured',environment:flightEnvironment()},timetable:timetable?.status(localDate(new Date().toISOString()))||{available:false},payment:{enabled:false,message:'试用阶段，未启用收款'},today:localDate(new Date().toISOString())});
   if(url.pathname==='/api/airports'&&req.method==='GET')return json(res,200,{metadata:airportMetadata,cities:airportCities});
   if(url.pathname==='/api/cancel'&&req.method==='POST'){
    const id=req.headers['x-search-id'];
    if(!id)return json(res,400,{error:'缺少查询编号'});
    if(!active)return json(res,200,{stopped:true});
    if(id!==active.id)return json(res,409,{error:'查询编号不匹配'});
    const job=active;job.controller.abort();await job.finished;
    return json(res,200,{stopped:true});
   }
   if(url.pathname==='/api/search'&&req.method==='POST'){
    if(active)return json(res,429,{error:'已有查询进行中，请稍后重试'});
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>8000)return json(res,413,{error:'请求过大'});chunks.push(chunk)}
    let q;try{q=validate(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch(e){return json(res,400,{error:e.message})}
    if(q.date<localDate(new Date().toISOString()))return json(res,400,{error:'请选择今天或之后的日期'});
    const id=req.headers['x-search-id']||randomUUID();
    if(typeof id!=='string'||!/^[\w-]{1,80}$/.test(id))return json(res,400,{error:'查询编号无效'});
    if(active)return json(res,429,{error:'已有查询进行中，请稍后重试'});
    let resolveFinished;
    const job={id,controller:new AbortController(),finished:new Promise(resolve=>{resolveFinished=resolve})};active=job;
    const streaming=req.headers.accept?.includes('application/x-ndjson');
    res.setHeader('X-Search-Id',id);
    res.on('close',()=>{if(!res.writableEnded)job.controller.abort()});
    let providers;
    try {
     providers=providerFactory();
     if(streaming){res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.flushHeaders()}
     const result=await search(q,providers,{...searchOptions,timetable,signal:job.controller.signal,emit:event=>{if(streaming&&!res.destroyed&&!res.writableEnded)res.write(JSON.stringify(event)+'\n')}});
     if(!res.destroyed){if(streaming)res.end();else json(res,200,result)}
    } finally {
     if(active===job)active=null;resolveFinished();
     // Every provider owns its connection. Closing this one cannot affect a later search.
     Promise.resolve().then(()=>providers?.close?.()).catch(e=>console.error('连接清理失败:',e.message));
    }
    return;
   }
   if(req.method!=='GET')return json(res,405,{error:'方法不支持'});
   const files=['index.html','app.mjs','planner.mjs','planner-store.mjs','planner-worker.mjs','planner-client.mjs','search-client.mjs','locations.mjs','city-index.mjs','city-search.mjs','city-picker.mjs','demo.mjs','style.css','sources.html'];
   const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
   const vendor=url.pathname==='/vendor/comlink.mjs';
   if(!vendor&&!files.includes(path))return json(res,404,{error:'不存在'});
   const body=await readFile(new URL(vendor?'./node_modules/comlink/dist/esm/comlink.mjs':'./dist/'+path,import.meta.url));
   res.writeHead(200,{'Content-Type':path.endsWith('.mjs')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"});res.end(body);
  } catch(e) {console.error('Request failed:',e.message);if(!res.headersSent)json(res,500,{error:'服务暂时不可用，请重试'});else res.end()}
 });
 app.on('close',()=>active?.controller.abort());
 return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=createApp({timetable:await loadTimetable()}),port=Number(process.env.PORT||4173);
 app.listen(port,'127.0.0.1',()=>console.log('慢游 http://127.0.0.1:'+port));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{app.closeAllConnections();app.close();closeRail().finally(()=>process.exit(0))});
}
