import test from 'node:test';
import assert from 'node:assert/strict';
import { LeaderboardImageCache,leaderboard,leaderboardSVG } from '../src/leaderboard.js';
import { handleRankPage,rankPayload } from '../src/rank-pages.js';
const owner='123456789012345678';
const rows=Array.from({length:17},(_,i)=>({nick:'Player'+i,kd:2,wr:50,tanks:10,air:2,wins:5,losses:5}));
const season={id:'a',label:'01.09.2026 - 31.10.2026'};
test('page PNGs are reused across owners, but stats, ranks, roster and season changes cannot return stale images',()=>{
 const first=leaderboard(rows,'QZ',1,season);
 assert.strictEqual(leaderboard(structuredClone(rows),'QZ',1,season),first);
 assert.strictEqual(rankPayload(rows,'QZ','223456789012345678',1,season).files[0].attachment,first);
 assert.notDeepEqual(leaderboard(rows,'QZ',2,season),first);
 const changed=structuredClone(rows);changed[0].tanks++;
 assert.notDeepEqual(leaderboard(changed,'QZ',1,season),first);
 assert.notDeepEqual(leaderboard(rows.slice(1),'QZ',1,season),first);
 assert.notDeepEqual(leaderboard(rows,'QZ',1,{id:'b',label:'01.11.2026 - 31.12.2026'}),first);
 assert.notDeepEqual(leaderboard(rows,'Other',1,season),first);
});
test('PNG cache evicts least recently used entries and never exceeds its byte budget',()=>{
 let calls=0;const cache=new LeaderboardImageCache({render:svg=>{calls++;return Buffer.from(svg);},maxEntries:2,maxBytes:6});
 cache.png('aa');cache.png('bb');cache.png('aa');cache.png('cc');assert.equal(calls,3);
 cache.png('bb');assert.equal(calls,4);assert.equal(cache.images.size,2);
 cache.png('12345');assert.equal(cache.images.size,1);assert.equal(cache.bytes,5);
 cache.png('1234567');assert.equal(cache.bytes,5);assert.equal(cache.images.size,1);
});
function button(extra={}){
 const calls=[];const customId=rankPayload(rows,'QZ',owner,1,season).components[0].toJSON().components[2].custom_id;
 const i={calls,isButton:()=>true,customId,guildId:'g',message:{id:'message'},user:{id:owner},
  update:async p=>calls.push(['update',p]),deferUpdate:async()=>calls.push(['defer']),
  editReply:async p=>calls.push(['edit',p]),reply:async p=>calls.push(['reply',p]),followUp:async p=>calls.push(['follow',p]),...extra};return i;
}
const store={squad:()=> 'QZ',seasonRows:()=>rows};
test('fast paging is one Discord request, reads fresh stats, and replaces the same attachment',async()=>{
 const i=button();const current=structuredClone(rows);current[8].tanks=999;
 await handleRankPage(i,{...store,seasonRows:()=>current},'g',{currentSeason:async()=>season});
 assert.deepEqual(i.calls.map(c=>c[0]),['update']);
 const payload=i.calls[0][1];assert.deepEqual(payload.attachments,[]);assert.equal(payload.files.length,1);
 assert.deepEqual(payload.files[0].attachment,leaderboard(current,'QZ',2,season));
});
test('slow season lookup is acknowledged before timeout, duplicate clicks do not queue message edits',async()=>{
 let release;const pending=new Promise(r=>release=r),i=button();
 const task=handleRankPage(i,store,'g',{currentSeason:()=>pending});
 const duplicate=button();await handleRankPage(duplicate,store,'g',{currentSeason:()=>assert.fail('Duplicate lookup')});
 assert.deepEqual(duplicate.calls.map(c=>c[0]),['defer']);
 await new Promise(r=>setTimeout(r,1100));assert.deepEqual(i.calls.map(c=>c[0]),['defer']);
 release(season);await task;assert.deepEqual(i.calls.map(c=>c[0]),['defer','edit']);
 const next=button();await handleRankPage(next,store,'g',{currentSeason:async()=>season});assert.equal(next.calls[0][0],'update');
});
test('lookup errors and changed binding are private replies without editing the old leaderboard',async()=>{
 const i=button();await handleRankPage(i,store,'g',{currentSeason:async()=>{throw Error('offline');}});
 assert.equal(i.calls[0][0],'reply');assert.equal(i.calls.length,1);
 let binding='QZ';const other=button();await handleRankPage(other,{...store,squad:()=>binding},'g',{currentSeason:async()=>{binding='Other';return season;}});
 assert.equal(other.calls[0][0],'reply');assert.match(other.calls[0][1].content,/изменилась/);
});
