import { PermissionFlagsBits } from 'discord.js';
import { rankPayload } from './rank-pages.js';
import { lookupSquadron } from './squadron.js';
export const rankCommand={name:'rank',description:'Рейтинг игроков полка по К/Д и winrate',options:[{type:4,name:'page',description:'Страница',min_value:1,max_value:1000}]};
export const registerOption={type:1,name:'register',description:'Привязать полк к серверу',options:[{type:3,name:'name',description:'Точное название полка',required:true,max_length:100,autocomplete:true}]};
export const unregisterOption={type:1,name:'unregister',description:'Отвязать полк от сервера, сохранив статистику'};
export const importOption={type:1,name:'import',description:'Загрузить нормализованный JSON-отчёт ПБ',options:[{type:11,name:'report',description:'JSON по примеру из архива',required:true}]};
export const statusOption={type:1,name:'status',description:'Состояние автоматического сбора ПБ'};
export async function handleRank(i,store,guildId,lookup=lookupSquadron,suggestions,live){
 if(!i.isChatInputCommand() || i.guildId!==guildId)return false;
 const sub=i.commandName==='pb'?i.options.getSubcommand(false):null;
 if(i.commandName!=='rank' && !['register','unregister','import','status'].includes(sub))return false;
 const admin=['register','unregister','import','status'].includes(sub);
 await i.deferReply({ephemeral:admin});
 try{
  if(admin&&!i.memberPermissions?.has(PermissionFlagsBits.Administrator))throw Error('Эта команда доступна только администратору сервера.');
  if(sub==='status'){await i.editReply(live?.status()??'Автосбор не настроен.');return true;}
  if(sub==='register'){if(store.squad(i.guildId))throw Error('Уже привязан полк: '+store.squad(i.guildId)+'. Сначала выполни /pb unregister.');const profile=await lookup(i.options.getString('name',true));store.register(i.guildId,profile.name,profile.tag??'');suggestions?.remember([profile]);await i.editReply({content:`Полк привязан: ${profile.name}`,allowedMentions:{parse:[]}});void live?.tick();return true;}
  if(sub==='unregister'){const previous=store.squad(i.guildId);store.unregister(i.guildId);await i.editReply(previous?'Полк отвязан. Накопленная статистика сохранена.':'К серверу пока не привязан полк.');return true;}
  if(!store.squad(i.guildId))throw Error('Сначала выполни /pb register name:название полка.');
  if(sub==='import'){
   const a=i.options.getAttachment('report',true);if(a.size>1024*1024)throw Error('Максимальный размер отчёта: 1 МБ.');
   const url=new URL(a.url);if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname))throw Error('Неверный адрес вложения.');
   const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Не удалось скачать отчёт.');
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>1024*1024)throw Error('Отчёт слишком большой.');
   const b=JSON.parse(new TextDecoder().decode(bytes));const members=await i.guild.members.fetch();const result=store.ingest(i.guildId,b,members);
   await i.editReply(result.duplicate?'Этот бой уже учтён.':`Отчёт учтён. Игроков: ${result.count}.`);
  }else{
   const members=await i.guild.members.fetch();const rows=store.rows(i.guildId,members);const page=i.options.getInteger('page')??1;
   await i.editReply(rankPayload(rows,store.squad(i.guildId),i.user.id,page));
  }
 }catch(e){await i.editReply({content:e instanceof SyntaxError?'Некорректный JSON.':e.message,allowedMentions:{parse:[]}});}
 return true;
}
