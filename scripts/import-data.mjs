import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {parse} from 'csv-parse/sync';
import {cityIndex} from '../dist/city-index.mjs';
import {stations} from '../dist/locations.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const root = new URL('../',import.meta.url);
const dataDir = new URL('data/',root), cacheDir = new URL('data/cache/',root), licenseDir = new URL('licenses/',root);
await mkdir(cacheDir,{recursive:true});await mkdir(licenseDir,{recursive:true});
async function get(url,path,hash) {
  let bytes;
  try {if(process.argv.includes('--refresh'))throw Error();bytes=await readFile(path);} catch {
    console.log('下载',url);
    try {
      const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
      if(!response.ok)throw Error('下载失败 '+response.status+' '+url);
      bytes=Buffer.from(await response.arrayBuffer());
    }catch(error){
      // urllib can use Windows system proxy settings that Node fetch does not inherit.
      console.log('直接下载失败，尝试 Python 系统代理下载');
      const temporary=fileURLToPath(path)+'.download';
      try{await promisify(execFile)('python',[fileURLToPath(new URL('./download-data.py',import.meta.url)),url,temporary],{timeout:190000,windowsHide:true});bytes=await readFile(temporary)}
      catch{throw new Error('下载失败。请配置网络代理，或将数据放入 data/cache 后重新执行。原因：'+error.message)}
    }
    if(hash&&createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('数据校验失败');
    await writeFile(path,bytes);
  }
  if(hash&&createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('缓存校验失败，请移走损坏的下载文件');
  return bytes;
}
async function save(path,value) {await writeFile(new URL(path+'.tmp',root),JSON.stringify(value));await rename(new URL(path+'.tmp',root),new URL(path,root));}
const mode=process.argv[2]||'all';
if(!['all','airports','rail'].includes(mode))throw Error('数据类型须为 all、airports 或 rail');
if(['all','airports'].includes(mode)) {
  const base='https://raw.githubusercontent.com/mborsetti/airportsdata/main/';
  const bytes=await get(base+'airportsdata/airports.csv',new URL('airports.csv',cacheDir));
  const rows=parse(bytes,{columns:true,bom:true,skip_empty_lines:true});
  const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
  const byPinyin=new Map();
  for(const c of cityIndex){const key=normalize(c.pinyin);byPinyin.set(key,byPinyin.has(key)?null:c.name);}
  // Explicit city association for airports whose municipality differs from the served city.
  const overrides={TFU:'成都',CTU:'成都',XIY:'西安',PEK:'北京',PKX:'北京',PVG:'上海',SHA:'上海',CKG:'重庆',SIA:'西安',DYG:'张家界',KWE:'贵阳',LHW:'兰州',HET:'呼和浩特',URC:'乌鲁木齐',SJW:'石家庄',CGO:'郑州',CSX:'长沙',XMN:'厦门',TAO:'青岛',SYX:'三亚',HGH:'杭州',SZX:'深圳',CAN:'广州'};
  const airports=rows.filter(r=>r.country==='CN'&&r.iata).map(r=>({iata:r.iata,name:r.name,city:overrides[r.iata]||byPinyin.get(normalize(r.city))||null,sourceCity:r.city,lat:Number(r.lat),lon:Number(r.lon),tz:r.tz}));
  const metadata={source:'https://github.com/mborsetti/airportsdata',license:'MIT',importedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),mapped:airports.filter(a=>a.city).length,total:airports.length};
  await save('data/airports.json',{metadata,airports});
  await writeFile(new URL('airportsdata-MIT.txt',licenseDir),await get(base+'LICENSE',new URL('airports-LICENSE',cacheDir)));
  console.log('机场目录',metadata);
}
if(['all','rail'].includes(mode)) {
  const flag=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.split('=').slice(1).join('=');
  const release=flag('release')||'gtfs-20261024-052143';
  if(!/^gtfs-\d{8}-\d{6}$/.test(release))throw Error('铁路 release 格式无效');
  const source=`https://github.com/wensimehrp/chinese-railway-gtfs/releases/download/${release}/output_gtfs.zip`;
  const hash=flag('sha256')||(release==='gtfs-20261024-052143'?'b498ed6e7c0c2f1c8828f8939762bdeff67793df63ab6a62debab0c926570076':null);
  if(!hash||!/^[a-f0-9]{64}$/.test(hash))throw Error('指定新 release 时必须同时提供 --sha256=完整校验值');
  const bytes=await get(source,new URL(release+'.zip',cacheDir),hash);
  const wanted=new Set(['stops.txt','trips.txt','stop_times.txt','calendar_dates.txt','feed_info.txt']);
  const files=unzipSync(bytes,{filter:file=>wanted.has(file.name.split('/').at(-1))});
  const table=name=>{const key=Object.keys(files).find(k=>k.split('/').at(-1)===name);if(!key)throw Error('GTFS缺少 '+name);return parse(strFromU8(files[key]),{columns:true,bom:true,skip_empty_lines:true});};
  const cityByName=new Map(stations.map(s=>[s.name,s.city]));
  const stops=Object.fromEntries(table('stops.txt').map(s=>[s.stop_id,{name:s.stop_name,city:cityByName.get(s.stop_name)||cityByName.get(s.stop_name.replace(/站$/,''))||null,lat:Number(s.stop_lat),lon:Number(s.stop_lon),calls:0}]));
  const dates={};for(const d of table('calendar_dates.txt'))if(d.exception_type==='1')(dates[d.service_id]??=[]).push(d.date);
  const trips=new Map(table('trips.txt').map(t=>[t.trip_id,{id:t.trip_id,number:t.trip_short_name||t.route_id,dates:dates[t.service_id]||[],stops:[]}]));
  const minute=t=>{const [h,m,s]=t.split(':').map(Number);return h*60+m+(s||0)/60;};
  for(const s of table('stop_times.txt')){const trip=trips.get(s.trip_id),stop=stops[s.stop_id];if(trip&&stop){trip.stops.push([stop.name,minute(s.arrival_time),minute(s.departure_time),Number(s.stop_sequence)]);stop.calls++;}}
  for(const trip of trips.values()){trip.stops.sort((a,b)=>a[3]-b[3]);trip.stops=trip.stops.map(x=>x.slice(0,3));}
  const feed=table('feed_info.txt')[0];
  const allDates=Object.values(dates).flat().sort();
  const stamp=release.slice(5),sourceUpdatedAt=stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8)+'T'+stamp.slice(9,11)+':'+stamp.slice(11,13)+':'+stamp.slice(13,15)+'Z';
  const metadata={source,release,license:'CC-BY-4.0',coordinateSource:'OpenStreetMap',coordinateSystem:'WGS84',sourceUpdatedAt,importedAt:new Date().toISOString(),sha256:hash,start:feed?.feed_start_date||allDates[0],end:feed?.feed_end_date||allDates.at(-1)};
  await save('data/rail-index.json',{metadata,stops:Object.values(stops),trips:[...trips.values()].filter(t=>t.dates.length&&t.stops.length>1)});
  await writeFile(new URL('rail-GTFS-CC-BY-4.0.txt',licenseDir),await get('https://raw.githubusercontent.com/wensimehrp/chinese-railway-gtfs/main/LICENSE',new URL('rail-LICENSE',cacheDir)));
  console.log('铁路索引',metadata,'车站',Object.keys(stops).length,'车次',trips.size);
}
