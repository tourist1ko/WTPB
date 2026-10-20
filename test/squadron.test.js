import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookupSquadron, parseSquadronProfile } from '../src/squadron.js';
import { handleRank } from '../src/rank-command.js';
import { RatingStore } from '../src/rating.js';
import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';
const html=`<div class="squadrons-info__title">[[_QZ_]] Qazaqstan player community</div><div class="squadrons-info__meta-item">Number of players: 100</div>`;
const response=(status,text=html)=>({status,ok:status===200,url:'https://warthunder.com/en/community/claninfo/Qazaqstan%20player%20community',text:async()=>text});
test('verified profile uses exact official full name, not user input or tag',async()=>{
 let requested;
 const p=await lookupSquadron(' qazaqstan  player community ',{fetchImpl:async url=>{requested=url;return response(200);}});
 assert.equal(p.name,'Qazaqstan player community');assert.match(requested,/qazaqstan%20player%20community$/);
 assert.throws(()=>parseSquadronProfile(html,'_QZ_'),{code:'NOT_FOUND'});
 assert.equal(parseSquadronProfile('<div class="squadrons-info__title">[=ABC=] A &amp; B</div><div class="squadrons-info__meta-item"></div>','A & B').name,'A & B');
});
test('404 and source failures differ; generic 200 and challenge are never registered',async()=>{
 await assert.rejects(lookupSquadron('Missing',{fetchImpl:async()=>response(404)}),{code:'NOT_FOUND'});
 for(const r of [response(403),response(429),response(503),response(200,'<h1>Verify browser</h1>')])await assert.rejects(lookupSquadron('Missing',{fetchImpl:async()=>r}),{code:'SOURCE_UNAVAILABLE'});
 await assert.rejects(lookupSquadron('Missing',{fetchImpl:async()=>{throw Error('timeout');}}),{code:'SOURCE_UNAVAILABLE'});
});
test('failed lookup preserves previous binding, admin permission checked before network',async()=>{
 const s=new RatingStore(':memory:');let calls=0;
 const messages=[];const i={isChatInputCommand:()=>true,guildId:'g',commandName:'pb',memberPermissions:new PermissionsBitField([PermissionFlagsBits.Administrator]),options:{getSubcommand:()=> 'register',getString:()=> 'Missing'},deferReply:async()=>{},editReply:async m=>messages.push(m)};
 const lookup=async()=>{calls++;return lookupSquadron('Missing',{fetchImpl:async()=>response(404)});};
 await handleRank(i,s,'g',lookup);assert.equal(s.squad('g'),undefined);assert.match(messages[0].content,/не найден/);
 i.memberPermissions=new PermissionsBitField([PermissionFlagsBits.ManageGuild]);await handleRank(i,s,'g',lookup);assert.equal(calls,1);s.db.close();
});
