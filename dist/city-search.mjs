import {cityIndex} from './city-index.mjs';
export {cityIndex};
const clean=value=>String(value).trim().toLowerCase().replace(/\s/g,'').replace(/市$/,'');
export function searchCities(input,limit=8){
 const text=clean(input);
 const rank=c=>!text?0:c.name===text||c.pinyin===text?100:c.initials===text?90:c.name.startsWith(text)||c.pinyin.startsWith(text)?80:c.initials.startsWith(text)?70:c.name.includes(text)||c.pinyin.includes(text)?50:0;
 return cityIndex.map(c=>({...c,rank:rank(c)})).filter(c=>!text||c.rank).sort((a,b)=>b.rank-a.rank||b.count-a.count||a.name.localeCompare(b.name,'zh-CN')).slice(0,limit);
}
