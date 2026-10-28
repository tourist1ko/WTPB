import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { RatingStore, wtNick } from '../src/rating.js';
import { leaderboard } from '../src/leaderboard.js';
const battle={id:'a',mode:'squadron_realistic',squadron:'QZ',result:'win',players:[{nickname:'Alpha',tankKills:2,airKills:1,deaths:1},{nickname:'Bravo',tankKills:1,airKills:0,deaths:0},{nickname:'NoFormat',tankKills:8,airKills:0,deaths:0}]};
function store(){const s=new RatingStore(':memory:');s.register('g','QZ');return s;}

test('only explicitly added players count, even if a full Discord roster is supplied',()=>{
 const s=store();s.addPlayer('g','1','Alpha');s.addPlayer('g','2','Bravo');
 const discord=new Map([['3',{id:'3',nickname:'NoFormat (Name)',user:{bot:false}}]]);
 assert.equal(s.ingest('g',battle,discord).count,2);assert.equal(s.ingest('g',battle).duplicate,true);
 let r=s.rows('g');assert.equal(r[0].nick,'Alpha');assert.equal(r[0].kd,3);assert.equal(r[1].kd,1);
 s.ingest('g',{...battle,id:'b',result:'loss'});r=s.rows('g');assert.equal(r[0].wr,50);assert.equal(r[0].tanks,4);
 assert.equal(s.rows('g',new Map()).length,2);assert.throws(()=>s.ingest('g',{...battle,squadron:'Other'}));
 const png=leaderboard(r,'Қазақ & <полк>');assert.equal(png.subarray(1,4).toString(),'PNG');s.db.close();
});
test('manual roster starts empty, new players show zero and no battle is consumed without players',()=>{
 const s=store();assert.deepEqual(s.players('g'),[]);assert.deepEqual(s.rows('g'),[]);
 assert.throws(()=>s.ingest('g',battle),/addplayer/);assert.equal(s.recordedBattle('g','QZ','a'),false);
 s.addPlayer('g','1','Alpha');const row=s.rows('g')[0];assert.equal(row.kd,0);assert.equal(row.wr,0);assert.equal(row.wins+row.losses,0);
 assert.equal(s.ingest('g',battle).count,1);s.db.close();
});
test('duplicate nick and conflicting Discord binding rejected, repeated addition idempotent',()=>{
 const s=store();assert.equal(s.addPlayer('g','1',' Alpha ').added,true);assert.equal(s.addPlayer('g','1','ALPHA').added,false);
 assert.throws(()=>s.addPlayer('g','2','alpha'),/другому/);assert.throws(()=>s.addPlayer('g','1','Bravo'),/removeplayer/);
 assert.throws(()=>s.addPlayer('g','2','\n'));assert.throws(()=>s.addPlayer('g','2','A\nB'));
 assert.throws(()=>s.ingest('g',{...battle,id:'bad',players:[{...battle.players[0],deaths:-1}]}));s.db.close();
});
test('removal, re-addition and unregister preserve history without transferring between guilds or squads',()=>{
 const s=store();s.addPlayer('g','1','Alpha');s.ingest('g',battle);
 assert.equal(s.removePlayer('g','1'),true);assert.equal(s.removePlayer('g','1'),false);assert.equal(s.rows('g').length,0);
 s.addPlayer('g','1','Alpha');assert.equal(s.rows('g')[0].tanks,2);
 s.unregister('g');s.register('g','Other');assert.equal(s.rows('g').length,0);s.addPlayer('g','1','Alpha');assert.equal(s.rows('g')[0].tanks,0);
 s.unregister('g');s.register('g','QZ');assert.equal(s.rows('g')[0].tanks,2);assert.equal(s.ingest('g',battle).duplicate,true);
 s.register('other','QZ');assert.equal(s.rows('other').length,0);s.db.close();
});
test('legacy migration keeps stats, requires manual choice and roster survives restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pb-manual-')),file=join(dir,'rank.sqlite');
 try{
  const old=new DatabaseSync(file);old.exec("CREATE TABLE guilds(guild TEXT PRIMARY KEY,squadron TEXT NOT NULL);INSERT INTO guilds VALUES('g','QZ');CREATE TABLE stats(guild TEXT,squadron TEXT,uid TEXT,nick TEXT,tanks INTEGER DEFAULT 0,air INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,PRIMARY KEY(guild,squadron,uid,nick));INSERT INTO stats VALUES('g','QZ','1','alpha',8,2,5,3,1)");old.close();
  let s=new RatingStore(file);assert.equal(s.rows('g').length,0);assert.equal(s.db.prepare('SELECT tanks FROM stats').get().tanks,8);
  s.addPlayer('g','1','Alpha');assert.equal(s.rows('g')[0].kd,2.5);s.db.close();
  s=new RatingStore(file);assert.equal(s.players('g').length,1);assert.equal(s.rows('g')[0].wr,75);s.db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('winrate tie breaker and nickname helper remain stable',()=>{
 assert.equal(wtNick('Alpha (A)'),'Alpha');assert.equal(wtNick('Alpha'),null);
 const s=store();s.addPlayer('g','1','Alpha');s.addPlayer('g','2','Bravo');
 s.ingest('g',{...battle,players:battle.players.slice(0,2).map(p=>({...p,tankKills:1,airKills:0,deaths:1}))});
 s.ingest('g',{...battle,id:'loss',result:'loss',players:[{nickname:'Alpha',tankKills:1,airKills:0,deaths:1}]});
 assert.equal(s.rows('g')[0].nick,'Bravo');assert.ok(leaderboard([],'Empty').length>1000);s.db.close();
});
test('players added after a collected report receive their own results exactly once',()=>{
 const s=store();s.addPlayer('g','1','Alpha');assert.equal(s.ingest('g',battle).count,1);
 assert.equal(s.rows('g').length,1);assert.equal(s.addPlayer('g','2','Bravo').backfilled,1);
 let rows=s.rows('g');assert.equal(rows.find(p=>p.uid==='2').tanks,1);assert.equal(rows.find(p=>p.uid==='1').tanks,2);
 s.removePlayer('g','2');assert.equal(s.addPlayer('g','2','Bravo').backfilled,0);
 assert.equal(s.ingest('g',battle).duplicate,true);rows=s.rows('g');assert.equal(rows.find(p=>p.uid==='2').wins,1);
 s.addPlayer('g','3','NoFormat');assert.equal(s.rows('g').find(p=>p.uid==='3').tanks,8);s.db.close();
});
