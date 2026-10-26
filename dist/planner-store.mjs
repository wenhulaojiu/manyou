import {plan} from './planner.mjs';
export function createPlannerStore(compute=plan){
 let segments=[],revision=-1,key,result,rest=[],byId=new Map(),sort,calculations=0;
 return {page(request){
  if(request.segments){segments=request.segments;revision=request.revision}
  const {sort:order,...query}=request.query;
  const nextKey=JSON.stringify([revision,query,request.now===null?null:Math.floor(request.now/60000)]);
  if(nextKey!==key){
   result=compute(segments,request.query,{now:request.now});calculations++;key=nextKey;sort=order;
   const featuredIds=new Set(result.featured.map(f=>f.route.id));
   rest=result.options.filter(r=>!featuredIds.has(r.id));byId=new Map(result.options.map(r=>[r.id,r]));
  }
  if(order!==sort){rest.sort((a,b)=>order==='price'?a.cash-b.cash:order==='time'?a.travelMinutes-b.travelMinutes:a.score-b.score);sort=order}
  return {featured:result.featured,options:rest.slice(0,request.limit),selected:request.selectedIds.map(id=>byId.get(id)).filter(Boolean),restTotal:rest.length,total:result.total,baseline:result.baseline,calculations};
 }};
}
