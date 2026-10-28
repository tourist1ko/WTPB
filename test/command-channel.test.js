import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType,MessageFlags,PermissionFlagsBits,PermissionsBitField } from 'discord.js';
import { RatingStore } from '../src/rating.js';
import { enforceCommandChannel,handleCommandChannel } from '../src/command-channel.js';
const channelId='123456789012345678',otherId='223456789012345678';
const required=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.AttachFiles];
function interaction(extra={}){
 const replies=[];
 return {replies,guildId:'g',channelId,commandName:'pb',memberPermissions:new PermissionsBitField([PermissionFlagsBits.Administrator]),
  isChatInputCommand:()=>true,isAutocomplete:()=>false,isButton:()=>false,
  options:{getSubcommand:()=> 'br',getChannel:()=>null},
  reply:async p=>replies.push(p),deferReply:async p=>replies.push(p),editReply:async p=>replies.push(p),respond:async p=>replies.push(p),...extra};
}
function setup(extra={}){
 const channel={id:channelId,guildId:'g',type:ChannelType.GuildText,permissionsFor:()=>new PermissionsBitField(required)};
 const i=interaction({options:{getSubcommand:()=> 'command-channel',getChannel:()=>null},guild:{members:{me:{id:'bot'}},channels:{fetch:async id=>({...channel,id})}},...extra});return {i,channel};
}
test('administrator can choose current or another text channel without a registered squadron',async()=>{
 const s=new RatingStore(':memory:');let {i}=setup();assert.equal(await handleCommandChannel(i,s,'g'),true);
 assert.equal(s.commandChannel('g'),channelId);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);
 ({i}=setup());i.options.getChannel=()=>({id:otherId});await handleCommandChannel(i,s,'g');assert.equal(s.commandChannel('g'),otherId);
 assert.equal(await enforceCommandChannel(i,s,'g'),false);s.db.close();
});
test('non-admins, voice channels, other guilds and missing bot permissions cannot replace the setting',async()=>{
 const s=new RatingStore(':memory:');s.setCommandChannel('g',channelId);
 const regular=setup({memberPermissions:new PermissionsBitField([PermissionFlagsBits.ManageGuild])}).i;
 await handleCommandChannel(regular,s,'g');assert.match(regular.replies.at(-1).content,/только администратору/);
 for(const change of [{type:ChannelType.GuildVoice},{guildId:'other'},{permissionsFor:()=>new PermissionsBitField([PermissionFlagsBits.ViewChannel])}]){
  const {i,channel}=setup();i.options.getChannel=()=>({id:otherId});i.guild.channels.fetch=async()=>({...channel,id:otherId,...change});
  await handleCommandChannel(i,s,'g');assert.equal(s.commandChannel('g'),channelId);assert.equal(i.replies.length,2);
 }
 s.db.close();
});
test('every bot command and leaderboard button is blocked privately outside the channel, including for admins',async()=>{
 const s=new RatingStore(':memory:');s.setCommandChannel('g',channelId);
 for(const commandName of ['pb','rank'])for(const sub of ['br','register','unregister','addplayer','removeplayer','update']){
  const i=interaction({commandName,channelId:otherId,options:{getSubcommand:()=>sub}});
  assert.equal(await enforceCommandChannel(i,s,'g'),true);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);assert.match(i.replies[0].content,new RegExp(channelId));
 }
 const button=interaction({channelId:otherId,isChatInputCommand:()=>false,isButton:()=>true,customId:'pbrank:any'});
 assert.equal(await enforceCommandChannel(button,s,'g'),true);
 assert.equal(await enforceCommandChannel(interaction(),s,'g'),false);
 const thread=interaction({channelId:otherId,channel:{parentId:channelId}});assert.equal(await enforceCommandChannel(thread,s,'g'),true);s.db.close();
});
test('autocomplete does not query sources outside the channel, unrelated interactions and unconfigured guilds pass',async()=>{
 const s=new RatingStore(':memory:');assert.equal(await enforceCommandChannel(interaction({channelId:otherId}),s,'g'),false);
 s.setCommandChannel('g',channelId);
 const auto=interaction({channelId:otherId,isChatInputCommand:()=>false,isAutocomplete:()=>true});assert.equal(await enforceCommandChannel(auto,s,'g'),true);assert.deepEqual(auto.replies,[[]]);
 assert.equal(await enforceCommandChannel(interaction({channelId:otherId,commandName:'other'}),s,'g'),false);
 assert.equal(await enforceCommandChannel(interaction({channelId:otherId,guildId:'other'}),s,'g'),false);s.db.close();
});
test('channel survives restart and unregister, and administrator can recover from a deleted channel',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'pb-channel-')),file=join(directory,'rank.sqlite');
 try{
  let s=new RatingStore(file);s.register('g','QZ');s.setCommandChannel('g',otherId);s.unregister('g');s.db.close();
  s=new RatingStore(file);assert.equal(s.commandChannel('g'),otherId);assert.equal(s.commandChannel('other'),undefined);
  const {i}=setup();assert.equal(await enforceCommandChannel(i,s,'g'),false);await handleCommandChannel(i,s,'g');assert.equal(s.commandChannel('g'),channelId);s.db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
