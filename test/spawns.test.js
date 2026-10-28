import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RatingStore,validateBattle } from '../src/rating.js';
import { seasonWindow } from '../src/season.js';
const season=seasonWindow({start:'2026-09-01',end:'2026-10-31'});
const player={nickname:'Alpha',tankKills:3,airKills:1,deaths:0};
const battle={id:'first',squadron:'QZ',mode:'squadron_realistic',result:'win',playedAt:'2026-10-20T12:00:00Z',players:[player]};
function store(path=':memory:'){const s=new RatingStore(path);if(!s.squad('g'))s.register('g','QZ');s.addPlayer('g','1','Alpha');return s;}
test('a survivor counts one spawn, total kills divide by all spawns instead of deaths',()=>{
 const s=store();s.addPlayer('g','2','Bravo');s.addPlayer('g','3','Empty');
 const first={...battle,players:[player,{nickname:'Bravo',tankKills:2,airKills:0,deaths:1}]};
 const second={...battle,id:'second',result:'loss',players:[{...player,tankKills:1,airKills:0,deaths:1}]};
 for(const b of [first,second]){s.ingest('g',b);s.ingestSeason('g',b,season);}
 for(const rows of [s.rows('g'),s.seasonRows('g',season)]){
  const alpha=rows.find(p=>p.uid==='1');assert.equal(alpha.spawns,2);assert.equal(alpha.deaths,1);assert.equal(alpha.kd,2.5);assert.equal(alpha.wr,50);
  assert.equal(rows[0].nick,'Alpha');assert.equal(rows[1].kd,2);assert.equal(rows[2].kd,0);
 }
 s.ingest('g',second);s.ingestSeason('g',second,season);assert.equal(s.seasonRows('g',season)[0].spawns,2);s.db.close();
});
test('explicit spawn counts survive backfill, repeated add and removal without doubling',()=>{
 const s=store();const report={...battle,players:[player,{nickname:'Late',tankKills:3,airKills:0,deaths:1,spawns:2}]};
 s.ingest('g',report);s.ingestSeason('g',report,season);s.addPlayer('g','2','Late');
 s.addPlayer('g','2','Late');s.removePlayer('g','2');s.addPlayer('g','2','Late');
 for(const rows of [s.rows('g'),s.seasonRows('g',season)]){const late=rows.find(p=>p.uid==='2');assert.equal(late.spawns,2);assert.equal(late.kd,1.5);assert.equal(late.wins,1);}
 for(const spawns of [-1,1.5,'1',null,101])assert.throws(()=>validateBattle({...battle,players:[{...player,spawns}]}),/spawns/);
 assert.throws(()=>validateBattle({...battle,players:[{...player,spawns:0}]}),/без выхода/);s.db.close();
});
test('existing lifetime and seasonal stats migrate once without re-downloading or changing kills and wins',()=>{
 const directory=mkdtempSync(join(tmpdir(),'pb-spawns-')),file=join(directory,'rank.sqlite');
 try{
  let s=store(file);s.ingest('g',battle);s.ingestSeason('g',battle,season);
  // Recreate the schema state before the spawn field existed.
  s.db.exec('ALTER TABLE stats DROP COLUMN spawns;ALTER TABLE season_stats DROP COLUMN spawns');s.db.close();
  s=store(file);
  for(const rows of [s.rows('g'),s.seasonRows('g',season)]){assert.equal(rows[0].spawns,1);assert.equal(rows[0].kd,4);assert.equal(rows[0].wins,1);assert.equal(rows[0].deaths,0);}
  assert.equal(s.ingest('g',battle).duplicate,true);assert.equal(s.ingestSeason('g',battle,season).duplicate,true);
  s.ingest('g',{...battle,id:'extra',players:[{...player,spawns:2}]});s.ingestSeason('g',{...battle,id:'extra',players:[{...player,spawns:2}]},season);s.db.close();
  s=store(file);assert.equal(s.rows('g')[0].spawns,3);assert.equal(s.seasonRows('g',season)[0].spawns,3);
  assert.equal(s.rows('g')[0].tanks,6);assert.equal(s.seasonRows('g',season)[0].wins,2);s.db.close();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
