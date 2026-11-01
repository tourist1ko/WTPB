import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { archiveBattle, archiveTeam, battlePath, sceneFromHtml, TacticalSource, SourceError } from '../src/tactical-source.js';
import { ArchiveBattles } from '../src/tactical-live.js';
import { RatingStore } from '../src/rating.js';
const fixture=id=>JSON.parse(readFileSync(new URL('./fixtures/tactical-'+id+'.json',import.meta.url),'utf8'));
const known=fixture('4ad212e8001639a5'),win=fixture('4ad212e800165e8b');
const members=new Map([['1',{id:'1',nickname:'tourist__ (Айбар)',user:{bot:false}}],['2',{id:'2',nickname:'Twinkleezh',user:{bot:false}}]]);

test('real session supplied by user maps raw air/ground fields and explicit result',()=>{
 const b=archiveBattle(known.row,known.scene,'Beyond Alive','┾105HP┿');
 assert.equal(b.result,'loss');assert.equal(b.id,'4ad212e8001639a5');assert.equal(b.players.length,8);
 assert.deepEqual(b.players.find(p=>p.nickname==='tourist__'),{nickname:'tourist__',tankKills:0,airKills:0,deaths:1});
 assert.equal(b.players.reduce((n,p)=>n+p.tankKills,0),0);assert.equal(b.players.reduce((n,p)=>n+p.airKills,0),1);assert.equal(b.players.reduce((n,p)=>n+p.deaths,0),8);
 const enemy=archiveBattle(known.row,known.scene,'Enemy','╖TEHb╖');assert.equal(enemy.result,'win');
 assert.deepEqual(enemy.players.find(p=>p.nickname==='blacksmith86'),{nickname:'blacksmith86',tankKills:1,airKills:2,deaths:1});
 assert.equal(archiveBattle(win.row,win.scene,'Beyond Alive','┾105HP┿').result,'win');
 assert.equal(archiveBattle(known.row,known.scene,'Wrong','105H'),null);
 assert.throws(()=>archiveBattle({...known.row,team1Kills:10},known.scene,'Beyond Alive','┾105HP┿'),/сумма убийств/);
});
test('JSON scene is parsed without evaluating scripts, paths and identity are validated',()=>{
 assert.deepEqual(sceneFromHtml('<script>window.SCENE = '+JSON.stringify(known.scene)+';</script><script>throw Error()</script>'),known.scene);
 assert.deepEqual(sceneFromHtml('<script>window.SCENE = '+JSON.stringify(known.scene)+'; window.I18N={};</script>'),known.scene);
 assert.deepEqual(sceneFromHtml('window.SCENE={"text":"brace } and quote \\"","nested":{"a":1}};after();'),{text:'brace } and quote "',nested:{a:1}});
 assert.throws(()=>sceneFromHtml('<script>window.SCENE = dangerousCode();</script>'));
 assert.equal(battlePath(known.row),'/en/wt/ardennes-105hp-vs-tehb-4ad212e8001639a5');
 assert.throws(()=>battlePath({...known.row,sessionId:'../evil'}));
 assert.equal(archiveTeam({...known.row,team2Tag:'┾105HP┿'},'┾105HP┿'),null);
 for(const change of [{sessionId:'wrong'},{scoreboardConfidence:'partial'},{winnerTeam:null},{winnerTeam:1}])assert.throws(()=>archiveBattle(known.row,{...known.scene,match:{...known.scene.match,...change}},'Beyond Alive','┾105HP┿'));
 assert.throws(()=>archiveBattle(known.row,{...known.scene,players:[{...known.scene.players[0],clanTag:'Wrong'}]},'Beyond Alive','┾105HP┿'));
});
test('public source uses observed URLs without auth, handles ETag and throttling',async()=>{
 let calls=0;
 const source=new TacticalSource({fetchImpl:async(url,options)=>{
  assert.ok(!('Authorization' in options.headers));assert.match(url,/\/wt\/api\/replays\?skip=0&take=20&clan=/);
  calls++;if(calls===2){assert.equal(options.headers['If-None-Match'],'abc');return new Response(null,{status:304});}
  return new Response(JSON.stringify({total:1,items:[known.row]}),{headers:{ETag:'abc'}});
 }});
 assert.equal((await source.list('┾105HP┿')).items[0].sessionId,known.row.sessionId);assert.equal((await source.list('┾105HP┿')).total,1);
 const blocked=new TacticalSource({fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'600'}})});
 await assert.rejects(blocked.list('tag'),e=>e instanceof SourceError&&e.retryMs===600000);
 const huge=new TacticalSource({fetchImpl:async()=>new Response('x',{headers:{'Content-Length':'99999999'}})});await assert.rejects(huge.list('tag'),/слишком большой/);
});
test('archive polling automatically registers every squadron player and never requests the Discord roster',async()=>{
 const store=new RatingStore(':memory:');store.register('g','Beyond Alive','┾105HP┿');store.addPlayer('g','1','tourist__');let now=Date.parse(known.row.playedAtUtc)+3600000,details=0;
 const source={list:async()=>({total:1,items:[known.row]}),battle:async(...args)=>{details++;return archiveBattle(args[0],known.scene,args[1],args[2]);}};
 const client={guilds:{cache:new Map([['g',{members:{fetch:async()=>{throw Error("Full roster must not be requested");}}}]])}};
 const live=new ArchiveBattles({store,client,guildId:'g',source,now:()=>now,pause:async()=>{},log:()=>{}});
 try{
  live.stopped=false;await live.tick();let rows=store.rows('g');assert.equal(rows.length,8);const own=rows.find(p=>p.nick==='tourist__');assert.equal(own.losses,1);assert.equal(own.deaths,1);assert.equal(store.pendingCount('g'),0);
  now+=60001;await live.tick();assert.equal(details,1);assert.equal(store.rows('g').find(p=>p.nick==='tourist__').losses,1);
  assert.equal(store.ingest('g',{...archiveBattle(known.row,known.scene,'Beyond Alive','┾105HP┿'),id:'5391392491559074213'},members).duplicate,true);
 }finally{live.stop();store.db.close();}
});
test('polling paginates initial 24 h, ignores arcade and respects request backoff',async()=>{
 const store=new RatingStore(':memory:');store.register('g','Beyond Alive','┾105HP┿');store.addPlayer('g','1','tourist__');let now=Date.parse(known.row.playedAtUtc)+3600000,calls=[],fail=false;
 const old={...known.row,playedAtUtc:new Date(now-2*86400000).toISOString()};
 const source={list:async(tag,skip)=>{calls.push(skip);if(fail)throw new SourceError('limited',300000);return skip===0?{total:21,items:[{...known.row,difficulty:'arcade'}]}:{total:21,items:[old]};},battle:async()=>{throw Error('should not request details');}};
 const live=new ArchiveBattles({store,client:{},guildId:'g',source,now:()=>now,pause:async()=>{},log:()=>{}});
 try{
  live.stopped=false;await live.tick();assert.deepEqual(calls,[0,20]);fail=true;now+=60001;await live.tick();const count=calls.length;
  now+=60001;await live.tick();assert.equal(calls.length,count);assert.match(live.status(),/limited/);
 }finally{live.stop();store.db.close();}
});
test('empty roster does not block discovery; all players are registered from the battle report',async()=>{
 const store=new RatingStore(':memory:');store.register('g','Beyond Alive','┾105HP┿');
 const battle=archiveBattle(known.row,known.scene,'Beyond Alive','┾105HP┿');let queries=0;
 const source={list:async()=>{queries++;return {total:1,items:[known.row]};},battle:async()=>battle};
 const live=new ArchiveBattles({store,client:{},guildId:'g',source,now:()=>Date.parse(known.row.playedAtUtc)+3600000,pause:async()=>{},log:()=>{}});
 try{
  live.stopped=false;await live.tick();assert.equal(queries,1);
  assert.equal(store.rows('g').length,8);assert.equal(store.rows('g').reduce((n,p)=>n+p.losses,0),8);assert.equal(store.pendingCount('g'),0);
 }finally{live.stop();store.db.close();}
});
