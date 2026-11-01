import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { seasonWindow, inSeason, battleTime } from './season.js';
function battleIds(id){
  if(typeof id!=='string')return [id];
  let hex;
  if(/^[0-9a-f]{16}$/i.test(id))hex=id.toLowerCase();
  else if(/^\d{17,20}$/.test(id)&&BigInt(id)<=0xffffffffffffffffn)hex=BigInt(id).toString(16).padStart(16,'0');
  return hex?[...new Set([hex,BigInt('0x'+hex).toString(),id])]:[id];
}
export function wtNick(name) {
  if (typeof name !== 'string') return null;
  const m = name.match(/^([^()]+?)\s+\(([^()]+)\)$/u);
  return m && m[1].trim() && m[2].trim() ? m[1].trim() : null;
}
export function validateBattle(b) {
  if(!b || typeof b.id!=='string' || !/^[\w-]{1,100}$/.test(b.id) || b.mode!=='squadron_realistic' || typeof b.squadron!=='string' || !b.squadron.trim() || !['win','loss'].includes(b.result) || !Array.isArray(b.players) || b.players.length<1 || b.players.length>8) throw Error('Неверный отчёт ПБ. См. examples/battle.json.');
  const seen=new Set();
  if(b.playedAt!==undefined&&!Number.isFinite(battleTime(b.playedAt)))throw Error('Неверная дата playedAt. Укажи ISO 8601 со временем и часовым поясом.');
  for(const p of b.players) {
    if(typeof p.nickname!=='string' || !p.nickname.trim() || seen.has(p.nickname.toLowerCase())) throw Error('Неверные или повторные ники в отчёте.');
    seen.add(p.nickname.toLowerCase());
    for(const k of ['tankKills','airKills','deaths']) if(!Number.isSafeInteger(p[k]) || p[k]<0 || p[k]>100) throw Error('Неверное значение '+k);
    if(p.assists!==undefined&&(!Number.isSafeInteger(p.assists)||p.assists<0||p.assists>100)) throw Error('Неверное значение assists');
  }
  return b;
}
// Players with battles first, then К/Д, WinRate and nickname.
const byRank=(a,b)=>Number(b.wins+b.losses>0)-Number(a.wins+a.losses>0)||b.kd-a.kd||b.wr-a.wr||a.nick.localeCompare(b.nick);
export class RatingStore {
  constructor(path) {
    mkdirSync(dirname(path),{recursive:true}); this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS guilds(guild TEXT PRIMARY KEY,squadron TEXT NOT NULL); CREATE TABLE IF NOT EXISTS battles(guild TEXT,squadron TEXT,battle TEXT,PRIMARY KEY(guild,squadron,battle)); CREATE TABLE IF NOT EXISTS stats(guild TEXT,squadron TEXT,uid TEXT,nick TEXT,tanks INTEGER DEFAULT 0,air INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,PRIMARY KEY(guild,squadron,uid,nick));`);
    if(!this.db.prepare('PRAGMA table_info(guilds)').all().some(c=>c.name==='tag'))this.db.exec("ALTER TABLE guilds ADD COLUMN tag TEXT NOT NULL DEFAULT ''");
    this.db.exec('CREATE TABLE IF NOT EXISTS pending_battles(guild TEXT,squadron TEXT,battle TEXT,payload TEXT NOT NULL,PRIMARY KEY(guild,squadron,battle))');
    this.db.exec('CREATE TABLE IF NOT EXISTS tracked_players(guild TEXT NOT NULL,squadron TEXT NOT NULL,uid TEXT NOT NULL,nick TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(guild,squadron,uid),UNIQUE(guild,squadron,nick))');
    this.db.exec('CREATE TABLE IF NOT EXISTS battle_reports(guild TEXT NOT NULL,squadron TEXT NOT NULL,battle TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(guild,squadron,battle));CREATE TABLE IF NOT EXISTS player_battles(guild TEXT NOT NULL,squadron TEXT NOT NULL,battle TEXT NOT NULL,uid TEXT NOT NULL,nick TEXT NOT NULL,PRIMARY KEY(guild,squadron,battle,uid,nick))');
    this.db.exec('CREATE TABLE IF NOT EXISTS season_battles(guild TEXT NOT NULL,squadron TEXT NOT NULL,season TEXT NOT NULL,battle TEXT NOT NULL,playedAt TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(guild,squadron,season,battle));CREATE TABLE IF NOT EXISTS season_player_battles(guild TEXT NOT NULL,squadron TEXT NOT NULL,season TEXT NOT NULL,battle TEXT NOT NULL,uid TEXT NOT NULL,nick TEXT NOT NULL,PRIMARY KEY(guild,squadron,season,battle,uid,nick));CREATE TABLE IF NOT EXISTS season_stats(guild TEXT NOT NULL,squadron TEXT NOT NULL,season TEXT NOT NULL,uid TEXT NOT NULL,nick TEXT NOT NULL,tanks INTEGER DEFAULT 0,air INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,PRIMARY KEY(guild,squadron,season,uid,nick))');
    for(const table of ['stats','season_stats'])if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='assists'))this.db.exec(`ALTER TABLE ${table} ADD COLUMN assists INTEGER DEFAULT 0`);
    this.db.exec('CREATE TABLE IF NOT EXISTS squad_roster(guild TEXT NOT NULL,squadron TEXT NOT NULL,nick TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(guild,squadron,nick))');
  }
  squad(guild){return this.db.prepare('SELECT squadron FROM guilds WHERE guild=?').get(guild)?.squadron;}
  binding(guild){return this.db.prepare('SELECT squadron,tag FROM guilds WHERE guild=?').get(guild);}
  setTag(guild,name,tag){this.db.prepare('UPDATE guilds SET tag=? WHERE guild=? AND squadron=?').run(tag??'',guild,name);}
  register(guild,name,tag=''){name=name.trim();if(!name || name.length>100) throw Error('Укажи название полка до 100 символов.');const saved=this.db.prepare('INSERT OR IGNORE INTO guilds(guild,squadron,tag) VALUES(?,?,?)').run(guild,name,tag);if(!saved.changes)throw Error('Уже привязан полк: '+this.squad(guild)+'. Сначала выполни /pb unregister.');}
  recordedBattle(guild,name,id){return battleIds(id).some(key=>this.db.prepare('SELECT 1 FROM battles WHERE guild=? AND squadron=? AND battle=?').get(guild,name,key));}
  seenBattle(guild,name,id){return this.recordedBattle(guild,name,id)||battleIds(id).some(key=>this.db.prepare('SELECT 1 FROM pending_battles WHERE guild=? AND squadron=? AND battle=?').get(guild,name,key));}
  enqueue(guild,b){validateBattle(b);b={...b,id:battleIds(b.id)[0],squadron:b.squadron.trim()};if(this.seenBattle(guild,b.squadron,b.id))return;this.db.prepare('INSERT OR IGNORE INTO pending_battles VALUES(?,?,?,?)').run(guild,b.squadron,b.id,JSON.stringify(b));}
  pending(guild,name){return this.db.prepare('SELECT payload FROM pending_battles WHERE guild=? AND squadron=? ORDER BY rowid LIMIT 50').all(guild,name).map(r=>JSON.parse(r.payload));}
  pendingCount(guild){return this.db.prepare('SELECT count(*) AS n FROM pending_battles WHERE guild=? AND squadron=?').get(guild,this.squad(guild)??'').n;}
  finishPending(guild,name,id){for(const key of battleIds(id))this.db.prepare('DELETE FROM pending_battles WHERE guild=? AND squadron=? AND battle=?').run(guild,name,key);}
  unregister(guild){this.db.prepare('DELETE FROM guilds WHERE guild=?').run(guild);}
  players(guild){return this.db.prepare('SELECT uid,nick,label FROM tracked_players WHERE guild=? AND squadron=? ORDER BY label COLLATE NOCASE').all(guild,this.squad(guild)??'');}
  addPlayer(guild,uid,nickname){
    const squad=this.squad(guild);if(!squad)throw Error('Сначала привяжи полк через /pb register.');
    if(typeof uid!=='string'||!/^\d{1,22}$/.test(uid))throw Error('Неверный участник Discord.');
    const label=typeof nickname==='string'?nickname.trim():'';
    if(!label||label.length>100||/[\u0000-\u001f\u007f]/.test(label))throw Error('Укажи игровой ник до 100 символов.');
    const nick=label.toLowerCase(),players=this.players(guild);let current=players.find(p=>p.uid===uid);
    if(current&&current.nick!==nick)throw Error('Участник уже добавлен с ником '+current.label+'. Сначала выполни /pb stat removeplayer.');
    const sameNick=players.find(p=>p.nick===nick);
    if(sameNick&&sameNick.uid!==uid&&!sameNick.uid.startsWith('wt:'))throw Error('Игровой ник '+label+' уже привязан к другому участнику.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(sameNick&&sameNick.uid!==uid){
        const old=sameNick.uid;
        this.db.prepare('UPDATE tracked_players SET uid=?,label=? WHERE guild=? AND squadron=? AND uid=?').run(uid,label,guild,squad,old);
        this.db.prepare('UPDATE stats SET uid=? WHERE guild=? AND squadron=? AND uid=?').run(uid,guild,squad,old);
        this.db.prepare('UPDATE player_battles SET uid=? WHERE guild=? AND squadron=? AND uid=?').run(uid,guild,squad,old);
        this.db.prepare('UPDATE season_player_battles SET uid=? WHERE guild=? AND squadron=? AND uid=?').run(uid,guild,squad,old);
        this.db.prepare('UPDATE season_stats SET uid=? WHERE guild=? AND squadron=? AND uid=?').run(uid,guild,squad,old);
        current={uid,nick,label};
      }
      if(!current&&!sameNick)this.db.prepare('INSERT INTO tracked_players VALUES(?,?,?,?,?)').run(guild,squad,uid,nick,label);
      let backfilled=0;
      for(const report of this.db.prepare('SELECT payload FROM battle_reports WHERE guild=? AND squadron=?').all(guild,squad)){
        const battle=JSON.parse(report.payload),row=battle.players.find(p=>p.nickname.toLowerCase()===nick);
        if(row)backfilled+=this.applyPlayer(guild,battle,{uid,nick},row);
      }
      for(const report of this.db.prepare('SELECT season,payload FROM season_battles WHERE guild=? AND squadron=?').all(guild,squad)){
        const battle=JSON.parse(report.payload),row=battle.players.find(p=>p.nickname.toLowerCase()===nick);
        if(row)this.applySeasonPlayer(guild,battle,report.season,{uid,nick},row);
      }
      this.db.exec('COMMIT');return {added:!current,player:current??{uid,nick,label},backfilled};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  // Current squadron roster from the official site. Members are added to the
  // statistics list right away; former members keep rows only if they have battles.
  setRoster(guild,name,nicks){
    if(this.squad(guild)!==name)return 0;
    const clean=new Map();
    for(const value of nicks??[]){const label=String(value??'').trim();if(label&&label.length<=100&&!/[\u0000-\u001f\u007f]/.test(label))clean.set(label.toLowerCase(),label);}
    if(!clean.size)return 0;
    let added=0;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM squad_roster WHERE guild=? AND squadron=?').run(guild,name);
      const roster=this.db.prepare('INSERT OR IGNORE INTO squad_roster VALUES(?,?,?,?)');
      const player=this.db.prepare('INSERT OR IGNORE INTO tracked_players(guild,squadron,uid,nick,label) VALUES(?,?,?,?,?)');
      for(const [nick,label] of clean){roster.run(guild,name,nick,label);added+=player.run(guild,name,'wt:'+nick,nick,label).changes;}
      this.db.prepare(`DELETE FROM tracked_players WHERE guild=? AND squadron=? AND uid LIKE 'wt:%'
        AND nick NOT IN (SELECT nick FROM squad_roster WHERE guild=? AND squadron=?)
        AND NOT EXISTS (SELECT 1 FROM season_player_battles b WHERE b.guild=tracked_players.guild AND b.squadron=tracked_players.squadron AND b.uid=tracked_players.uid)
        AND NOT EXISTS (SELECT 1 FROM player_battles b WHERE b.guild=tracked_players.guild AND b.squadron=tracked_players.squadron AND b.uid=tracked_players.uid)`).run(guild,name,guild,name);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return added;
  }
  rosterCount(guild){return this.db.prepare('SELECT count(*) AS n FROM squad_roster WHERE guild=? AND squadron=?').get(guild,this.squad(guild)??'').n;}
  seasonBattleCount(guild,range){return this.db.prepare('SELECT count(*) AS n FROM season_battles WHERE guild=? AND squadron=? AND season=?').get(guild,this.squad(guild)??'',seasonWindow(range).id).n;}
  removePlayer(guild,uid){return this.db.prepare('DELETE FROM tracked_players WHERE guild=? AND squadron=? AND uid=?').run(guild,this.squad(guild)??'',uid).changes>0;}
  ensureBattlePlayers(guild,b){
    // WT nicknames are the stable identity available in public battle reports.
    // A later manual Discord link with the same nickname reuses this tracked row.
    const insert=this.db.prepare('INSERT OR IGNORE INTO tracked_players(guild,squadron,uid,nick,label) VALUES(?,?,?,?,?)');
    for(const row of b.players){
      const label=row.nickname.trim(),nick=label.toLowerCase();
      if(!label||label.length>100||/[\u0000-\u001f\u007f]/.test(label))continue;
      insert.run(guild,b.squadron,'wt:'+nick,nick,label);
    }
  }
  applyPlayer(guild,b,player,row){
    const entry=this.db.prepare('INSERT OR IGNORE INTO player_battles VALUES(?,?,?,?,?)').run(guild,b.squadron,b.id,player.uid,player.nick);
    if(!entry.changes)return 0;
    this.db.prepare(`INSERT INTO stats(guild,squadron,uid,nick,tanks,air,deaths,wins,losses,assists) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild,squadron,uid,nick) DO UPDATE SET assists=assists+excluded.assists,tanks=tanks+excluded.tanks,air=air+excluded.air,deaths=deaths+excluded.deaths,wins=wins+excluded.wins,losses=losses+excluded.losses`).run(guild,b.squadron,player.uid,player.nick,row.tankKills,row.airKills,row.deaths,+(b.result==='win'),+(b.result==='loss'),row.assists??0);
    return 1;
  }
  ingest(guild,b){
    validateBattle(b);const squad=this.squad(guild);
    b={...b,id:battleIds(b.id)[0],squadron:b.squadron.trim()};
    if(!squad || squad!==b.squadron.trim())throw Error('Полк отчёта не совпадает с /pb register.');
    let count=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.recordedBattle(guild,squad,b.id)){this.db.exec('ROLLBACK');return {duplicate:true,count:0};}
      const inserted=this.db.prepare('INSERT OR IGNORE INTO battles VALUES(?,?,?)').run(guild,squad,b.id);
      if(!inserted.changes){this.db.exec('ROLLBACK');return {duplicate:true,count:0};}
      this.db.prepare('INSERT INTO battle_reports VALUES(?,?,?,?)').run(guild,squad,b.id,JSON.stringify(b));
      this.ensureBattlePlayers(guild,b);
      const map=new Map(this.players(guild).map(p=>[p.nick,p]));
      for(const p of b.players){const m=map.get(p.nickname.toLowerCase());if(m)count+=this.applyPlayer(guild,b,m,p);}
      this.db.exec('COMMIT');return {duplicate:false,count};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  rows(guild){return this.db.prepare(`SELECT p.uid,p.label AS nick,COALESCE(s.tanks,0) AS tanks,COALESCE(s.air,0) AS air,COALESCE(s.deaths,0) AS deaths,COALESCE(s.wins,0) AS wins,COALESCE(s.losses,0) AS losses,COALESCE(s.assists,0) AS assists FROM tracked_players p LEFT JOIN stats s ON s.guild=p.guild AND s.squadron=p.squadron AND s.uid=p.uid AND s.nick=p.nick WHERE p.guild=? AND p.squadron=?`).all(guild,this.squad(guild)??'').map(p=>({...p,kd:p.deaths?(p.tanks+p.air)/p.deaths:(p.tanks+p.air?Infinity:0),wr:p.wins+p.losses?p.wins/(p.wins+p.losses)*100:0})).sort(byRank);}
  applySeasonPlayer(guild,b,season,player,row){
    if(!this.db.prepare('INSERT OR IGNORE INTO season_player_battles VALUES(?,?,?,?,?,?)').run(guild,b.squadron,season,b.id,player.uid,player.nick).changes)return 0;
    this.db.prepare('INSERT INTO season_stats(guild,squadron,season,uid,nick,tanks,air,deaths,wins,losses,assists) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guild,squadron,season,uid,nick) DO UPDATE SET assists=assists+excluded.assists,tanks=tanks+excluded.tanks,air=air+excluded.air,deaths=deaths+excluded.deaths,wins=wins+excluded.wins,losses=losses+excluded.losses').run(guild,b.squadron,season,player.uid,player.nick,row.tankKills,row.airKills,row.deaths,+(b.result==='win'),+(b.result==='loss'),row.assists??0);
    return 1;
  }
  seasonReport(guild,season,id){
    const row=this.db.prepare('SELECT payload FROM season_battles WHERE guild=? AND squadron=? AND season=? AND battle=?').get(guild,this.squad(guild)??'',season.id,battleIds(id)[0]);
    return row?JSON.parse(row.payload):null;
  }
  ingestSeason(guild,report,range){
    validateBattle(report);const season=seasonWindow(range),squad=this.squad(guild);
    if(!squad||report.squadron.trim()!==squad)throw Error('Полк отчёта не совпадает с привязкой.');
    if(!inSeason(report.playedAt,season))throw Error('Дата боя не входит в выбранный сезон.');
    let b={...report,id:battleIds(report.id)[0],squadron:squad},count=0;
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const existing=this.seasonReport(guild,season,b.id);if(existing)b=existing;
      this.db.prepare('INSERT OR IGNORE INTO season_battles VALUES(?,?,?,?,?,?)').run(guild,squad,season.id,b.id,b.playedAt,JSON.stringify(b));
      this.ensureBattlePlayers(guild,b);
      const map=new Map(this.players(guild).map(p=>[p.nick,p]));
      for(const row of b.players){const player=map.get(row.nickname.toLowerCase());if(player)count+=this.applySeasonPlayer(guild,b,season.id,player,row);}
      this.db.exec('COMMIT');return {count,duplicate:Boolean(existing)};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  seasonRows(guild,range){
    const season=seasonWindow(range);
    return this.db.prepare('SELECT p.uid,p.label AS nick,COALESCE(s.tanks,0) AS tanks,COALESCE(s.air,0) AS air,COALESCE(s.deaths,0) AS deaths,COALESCE(s.wins,0) AS wins,COALESCE(s.losses,0) AS losses,COALESCE(s.assists,0) AS assists FROM tracked_players p LEFT JOIN season_stats s ON s.guild=p.guild AND s.squadron=p.squadron AND s.uid=p.uid AND s.nick=p.nick AND s.season=? WHERE p.guild=? AND p.squadron=?').all(season.id,guild,this.squad(guild)??'').map(p=>({...p,kd:p.deaths?(p.tanks+p.air)/p.deaths:(p.tanks+p.air?Infinity:0),wr:p.wins+p.losses?p.wins/(p.wins+p.losses)*100:0})).sort(byRank);
  }
}
