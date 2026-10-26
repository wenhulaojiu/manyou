import {readFile} from 'node:fs/promises';
import {addDays} from './dist/planner.mjs';

export function createTimetable(data) {
  const stops=new Map(data.stops.map(s=>[s.name,s]));
  const byStation=new Map();
  for(const t of data.trips)for(let i=0;i<t.stops.length;i++){
    const name=t.stops[i][0];if(!byStation.has(name))byStation.set(name,[]);byStation.get(name).push([t,i]);
  }
  const fresh=date=>{const d=date.replaceAll('-','');const updated=Math.min(Date.parse(data.metadata.importedAt),Date.parse(data.metadata.sourceUpdatedAt||data.metadata.importedAt));return d>=data.metadata.start&&d<=data.metadata.end&&Date.now()-updated<3*86400000;};
  function connections(origins,date) {
    const scores=new Map();if(!fresh(date))return scores;
    for(const name of origins)for(const [t,i] of byStation.get(name)||[]){
      const departure=t.stops[i][2],day=addDays(date,-Math.floor(departure/1440)).replaceAll('-','');
      if(!t.dates.includes(day))continue;
      for(let j=i+1;j<t.stops.length;j++){
        const target=t.stops[j][0];const key=name+'|'+target;
        scores.set(key,(scores.get(key)||0)+1);
      }
    }return scores;
  }
  return {
    status(date){return {...data.metadata,available:fresh(date),stations:stops.size,trips:data.trips.length}},
    stationScore(name,date){return fresh(date)?(stops.get(name)?.calls||0):0},
    pairs(origins,destinations,date){const scores=connections(origins,date);return new Map(origins.flatMap(a=>destinations.map(b=>[a+'|'+b,scores.get(a+'|'+b)||0])))},
    hubs(from,to,date,candidates){
      if(!fresh(date))return candidates;
      const origins=[...stops.values()].filter(s=>s.city===from).map(s=>s.name);
      const reachable=new Map();for(const [pair,count] of connections(origins,date)){
        const city=stops.get(pair.split('|')[1])?.city;if(city)reachable.set(city,(reachable.get(city)||0)+count);
      }
      const target=[...stops.values()].find(s=>s.city===to),origin=[...stops.values()].find(s=>s.city===from);
      const distance=(a,b)=>Math.hypot(a.lat-b.lat,(a.lon-b.lon)*Math.cos(a.lat*Math.PI/180));
      const score=city=>{const hub=[...stops.values()].find(s=>s.city===city);return (reachable.has(city)?100:0)+Math.log1p(reachable.get(city)||0)-(hub&&origin&&target?distance(origin,hub)+distance(hub,target):100)};
      return [...candidates].sort((a,b)=>score(b)-score(a)||a.localeCompare(b,'zh-CN'));
    }
  };
}
let loaded;
export async function loadTimetable(){
  if(!loaded)loaded=readFile(new URL('./data/rail-index.json',import.meta.url),'utf8').then(s=>createTimetable(JSON.parse(s))).catch(()=>null);
  return loaded;
}
