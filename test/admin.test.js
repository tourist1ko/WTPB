import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { handleRank } from '../src/rank-command.js';
import { RatingStore } from '../src/rating.js';
function interaction(sub,bits){const responses=[];return {responses,isChatInputCommand:()=>true,guildId:'g',commandName:'pb',memberPermissions:new PermissionsBitField(bits),options:{getSubcommand:()=>sub,getString:()=> 'QZ'},deferReply:async()=>{},editReply:async msg=>responses.push(msg)};}
test('Manage Server cannot register/unregister, administrator can',async()=>{
 const store=new RatingStore(':memory:');
 for(const sub of ['register','unregister']){const i=interaction(sub,[PermissionFlagsBits.ManageGuild]);await handleRank(i,store,'g');assert.match(i.responses[0].content,/только администратору/);assert.equal(store.squad('g'),undefined);}
 const a=interaction('register',[PermissionFlagsBits.Administrator]);await handleRank(a,store,'g',async()=>({name:'QZ'}));assert.equal(store.squad('g'),'QZ');
 const b=interaction('unregister',[PermissionFlagsBits.Administrator]);await handleRank(b,store,'g');assert.equal(store.squad('g'),undefined);assert.match(b.responses[0],/сохранена/);store.db.close();
});
test('unregister preserves stats and duplicate ledger, other guild stays bound',()=>{
 const store=new RatingStore(':memory:');store.register('g','QZ');store.register('other','Other');
 const members=new Map([['1',{id:'1',nickname:'Alpha (A)',user:{bot:false}}]]);
 const battle={id:'1',mode:'squadron_realistic',squadron:'QZ',result:'win',players:[{nickname:'Alpha',tankKills:2,airKills:1,deaths:1}]};store.ingest('g',battle,members);store.unregister('g');assert.equal(store.rows('g',members).length,0);assert.equal(store.squad('other'),'Other');store.register('g','QZ');assert.equal(store.rows('g',members)[0].tanks,2);assert.equal(store.ingest('g',battle,members).duplicate,true);store.db.close();
});
