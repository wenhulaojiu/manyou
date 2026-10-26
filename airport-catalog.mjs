import {readFileSync} from 'node:fs';
const catalog=JSON.parse(readFileSync(new URL('./data/airports.json',import.meta.url),'utf8'));
export const airportMetadata=catalog.metadata;
export const airportCities=Object.fromEntries([...new Set(catalog.airports.map(a=>a.city).filter(Boolean))].sort().map(city=>[city,catalog.airports.filter(a=>a.city===city)]));
export const airportsFor=city=>airportCities[city]||[];
