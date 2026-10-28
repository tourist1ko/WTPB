import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPayload, handleRankPage } from '../src/rank-pages.js';
import { leaderboardSVG, pageState } from '../src/leaderboard.js';
const owner='123456789012345678';
const rows=Array.from({length:31},(_,i)=>({nick:`Player${i+1}`,kd:3-i/20,wr:70,tanks:100-i,air:10,wins:21,losses:9}));
test('pagination covers first, middle and last page and clamps shrinking results',()=>{
 let data=rankPayload(rows,'QZ',owner,1);let c=data.components[0].toJSON().components;assert.equal(c[0].disabled,true);assert.equal(c[1].label,'1 / 4');assert.equal(c[2].disabled,false);
 data=rankPayload(rows,'QZ',owner,4);c=data.components[0].toJSON().components;assert.equal(c[0].disabled,false);assert.equal(c[2].disabled,true);
 assert.equal(pageState(0,5).page,1);assert.equal(pageState(31,99).page,4);
 const svg=leaderboardSVG(rows,'QZ',2);assert.match(svg,/Player9/);assert.match(svg,/Player16/);assert.doesNotMatch(svg,/Player17<\/text>/);assert.equal((svg.match(/>Player\d+<\/text>/g)||[]).length,8);assert.deepEqual(pageState(8),{page:1,pages:1,start:0});assert.equal(pageState(9).pages,2);assert.equal(pageState(16).pages,2);assert.equal(pageState(17).pages,3);assert.doesNotMatch(svg,/Player1<\/text>/);assert.match(svg,/WinRate/);assert.match(svg,/Самолет/);assert.doesNotMatch(svg,/Пример|К\/Д ↓|Страница/);
});
test('page buttons update the same message with a new image, reject another user and changed squad',async()=>{
 const payload=rankPayload(rows,'QZ',owner,1);const id=payload.components[0].toJSON().components[2].custom_id;
 let fetches=0;let update;let error;let defers=0;
 const i={isButton:()=>true,customId:id,guildId:'g',user:{id:owner},guild:{members:{fetch:async()=>{fetches++;return new Map();}}},deferUpdate:async()=>{defers++;},update:async p=>update=p,editReply:async()=>assert.fail('Fast page must use one update request'),reply:async p=>error=p,followUp:async p=>error=p};
 const store={squad:()=> 'QZ',rows:()=>rows};assert.equal(await handleRankPage(i,store,'g'),true);assert.equal(update.components[0].toJSON().components[1].label,'2 / 4');assert.deepEqual(update.attachments,[]);assert.equal(update.content,'');assert.equal(update.files.length,1);
 assert.equal(defers,0);update=null;i.user.id='223456789012345678';await handleRankPage(i,store,'g');assert.equal(fetches,0);assert.equal(update,null);assert.match(error.content,/свою таблицу/);
 i.user.id=owner;await handleRankPage(i,{...store,squad:()=> 'Other'},'g');assert.equal(fetches,0);assert.match(error.content,/изменилась/);
});
