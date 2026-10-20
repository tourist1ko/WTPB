import WebSocket from 'ws';
import { decodeReplay, battleForSquad } from './wtapi-codec.js';
import { lookupSquadron } from './squadron.js';
import { getGuildMembers } from './members.js';

const STREAM='wss://wtapi.dev/v1/replays/ws/sqb';
export class LiveBattles {
 constructor({key,store,client,guildId,lookup=lookupSquadron,Socket=WebSocket,log=console.log,membersForGuild=getGuildMembers}) {
  Object.assign(this,{key,store,client,guildId,lookup,Socket,log,membersForGuild});
  this.state=key?'Ожидание подключения.':'Автосбор выключен: не задан WTAPI_KEY.';
  this.failures=0;this.stopped=true;this.draining=false;
 }
 start(){if(!this.stopped)return;this.stopped=false;void this.tick();this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();}
 stop(){this.stopped=true;clearInterval(this.timer);clearTimeout(this.reconnect);this.socket?.terminate();this.socket=null;}
 async tick(){
  if(this.stopped||this.ticking)return;this.ticking=true;
  try{
   const binding=this.store.binding(this.guildId);
   if(!binding){this.socket?.terminate();this.socket=null;this.state='Полк не привязан.';return;}
   if(!this.key){this.state='Автосбор выключен: не задан WTAPI_KEY.';return;}
   if(!binding.tag){
    const profile=await this.lookup(binding.squadron);
    this.store.setTag(this.guildId,binding.squadron,profile.tag);
   }
   if(!this.socket&&!this.reconnect)this.connect();
   await this.drain();
  }catch(e){this.report(e);}finally{this.ticking=false;}
 }
 report(e){const message=String(e?.message??e).replaceAll(this.key||'\u0000','[REDACTED]');this.log(`Автосбор: ${message}`);}
 connect(){
  if(this.stopped)return;
  this.state='Подключение к WTApi…';
  const socket=new this.Socket(STREAM,{headers:{Authorization:`Bearer ${this.key}`},handshakeTimeout:15000,maxPayload:64*1024*1024});
  this.socket=socket;
  socket.on('open',()=>{if(this.socket!==socket)return;this.failures=0;this.state='Подключён к потоку ПБ WTApi.';this.log(this.state);});
  socket.on('message',(bytes,isBinary)=>{
   try{
    if(!isBinary)throw Error('WTApi: получено текстовое сообщение вместо бинарного.');
    const binding=this.store.binding(this.guildId);
    if(!binding?.tag)return;
    const battle=battleForSquad(decodeReplay(bytes),binding.squadron,binding.tag);
    if(!battle)return;
    this.store.enqueue(this.guildId,battle);
    void this.drain();
   }catch(e){this.report(e);this.state='Ошибка обработки ПБ. Подробности в логах.';}
  });
  socket.on('error',e=>{this.report(e);this.state='Ошибка подключения к WTApi. Повторная попытка автоматически.';socket.terminate();});
  socket.on('close',code=>{
   if(this.socket!==socket)return;this.socket=null;
   if(this.stopped)return;
   this.state=code===1008?'WTApi отклонил доступ. Проверь ключ и выбранный тег полка.':'Поток ПБ отключён. Переподключение автоматически.';
   this.log(`${this.state} Код: ${code}.`);
   const delay=Math.min(300000,5000*2**Math.min(this.failures++,6));
   this.reconnect=setTimeout(()=>{this.reconnect=null;void this.tick();},delay);this.reconnect.unref();
  });
 }
 async drain(){
  if(this.draining||this.stopped)return;this.draining=true;
  try{
   const binding=this.store.binding(this.guildId);if(!binding)return;
   const pending=this.store.pending(this.guildId,binding.squadron);if(!pending.length)return;
   const guild=this.client.guilds.cache.get(this.guildId);if(!guild)throw Error('Discord-сервер недоступен. Бои сохранены в очереди.');
   const members=await this.membersForGuild(guild);
   for(const battle of pending){
    if(this.stopped||this.store.squad(this.guildId)!==binding.squadron)break;
    const result=this.store.ingest(this.guildId,battle,members);
    this.store.finishPending(this.guildId,battle.squadron,battle.id);
    if(!result.duplicate)this.log(`ПБ ${battle.id}: учтено игроков ${result.count}.`);
   }
  }catch(e){this.report(e);}finally{this.draining=false;}
 }
 status(){return `${this.state}\nБоев в очереди: ${this.store.pendingCount(this.guildId)}.`;}
}
