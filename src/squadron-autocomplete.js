import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
const normal=s=>s.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
export function extractSquadrons(data){
 const result=new Map();const visit=(node,depth=0)=>{
  if(!node||typeof node!=='object'||depth>12)return;
  const name=node.name??node.clanName;
  const tag=node.tag??node.clanTag;
  if(typeof name==='string'&&typeof tag==='string'&&name.trim().length>0&&name.length<=100&&!/[\x00-\x1f]/u.test(name))result.set(normal(name),{name:name.trim(),tag:tag.trim()});
  for(const value of Object.values(node))if(value&&typeof value==='object')visit(value,depth+1);
 };visit(data);return [...result.values()];
}
export class SquadronSuggestions {
 constructor({fetchImpl=fetch,now=Date.now,file,seed}={}){
  this.fetch=fetchImpl;this.now=now;this.file=file;this.entries=new Map();this.queries=new Map();this.inflight=new Map();this.cooldown=0;
  if(!seed){try{seed=JSON.parse(readFileSync(new URL('../data/squadrons.json',import.meta.url),'utf8')).squadrons;}catch{seed=[];}}
  this.remember(seed,false);
  if(file){try{this.remember(JSON.parse(readFileSync(file,'utf8')).squadrons,false);}catch{}}
 }
 remember(entries,save=true){
  for(const row of entries??[])if(typeof row.name==='string'&&row.name.length<=100&&row.name.trim())this.entries.set(normal(row.name),{name:row.name,tag:row.tag??''});
  while(this.entries.size>10000)this.entries.delete(this.entries.keys().next().value);
  if(save&&this.file){try{writeFileSync(this.file+'.tmp',JSON.stringify({squadrons:[...this.entries.values()]}));renameSync(this.file+'.tmp',this.file);}catch{}}
 }
 choices(query){
  const q=normal(query);const score=row=>normal(row.name)===q||normal(row.tag)===q?0:normal(row.name).startsWith(q)||normal(row.tag).startsWith(q)?1:2;
  return [...this.entries.values()].filter(row=>normal(row.name).includes(q)||normal(row.tag).includes(q)).sort((a,b)=>score(a)-score(b)||a.name.localeCompare(b.name)).slice(0,25).map(row=>({name:Array.from(`${row.tag?row.tag+' · ':''}${row.name}`).slice(0,100).join(''),value:row.name}));
 }
 async search(query){
  const q=normal(query);if(q.length<2||q.length>100)return [];
  if((this.queries.get(q)??0)>this.now()||this.cooldown>this.now())return this.choices(q);
  if(!this.inflight.has(q)&&this.inflight.size<4){
   const job=(async()=>{
    try{
     const url=new URL('https://api.thunderinsights.dk/v1/clans/direct/clan/search/');url.searchParams.set('clan',query.trim());url.searchParams.set('limit','25');
     const response=await this.fetch(url,{signal:AbortSignal.timeout(1800),headers:{Accept:'application/json'}});
     if(!response.ok)throw Error('search unavailable');
     const payload=await response.json();
     if(payload?.detail||payload?.error)throw Error('search unavailable');
     this.remember(extractSquadrons(payload));this.queries.set(q,this.now()+300000);
     while(this.queries.size>300)this.queries.delete(this.queries.keys().next().value);
    }catch{this.cooldown=this.now()+30000;}
   })().finally(()=>this.inflight.delete(q));this.inflight.set(q,job);
  }
  const pending=this.inflight.get(q);
  if(pending){let timer;await Promise.race([pending,new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);clearTimeout(timer);}
  return this.choices(q);
 }
}
export async function handleSquadronAutocomplete(i,store,guildId,suggestions){
 if(!i.isAutocomplete?.()||i.commandName!=='pb'||i.guildId!==guildId)return false;
 if(i.options.getSubcommand(false)!=='register')return false;
 if(!i.memberPermissions?.has(PermissionFlagsBits.Administrator)||store.squad(i.guildId)){await i.respond([]);return true;}
 const focus=i.options.getFocused(true);if(focus.name!=='name'){await i.respond([]);return true;}
 let choices=[];
 try{choices=await suggestions.search(String(focus.value));}catch{}
 await i.respond(choices);return true;
}
export const suggestionsFile=()=>join(process.env.DATA_DIR||'./storage','squadron-suggestions.json');
