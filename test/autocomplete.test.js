import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { SquadronSuggestions, handleSquadronAutocomplete } from '../src/squadron-autocomplete.js';
import { handleRank } from '../src/rank-command.js';
import { RatingStore } from '../src/rating.js';
const seed=[{name:'Qazaqstan player community',tag:'_QZ_'},{name:'Library',tag:'=BOOK='}];
test('search uses documented clan parameter, caches suggestions, returns canonical values',async()=>{
 let calls=0;let url;
 const suggestions=new SquadronSuggestions({seed,fetchImpl:async u=>{calls++;url=u;return {ok:true,json:async()=>({timestamp:1,clans:{'1':{name:'Qazaq New',tag:'QZN'}}})};}});
 const rows=await suggestions.search('Qazaq');assert.equal(url.searchParams.get('clan'),'Qazaq');assert.equal(rows.length,2);assert.equal(rows[0].value,'Qazaq New');await suggestions.search('Qazaq');assert.equal(calls,1);assert.equal((await suggestions.search('_QZ_'))[0].value,seed[0].name);
});
test('service failure falls back to cached real entries, no manufactured matches, enforces 25 choices',async()=>{
 let calls=0;const suggestions=new SquadronSuggestions({seed,fetchImpl:async()=>{calls++;return {ok:false,status:503};}});
 assert.equal((await suggestions.search('Qazaq'))[0].value,seed[0].name);assert.deepEqual(await suggestions.search('DoesNotExist'),[]);assert.equal(calls,1);assert.deepEqual(await suggestions.search('Q'),[]);
 suggestions.remember(Array.from({length:40},(_,i)=>({name:'Squadron '+i,tag:'S'+i})));assert.equal((await suggestions.search('Squadron')).length,25);
});
test('autocomplete requires admin and unbound server and answers with Discord choices',async()=>{
 const store=new RatingStore(':memory:');let values;let calls=0;
 const i={isAutocomplete:()=>true,commandName:'pb',guildId:'g',memberPermissions:new PermissionsBitField([PermissionFlagsBits.Administrator]),options:{getSubcommand:()=> 'register',getFocused:()=>({name:'name',value:'Qaz'})},respond:async v=>values=v};
 const suggestions={search:async()=>{calls++;return [{name:'_QZ_ · Qazaqstan',value:'Qazaqstan'}];}};
 assert.equal(await handleSquadronAutocomplete(i,store,'g',suggestions),true);assert.equal(values.length,1);store.register('g','Existing');await handleSquadronAutocomplete(i,store,'g',suggestions);assert.deepEqual(values,[]);assert.equal(calls,1);store.unregister('g');i.memberPermissions=new PermissionsBitField([PermissionFlagsBits.ManageGuild]);await handleSquadronAutocomplete(i,store,'g',suggestions);assert.equal(calls,1);store.db.close();
});
test('already-bound registration does not lookup and concurrent registration cannot overwrite',async()=>{
 const store=new RatingStore(':memory:');store.register('g','Existing');let calls=0;let message;
 const make=name=>({isChatInputCommand:()=>true,commandName:'pb',guildId:'g',memberPermissions:new PermissionsBitField([PermissionFlagsBits.Administrator]),options:{getSubcommand:()=> 'register',getString:()=>name},deferReply:async()=>{},editReply:async m=>message=m});
 await handleRank(make('Other'),store,'g',async()=>{calls++;return {name:'Other'};});assert.equal(calls,0);assert.equal(store.squad('g'),'Existing');assert.match(message.content,/unregister/);
 store.unregister('g');let first,second;
 const a=handleRank(make('First'),store,'g',()=>new Promise(r=>first=r));const b=handleRank(make('Second'),store,'g',()=>new Promise(r=>second=r));
 await Promise.resolve();await Promise.resolve();first({name:'First'});await a;second({name:'Second'});await b;assert.equal(store.squad('g'),'First');assert.match(message.content,/unregister/);store.db.close();
});
