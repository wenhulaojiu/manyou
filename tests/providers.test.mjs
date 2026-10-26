import {test,before,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setupServer} from 'msw/node';
import {http,HttpResponse} from 'msw/http';
import {createProviders,interlineHubs} from '../providers.mjs';
import {createRailSession} from '../rail-session.mjs';
import {readSearchStream} from '../dist/search-client.mjs';
const mock=setupServer();
before(()=>mock.listen({onUnhandledRequest:'error'}));after(()=>mock.close());afterEach(()=>mock.resetHandlers());
const stub=()=>({close:async()=>{}});
test('MSW: flight covers both Shanghai and Chengdu airports and retains successes on HTTP failure',async t=>{
 const old={id:process.env.AMADEUS_CLIENT_ID,secret:process.env.AMADEUS_CLIENT_SECRET,env:process.env.AMADEUS_ENV};
 process.env.AMADEUS_CLIENT_ID='fixture';process.env.AMADEUS_CLIENT_SECRET='fixture';process.env.AMADEUS_ENV='test';
 t.after(()=>{for(const [key,value] of Object.entries({AMADEUS_CLIENT_ID:old.id,AMADEUS_CLIENT_SECRET:old.secret,AMADEUS_ENV:old.env})){if(value===undefined)delete process.env[key];else process.env[key]=value}});
 const pairs=[],increments=[];
 mock.use(http.post('https://test.api.amadeus.com/v1/security/oauth2/token',()=>HttpResponse.json({access_token:'mock-token',expires_in:1800})),http.get('https://test.api.amadeus.com/v2/shopping/flight-offers',({request})=>{
  const url=new URL(request.url),a=url.searchParams.get('originLocationCode'),b=url.searchParams.get('destinationLocationCode');pairs.push(a+'-'+b);
  if(a==='SHA'&&b==='CTU')return new HttpResponse(null,{status:503});
  return HttpResponse.json({data:[{price:{currency:'CNY',grandTotal:'500'},itineraries:[{segments:[{carrierCode:'MU',number:'123',departure:{iataCode:a,at:'2026-10-27T08:00:00'},arrival:{iataCode:b,at:'2026-10-27T11:00:00'}}]}]}]});
 }));
 const providers=createProviders({sessionFactory:stub});t.after(()=>providers.close());
 const r=await providers.flight('上海','成都','2026-10-27',{onUpdate:rows=>increments.push(...rows)});
 assert.deepEqual(new Set(pairs),new Set(['SHA-CTU','SHA-TFU','PVG-CTU','PVG-TFU']));assert.equal(r.rows.length,3);assert.equal(increments.length,3);assert.equal(r.complete,false);assert.equal(r.pairs.failed,1);assert(r.rows.every(r=>r.test&&r.price===500));
});
test('MSW: streaming handles split Chinese bytes and final event without newline',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({type:'segments',segments:[{from:'上海'}]})+'\n'+JSON.stringify({type:'done',result:{ok:true}}));
 mock.use(http.get('https://fixture.test/search',()=>new HttpResponse(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.slice(i,i+2));controller.close()}}))));
 const events=[];await readSearchStream(await fetch('https://fixture.test/search'),e=>events.push(e));assert.equal(events[0].segments[0].from,'上海');assert.equal(events.at(-1).type,'done');
 await assert.rejects(readSearchStream(new Response('{"type":"start"}\n'),()=>{}),/连接提前结束/);
});
test('rail cancellation during connect never closes another search connection',async()=>{
 let finishOld,oldCloses=0,newCloses=0;
 const old=createRailSession({makeTransport:()=>({close:async()=>{oldCloses++}}),makeClient:()=>({connect:()=>new Promise(r=>{finishOld=r}),callTool:()=>assert.fail('cancelled client must not query')})});
 const newer=createRailSession({makeTransport:()=>({close:async()=>{newCloses++}}),makeClient:()=>({connect:async()=>{},callTool:async()=>({content:[{type:'text',text:'[]'}]})})});
 const controller=new AbortController();const call=old.call('get-tickets',{}, {signal:controller.signal});await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(call);
 assert.deepEqual(await newer.call('get-tickets',{}),[]);finishOld();await old.close();assert.equal(oldCloses,1);assert.equal(newCloses,0);await newer.close();assert.equal(newCloses,1);
});
test('failed rail connection is replaced and official suggestions map only known hub stations',async()=>{
 let calls=0,closed=0;
 const session=createRailSession({makeTransport:()=>({close:async()=>{closed++}}),makeClient:()=>({connect:async()=>{},callTool:async()=>++calls===1?{isError:true}:{content:[{type:'text',text:'[]'}]}})});
 await assert.rejects(session.call('get-tickets',{}));assert.deepEqual(await session.call('get-tickets',{}),[]);assert.equal(closed,1);await session.close();
 assert.deepEqual(interlineHubs([{middle_station_name:'武汉'},{middle_station_name:'汉口'},{middle_station_name:'不存在'}]),['武汉']);
});
