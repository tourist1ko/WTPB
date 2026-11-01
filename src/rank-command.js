import { PermissionFlagsBits } from 'discord.js';
import { rankPayload } from './rank-pages.js';
import { lookupSquadron } from './squadron.js';
import { coreTag } from './wtapi-codec.js';
export const rankCommand={name:'rank',description:'Рейтинг игроков полка по К/Д и winrate',options:[{type:4,name:'page',description:'Страница',min_value:1,max_value:1000}]};
export const registerOption={type:1,name:'register',description:'Привязать полк к серверу',options:[{type:3,name:'name',description:'Полное название полка или тег',required:true,max_length:100,autocomplete:true}]};
export const unregisterOption={type:1,name:'unregister',description:'Отвязать полк от сервера, сохранив статистику'};
export const statusOption={type:1,name:'status',description:'Работа бота и привязанный полк'};
const ADMIN=['register','unregister'];
const startedAt=Date.now();

function duration(ms){
 const m=Math.floor(ms/60000),d=Math.floor(m/1440),h=Math.floor(m%1440/60),min=m%60;
 return (d?d+' д ':'')+(d||h?h+' ч ':'')+min+' мин';
}
// Accept a full name or a tag. A tag is resolved through known squadrons, then
// verified on the official site by its full name.
async function resolveSquadron(input,lookup,suggestions){
 try{return await lookup(input);}
 catch(error){
  if(error?.code!=='NOT_FOUND'||!suggestions)throw error;
  const core=coreTag(input);
  if(!core)throw error;
  if(suggestions.search)await suggestions.search(input).catch(()=>{});
  const hit=[...(suggestions.entries?.values?.()??[])].find(row=>coreTag(row.tag)===core);
  if(!hit)throw error;
  return lookup(hit.name);
 }
}
export async function statusText(store,guildId,{live,seasons,client,service}={}){
 const lines=['**Бот работает**',`Время работы: ${duration(Date.now()-startedAt)}`];
 const ping=client?.ws?.ping;if(Number.isFinite(ping)&&ping>=0)lines.push(`Задержка Discord: ${Math.round(ping)} мс`);
 const binding=store.binding(guildId);
 lines.push('');
 if(!binding){lines.push('Полк: не привязан. Администратор: /pb register name:название полка');return lines.join('\n');}
 lines.push(`Полк: **${binding.tag?binding.tag+' ':''}${binding.squadron}**`);
 const season=seasons?await seasons.currentSeason().catch(()=>null):null;
 if(season){
  lines.push(`Сезон: ${season.label}${season.provisional?' (официальное расписание ещё не опубликовано)':''}`);
  const rows=store.seasonRows(guildId,season);
  lines.push(`Игроков в статистике: ${rows.length} (в составе полка: ${store.rosterCount(guildId)}, с боями в сезоне: ${rows.filter(r=>r.wins+r.losses>0).length})`);
  lines.push(`ПБ учтено за сезон: ${store.seasonBattleCount(guildId,season)}`);
 }
 const br=service?await service.getBRInfo().catch(()=>null):null;
 if(br)lines.push(`Текущий БР: ${br.current}`);
 if(live)lines.push('',`Автосбор новых боёв: ${live.status()}`);
 if(seasons)lines.push('',`Бои сезона:\n${await seasons.status().catch(e=>e.message)}`);
 return lines.join('\n').slice(0,2000);
}
export async function handleRank(i,store,guildId,lookup=lookupSquadron,suggestions,live,seasons,extra={}){
 if(!i.isChatInputCommand() || i.guildId!==guildId)return false;
 const sub=i.commandName==='pb'?i.options.getSubcommand(false):null;
 if(i.commandName!=='rank' && ![...ADMIN,'status'].includes(sub))return false;
 const admin=ADMIN.includes(sub);
 await i.deferReply({ephemeral:admin||sub==='status'});
 try{
  if(admin&&!i.memberPermissions?.has(PermissionFlagsBits.Administrator))throw Error('Эта команда доступна только администратору сервера.');
  if(sub==='status'){await i.editReply({content:await statusText(store,guildId,{live,seasons,...extra}),allowedMentions:{parse:[]}});return true;}
  if(sub==='register'){
   if(store.squad(i.guildId))throw Error('Уже привязан полк: '+store.squad(i.guildId)+'. Сначала выполни /pb unregister.');
   const profile=await resolveSquadron(i.options.getString('name',true),lookup,suggestions);
   store.register(i.guildId,profile.name,profile.tag??'');
   suggestions?.remember?.([profile]);
   const added=store.setRoster(i.guildId,profile.name,profile.members??[]);
   seasons?.markRoster?.(profile.name);
   const roster=profile.members?.length?`Игроков полка добавлено в статистику: ${added}.`:'Состав полка добавится автоматически из отчётов боёв.';
   await i.editReply({content:`Полк привязан: ${profile.tag?profile.tag+' ':''}${profile.name}\n${roster}\nБои текущего сезона загружаются автоматически. Прогресс: /pb status`,allowedMentions:{parse:[]}});
   void seasons?.kick?.();void live?.tick?.();
   return true;
  }
  if(sub==='unregister'){const previous=store.squad(i.guildId);store.unregister(i.guildId);await i.editReply(previous?'Полк отвязан. Накопленная статистика сохранена.':'К серверу пока не привязан полк.');return true;}
  if(!store.squad(i.guildId))throw Error('Полк ещё не привязан. Администратор: /pb register name:название полка.');
  const season=await seasons?.currentSeason();const rows=season?store.seasonRows(i.guildId,season):store.rows(i.guildId);const page=i.options.getInteger('page')??1;
  await i.editReply(rankPayload(rows,store.squad(i.guildId),i.user.id,page,season,store.binding(i.guildId)?.tag||store.squad(i.guildId)));
 }catch(e){await i.editReply({content:e.message,allowedMentions:{parse:[]}});}
 return true;
}
