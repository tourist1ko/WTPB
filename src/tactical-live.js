import { TacticalSource, archiveTeam } from './tactical-source.js';
import { lookupSquadron } from './squadron.js';

const DAY=86400000;
export class ArchiveBattles {
 constructor({store,client,guildId,source=new TacticalSource(),lookup=lookupSquadron,log=console.log,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
  Object.assign(this,{store,client,guildId,source,lookup,log,now,pause});
  this.stopped=true;this.state='Ожидание проверки архива ПБ.';this.nextPoll=0;this.nextRescan=0;
  this.retries=new Map();
 }
 start(){if(!this.stopped)return;this.stopped=false;void this.tick();this.timer=setInterval(()=>void this.tick(),60000);this.timer.unref();}
 stop(){this.stopped=true;clearInterval(this.timer);}
 status(){return `${this.state}\nИсточник: Tactical Replays, без ключа.\nБоев в очереди: ${this.store.pendingCount(this.guildId)}.`;}
 same(binding){const b=this.store.binding(this.guildId);return !this.stopped&&b?.squadron===binding.squadron&&b?.tag===binding.tag;}
 async drain(binding){
  const pending=this.store.pending(this.guildId,binding.squadron);if(!pending.length)return;
  const guild=this.client.guilds.cache.get(this.guildId);if(!guild)throw Error('Discord-сервер недоступен. Полученные бои сохранены в очереди.');
  const members=await guild.members.fetch();
  for(const battle of pending){
   if(!this.same(binding))return;
   const result=this.store.ingest(this.guildId,battle,members);this.store.finishPending(this.guildId,battle.squadron,battle.id);
   if(!result.duplicate)this.log(`ПБ ${battle.id}: учтено игроков ${result.count}.`);
  }
 }
 async tick(){
  if(this.stopped||this.running)return;this.running=true;
  try{
   let binding=this.store.binding(this.guildId);
   if(!binding){this.state='Полк не привязан.';return;}
   if(!binding.tag){const profile=await this.lookup(binding.squadron);this.store.setTag(this.guildId,binding.squadron,profile.tag);binding=this.store.binding(this.guildId);}
   if(!binding?.tag)throw Error('Не удалось определить тег полка.');
   if(!this.same(binding))return;
   if(this.lastBinding!==binding.squadron+'\0'+binding.tag){this.nextPoll=0;this.nextRescan=0;this.lastBinding=binding.squadron+'\0'+binding.tag;}
   await this.drain(binding);
   if(this.now()<this.nextPoll)return;
   this.nextPoll=this.now()+60000;
   const catchup=this.now()>=this.nextRescan,cutoff=this.now()-DAY;
   let loaded=0,limited=false,failures=0;
   // One page per minute in normal operation; rescan the last 24 h hourly and on restart.
   for(let page=0;page<(catchup?100:1);page++){
    if(!this.same(binding))return;
    const data=await this.source.list(binding.tag,page*20);
    let older=false;
    for(const row of data.items){
     if(!this.same(binding))return;
     const played=Date.parse(row.playedAtUtc);
     if(!Number.isFinite(played))throw Error('Архив: нет даты боя.');
     if(played<cutoff){older=true;continue;}
     if(played>this.now()+300000||row.difficulty!=='realistic'||!archiveTeam(row,binding.tag)||![1,2].includes(row.winnerTeam)||this.store.seenBattle(this.guildId,binding.squadron,row.sessionId))continue;
     const retry=this.retries.get(row.sessionId);if(retry?.until>this.now())continue;
     if(loaded>=5){limited=true;break;}
     await this.pause(1000);if(!this.same(binding))return;
     try{
      const battle=await this.source.battle(row,binding.squadron,binding.tag);
      if(battle&&this.same(binding))this.store.enqueue(this.guildId,battle);
      this.retries.delete(row.sessionId);
     }catch(e){if(e.retryMs>=300000)throw e;failures++;const attempts=(retry?.attempts??0)+1;this.retries.set(row.sessionId,{attempts,until:this.now()+Math.min(3600000,60000*2**Math.min(attempts,6))});if(this.retries.size>1000)this.retries.delete(this.retries.keys().next().value);this.log(`ПБ ${row.sessionId}: ${e.message}`);}
     loaded++;
    }
    if(limited)break;
    if(!data.items.length||older||(page+1)*20>=data.total)break;
    if(!catchup)break;
    if(page===99)limited=true;
    await this.pause(1000);
   }
   await this.drain(binding);
   if(!this.same(binding))return;
   if(catchup&&!limited&&!failures)this.nextRescan=this.now()+3600000;
   this.state=failures?'Часть боёв ещё недоступна. Проверка повторится.':limited?'Загрузка найденных ПБ продолжается.':'Архив ПБ проверен: '+new Date(this.now()).toISOString().slice(11,19)+' UTC.';
  }catch(e){
   this.state=String(e?.message??e);this.log('Автосбор: '+this.state);this.nextPoll=Math.max(this.nextPoll,this.now()+(e.retryMs??60000));
  }finally{this.running=false;}
 }
}
