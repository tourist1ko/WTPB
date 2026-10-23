import { PermissionFlagsBits } from 'discord.js';
import { rankPayload } from './rank-pages.js';
import { lookupSquadron } from './squadron.js';
import { wtNick } from './rating.js';
import { seasonProgress } from './season-update.js';
export const rankCommand={name:'rank',description:'Рейтинг игроков полка по К/Д и winrate',options:[{type:4,name:'page',description:'Страница',min_value:1,max_value:1000}]};
export const registerOption={type:1,name:'register',description:'Привязать полк к серверу',options:[{type:3,name:'name',description:'Точное название полка',required:true,max_length:100,autocomplete:true}]};
export const unregisterOption={type:1,name:'unregister',description:'Отвязать полк от сервера, сохранив статистику'};
export const importOption={type:1,name:'import',description:'Загрузить нормализованный JSON-отчёт ПБ',options:[{type:11,name:'report',description:'JSON по примеру из архива',required:true}]};
export const statusOption={type:1,name:'status',description:'Состояние автоматического сбора ПБ'};
const playerOption={type:6,name:'nickname',description:'Участник Discord',required:true};
export const statOption={type:2,name:'stat',description:'Участники статистики',options:[
 {type:1,name:'addplayer',description:'Добавить участника в статистику',options:[playerOption,{type:3,name:'wtnick',description:'Игровой ник, если отличается от ника на сервере',max_length:100,min_length:1}]},
 {type:1,name:'removeplayer',description:'Убрать участника из статистики, сохранив историю',options:[playerOption]},
 {type:1,name:'list',description:'Показать добавленных участников'},
 {type:1,name:'update',description:'Дополнить статистику текущего сезона',options:[{type:5,name:'full',description:'Повторить полный поиск боёв сезона'}]}
]};
export async function handleRank(i,store,guildId,lookup=lookupSquadron,suggestions,live,seasons){
 if(!i.isChatInputCommand() || i.guildId!==guildId)return false;
 const sub=i.commandName==='pb'?i.options.getSubcommand(false):null;
 const stat=i.commandName==='pb'&&i.options.getSubcommandGroup?.(false)==='stat';
 if(i.commandName!=='rank' && !stat && !['register','unregister','import','status'].includes(sub))return false;
 const admin=stat||['register','unregister','import','status'].includes(sub);
 await i.deferReply({ephemeral:admin});
 try{
  if(admin&&!i.memberPermissions?.has(PermissionFlagsBits.Administrator))throw Error('Эта команда доступна только администратору сервера.');
  if(sub==='status'){await i.editReply((live?.status()??'Автосбор не настроен.')+(seasons?'\n\n'+await seasons.status():''));return true;}
  if(sub==='register'){if(store.squad(i.guildId))throw Error('Уже привязан полк: '+store.squad(i.guildId)+'. Сначала выполни /pb unregister.');const profile=await lookup(i.options.getString('name',true));store.register(i.guildId,profile.name,profile.tag??'');suggestions?.remember([profile]);await i.editReply({content:`Полк привязан: ${profile.name}`,allowedMentions:{parse:[]}});void live?.tick();return true;}
  if(sub==='unregister'){const previous=store.squad(i.guildId);store.unregister(i.guildId);await i.editReply(previous?'Полк отвязан. Накопленная статистика сохранена.':'К серверу пока не привязан полк.');return true;}
  if(!store.squad(i.guildId))throw Error('Сначала выполни /pb register name:название полка.');
  if(stat){
   if(sub==='update'){
    if(!seasons)throw Error('Сезонное обновление не настроено.');
    const started=Date.now();let last=0,unsubscribe,timer;
    const show=async job=>{
     const terminal=job.status!=='running';
     if(Date.now()-started>14*60000){unsubscribe?.();clearTimeout(timer);return;}
     if(!terminal&&Date.now()-last<5000)return;
     last=Date.now();
     try{await i.editReply({content:seasonProgress(job),allowedMentions:{parse:[]}});}catch{unsubscribe?.();clearTimeout(timer);}
     if(terminal){unsubscribe?.();clearTimeout(timer);}
    };
    unsubscribe=seasons.subscribe(show);timer=setTimeout(()=>unsubscribe(),14*60000);timer.unref();
    try{await show(await seasons.start({full:i.options.getBoolean?.('full')??false}));}catch(error){unsubscribe();clearTimeout(timer);throw error;}
   }else if(sub==='list'){
    const players=store.players(i.guildId);
    if(!players.length){await i.editReply('Участников нет. Добавь через /pb stat addplayer.');return true;}
    const lines=players.map((p,index)=>`${index+1}. ${p.label} · <@${p.uid}>`),chunks=[];let chunk='';
    for(const line of lines){if(chunk.length+line.length+1>1800){chunks.push(chunk);chunk='';}chunk+=(chunk?'\n':'')+line;}if(chunk)chunks.push(chunk);
    await i.editReply({content:chunks[0],allowedMentions:{parse:[]}});
    for(const content of chunks.slice(1))await i.followUp({content,ephemeral:true,allowedMentions:{parse:[]}});
   }else if(sub==='removeplayer'){
    const user=i.options.getUser('nickname',true);
    await i.editReply(store.removePlayer(i.guildId,user.id)?'Участник убран. История сохранена.':'Участник не добавлен в статистику.');
   }else if(sub==='addplayer'){
    const user=i.options.getUser('nickname',true);if(user.bot)throw Error('Бота нельзя добавить в статистику.');
    const squad=store.squad(i.guildId);let member;
    try{member=await i.guild.members.fetch({user:user.id,force:true});}catch{throw Error('Не удалось проверить участника на этом сервере. Попробуй ещё раз.');}
    if(!member||member.user.bot)throw Error('Выбери участника этого сервера.');
    if(store.squad(i.guildId)!==squad)throw Error('Полк изменился. Повтори команду.');
    const explicit=i.options.getString('wtnick');
    const nick=explicit??wtNick(member.nickname)??member.nickname??user.username;
    const result=store.addPlayer(i.guildId,user.id,nick);
    const season=seasons?await seasons.currentSeason().catch(()=>null):null;
    const stats=season?store.seasonRows(i.guildId,season).find(p=>p.uid===user.id):null;
    await i.editReply({content:`${result.added?'Добавлен':'Уже добавлен'}: ${result.player.label} · <@${user.id}>`+(stats?`\nУчтено боёв: ${stats.wins+stats.losses}.`:''),allowedMentions:{parse:[]}});
   }
   return true;
  }
  if(sub==='import'){
   const a=i.options.getAttachment('report',true);if(a.size>1024*1024)throw Error('Максимальный размер отчёта: 1 МБ.');
   const url=new URL(a.url);if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname))throw Error('Неверный адрес вложения.');
   const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Не удалось скачать отчёт.');
   const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>1024*1024)throw Error('Отчёт слишком большой.');
   const b=JSON.parse(new TextDecoder().decode(bytes));if(seasons&&!b.playedAt)throw Error('Для сезонной статистики укажи playedAt в JSON: дата начала боя в ISO 8601.');
   const result=store.ingest(i.guildId,b);await seasons?.apply(b);
   await i.editReply(result.duplicate?'Этот бой уже учтён.':`Отчёт учтён. Игроков: ${result.count}.`);
  }else{
   const season=await seasons?.currentSeason();const rows=season?store.seasonRows(i.guildId,season):store.rows(i.guildId);const page=i.options.getInteger('page')??1;
   await i.editReply(rankPayload(rows,store.squad(i.guildId),i.user.id,page,season));
  }
 }catch(e){await i.editReply({content:e instanceof SyntaxError?'Некорректный JSON.':e.message,allowedMentions:{parse:[]}});}
 return true;
}
