import {wrap} from '/vendor/comlink.mjs';
export function createPlannerClient(){
 let worker,remote,revision=-1;
 const pending=new Set();
 function start(){
  worker=new Worker(new URL('./planner-worker.mjs',import.meta.url),{type:'module'});remote=wrap(worker);
  worker.onerror=()=>{for(const reject of pending)reject(Error('后台路线计算失败，请重试'));pending.clear();worker.terminate();worker=null;revision=-1};
 }
 return {async page(segments,request){
  if(!worker)start();
  const payload={...request};if(request.revision!==revision)payload.segments=segments;
  let rejectFailure;const failure=new Promise((_,reject)=>{rejectFailure=reject;pending.add(reject)});
  try{const result=await Promise.race([remote.page(payload),failure]);revision=request.revision;return result}
  finally{pending.delete(rejectFailure)}
 }};
}
