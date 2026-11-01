import test from 'node:test';
import assert from 'node:assert/strict';
import { rankPayload, handleRankPage } from '../src/rank-pages.js';
import { leaderboardSVG, pageState } from '../src/leaderboard.js';
import { rankText } from '../src/rank-pages.js';
const owner='123456789012345678';
const rows=Array.from({length:31},(_,i)=>({nick:`Player${i+1}`,kd:3-i/20,wr:70,tanks:100-i,air:10,wins:21,losses:9}));
test('pagination covers first, middle and last page and clamps shrinking results',()=>{
 let data=rankPayload(rows,'QZ',owner,1);let c=data.components[0].toJSON().components;assert.equal(c[0].disabled,true);assert.equal(c[1].label,'1 / 4');assert.equal(c[2].disabled,false);
 data=rankPayload(rows,'QZ',owner,4);c=data.components[0].toJSON().components;assert.equal(c[0].disabled,false);assert.equal(c[2].disabled,true);
 assert.equal(pageState(0,5).page,1);assert.equal(pageState(31,99).page,4);
 const svg=leaderboardSVG(rows,'QZ',2);assert.match(svg,/Player9/);assert.match(svg,/Player16/);assert.doesNotMatch(svg,/Player17<\/text>/);assert.equal((svg.match(/>Player\d+<\/text>/g)||[]).length,8);assert.deepEqual(pageState(8),{page:1,pages:1,start:0});assert.equal(pageState(9).pages,2);assert.equal(pageState(16).pages,2);assert.equal(pageState(17).pages,3);assert.doesNotMatch(svg,/Player1<\/text>/);assert.match(svg,/Жеңіс %/);assert.match(svg,/Ұшақтар/);assert.match(svg,/Көмек/);assert.doesNotMatch(svg,/Пример|К\/Д ↓/);
});
test('page buttons update the same text message, reject another user and changed squad',async()=>{
 const payload=rankPayload(rows,'QZ',owner,1);const id=payload.components[0].toJSON().components[2].custom_id;
 let fetches=0;let update;let error;
 const i={isButton:()=>true,customId:id,guildId:'g',user:{id:owner},guild:{members:{fetch:async()=>{fetches++;return new Map();}}},deferUpdate:async()=>{},editReply:async p=>update=p,reply:async p=>error=p,followUp:async p=>error=p};
 const store={squad:()=> 'QZ',rows:()=>rows};assert.equal(await handleRankPage(i,store,'g'),true);assert.equal(update.components[0].toJSON().components[1].label,'2 / 4');assert.equal(update.files.length,1);assert.equal(update.files[0].name,'rank.png');
 update=null;i.user.id='223456789012345678';await handleRankPage(i,store,'g');assert.equal(fetches,0);assert.equal(update,null);assert.match(error.content,/свою таблицу/);
 i.user.id=owner;await handleRankPage(i,{...store,squad:()=> 'Other'},'g');assert.equal(fetches,0);assert.match(error.content,/изменилась/);
});

test('rank output is plain text, keeps all requested stats and stays within Discord content limit',()=>{
 const text=rankText(rows,'QZ',1,{label:'Сезон 2026',id:'s1'});
 assert.match(text,/QZ \| Полктік ойындар/);assert.doesNotMatch(text,/количество убийств/);assert.match(text,/Сезон 2026/);assert.match(text,/WinRate/);assert.match(text,/Танки/);assert.match(text,/Самолёт/);assert.ok(text.length<=2000);
});
test('rank image is a PNG, hides players without battles and shows the squadron tag',()=>{
 const p=rankPayload([...rows.slice(0,3),{nick:'Idle',kd:0,wr:0,tanks:0,air:0,deaths:0,wins:0,losses:0}],'QZ',owner,1,{label:'01.11.2026 - 31.12.2026',id:'s'},'[_QZ_]');
 assert.equal(p.files[0].attachment.subarray(1,4).toString(),'PNG');assert.equal(p.components[0].toJSON().components[1].label,'1 / 1');
 const svg=leaderboardSVG(rows.slice(0,3),'QZ',1,{label:'x',id:'s'},{title:'[_QZ_]',idle:1});
 assert.match(svg,/\[_QZ_\] \| Полктік ойындар/);assert.doesNotMatch(svg,/Idle/);
});
test('all ten themes render',()=>{for(let n=1;n<=10;n++)assert.match(leaderboardSVG(rows,'QZ',1,undefined,{theme:n}),/Ойыншы/);});
