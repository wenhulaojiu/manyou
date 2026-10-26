import {scanRail} from './rail-scan.mjs';
import {createRailSession} from './rail-session.mjs';
import {addDays,localDate} from './dist/planner.mjs';
import {stations} from './dist/locations.mjs';
import {airportsFor,airportCities,airportMetadata} from './airport-catalog.mjs';
export {airportCities,airportMetadata};
export const railStatus={state:'idle',message:'免密钥实验查询，尚未连接'};
let newestSession;
const activeSessions=new Set();
export function flightConfigured(){return Boolean(process.env.AMADEUS_CLIENT_ID&&process.env.AMADEUS_CLIENT_SECRET)}
export function flightEnvironment(){return process.env.AMADEUS_ENV==='production'?'production':'test'}
export function normalizeRail(rows,from,to,date){
 return rows.flatMap(row=>{
  const seats=(row.prices||[]).filter(s=>s.seat_name!=='无座'&&(s.num==='有'||Number(s.num)>0)&&Number.isFinite(Number(s.price))&&Number(s.price)>0).sort((a,b)=>Number(a.price)-Number(b.price));
  if(!seats.length||!/^\d{2}:\d{2}$/.test(row.start_time)||!/^\d+:\d{2}$/.test(row.lishi))return [];
  const duration=row.lishi.split(':').map(Number).reduce((h,m)=>h*60+m);
  // Query date is the boarding date. Upstream start_date may be the train's origin date.
  const departure=date+'T'+row.start_time+':00+08:00';
  if(!Number.isFinite(Date.parse(departure))||duration<=0)return [];
  return seats.map(seat=>({id:[date,row.train_no,row.from_station_telecode,row.to_station_telecode,seat.seat_name].join('-'),from,to,fromStation:row.from_station,toStation:row.to_station,departure,arrival:new Date(Date.parse(departure)+duration*60000).toISOString(),price:Number(seat.price),seat:seat.seat_name,number:row.start_train_code,mode:'rail',available:true,source:'12306 / 12306-mcp',observedAt:new Date().toISOString()}));
 });
}

export function interlineHubs(rows) {
 const byName=new Map(stations.map(s=>[s.name,s.city]));
 return [...new Set(rows.map(r=>byName.get(r.middle_station_name)).filter(Boolean))];
}
export function createProviders({sessionFactory=createRailSession,fetchImpl=fetch}={}) {
 const owner={};newestSession=owner;
 const session=sessionFactory({onStatus:(state,message)=>{if(newestSession===owner)Object.assign(railStatus,{state,message})}});
 activeSessions.add(session);
 let token;
 async function jsonFetch(url,options={}) {
  const res=await fetchImpl(url,{...options,signal:AbortSignal.any([AbortSignal.timeout(20000),...(options.signal?[options.signal]:[])])});
  if(!res.ok)throw Error('机票服务返回 HTTP '+res.status);
  return res.json();
 }
 async function flightPair(from,to,date,origin,destination,{signal}={}) {
  const host=flightEnvironment()==='production'?'https://api.amadeus.com':'https://test.api.amadeus.com';
  if(!token||token.expires<Date.now()) {
   const d=await jsonFetch(host+'/v1/security/oauth2/token',{signal,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:process.env.AMADEUS_CLIENT_ID,client_secret:process.env.AMADEUS_CLIENT_SECRET})});
   if(!d.access_token)throw Error('机票授权未返回有效令牌');
   token={value:d.access_token,expires:Date.now()+Number(d.expires_in)*1000-60000};
  }
  const params=new URLSearchParams({originLocationCode:origin.iata,destinationLocationCode:destination.iata,departureDate:date,adults:'1',currencyCode:'CNY',nonStop:'true',max:'250'});
  let d;
  try {d=await jsonFetch(host+'/v2/shopping/flight-offers?'+params,{signal,headers:{Authorization:'Bearer '+token.value}})}
  catch(e){if(e.message.includes('401'))token=null;throw e}
  const rows=(d.data||[]).flatMap(o=>{
   const legs=o.itineraries?.[0]?.segments,price=Number(o.price?.grandTotal||o.price?.total);
   if(legs?.length!==1||o.price?.currency!=='CNY'||!Number.isFinite(price)||price<=0)return [];
   const l=legs[0];if(!l.departure?.at||!l.arrival?.at)return [];
   const departure=l.departure.at+'+08:00',arrival=l.arrival.at+'+08:00';
   if(!Number.isFinite(Date.parse(departure))||Date.parse(arrival)<=Date.parse(departure))return [];
   return [{id:['flight',date,l.departure.iataCode,l.arrival.iataCode,l.carrierCode+l.number,l.departure.at,price].join('-'),from,to,fromStation:l.departure.iataCode,toStation:l.arrival.iataCode,departure,arrival,price,mode:'flight',number:l.carrierCode+l.number,seat:'经济舱，行李需复核',available:true,source:flightEnvironment()==='production'?'Amadeus 实时':'Amadeus 测试数据',test:flightEnvironment()!=='production',observedAt:new Date().toISOString()}];
  });
  return {rows,truncated:(d.data||[]).length>=250};
 }
 return {
  flightConfigured,
  async rail(from,to,date,options={}) {
   const today=localDate(new Date().toISOString());
   if(date<today||date>addDays(today,14))throw Error('超出铁路 15 天查询窗口');
   return scanRail(from,to,date,options,async(_from,_to,_date,fromStation,toStation)=>{
    const rows=await session.call('get-tickets',{date,fromStation,toStation,format:'json',limitedNum:0},options);
    return normalizeRail(rows,from,to,date);
   });
  },
  async discoverHubs(from,to,date,options={}) {
   const rows=await session.call('get-interline-tickets',{date,fromStation:options.fromStation||from,toStation:options.toStation||to,format:'json',limitedNum:10,showWZ:false},options);
   return interlineHubs(rows).filter(c=>c!==from&&c!==to);
  },
  async flight(from,to,date,options={}) {
   if(!flightConfigured())throw Error('机票需配置 Amadeus API 凭据');
   const origins=airportsFor(from),destinations=airportsFor(to);
   if(!origins.length||!destinations.length)throw Error('城市暂无已映射的机场，本次不覆盖机票');
   const rows=new Map(),failures=[];let truncated=false,done=0;
   for(const a of origins)for(const b of destinations){
    options.signal?.throwIfAborted();
    try{const work=()=>flightPair(from,to,date,a,b,options);const result=await (options.schedule?options.schedule(work):work());truncated ||= result.truncated;for(const l of result.rows)rows.set(l.id,l);options.onUpdate?.(result.rows)}
    catch(e){if(options.signal?.aborted)throw e;failures.push(a.iata+' → '+b.iata+': '+e.message)}
    done++;
   }
   return {rows:[...rows.values()],complete:!failures.length&&!truncated,pairs:{done,total:origins.length*destinations.length,failed:failures.length},message:failures.join('；')||(truncated?'供应商报价达到 250 条上限':''),coverage:'供应商单程直飞报价；覆盖已映射机场，不能代表全市场报价'};
  },
  async close(){activeSessions.delete(session);await session.close()}
 };
}
export async function closeRail(){await Promise.allSettled([...activeSessions].map(s=>s.close()));activeSessions.clear()}
