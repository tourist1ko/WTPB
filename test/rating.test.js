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

test('duplicate nick and conflicting Discord binding rejected, repeated addition idempotent',()=>{
 const s=store();assert.equal(s.addPlayer('g','1',' Alpha ').added,true);assert.equal(s.addPlayer('g','1','ALPHA').added,false);
 assert.throws(()=>s.addPlayer('g','2','alpha'),/другому/);assert.throws(()=>s.addPlayer('g','1','Bravo'),/removeplayer/);
 assert.throws(()=>s.addPlayer('g','2','\n'));assert.throws(()=>s.addPlayer('g','2','A\nB'));
 assert.throws(()=>s.ingest('g',{...battle,id:'bad',players:[{...battle.players[0],deaths:-1}]}));s.db.close();
});
test('legacy migration keeps stats, requires manual choice and roster survives restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pb-manual-')),file=join(dir,'rank.sqlite');
 try{
  const old=new DatabaseSync(file);old.exec("CREATE TABLE guilds(guild TEXT PRIMARY KEY,squadron TEXT NOT NULL);INSERT INTO guilds VALUES('g','QZ');CREATE TABLE stats(guild TEXT,squadron TEXT,uid TEXT,nick TEXT,tanks INTEGER DEFAULT 0,air INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,PRIMARY KEY(guild,squadron,uid,nick));INSERT INTO stats VALUES('g','QZ','1','alpha',8,2,5,3,1)");old.close();
  let s=new RatingStore(file);assert.equal(s.rows('g').length,0);assert.equal(s.db.prepare('SELECT tanks FROM stats').get().tanks,8);
  s.addPlayer('g','1','Alpha');assert.equal(s.rows('g')[0].kd,2);s.db.close();
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
test('players from reports are added automatically and counted once',()=>{
 const s=store();const r=s.ingest('g',battle);assert.equal(r.count,3);assert.equal(s.ingest('g',battle).duplicate,true);
 const rows=s.rows('g');assert.equal(rows.length,3);assert.equal(rows[0].nick,'Bravo');assert.equal(rows.find(p=>p.nick==='Alpha').kd,3);
 assert.throws(()=>s.ingest('g',{...battle,squadron:'Other'}));s.db.close();
});
test('roster from the official site is added at once, former members without battles are dropped',()=>{
 const s=store();s.ingest('g',battle);
 assert.equal(s.setRoster('g','QZ',['Alpha','Charlie','Delta']),2);assert.equal(s.rosterCount('g'),3);
 let rows=s.rows('g');assert.equal(rows.length,5);assert.equal(rows.at(-1).wins+rows.at(-1).losses,0);
 assert.equal(s.setRoster('g','QZ',['Alpha','Charlie']),0);rows=s.rows('g');
 assert.ok(!rows.some(p=>p.nick==='Delta'));assert.ok(rows.some(p=>p.nick==='Bravo'));
 assert.equal(s.setRoster('g','Other',['X']),0);s.db.close();
});
