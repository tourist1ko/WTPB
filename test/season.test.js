import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionsBitField,PermissionFlagsBits } from 'discord.js';
import { RatingStore } from '../src/rating.js';
import { seasonWindow,inSeason } from '../src/season.js';
import { SeasonUpdate,seasonProgress } from '../src/season-update.js';
import { SourceError } from '../src/tactical-source.js';
import { handleRank } from '../src/rank-command.js';
import { rankPayload,handleRankPage } from '../src/rank-pages.js';
import { leaderboardSVG } from '../src/leaderboard.js';
import { ArchiveBattles } from '../src/tactical-live.js';

const season=seasonWindow({start:'2026-09-01',end:'2026-10-31'});
const next=seasonWindow({start:'2026-11-01',end:'2026-12-31'});
const guild='g',uid='123456789012345678',tag='┾105HP┿',squadron='Beyond Alive';
const base=JSON.parse(readFileSync(new URL('./fixtures/tactical-4ad212e8001639a5.json',import.meta.url),'utf8')).row;
const row=(index,playedAtUtc='2026-09-05T15:00:00Z')=>({...base,sessionId:(0x4ad212e800160000n+BigInt(index)).toString(16),playedAtUtc});
const report=r=>({id:r.sessionId,squadron,mode:'squadron_realistic',playedAt:r.playedAtUtc,result:'win',players:[{nickname:'tourist__',tankKills:2,airKills:1,deaths:1},{nickname:'LatePlayer',tankKills:1,airKills:0,deaths:1}]});
function store(path=':memory:'){const s=new RatingStore(path);if(!s.squad(guild))s.register(guild,squadron,tag);if(!s.players(guild).length)s.addPlayer(guild,uid,'tourist__');return s;}
function worker(s,source,extra={}){return new SeasonUpdate({store:s,guildId:guild,getSeason:async()=>season,source,now:()=>Date.parse('2026-10-23T12:00:00Z'),pause:async()=>{},log:()=>{},...extra});}

