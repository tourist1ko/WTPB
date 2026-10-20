import { setTimeout as sleep } from 'node:timers/promises';

export function retryDelay(error){
 const data=error?.data;
 if(data?.opcode===8&&Number.isFinite(data.retry_after)&&data.retry_after>=0)return Math.ceil(data.retry_after*1000);
 const match=String(error?.message??'').match(/opcode\s+8\b.*?Retry after\s+([\d.]+)\s+seconds/i);
 return match&&Number.isFinite(Number(match[1]))?Math.ceil(Number(match[1])*1000):null;
}
export class MemberRoster {
 constructor({now=Date.now,pause=sleep,ttl=600000,gap=31000}={}){Object.assign(this,{now,pause,ttl,gap});this.entries=new WeakMap();}
 entry(guild){
  let e=this.entries.get(guild);
  if(!e){e={members:null,expires:0,next:0,pending:null,changes:new Map(),generation:0};this.entries.set(guild,e);}
  return e;
 }
 get(guild){
  if(!guild?.members?.fetch)return Promise.reject(Error('Discord-сервер недоступен.'));
  const e=this.entry(guild);
  if(e.members&&this.now()<e.expires)return Promise.resolve(e.members);
  if(e.pending)return e.pending;
  e.pending=this.refresh(guild,e).finally(()=>{e.pending=null;});return e.pending;
 }
 async refresh(guild,e){
  for(let attempt=0;attempt<2;attempt++){
   // All commands and collectors await this same promise, including its cooldown.
   while(this.now()<e.next)await this.pause(Math.min(60000,e.next-this.now()));
   e.next=this.now()+this.gap;const generation=e.generation;
   try{
    const fetched=await guild.members.fetch({time:30000});
    if(generation!==e.generation)throw Error('Соединение Discord изменилось. Список участников будет запрошен повторно.');
    const members=new Map(fetched);
    for(const [id,member] of e.changes){if(member)members.set(id,member);else members.delete(id);}
    e.changes.clear();e.members=members;e.expires=this.now()+this.ttl;
    return members;
   }catch(error){
    const retry=retryDelay(error);
    if(retry===null)throw error;
    e.next=Math.max(e.next,this.now()+retry+250);
    if(attempt===1)throw Error(`Discord временно ограничил список участников. Повтор через ${Math.ceil((e.next-this.now())/1000)} сек.`,{cause:error});
   }
  }
 }
 change(member,removed=false){
  const e=member?.guild&&this.entries.get(member.guild);if(!e)return;
  if(e.members){if(removed)e.members.delete(member.id);else e.members.set(member.id,member);}
  if(e.pending)e.changes.set(member.id,removed?null:member);
 }
 invalidate(guild){const e=this.entries.get(guild);if(e){e.expires=0;e.generation++;}}
}
export const memberRoster=new MemberRoster();
export const getGuildMembers=guild=>memberRoster.get(guild);
