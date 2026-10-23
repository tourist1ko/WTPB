import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField, ApplicationCommandOptionType, SlashCommandBuilder } from 'discord.js';
import { handleRank, statOption, rankCommand } from '../src/rank-command.js';
import { command } from '../src/command.js';
import { RatingStore } from '../src/rating.js';

const uid='123456789012345678';
function interaction(sub,{bits=[PermissionFlagsBits.Administrator],nick='Alpha (Имя)',wtnick=null,bot=false}={}){
 const responses=[];let fetches=0;
 const user={id:uid,username:'DiscordAccount',bot};
 return {responses,get fetches(){return fetches;},isChatInputCommand:()=>true,guildId:'g',commandName:'pb',memberPermissions:new PermissionsBitField(bits),
 options:{getSubcommand:()=>sub,getSubcommandGroup:()=> 'stat',getUser:()=>user,getString:()=>wtnick},
 guild:{members:{fetch:async request=>{fetches++;assert.deepEqual(request,{user:uid,force:true});return {id:uid,nickname:nick,user};}}},
 deferReply:async()=>{},editReply:async msg=>responses.push(msg),followUp:async msg=>responses.push(msg)};
}
test('stat group is a valid slash-command group with Discord user selection',()=>{
 const schema=new SlashCommandBuilder().setName(command.name).setDescription(command.description).addSubcommandGroup(group=>{
  group.setName(statOption.name).setDescription(statOption.description);
  for(const sub of statOption.options)group.addSubcommand(option=>{
   option.setName(sub.name).setDescription(sub.description);
   for(const field of sub.options??[]){
    if(field.type===ApplicationCommandOptionType.User)option.addUserOption(o=>o.setName(field.name).setDescription(field.description).setRequired(field.required));
    else if(field.type===ApplicationCommandOptionType.Boolean)option.addBooleanOption(o=>o.setName(field.name).setDescription(field.description));
    else option.addStringOption(o=>o.setName(field.name).setDescription(field.description).setMinLength(field.min_length).setMaxLength(field.max_length));
   }
   return option;
  });
  return group;
 }).toJSON();
 const stat=schema.options.find(o=>o.name==='stat');assert.equal(stat.type,ApplicationCommandOptionType.SubcommandGroup);
 assert.deepEqual(stat.options.map(o=>o.name),['addplayer','removeplayer','list','update']);assert.equal(stat.options[0].options[0].type,ApplicationCommandOptionType.User);
 assert.equal(rankCommand.name,'rank');
});
test('administrator manually selects a member, WT nickname can override all Discord formatting',async()=>{
 const store=new RatingStore(':memory:');store.register('g','QZ');
 let i=interaction('addplayer');await handleRank(i,store,'g');assert.equal(store.players('g')[0].label,'Alpha');assert.equal(i.fetches,1);assert.match(i.responses[0].content,/Добавлен/);
 i=interaction('removeplayer');await handleRank(i,store,'g');assert.equal(store.players('g').length,0);assert.equal(i.fetches,0);
 i=interaction('addplayer',{nick:'Имя в Discord',wtnick:'tourist__'});await handleRank(i,store,'g');assert.equal(store.players('g')[0].label,'tourist__');
 i=interaction('list');await handleRank(i,store,'g');assert.match(i.responses[0].content,/tourist__/);assert.equal(i.fetches,0);store.db.close();
});
test('plain server nickname can be chosen manually, add/list/remove require Administrator',async()=>{
 const store=new RatingStore(':memory:');store.register('g','QZ');
 for(const sub of ['addplayer','removeplayer','list','update']){const i=interaction(sub,{bits:[PermissionFlagsBits.ManageGuild]});await handleRank(i,store,'g');assert.match(i.responses[0].content,/только администратору/);assert.equal(i.fetches,0);}
 let i=interaction('addplayer',{nick:'NoFormat'});await handleRank(i,store,'g');assert.equal(store.players('g')[0].label,'NoFormat');
 i=interaction('addplayer',{bot:true});await handleRank(i,store,'g');assert.match(i.responses[0].content,/Бота нельзя/);store.db.close();
});
test('rank and page rendering work without any Discord member discovery',async()=>{
 const store=new RatingStore(':memory:');store.register('g','QZ');store.addPlayer('g',uid,'ManualOnly');
 const i={isChatInputCommand:()=>true,guildId:'g',commandName:'rank',user:{id:uid},options:{getInteger:()=>1},deferReply:async()=>{},editReply:async p=>{assert.equal(p.files.length,1);assert.equal(p.components[0].toJSON().components[1].label,'1 / 1');}};
 await handleRank(i,store,'g');store.db.close();
});