test('season boundaries follow Moscow dates including start, end and cross-year ranges',()=>{
 assert.equal(inSeason('2026-08-31T20:59:59Z',season),false);assert.equal(inSeason('2026-08-31T21:00:00Z',season),true);
 assert.equal(inSeason('2026-10-31T20:59:59Z',season),true);assert.equal(inSeason('2026-10-31T21:00:00Z',season),false);
 assert.throws(()=>seasonWindow({start:'2026-02-30',end:'2026-03-31'}));
 const cross=seasonWindow({start:'2026-12-01',end:'2027-01-31'});assert.equal(inSeason('2027-01-03T12:00:00Z',cross),true);
 assert.equal(inSeason('2026-09-01T12:00:00',season),false);assert.equal(inSeason('2026-09-31T12:00:00Z',season),false);
});
test('season totals ignore legacy aggregates, deduplicate hex/decimal IDs and isolate the next season',()=>{
 const s=store(),b=report(row(1));s.ingest(guild,{...b,players:[{...b.players[0],tankKills:99}]});
 assert.equal(s.seasonRows(guild,season)[0].tanks,0);s.ingestSeason(guild,b,season);
 s.ingestSeason(guild,{...b,id:BigInt('0x'+b.id).toString()},season);assert.equal(s.seasonRows(guild,season)[0].tanks,2);
 assert.equal(s.rows(guild)[0].tanks,99);assert.equal(s.seasonRows(guild,next)[0].wins,0);
 assert.throws(()=>s.ingestSeason(guild,b,next),/не входит/);
 s.ingestSeason(guild,report(row(2,'2026-11-02T10:00:00Z')),next);assert.equal(s.seasonRows(guild,next)[0].wins,1);assert.equal(s.seasonRows(guild,season)[0].wins,1);
 s.addPlayer(guild,'2','LatePlayer');assert.equal(s.seasonRows(guild,season).find(p=>p.uid==='2').wins,1);
 s.removePlayer(guild,'2');s.addPlayer(guild,'2','LatePlayer');assert.equal(s.seasonRows(guild,next).find(p=>p.uid==='2').wins,1);s.db.close();
});
test('full update scans multiple pages beyond 24 hours, repeated run uses cached reports without double counting',async()=>{
 const s=store(),rows=Array.from({length:21},(_,i)=>row(i+1));rows.push(row(30,'2026-08-01T12:00:00Z'),row(31,'2026-11-05T12:00:00Z'));
 let lists=[],downloads=0;const source={list:async(_tag,skip)=>{lists.push(skip);return {total:rows.length,items:rows.slice(skip,skip+20)};},battle:async r=>{downloads++;return report(r);}};
 const live={},w=worker(s,source,{live});const progress=[];w.subscribe(p=>progress.push(p));
 await w.start();await w.promise;assert.deepEqual(lists,[0,20]);assert.equal(downloads,21);assert.equal(w.snapshot().status,'done');assert.equal(w.snapshot().total,21);
 assert.equal(s.seasonRows(guild,season)[0].wins,21);assert.equal(live.seasonUpdating,false);assert.equal(s.rows(guild)[0].wins,0);
 await w.start();await w.promise;assert.equal(downloads,21);assert.equal(s.seasonRows(guild,season)[0].tanks,42);assert.ok(progress.some(p=>p.done===21));w.stop();s.db.close();
});
test('incomplete reports are reported and retried, successful reports remain counted once',async()=>{
 const s=store(),rows=[row(1),row(2)];let fail=true,downloads=0;
 const source={list:async()=>({total:2,items:rows}),battle:async r=>{downloads++;if(fail&&r.sessionId===rows[1].sessionId)throw Error('incomplete');return report(r);}};
 const w=worker(s,source);await w.start();await w.promise;assert.equal(w.snapshot().status,'partial');assert.equal(w.snapshot().failed,1);assert.equal(s.seasonRows(guild,season)[0].wins,1);
 assert.match(seasonProgress(w.snapshot()),/пропусками/);fail=false;await w.start();await w.promise;assert.equal(w.snapshot().status,'done');assert.equal(w.snapshot().failed,0);assert.equal(downloads,3);assert.equal(s.seasonRows(guild,season)[0].wins,2);w.stop();s.db.close();
});
test('rate limit and checkpoint survive restart, early retry does not contact source',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pb-season-')),path=join(dir,'rank.sqlite');let now=Date.parse('2026-10-23T12:00:00Z'),limited=true,calls=0;
 const source={list:async()=>{calls++;if(limited)throw new SourceError('HTTP 429',300000);return {total:1,items:[row(1)]};},battle:async r=>report(r)};
 let s=store(path),w=worker(s,source,{now:()=>now});
 try{
  await w.start();await w.promise;assert.equal(w.snapshot().status,'paused');assert.equal(w.snapshot().cursor,0);w.stop();s.db.close();
  s=store(path);w=worker(s,source,{now:()=>now});await w.start();assert.equal(calls,1);assert.equal(w.snapshot().status,'paused');
  now+=300001;limited=false;await w.start();await w.promise;assert.equal(calls,2);assert.equal(s.seasonRows(guild,season)[0].wins,1);w.stop();s.db.close();
  s=store(path);assert.equal(s.seasonRows(guild,season)[0].tanks,2);
 }finally{w.stop();try{s.db.close();}catch{}rmSync(dir,{recursive:true,force:true});}
});
test('concurrent commands share a single update and binding changes pause it safely',async()=>{
 const s=store();let release,calls=0;
 const source={list:async()=>{calls++;return new Promise(r=>release=r);},battle:async r=>report(r)};
 const w=worker(s,source);await w.start();assert.equal((await w.start()).status,'running');assert.equal(calls,1);
 s.unregister(guild);release({total:1,items:[row(1)]});await w.promise;assert.equal(w.snapshot().status,'paused');assert.equal(s.db.prepare('SELECT count(*) AS n FROM season_battles').get().n,0);w.stop();s.db.close();
});
test('season date is shown on each page and buttons from a previous season expire',async()=>{
 const s=store();const payload=rankPayload(s.seasonRows(guild,season),squadron,uid,1,season);
 assert.match(leaderboardSVG(s.seasonRows(guild,season),squadron,1,season),/01\.09\.2026 - 31\.10\.2026/);
 let message;const i={isButton:()=>true,customId:payload.components[0].toJSON().components[0].custom_id,guildId:guild,user:{id:uid},deferUpdate:async()=>{},followUp:async p=>message=p};
 await handleRankPage(i,s,guild,{currentSeason:async()=>next});assert.match(message.content,/сезон/);s.db.close();
});
test('admin update starts background work and reports progress, rank uses seasonal rows',async()=>{
 const s=store(),w=worker(s,{list:async()=>({total:1,items:[row(1)]}),battle:async r=>report(r)}),messages=[];
 const i={isChatInputCommand:()=>true,guildId:guild,commandName:'pb',memberPermissions:new PermissionsBitField([PermissionFlagsBits.Administrator]),options:{getSubcommand:()=> 'update',getSubcommandGroup:()=> 'stat'},deferReply:async()=>{},editReply:async p=>messages.push(p)};
 await handleRank(i,s,guild,undefined,undefined,undefined,w);await w.promise;await new Promise(r=>setImmediate(r));
 assert.ok(messages.some(p=>p.content.includes('Сезон')));assert.ok(messages.some(p=>p.content.includes('Обработано: 1 / 1')));
 i.commandName='rank';i.user={id:uid};i.options.getInteger=()=>1;i.editReply=async p=>assert.equal(p.files.length,1);
 await handleRank(i,s,guild,undefined,undefined,undefined,w);w.stop();s.db.close();
});
test('automatic collection continues updating the current season after the full scan',async()=>{
 const s=store(),r=row(77,'2026-10-23T11:00:00Z');
 const source={list:async()=>({total:1,items:[r]}),battle:async value=>report(value)};
 const w=worker(s,source),live=new ArchiveBattles({store:s,guildId:guild,source,now:()=>Date.parse('2026-10-23T12:00:00Z'),pause:async()=>{},log:()=>{},onBattle:b=>w.apply(b)});
 live.stopped=false;await live.tick();assert.equal(s.rows(guild)[0].wins,1);assert.equal(s.seasonRows(guild,season)[0].wins,1);assert.equal(s.pendingCount(guild),0);
 live.stop();w.stop();s.db.close();
});
test('completed job keeps checkpoints, incremental update visits only the new head and never reprocesses cached reports',async()=>{
 const s=store(),rows=Array.from({length:61},(_,i)=>row(i+1));let skips=[],downloads=0;
 const source={list:async(_tag,skip)=>{skips.push(skip);return {total:rows.length,items:rows.slice(skip,skip+20)};},battle:async value=>{downloads++;return report(value);}};
 let w=worker(s,source);await w.start();await w.promise;assert.deepEqual(skips,[0,20,40,60]);assert.equal(downloads,61);
 // Simulate loading a completed pre-1.5.2 job without the new mode field.
 const saved=w.saved(season);delete saved.mode;s.db.prepare('UPDATE season_jobs SET payload=?').run(JSON.stringify(saved));w.stop();w=worker(s,source);
 skips=[];await w.start();await w.promise;assert.deepEqual(skips,[0]);assert.equal(downloads,61);assert.equal(w.snapshot().done,61);assert.equal(w.snapshot().mode,'incremental');
 rows.unshift(row(900,'2026-10-23T11:00:00Z'));skips=[];const progress=[];w.subscribe(p=>progress.push(p));
 await w.start();await w.promise;assert.deepEqual(skips,[0,20]);assert.equal(downloads,62);assert.equal(s.seasonRows(guild,season)[0].wins,62);
 assert.ok(progress.every(p=>p.done>=61));assert.equal(w.snapshot().total,62);w.stop();s.db.close();
});
test('late Discord participant receives cached season results on addplayer with no source calls or collector restart',async()=>{
 const s=store();let requests=0;
 const source={list:async()=>{requests++;return {total:1,items:[row(1)]};},battle:async value=>{requests++;return report(value);}};
 const w=worker(s,source);await w.start();await w.promise;assert.equal(requests,2);
 source.list=source.battle=async()=>{throw Error('Unexpected source request');};let ticks=0,message;
 const id='223456789012345678',user={id,username:'DiscordName',bot:false};
 const i={isChatInputCommand:()=>true,guildId:guild,commandName:'pb',memberPermissions:new PermissionsBitField([PermissionFlagsBits.Administrator]),options:{getSubcommand:()=> 'addplayer',getSubcommandGroup:()=> 'stat',getUser:()=>user,getString:()=> 'LatePlayer'},guild:{members:{fetch:async()=>({nickname:'Другой ник',user})}},deferReply:async()=>{},editReply:async p=>message=p};
 await handleRank(i,s,guild,undefined,undefined,{tick:()=>ticks++},w);
 assert.match(message.content,/Учтено боёв: 1/);assert.equal(ticks,0);assert.equal(requests,2);
 assert.equal(s.seasonRows(guild,season).find(p=>p.uid===id).wins,1);
 await handleRank(i,s,guild,undefined,undefined,{tick:()=>ticks++},w);
 assert.match(message.content,/Уже добавлен/);assert.equal(s.seasonRows(guild,season).find(p=>p.uid===id).wins,1);w.stop();s.db.close();
});
test('explicit full search discovers older archive additions while retaining existing results',async()=>{
 const s=store(),rows=Array.from({length:41},(_,i)=>row(i+1));let downloads=0,skips=[];
 const source={list:async(_tag,skip)=>{skips.push(skip);return {total:rows.length,items:rows.slice(skip,skip+20)};},battle:async value=>{downloads++;return report(value);}};
 const w=worker(s,source);await w.start();await w.promise;
 rows.push(row(901,'2026-09-01T12:00:00Z'));skips=[];
 await w.start();await w.promise;assert.deepEqual(skips,[0]);assert.equal(downloads,41);
 skips=[];await w.start({full:true});await w.promise;assert.deepEqual(skips,[0,20,40]);assert.equal(downloads,42);assert.equal(s.seasonRows(guild,season)[0].wins,42);w.stop();s.db.close();
});
test('rows shifted between pages during incremental discovery do not become an early stop boundary',async()=>{
 const s=store(),rows=Array.from({length:45},(_,i)=>row(i+1));let downloads=0,shift=false,skips=[];
 const source={list:async(_tag,skip)=>{
  skips.push(skip);
  if(shift&&skip===20){rows.unshift(...Array.from({length:20},(_,i)=>row(1000+i)));shift=false;}
  return {total:rows.length,items:rows.slice(skip,skip+20)};
 },battle:async value=>{downloads++;return report(value);}};
 const w=worker(s,source);await w.start();await w.promise;
 rows.unshift(...Array.from({length:25},(_,i)=>row(900+i)));shift=true;skips=[];
 await w.start();await w.promise;assert.deepEqual(skips,[0,20,40,60]);assert.equal(downloads,70);
 await w.start();await w.promise;assert.equal(downloads,90);assert.equal(s.seasonRows(guild,season)[0].wins,90);w.stop();s.db.close();
});
