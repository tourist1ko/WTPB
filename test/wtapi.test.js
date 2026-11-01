import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { zstdCompressSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { wireTypes, decodeReplay, battleForSquad } from '../src/wtapi-codec.js';
import { LiveBattles } from '../src/wtapi-live.js';
import { RatingStore } from '../src/rating.js';

// Synthetic protocol fixture, not a claimed result of a real Beyond Alive battle.
const fixture=()=>({id:'5391392491559074213',type:'sqb',difficulty:'realistic',status:'completed',end_ts:1792510738,winner_team:2,loser_team:1,winner_tag:'[Enemy]',loser_tag:'[┾105HP┿]',players:[
 {uid:'175849452',name:'tourist__',tag:'[┾105HP┿]',team:1,ground_kills:2,air_kills:1,deaths:1},
 {uid:'2',name:'NoDiscord',tag:'[┾105HP┿]',team:1,ground_kills:3,air_kills:0,deaths:1},
 {uid:'3',name:'Enemy',tag:'[Enemy]',team:2,ground_kills:4,air_kills:0,deaths:0}
]});
function pack(data,{kind='full',version=3}={}){
 const type=wireTypes[kind==='full'?'Replay':'LightReplay'];
 const body=type.encode(kind==='full'?{light:data}:data).finish();
 return zstdCompressSync(wireTypes.Envelope.encode({schema_version:version,kind,body}).finish());
}
const members=new Map([['1',{id:'1',nickname:'tourist__ (Айбар)',user:{bot:false}}],['2',{id:'2',nickname:'NoDiscord',user:{bot:false}}]]);
test('zstd protobuf full/light headers decode and map only registered squad',()=>{
 for(const kind of ['full','light']){
  const r=decodeReplay(pack(fixture(),{kind}));
  const b=battleForSquad(r,'Beyond Alive','┾105HP┿');
  assert.equal(b.result,'loss');assert.equal(b.players.length,2);
  assert.equal(battleForSquad(r,'Enemy','Enemy').result,'win');
  assert.deepEqual(b.players[0],{nickname:'tourist__',tankKills:2,airKills:1,deaths:1});
  assert.equal(battleForSquad(r,'Another','Other'),null);
 }
 assert.throws(()=>decodeReplay(pack(fixture(),{version:4})),/схема 4/);
 assert.throws(()=>decodeReplay(Buffer.from('bad')));
});
test('partial battles, wrong modes, draws and unresolved winners never count as losses',()=>{
 for(const change of [{status:'pending'},{status:'in_progress'},{type:'random'},{difficulty:'arcade'},{draw:true}])assert.equal(battleForSquad({...fixture(),...change},'Beyond Alive','┾105HP┿'),null);
 for(const change of [{winner_team:0},{winner_team:1},{end_ts:0}])assert.throws(()=>battleForSquad({...fixture(),...change},'Beyond Alive','┾105HP┿'));
 const r=fixture();r.players[2].tag='[┾105HP┿]';assert.throws(()=>battleForSquad(r,'Beyond Alive','┾105HP┿'),/неоднозначная/);
});
test('pending battle survives restart, legacy DB migration preserves binding and stats deduplicate',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pb-live-')),path=join(dir,'rank.sqlite');
 try{
  const old=new DatabaseSync(path);old.exec("CREATE TABLE guilds(guild TEXT PRIMARY KEY,squadron TEXT NOT NULL); INSERT INTO guilds VALUES('g','Beyond Alive')");old.close();
  let store=new RatingStore(path);assert.equal(store.squad('g'),'Beyond Alive');store.setTag('g','Beyond Alive','┾105HP┿');
  const b=battleForSquad(fixture(),'Beyond Alive','┾105HP┿');store.enqueue('g',b);store.enqueue('g',b);store.db.close();
  store=new RatingStore(path);assert.equal(store.pendingCount('g'),1);assert.equal(store.binding('g').tag,'┾105HP┿');store.addPlayer('g','1','tourist__');
  assert.equal(store.ingest('g',store.pending('g','Beyond Alive')[0],members).count,2);
  // Simulate restart after the stats transaction but before queue acknowledgement.
  store.db.close();store=new RatingStore(path);assert.equal(store.ingest('g',store.pending('g','Beyond Alive')[0],members).duplicate,true);
  store.finishPending('g',b.squadron,b.id);assert.equal(store.pendingCount('g'),0);
  const row=store.rows('g',members).find(p=>p.nick==='tourist__');assert.equal(row.tanks,2);assert.equal(row.air,1);assert.equal(row.losses,1);assert.equal(row.wr,0);
  store.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('stream sends auth in header, collects players automatically and ignores duplicate frames',async()=>{
 const store=new RatingStore(':memory:');store.register('g','Beyond Alive','┾105HP┿');
 let socket;
 class Socket extends EventEmitter {constructor(url,options){super();socket=this;assert.equal(url,'wss://wtapi.dev/v1/replays/ws/sqb');assert.equal(options.headers.Authorization,'Bearer test-secret');}terminate(){this.emit('close',1000);}}
 const client={guilds:{cache:new Map()}};
 const logs=[];const live=new LiveBattles({key:'test-secret',store,client,guildId:'g',Socket,log:s=>logs.push(s)});
 try{
  live.start();socket.emit('open');socket.emit('message',pack(fixture()),true);
  await new Promise(resolve=>setImmediate(resolve));await live.drain();assert.equal(store.pendingCount('g'),0);const own=()=>store.rows('g',members).find(p=>p.nick==='tourist__');assert.equal(own().kd,3);
  socket.emit('message',pack(fixture()),true);await new Promise(resolve=>setImmediate(resolve));assert.equal(own().losses,1);
  live.report(Error('test-secret'));assert.ok(!logs.join('').includes('test-secret'));
  store.unregister('g');socket.emit('message',pack(fixture()),true);assert.equal(store.pendingCount('g'),0);
 }finally{live.stop();store.db.close();}
});
