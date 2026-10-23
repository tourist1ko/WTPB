import { MessageFlags } from 'discord.js';

export class RequestLimiter {
  constructor({limit=10,windowMs=60000,now=()=>performance.now()}={}){
    this.limit=limit;this.windowMs=windowMs;this.now=now;this.entries=new Map();this.nextSweep=0;
  }
  take(key){
    const now=this.now(),cutoff=now-this.windowMs;
    if(now>=this.nextSweep){
      for(const [id,times] of this.entries)if(times.at(-1)<=cutoff)this.entries.delete(id);
      this.nextSweep=now+this.windowMs;
    }
    const times=(this.entries.get(key)??[]).filter(time=>time>cutoff);
    if(times.length>=this.limit)return {allowed:false,retryAfterMs:Math.max(1,times[0]+this.windowMs-now)};
    times.push(now);this.entries.set(key,times);
    return {allowed:true,retryAfterMs:0};
  }
}

export async function enforceRateLimit(interaction,guildId,limiter){
  if(interaction.guildId!==guildId||!interaction.user?.id)return false;
  const command=interaction.isChatInputCommand?.()&&['pb','rank'].includes(interaction.commandName);
  const button=interaction.isButton?.()&&interaction.customId?.startsWith('pbrank:');
  if(!command&&!button)return false;
  const result=limiter.take(`${guildId}:${interaction.user.id}`);
  if(result.allowed)return false;
  const seconds=Math.ceil(result.retryAfterMs/1000);
  await interaction.reply({content:`Лимит: ${limiter.limit} запросов в минуту. Подожди ещё ${seconds} сек.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  return true;
}
