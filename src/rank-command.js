import { PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
import { leaderboard } from './leaderboard.js';
export const rankCommand={name:'rank',description:'Рейтинг игроков полка по К/Д и winrate',options:[{type:4,name:'page',description:'Страница',min_value:1,max_value:1000}]};
export const registerOption={type:1,name:'register',description:'Привязать полк к серверу',options:[{type:3,name:'name',description:'Точное название полка',required:true,max_length:100}]};
export const importOption={type:1,name:'import',description:'Загрузить нормализованный JSON-отчёт ПБ',options:[{type:11,name:'report',description:'JSON по примеру из архива',required:true}]};
export async function handleRank(i,store,guildId){
 if(!i.isChatInputCommand() || i.guildId!==guildId)return false;
 const sub=i.commandName==='pb'?i.options.getSubcommand(false):null;
 if(i.commandName!=='rank' && !['register','import'].includes(sub))return false;
 const admin=sub==='register'||sub==='import';
 await i.deferReply({ephemeral:admin});
 try{
  if(admin&&!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))throw Error('Нужно разрешение «Управлять сервером».');
  if(sub==='register'){const name=i.options.getString('name',true).trim();store.register(i.guildId,name);await i.editReply(`Привязан полк: ${name}. Автосбор War Thunder ещё не подключён. Отчёты загружаются через /pb import.`);return true;}
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
   await i.editReply({files:[new AttachmentBuilder(leaderboard(rows,store.squad(i.guildId),page),{name:'rank.png'})],content:'К/Д = (танки + самолёты) / смерти. Winrate = победы / бои. При нуле смертей и наличии киллов: ∞. Данные из загруженных отчётов.',allowedMentions:{parse:[]}});
  }
 }catch(e){await i.editReply({content:e instanceof SyntaxError?'Некорректный JSON.':e.message,allowedMentions:{parse:[]}});}
 return true;
}
