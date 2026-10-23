import { createHash } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } from 'discord.js';
import { leaderboard, pageState } from './leaderboard.js';
const squadKey = (squad,season) => createHash('sha256').update(season?squad+'\0'+season.id:squad).digest('hex').slice(0,12);
export function rankPayload(rows,squad,owner,requested=1,season){
  const {page,pages}=pageState(rows.length,requested);
  const id=target=>`pbrank:${owner}:${target}:${squadKey(squad,season)}`;
  const controls=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id(Math.max(1,page-1))).setLabel('Назад').setStyle(ButtonStyle.Secondary).setDisabled(page===1),
    new ButtonBuilder().setCustomId(`pbrank:counter:${owner}`).setLabel(`${page} / ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(id(page+1)).setLabel('Далее').setStyle(ButtonStyle.Secondary).setDisabled(page===pages),
  );
  return {content:'',attachments:[],files:[new AttachmentBuilder(leaderboard(rows,squad,page,season),{name:'rank.png'})],components:[controls],allowedMentions:{parse:[]}};
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
    await i.editReply(rankPayload(season?store.seasonRows(i.guildId,season):store.rows(i.guildId),squad,i.user.id,Number(match[2]),season));
  }catch{await i.followUp({content:'Не удалось обновить таблицу. Попробуй ещё раз.',flags:MessageFlags.Ephemeral});}
  return true;
}
