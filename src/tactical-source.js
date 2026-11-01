import { validateBattle } from './rating.js';
import { normalizeTag, coreTag, sameTag } from './wtapi-codec.js';

export const ARCHIVE='https://www.antoniocnz.com';
const HEADERS={'User-Agent':'PB-Rank/1.5 (Discord squadron statistics)','Accept':'application/json,text/html'};
export class SourceError extends Error {
 constructor(message,retryMs=60000){super(message);this.retryMs=retryMs;}
}
const session=id=>typeof id==='string'&&/^[0-9a-f]{16}$/i.test(id);
const slug=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
export function battlePath(row){
 if(!session(row.sessionId))throw Error('Архив: неверный ID боя.');
 const parts=[slug(String(row.mapDisplayName??'').replace(/^avg_/,''))];
 const a=slug(row.team1Tag),b=slug(row.team2Tag);if(a&&b)parts.push(a,'vs',b);
 parts.push(row.sessionId.toLowerCase());return '/en/wt/'+parts.filter(Boolean).join('-');
}
export function sceneFromHtml(html){
 // Read the JSON literal; never execute scripts obtained from the source.
 const marker=/\bwindow\.SCENE\s*=\s*\{/i.exec(html);
 if(!marker)throw Error('Архив: формат страницы боя изменился.');
 const start=marker.index+marker[0].length-1;
 let depth=0,inString=false,escaped=false;
 for(let i=start;i<html.length;i++){
  const c=html[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){
   try{return JSON.parse(html.slice(start,i+1));}catch{throw Error('Архив: некорректные данные боя.');}
  }
 }
 throw Error('Архив: данные боя оборваны.');
}
// Which side (1 or 2) is the registered squadron. Exact tag first, then the
// tag without decorations, so "[105HP]" from the site still finds "┾105HP┿".
export function archiveTeam(row,tag){
 const expected=normalizeTag(tag),core=coreTag(tag);if(!expected||!core)return null;
 const a=normalizeTag(row.team1Tag)===expected,b=normalizeTag(row.team2Tag)===expected;
 if(a!==b)return a?1:2;
 if(a&&b)return null;
 const c=coreTag(row.team1Tag)===core,d=coreTag(row.team2Tag)===core;
 return c!==d?(c?1:2):null;
}
export function archiveBattle(row,scene,name,tag){
 const team=archiveTeam(row,tag);if(!team||row.difficulty!=='realistic')return null;
 const match=scene?.match;
 if(!match || match.sessionId!==row.sessionId || match.difficulty!=='realistic')throw Error('Архив: страница не соответствует выбранному бою.');
 if(match.scoreboardConfidence&&match.scoreboardConfidence!=='full')throw Error('Архив: итоговая статистика пока неполная.');
 const winner=[1,2].includes(match.winnerTeam)?match.winnerTeam:row.winnerTeam;
 if(![1,2].includes(winner))throw Error('Архив: результат боя не подтверждён.');
 if(!Array.isArray(scene.players)||scene.players.length<2||scene.players.length>32)throw Error('Архив: неверный состав боя.');
 // Only our side, only players with our tag (bots and empty tags are skipped).
 const players=scene.players.filter(p=>p.team===team&&typeof p.name==='string'&&p.name.trim()&&sameTag(p.clanTag,tag));
 if(!players.length)throw Error('Архив: в отчёте нет игроков полка.');
 const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=100?v:0;
 const seen=new Set(),rows=[];
 for(const p of players){const key=p.name.trim().toLowerCase();if(seen.has(key))continue;seen.add(key);rows.push({nickname:p.name.trim(),tankKills:count(p.groundKills),airKills:count(p.kills),deaths:count(p.deaths),assists:count(p.assists??p.assist??p.assistCount??p.killAssists)});}
 const battle=validateBattle({id:row.sessionId.toLowerCase(),mode:'squadron_realistic',squadron:name,playedAt:row.playedAtUtc,result:winner===team?'win':'loss',players:rows.slice(0,8)});
 return battle;
}
export class TacticalSource {
 constructor({fetchImpl=fetch}={}){this.fetchImpl=fetchImpl;this.cache=new Map();this.queries=new Map();}
 async request(path,maxBytes,conditional=false){
  const cached=conditional?this.cache.get(path):null;
  const headers={...HEADERS};if(cached?.etag)headers['If-None-Match']=cached.etag;
  const r=await this.fetchImpl(ARCHIVE+path,{headers,signal:AbortSignal.timeout(20000),redirect:'follow'});
  if(r.url){const u=new URL(r.url);if(u.protocol!=='https:'||!['www.antoniocnz.com','antoniocnz.com'].includes(u.hostname))throw Error('Архив: неожиданный адрес ответа.');}
  if(r.status===304&&cached)return cached.text;
  if(!r.ok){
   const seconds=Number(r.headers?.get('retry-after'));
   throw new SourceError(`Архив: HTTP ${r.status}. Повторная попытка позже.`,r.status===429?Math.min(3600000,Math.max(300000,(seconds||0)*1000)):60000);
  }
  const declared=Number(r.headers?.get('content-length'));if(declared>maxBytes)throw Error('Архив: ответ слишком большой.');
  const chunks=[];let size=0;
  if(r.body?.getReader){
   const reader=r.body.getReader();
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Архив: ответ слишком большой.');chunks.push(Buffer.from(value));}}
   catch(e){await reader.cancel().catch(()=>{});throw e;}
  }else{const b=Buffer.from(await r.text());if(b.length>maxBytes)throw Error('Архив: ответ слишком большой.');chunks.push(b);}
  const text=Buffer.concat(chunks).toString('utf8');
  if(conditional){if(this.cache.size>=64)this.cache.clear();this.cache.set(path,{etag:r.headers?.get('etag'),text});}
  return text;
 }
 async page(query,skip){
  const data=JSON.parse(await this.request('/wt/api/replays?skip='+skip+'&take=20&clan='+encodeURIComponent(query),2*1024*1024,true));
  if(!Array.isArray(data?.items)||data.items.length>20||!Number.isSafeInteger(data.total)||data.total<0)throw Error('Архив: формат списка боёв изменился.');
  return data;
 }
 // The archive filters by the tag as it appears in battles. The official site may
 // show it differently, so try the tag, the tag without brackets and the bare core.
 async list(tag,skip=0){
  const saved=this.queries.get(tag);if(saved)return this.page(saved,skip);
  const bare=String(tag??'').trim().replace(/^\[(.*)\]$/u,'$1').trim();
  const core=String(tag??'').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
  let first;
  for(const query of [...new Set([tag,bare,core].filter(Boolean))]){
   const data=await this.page(query,skip);first??=data;
   if(data.total>0&&data.items.some(row=>archiveTeam(row,tag))){this.queries.set(tag,query);return data;}
  }
  return first;
 }
 async battle(row,name,tag){return archiveBattle(row,sceneFromHtml(await this.request(battlePath(row),16*1024*1024)),name,tag);}
}
