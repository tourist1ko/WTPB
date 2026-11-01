import { createHash } from 'node:crypto';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { PAGE_SIZE, pageState, leaderboard } from './leaderboard.js';
const squadKey = (squad,season) => createHash('sha256').update(season?squad+'\0'+season.id:squad).digest('hex').slice(0,12);
const safeNick = value => Array.from(String(value ?? 'Без ника').replace(/[\r\n`]/g, ' ')).slice(0,18).join('');
const number = value => Number.isFinite(value) ? String(value) : '∞';
export function rankText(rows,squad,page=1,season,title){
  const {page:current,pages,start}=pageState(rows.length,page);
  const selected=rows.slice(start,start+PAGE_SIZE);
  const lines=[
    `**${title||squad} | Полктік ойындар**`,
    season ? `Сезон: **${season.label}**` : 'Общая статистика',
    `Страница ${current}/${pages} · Игроков: ${rows.length}`,
    '',
    '```',
    '#  Игрок               К/Д    WinRate  Танки  Самолёт',
  ];
  if(!selected.length) lines.push('   Пока нет данных о боях.');
  selected.forEach((r,index)=>{
    const rank=String(start+index+1).padStart(2,' ');
    const nick=safeNick(r.nick).padEnd(18,' ');
    const kd=number(r.kd).padStart(5,' ');
    const wr=(Number(r.wr)||0).toFixed(1).padStart(6,' ')+'%';
    const tanks=String(r.tanks??0).padStart(6,' ');
    const air=String(r.air??0).padStart(7,' ');
    lines.push(`${rank} ${nick} ${kd}  ${wr} ${tanks} ${air}`);
  });
  lines.push('```');
  return lines.join('\n').slice(0,2000);
}
const MEDALS=['🥇','🥈','🥉'];
const embedNick=value=>Array.from(String(value??'Без ника').replace(/[\r\n]/g,' ').replace(/([*_~`|>\\])/g,'\\$1')).slice(0,60).join('');
const kdText=r=>Number.isFinite(r.kd)?r.kd.toFixed(2):'∞';
const battles=r=>(r.wins??0)+(r.losses??0);
// Card layout: every player gets a heading and labelled numbers.
export function rankEmbed(rows,squad,page=1,season,title,idle=0){
  const {page:current,pages,start}=pageState(rows.length,page);
  const selected=rows.slice(start,start+PAGE_SIZE);
  const embed=new EmbedBuilder().setColor(0xE8B23A).setTitle(`${title||squad} | Полктік ойындар`);
  const head=[season?`📅 Сезон: **${season.label}**`:'Общая статистика',`👥 Игроков с боями: **${rows.length}**`];
  if(!selected.length)head.push('','В этом сезоне пока нет учтённых боёв.');
  embed.setDescription(head.join('\n'));
  selected.forEach((r,index)=>{
    const place=start+index+1;
    embed.addFields({
      name:`${MEDALS[place-1]??`#${place}`}  ${embedNick(r.nick)}`,
      value:`К/Д **${kdText(r)}**  •  WinRate **${(Number(r.wr)||0).toFixed(1)}%**  •  Боёв **${battles(r)}** (${r.wins??0} W / ${r.losses??0} L)\n🎯 Танки: **${r.tanks??0}**  •  ✈️ Самолёты: **${r.air??0}**  •  💀 Смерти: **${r.deaths??0}**`,
    });
  });
  embed.setFooter({text:`Страница ${current}/${pages}  •  Сортировка: К/Д, затем WinRate${idle?`  •  Без боёв в сезоне: ${idle}`:''}`});
  return embed;
}
export function rankPayload(rows,squad,owner,requested=1,season,title){
  // Players without battles this season are only counted in the footer.
  const played=rows.filter(r=>battles(r)>0),idle=rows.length-played.length;
  const {page,pages}=pageState(played.length,requested);
  const id=target=>`pbrank:${owner}:${target}:${squadKey(squad,season)}`;
  const controls=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id(Math.max(1,page-1))).setLabel('◀ Назад').setStyle(ButtonStyle.Secondary).setDisabled(page===1),
    new ButtonBuilder().setCustomId(`pbrank:counter:${owner}`).setLabel(`${page} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(id(page+1)).setLabel('Далее ▶').setStyle(ButtonStyle.Secondary).setDisabled(page===pages),
  );
  // Rendered PNG card; attachments:[] replaces the previous page image on edit.
  const image=new AttachmentBuilder(leaderboard(played,squad,page,season,{title,idle}),{name:'rank.png'});
  return {content:'',embeds:[],files:[image],attachments:[],components:[controls],allowedMentions:{parse:[]}};
}
export async function handleRankPage(i,store,guildId,seasons){
  if(!i.isButton?.() || !i.customId.startsWith('pbrank:'))return false;
  if(i.guildId!==guildId)return false;
  const match=i.customId.match(/^pbrank:(\d{17,22}):(\d{1,5}):([a-f0-9]{12})$/);
  if(!match){await i.reply({content:'Открой новую таблицу через /rank.',flags:MessageFlags.Ephemeral});return true;}
  if(i.user.id!==match[1]){await i.reply({content:'Открой свою таблицу через /rank.',flags:MessageFlags.Ephemeral});return true;}
  const squad=store.squad(i.guildId);
  if(!squad){await i.reply({content:'Привязка полка изменилась. Открой /rank заново.',flags:MessageFlags.Ephemeral});return true;}
  await i.deferUpdate();
  try{
    const season=await seasons?.currentSeason();
    if(squadKey(squad,season)!==match[3]){await i.followUp({content:'Привязка полка изменилась или начался новый сезон. Открой /rank заново.',flags:MessageFlags.Ephemeral});return true;}
    await i.editReply(rankPayload(season?store.seasonRows(i.guildId,season):store.rows(i.guildId),squad,i.user.id,Number(match[2]),season,store.binding?.(i.guildId)?.tag||squad));
  }catch{await i.followUp({content:'Не удалось обновить таблицу. Попробуй ещё раз.',flags:MessageFlags.Ephemeral});}
  return true;
}
