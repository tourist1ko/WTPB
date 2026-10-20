import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function wtNick(name) {
  if (typeof name !== 'string') return null;
  const m = name.match(/^([^()]+?)\s+\(([^()]+)\)$/u);
  return m && m[1].trim() && m[2].trim() ? m[1].trim() : null;
}
export function memberMap(members) {
  const map = new Map();
  for (const m of members.values()) {
    if(m.user.bot) continue;
    const nick = wtNick(m.nickname);
    if(!nick) continue;
    const key=nick.toLowerCase();
    map.set(key, map.has(key) ? null : {id:m.id,nick});
  }
  return map;
}
export function validateBattle(b) {
  if(!b || typeof b.id!=='string' || !/^[\w-]{1,100}$/.test(b.id) || b.mode!=='squadron_realistic' || typeof b.squadron!=='string' || !b.squadron.trim() || !['win','loss'].includes(b.result) || !Array.isArray(b.players) || b.players.length<1 || b.players.length>8) throw Error('Неверный отчёт ПБ. См. examples/battle.json.');
  const seen=new Set();
  for(const p of b.players) {
    if(typeof p.nickname!=='string' || !p.nickname.trim() || seen.has(p.nickname.toLowerCase())) throw Error('Неверные или повторные ники в отчёте.');
    seen.add(p.nickname.toLowerCase());
    for(const k of ['tankKills','airKills','deaths']) if(!Number.isSafeInteger(p[k]) || p[k]<0 || p[k]>100) throw Error('Неверное значение '+k);
  }
  return b;
}
export class RatingStore {
  constructor(path) {
    mkdirSync(dirname(path),{recursive:true}); this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS guilds(guild TEXT PRIMARY KEY,squadron TEXT NOT NULL); CREATE TABLE IF NOT EXISTS battles(guild TEXT,squadron TEXT,battle TEXT,PRIMARY KEY(guild,squadron,battle)); CREATE TABLE IF NOT EXISTS stats(guild TEXT,squadron TEXT,uid TEXT,nick TEXT,tanks INTEGER DEFAULT 0,air INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,losses INTEGER DEFAULT 0,PRIMARY KEY(guild,squadron,uid,nick));`);
  }
  squad(guild){return this.db.prepare('SELECT squadron FROM guilds WHERE guild=?').get(guild)?.squadron;}
  register(guild,name){name=name.trim();if(!name || name.length>100) throw Error('Укажи название полка до 100 символов.');const saved=this.db.prepare('INSERT OR IGNORE INTO guilds VALUES(?,?)').run(guild,name);if(!saved.changes)throw Error('Уже привязан полк: '+this.squad(guild)+'. Сначала выполни /pb unregister.');}
  unregister(guild){this.db.prepare('DELETE FROM guilds WHERE guild=?').run(guild);}
  ingest(guild,b,members){
    validateBattle(b);const squad=this.squad(guild);
    if(!squad || squad!==b.squadron.trim())throw Error('Полк отчёта не совпадает с /pb register.');
    const map=memberMap(members);let count=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted=this.db.prepare('INSERT OR IGNORE INTO battles VALUES(?,?,?)').run(guild,squad,b.id);
      if(!inserted.changes){this.db.exec('ROLLBACK');return {duplicate:true,count:0};}
      for(const p of b.players){const m=map.get(p.nickname.toLowerCase());if(!m)continue;
        this.db.prepare(`INSERT INTO stats VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(guild,squadron,uid,nick) DO UPDATE SET tanks=tanks+excluded.tanks,air=air+excluded.air,deaths=deaths+excluded.deaths,wins=wins+excluded.wins,losses=losses+excluded.losses`).run(guild,squad,m.id,m.nick.toLowerCase(),p.tankKills,p.airKills,p.deaths,+(b.result==='win'),+(b.result==='loss'));count++;
      }
      this.db.exec('COMMIT');return {duplicate:false,count};
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  rows(guild,members){const map=memberMap(members);return this.db.prepare('SELECT * FROM stats WHERE guild=? AND squadron=?').all(guild,this.squad(guild)??'').filter(p=>map.get(p.nick)?.id===p.uid).map(p=>({...p,nick:map.get(p.nick).nick,kd:p.deaths?(p.tanks+p.air)/p.deaths:(p.tanks+p.air?Infinity:0),wr:p.wins/(p.wins+p.losses)*100})).sort((a,b)=>b.kd-a.kd||b.wr-a.wr||a.nick.localeCompare(b.nick));}
}
