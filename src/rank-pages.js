import { createHash } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } from 'discord.js';
import { leaderboard, pageState } from './leaderboard.js';
const squadKey = (squad,season) => createHash('sha256').update(season?squad+'\0'+season.id:squad).digest('hex').slice(0,12);
const updating=new Set();
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
  // Duplicate clicks while the same message is in flight must not queue edits
  // or let an older image overwrite a newer one.
  const messageKey=i.message?.id;
  if(messageKey&&updating.has(messageKey)){await i.deferUpdate();return true;}
  if(messageKey)updating.add(messageKey);
  let deferred;
  // Normally the image and season are already local. Keep the interaction
  // alive if a missing season forces a slow external lookup.
  const timer=setTimeout(()=>{deferred=i.deferUpdate();deferred.catch(()=>{});},1000);
  try{
    const season=await seasons?.currentSeason();
    if(store.squad(i.guildId)!==squad||squadKey(squad,season)!==match[3]){
      clearTimeout(timer);
      if(deferred){await deferred;await i.followUp({content:'Привязка полка изменилась или начался новый сезон. Открой /rank заново.',flags:MessageFlags.Ephemeral});}
      else await i.reply({content:'Привязка полка изменилась или начался новый сезон. Открой /rank заново.',flags:MessageFlags.Ephemeral});
      return true;
    }
    const payload=rankPayload(season?store.seasonRows(i.guildId,season):store.rows(i.guildId),squad,i.user.id,Number(match[2]),season);
    clearTimeout(timer);
    if(deferred){await deferred;await i.editReply(payload);}
    else await i.update(payload);
  }catch{
    clearTimeout(timer);
    const error={content:'Не удалось обновить таблицу. Попробуй ещё раз.',flags:MessageFlags.Ephemeral};
    if(deferred){await deferred;await i.followUp(error);}
    else if(i.replied||i.deferred)await i.followUp(error);
    else await i.reply(error);
  }finally{clearTimeout(timer);if(messageKey)updating.delete(messageKey);}
  return true;
}
