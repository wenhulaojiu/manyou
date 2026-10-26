import {cityPicker} from './city-picker.mjs';
import {stations} from './locations.mjs';
import {validate,addDays,localDate,fmt,hours} from './planner.mjs';
import {demo} from './demo.mjs';
import {createPlannerClient} from './planner-client.mjs';
import {readSearchStream} from './search-client.mjs';
const $=id=>document.getElementById(id),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let hubs=new Set(['武汉','重庆']),sort='value',data=null,query=null,selected=new Set(),latest=[],limit=0,status=null,loading=false,controller=null,renderTimer=null,progressTimer=null;
const planner=createPlannerClient();
let revision=0,renderVersion=0,rendering=false,renderAgain=false,searchId=null,searchAccepted=false,airportCatalog=null;
const money=v=>Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
const mode=()=>document.querySelector('[name=mode]:checked').value;
const pickers={};
for(const id of ['from','to']){const old=$(id),input=document.createElement('input');input.id=id;input.placeholder='城市 / 拼音 / 首字母';input.required=true;old.replaceWith(input)}
$('from').value='上海';$('to').value='成都';
function stationOptions(id){const select=$(id+'Station');const items=stations.filter(s=>s.city===$(id).value);select.innerHTML='<option value="">全城车站</option>'+items.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');select.disabled=!items.length}
for(const id of ['from','to']){const label=document.createElement('label');label.textContent=id==='from'?'出发车站':'到达车站';const select=document.createElement('select');select.id=id+'Station';label.append(select);$('stationFields').append(label);$(id).addEventListener('input',()=>{stationOptions(id);stale()});select.onchange=stale;stationOptions(id)}
for(const id of ['from','to'])pickers[id]=cityPicker($(id),()=>{stationOptions(id);updateHubs();stale()});
$('date').value=addDays(localDate(new Date().toISOString()),1);$('date').min=localDate(new Date().toISOString());
function updateHubs(){
 hubs=new Set([...hubs].filter(c=>c!==$('from').value&&c!==$('to').value));
 $('hubs').innerHTML=['北京','上海','广州','杭州','成都','重庆','武汉','南京','长沙','西安','郑州','深圳'].filter(c=>![$('from').value,$('to').value].includes(c)).map(c=>`<button type="button" class="chip" data-city="${c}" aria-pressed="${hubs.has(c)}" ${hubs.size>=2&&!hubs.has(c)?'disabled':''}>${c}${hubs.has(c)?' ✓':''}</button>`).join('');
 $('hubs').querySelectorAll('button').forEach(b=>b.onclick=()=>{hubs.has(b.dataset.city)?hubs.delete(b.dataset.city):hubs.add(b.dataset.city);updateHubs();stale()});
}
function readQuery(){return validate({from:$('from').value,to:$('to').value,date:$('date').value,transport:$('transport').value,fromStation:$('fromStation').value,toStation:$('toStation').value,hubs:[...hubs],autoSearch:$('autoSearch').checked,accessMinutes:Number($('accessMinutes').value),egressMinutes:Number($('egressMinutes').value),accessFee:Number($('accessFee').value),seatPreference:$('seatPreference').value,hourValue:Number($('hourValue').value),buffer:Number($('buffer').value),stayDays:Number($('stayDays').value),hotel:Number($('hotel').value),transferMinutes:Number($('transferMinutes').value),transferFee:Number($('transferFee').value),budget:Number($('budget').value),maxHours:Number($('maxHours').value),noOvernight:$('noOvernight').checked,onlyWorth:$('onlyWorth').checked,sort})}
function stale(){showAirports();if(data){revision++;renderVersion++;data=null;query=null;latest=[];selected.clear();$('results').innerHTML='<p>条件已改变，请重新查询。</p>';$('count').textContent='等待重新查询';$('coverage').innerHTML='';renderCompare()}}
function showAirports(){if(!$('airportHint'))return;$('airportHint').textContent=airportCatalog?['from','to'].map(id=>$(id).value+'：'+(airportCatalog.cities[$(id).value]?.map(a=>a.iata).join('、')||'暂无已映射机场')).join('；')+'。指定火车站时不含该端航空方案。':'机场目录加载中。'}
function showStatus(){
 $('sourceHint').textContent=mode()==='demo'?'演示模式：所有车次、票价和时刻均为虚构示例。':status?'火车免密钥实验查询已接入；'+(status.flight.state==='configured'?'机票使用 Amadeus '+(status.flight.environment==='test'?'测试环境。':'生产环境。'):'机票尚未配置账号，本次可能只覆盖火车。'):'本地服务尚未连接。可切换演示体验。';
 $('providerStatus').innerHTML=status?`<ul><li>铁路模块：${esc(status.rail.message)}</li><li>机票：${status.flight.state==='configured'?esc(status.flight.environment)+' 环境已配置，覆盖需实测':'未配置 Amadeus 凭据'}</li><li>支付：未启用，当前查询不扣费</li></ul>`:'未连接本地服务';
}
async function getStatus(){try{const r=await fetch('/api/status');if(!r.ok)throw Error();status=await r.json()}catch{status=null}showStatus()}
function coverage(){
 if(!data)return;
 const issues=data.checks?.filter(c=>!['ok','excluded'].includes(c.state))||[];
 const audit=data.search?`已处理 ${data.progress?.hubsDone||0} / ${data.search.hubs.length} 个中转城市；${data.checks.filter(c=>c.state==='ok').length} 项区间查询完成。${data.search.timetable?.available?'时刻索引已用于优先查询有班次的车站。':'当前未使用有效时刻索引，按车站目录查询。'}${data.search.discovery?.state==='ok'?'已参考铁路中转建议，逐段查询票价和余票。':''}<br>`:'';
 const text=data.mode==='demo'?'演示数据 · 不可用于实际购票':`查询于 ${fmt(data.queriedAt)} · ${loading?'搜索进行中，推荐会继续更新':data.partial?'部分渠道未完成，结果并非全量':'本次所选范围查询完成'} · 本次未收费`;
 const tests=data.segments.some(l=>l.test);
 $('coverage').innerHTML=`<div class="coverage ${!data.partial&&data.mode!=='demo'?'good':''}">${audit}${esc(text)}${tests?'<br>含 Amadeus 测试数据，请勿用于实际出行决策。':''}<br>自动比较主要枢纽与有限候选，未穷举全国所有线路；接驳和住宿为估算。${issues.length?`<details><summary>查看 ${issues.length} 项未覆盖查询</summary><ul>${issues.map(c=>`<li>${esc(c.from)} → ${esc(c.to)} · ${esc(c.date)} · ${c.mode==='rail'?'火车':'飞机'}：${esc(c.message)}</li>`).join('')}</ul></details>`:''}</div>`;
}
function comparisonText(r){
 if(r.saving===null)return '未查到可用直达基准，暂不能判断每小时节省额。';
 if(r.extra<=0&&r.saving===0)return '本次查到的最快直达基准';
 if(r.extra<=0)return `比直达基准${r.saving>=0?'省':'多花'} ¥${money(Math.abs(r.saving))}，赶路时间更短或相同`;
 return `比最快直达${r.saving>=0?'省':'多花'} ¥${money(Math.abs(r.saving))}，多花 ${r.extra<1?r.extra.toFixed(2):r.extra.toFixed(1)} 小时<br><strong>每多花 1 小时${r.rate>=0?'省':'多花'} ¥${money(Math.abs(r.rate))}</strong> · ${r.worthwhile?'符合':'未达到'}你的 ¥${query.hourValue}/小时偏好`;
}
function routeTitle(r){return [r.legs[0].from,...r.legs.map(l=>l.to)].join(' → ')}
function card(r,labels=[]){
 const paths=r.legs.map((l,i)=>`<div class="leg"><b>${esc(l.number)} · ${l.mode==='rail'?'火车':'飞机'} · ${esc(l.seat)}</b><p>${esc(l.fromStation)} → ${esc(l.toStation)}</p><p>${fmt(l.departure)} → ${fmt(l.arrival)}</p><p>票价 ¥${money(l.price)} · ${esc(l.source)}${l.observedAt?' · '+fmt(l.observedAt)+' 查询':''}</p></div>${i===0&&r.legs.length===2?`<div class="transfer">${r.stayDays?`在 ${esc(l.to)} 住 ${r.stayDays} 晚 · 可自由安排约 ${hours(r.leisure)} 小时<br>`:''}两段间隔 ${hours(r.gap)} 小时<br>出站/下机 ${r.exit} 分钟 + 当地接驳 ${r.transfer} 分钟 + 下程准备 ${r.board} 分钟 + 缓冲 ${r.buffer} 分钟${r.stayDays?'':` + 额外等待 ${r.spare} 分钟`}<br>接驳为估算；跨站、航站楼和误点风险需再次核实。</div>`:''}`).join('');
 return `<article class="route" data-route="${esc(r.id)}">${labels.length?`<div class="recommend-label">${labels.map(esc).join(' · ')}</div>`:''}<div class="route-top"><div><span class="badge">${r.legs.length===1?'直达':r.stayDays?'顺路游玩':'中转换乘'}</span></div><div class="price"><small>现金支出估算</small><strong>¥${money(r.cash)}</strong></div></div><h3>${esc(routeTitle(r))}</h3><div class="meta">${fmt(r.departure)} 出发 → ${fmt(r.arrival)} 到达<br>赶路 ${hours(r.travelMinutes)} 小时 · 全程 ${hours(r.totalMinutes)} 小时${r.stayDays?` · 含 ${r.stayDays} 晚停留`:''} · ${r.legs.length-1} 次换乘</div><div class="saving ${r.worthwhile===false?'warning':''}">${comparisonText(r)}</div><div class="meta">综合参考成本 ¥${money(r.score)} <small>（时间折算非收费）</small></div><details><summary>展开行程、时间与费用</summary>${paths}<div class="fees"><span>票价合计</span><b>¥${money(r.ticket)}</b><span>两端市内接驳（估算）</span><b>¥${r.accessFee}</b><span>中转当地交通（预算）</span><b>¥${r.transferFee}</b><span>住宿 ${r.hotelNights} 晚（预算）</span><b>¥${r.hotelFee}</b><strong>现金合计</strong><strong>¥${money(r.cash)}</strong></div><p class="disclosure">赶路 = 乘坐 ${r.ride} + 两端接驳 ${r.access+r.egress} + 首程准备 ${r.initial} + 必要中转/等待 ${r.gap-r.leisure} 分钟。主动停留 ${Math.round(r.leisure)} 分钟单列，未重复计算缓冲。餐饮、景点、未列明的行李费用未计入。</p><div class="booking">${r.legs.map((l,i)=>`<a target="_blank" rel="noopener noreferrer" href="${l.mode==='rail'?'https://www.12306.cn/':'https://flights.ctrip.com/'}">第 ${i+1} 段：去${l.mode==='rail'?'12306':'机票平台'}核实购票 ↗</a>`).join('')}</div><p class="disclosure">链接打开平台首页，请按上方日期、站点和班次重新查询。分开购票无联程保障。</p></details><div class="route-top"><label><input type="checkbox" data-select="${esc(r.id)}" ${selected.has(r.id)?'checked':''}> 加入对比（最多 3 条）</label></div></article>`;
}
async function render(){
 renderVersion++;if(rendering){renderAgain=true;return}rendering=true;
 try{do{renderAgain=false;await renderOnce(renderVersion)}while(renderAgain)}
 catch(e){$('error').textContent=e.message}
 finally{rendering=false}
}
async function renderOnce(version){
 if(!data)return;query.sort=sort;
 const opened=new Set([...document.querySelectorAll('[data-route]')].filter(el=>el.querySelector('details')?.open).map(el=>el.dataset.route));
 const result=await planner.page(data.segments,{revision,query:{...query},now:data.mode==='live'?Date.now():null,limit,selectedIds:[...selected]});
 if(version!==renderVersion||!data)return;
 const featured=result.featured;
 latest=[...new Map([...featured.map(f=>f.route),...result.options,...result.selected].map(r=>[r.id,r])).values()];
 selected=new Set([...selected].filter(id=>latest.some(r=>r.id===id)));
 $('heading').textContent=query.from+' → '+query.to;
 $('count').textContent=`${query.date} · ${result.total} 个符合条件的候选 · ${loading?'目前查到的推荐，仍在更新':result.baseline?'以本次最快直达为比较基准':'未找到可用直达基准'}`;
 const rest=result.options;
 $('results').innerHTML=latest.length?`<p class="recommend-note">先看这 ${featured.length} 条${loading?'暂时领先的':''}方案。同一条满足多个偏好时合并展示。</p>`+featured.map(f=>card(f.route,f.labels)).join('')+rest.map(r=>card(r)).join('')+(result.restTotal>limit?`<button id="more" class="secondary">${limit?'继续展开':'展开其他'}候选（还有 ${result.restTotal-limit} 条） ↓</button>`:''):`<div class="empty"><span>⌁</span><h3>${loading?'正在寻找合适的路线':'暂时没有符合条件的方案'}</h3><p>${loading?'查到可用车次后会直接显示，无需等待搜索全部结束。':'查看覆盖提示，或调整预算、时间和车站条件。'}</p></div>`;
 document.querySelectorAll('[data-route]').forEach(el=>{if(opened.has(el.dataset.route))el.querySelector('details').open=true});
 $('more')?.addEventListener('click',()=>{limit+=6;render()});
 document.querySelectorAll('[data-select]').forEach(box=>box.onchange=()=>{if(box.checked&&selected.size>=3){box.checked=false;$('error').textContent='最多同时对比 3 条路线。';return}box.checked?selected.add(box.dataset.select):selected.delete(box.dataset.select);renderCompare()});
 renderCompare();coverage();
}
function renderCompare(){
 const rows=latest.filter(r=>selected.has(r.id));$('compare').hidden=!rows.length;$('compareJump').hidden=!rows.length;$('compareJump').textContent='查看 '+rows.length+' 条路线对比 ↓';
 $('comparison').innerHTML=rows.length?`<div class="compare-wrap"><table><thead><tr><th>比较项</th>${rows.map(r=>`<th>${esc(routeTitle(r))}</th>`).join('')}</tr></thead><tbody>${[['现金支出',r=>'¥'+money(r.cash)],['赶路时间',r=>hours(r.travelMinutes)+' 小时'],['主动停留',r=>r.stayDays+' 晚 / '+hours(r.leisure)+' 小时'],['全程跨度',r=>hours(r.totalMinutes)+' 小时'],['每小时省下',r=>r.rate===null?'无额外耗时或无基准':'¥'+money(r.rate)],['综合参考成本',r=>'¥'+money(r.score)]].map(([label,fn])=>`<tr><th>${label}</th>${rows.map(r=>`<td>${fn(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';
}
$('export').onclick=()=>{
 const rows=latest.filter(r=>selected.has(r.id));if(!rows.length)return;
 const report=['慢游路线对比报告',data.mode==='demo'?'演示数据，不可用于购票':'真实查询结果；部分渠道可能缺失，购票前须复核','查询时间：'+(data.queriedAt||'演示'),`时间价值：¥${query.hourValue}/小时`,...rows.flatMap(r=>['',routeTitle(r),`现金预算 ¥${money(r.cash)}；赶路 ${hours(r.travelMinutes)} 小时；总跨度 ${hours(r.totalMinutes)} 小时；主动停留 ${r.stayDays} 晚`,...r.legs.map(l=>`${l.number} ${l.fromStation} → ${l.toStation} ${fmt(l.departure)} → ${fmt(l.arrival)} ¥${l.price} ${l.seat} [${l.source}]`),`票价 ${r.ticket} + 两端接驳 ${r.accessFee} + 中转交通 ${r.transferFee} + 住宿 ${r.hotelFee}`,`换乘缓冲 ${r.buffer} 分钟；交通/住宿均为预算；餐饮景点行李另计。`]),'','报告提供规划参考，票务平台确认库存及退改规则。'].join('\n');
 const url=URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='慢游-'+query.date+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('clearCompare').onclick=()=>{selected.clear();render()};
function showProgress(p){
 $('searchProgress').hidden=false;
 const phases={direct:'先查直达',discovery:'寻找铁路中转点',transfers:'逐段组合中转',done:'本次搜索结束',timeout:'已到查询时限',stopped:'已停止搜索'};
 $('progressTitle').textContent=phases[p.phase]||'准备查询';
 $('progressDetail').textContent=`${p.current||''} · 已用 ${p.elapsedSeconds||0} 秒`;
 $('progressCount').textContent=`中转城市 ${p.hubsDone||0} / ${p.hubsTotal||0}${p.pairs?` · 当前区间车站组合 ${p.pairs.done} / ${p.pairs.total}（失败 ${p.pairs.failed}）`:''}`;
 $('progressBar').max=Math.max(1,p.hubsTotal||1);$('progressBar').value=p.hubsDone||0;
 $('stopSearch').hidden=!loading;
}
function scheduleRender(){if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;render()},500)}
function acceptEvent(event){
 if(event.progress){data.progress=event.progress;showProgress(event.progress)}
 if(event.type==='start'||event.type==='scope'){data.search=event.search;query.hubs=event.search.hubs;scheduleRender()}
 if(event.segments?.length){data.segments.push(...event.segments);revision++;scheduleRender()}
 if(event.check){data.checks.push(event.check);data.partial ||= !['ok','excluded'].includes(event.check.state);coverage()}
 if(event.type==='done'){data=event.result;revision++;query.hubs=data.search.hubs;clearTimeout(renderTimer);renderTimer=null;render()}
}
$('stopSearch').onclick=async()=>{
 $('stopSearch').disabled=true;const ownController=controller;
 if(!searchAccepted){ownController?.abort();return}
 try{const response=await fetch('/api/cancel',{method:'POST',headers:{'X-Search-Id':searchId},signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('取消失败')}
 catch{ownController?.abort()}
};
$('search').onsubmit=async e=>{
 e.preventDefault();if(loading)return;
 if(!pickers.from.validate()||!pickers.to.validate())return;
 let q;try{q=readQuery()}catch(e){$('error').textContent=e.message;return}
 const requestMode=mode();loading=true;query=q;limit=0;selected.clear();revision++;searchId=crypto.randomUUID();searchAccepted=false;
 data={segments:[],checks:[],mode:requestMode,partial:false,queriedAt:new Date().toISOString()};render();
 $('error').textContent='';$('searchBtn').textContent='搜索进行中…';document.querySelectorAll('#search input,#search select,#search button,.mode-switch input').forEach(x=>x.disabled=true);
 $('stopSearch').disabled=false;controller=new AbortController();
 data.progress={phase:'direct',current:'正在连接数据服务',hubsDone:0,hubsTotal:q.hubs.length};showProgress(data.progress);
 const searchStarted=Date.now();progressTimer=setInterval(()=>{if(data.progress)showProgress({...data.progress,elapsedSeconds:Math.floor((Date.now()-searchStarted)/1000)})},1000);
 try{
  if(requestMode==='demo'){
   data={segments:demo(q),mode:'demo',checks:[],partial:false};revision++;render();$('searchProgress').hidden=true;
  }else{
   const r=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson','X-Search-Id':searchId},body:JSON.stringify(q),signal:controller.signal});
   searchAccepted=r.ok;await readSearchStream(r,acceptEvent);
  }
 }catch(e){
  data.partial=true;data.progress={...data.progress,phase:'stopped',current:'保留已查到的结果'};showProgress(data.progress);
  $('error').textContent=e.name==='AbortError'?'已停止搜索，下面的结果仍可比较。':'查询未完成：'+e.message+'。已保留收到的结果，没有扣费。';
 }finally{
  loading=false;clearInterval(progressTimer);progressTimer=null;clearTimeout(renderTimer);renderTimer=null;controller=null;
  document.querySelectorAll('#search input,#search select,#search button,.mode-switch input').forEach(x=>x.disabled=false);
  $('stopSearch').hidden=true;$('searchBtn').textContent='查询候选路线 ↗';updateHubs();getStatus();render();
 }
};
for(const id of ['from','to'])$(id).onchange=()=>{updateHubs();stale()};
for(const id of ['date','transport','stayDays','autoSearch'])$(id).onchange=stale;
$('swap').onclick=()=>{const fs=$('fromStation').value,ts=$('toStation').value;const from=$('from').value;$('from').value=$('to').value;$('to').value=from;stationOptions('from');stationOptions('to');$('fromStation').value=ts;$('toStation').value=fs;pickers.from.sync();pickers.to.sync();updateHubs();stale()};
for(const id of ['hourValue','budget','maxHours','buffer','hotel','transferMinutes','transferFee','noOvernight','onlyWorth','accessMinutes','egressMinutes','accessFee','seatPreference'])$(id).addEventListener('input',()=>{
 $('hourOutput').textContent=$('hourValue').value;
 if(!query)return;try{const next=readQuery();for(const k of ['hourValue','budget','maxHours','buffer','hotel','transferMinutes','transferFee','noOvernight','onlyWorth','accessMinutes','egressMinutes','accessFee','seatPreference'])query[k]=next[k];render()}catch(e){$('error').textContent=e.message}
});
document.querySelectorAll('[name=mode]').forEach(b=>b.onchange=()=>{showStatus();stale()});
document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{sort=b.dataset.sort;document.querySelectorAll('[data-sort]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b))});render()});
updateHubs();getStatus();
fetch('/api/airports').then(r=>{if(!r.ok)throw Error();return r.json()}).then(c=>{airportCatalog=c;showAirports()}).catch(()=>{if($('airportHint'))$('airportHint').textContent='机场目录暂时不可用。'});
