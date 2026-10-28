import { ChannelType,MessageFlags,PermissionFlagsBits } from 'discord.js';

export const commandChannelOption={
  type:1,name:'command-channel',description:'Выбрать канал для команд бота (администратор)',
  options:[{type:7,name:'channel',description:'Канал для команд. По умолчанию текущий',channel_types:[ChannelType.GuildText,ChannelType.GuildAnnouncement]}],
};
const isSetup=i=>i.isChatInputCommand?.()&&i.commandName==='pb'&&i.options.getSubcommand(false)==='command-channel';
const isBotInteraction=i=>['pb','rank'].includes(i.commandName)&&(i.isChatInputCommand?.()||i.isAutocomplete?.())||i.isButton?.()&&i.customId?.startsWith('pbrank:');

export async function enforceCommandChannel(i,store,guildId){
  if(i.guildId!==guildId||!isBotInteraction(i))return false;
  // Allow only the configuration command outside the registered channel, so
  // an administrator can recover if that channel is deleted or inaccessible.
  if(isSetup(i))return false;
  const channel=store.commandChannel(guildId);
  if(!channel||i.channelId===channel)return false;
  if(i.isAutocomplete?.())await i.respond([]);
  else await i.reply({content:`Команды бота доступны только в <#${channel}>.`,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  return true;
}

export async function handleCommandChannel(i,store,guildId){
  if(i.guildId!==guildId||!isSetup(i))return false;
  await i.deferReply({flags:MessageFlags.Ephemeral});
  try{
    if(!i.memberPermissions?.has(PermissionFlagsBits.Administrator))throw Error('Эта команда доступна только администратору сервера.');
    const selected=i.options.getChannel('channel')?.id??i.channelId;
    const channel=await i.guild.channels.fetch(selected);
    if(!channel||channel.guildId!==guildId||![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(channel.type))throw Error('Выбери текстовый канал этого сервера.');
    const permissions=channel.permissionsFor(i.guild.members.me);
    if(!permissions?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.AttachFiles]))throw Error('Дай боту права просматривать канал, отправлять сообщения и прикреплять файлы.');
    store.setCommandChannel(guildId,channel.id);
    await i.editReply({content:`Канал команд: <#${channel.id}>.`,allowedMentions:{parse:[]}});
  }catch(error){await i.editReply({content:error.message,allowedMentions:{parse:[]}});}
  return true;
}
