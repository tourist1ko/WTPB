import protobuf from 'protobufjs';
import { zstdDecompressSync } from 'node:zlib';
import { validateBattle } from './rating.js';

// Wire-compatible subset of https://wtapi.dev/schemas/v3/replay.proto.
// Heavy replay sections are deliberately skipped by the protobuf decoder.
const schema = protobuf.parse(`syntax="proto3";
message Envelope { uint32 schema_version=1; string kind=2; bytes body=3; }
message Replay { LightReplay light=1; }
message LightReplay {
 string id=1; string type=2; uint32 start_ts=5; uint32 end_ts=6;
 string difficulty=10; bool draw=12; uint32 winner_team=13; uint32 loser_team=14;
 string winner_tag=15; string loser_tag=16; string status=18; repeated Player players=23;
}
message Player {
 string uid=2; string name=3; string tag=4; uint32 team=5;
 uint32 air_kills=7; uint32 ground_kills=8; uint32 deaths=10;
}`, { keepCase:true }).root;
export const wireTypes = Object.fromEntries(['Envelope','Replay','LightReplay'].map(n=>[n,schema.lookupType(n)]));
const MAX_BYTES=64*1024*1024;
export function decodeReplay(bytes) {
 if(bytes.length>MAX_BYTES)throw Error('WTApi: сообщение превышает 64 МБ.');
 const raw=zstdDecompressSync(bytes,{maxOutputLength:MAX_BYTES});
 const envelope=wireTypes.Envelope.decode(raw);
 if(envelope.schema_version!==3)throw Error(`WTApi: неподдерживаемая схема ${envelope.schema_version}. Требуется обновление бота.`);
 if(!['light','full'].includes(envelope.kind))throw Error('WTApi: неизвестный тип сообщения.');
 const type=wireTypes[envelope.kind==='full'?'Replay':'LightReplay'];
 const data=type.toObject(type.decode(envelope.body),{defaults:true});
 return envelope.kind==='full'?data.light:data;
}
export function normalizeTag(tag) {
 if(typeof tag!=='string')return '';
 tag=tag.normalize('NFC').trim();
 if(tag.startsWith('[')&&tag.endsWith(']'))tag=tag.slice(1,-1).trim();
 return tag.toLowerCase();
}
// Tag without in-game decorations: "┾105HP┿", "[105HP]" and "105HP" share core "105hp".
export function coreTag(tag) {
 if(typeof tag!=='string')return '';
 return tag.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
}
// Exact match first; decoration-insensitive match as fallback.
export function sameTag(a,b) {
 const x=normalizeTag(a),y=normalizeTag(b);
 if(!x||!y)return false;
 return x===y||(coreTag(a)!==''&&coreTag(a)===coreTag(b));
}
export function battleForSquad(replay,name,tag) {
 const expected=normalizeTag(tag);
 if(!expected || !coreTag(tag) || !replay || replay.type!=='sqb' || replay.difficulty!=='realistic' || replay.status!=='completed')return null;
 if(replay.draw)return null;
 const winner=replay.winner_team,loser=replay.loser_team;
 if(![1,2].includes(winner)||![1,2].includes(loser)||winner===loser)throw Error('WTApi: не указан достоверный победитель.');
 if(!Number.isSafeInteger(replay.end_ts)||replay.end_ts<=0)throw Error('WTApi: нет времени завершения боя.');
 const teams=new Set();
 if(sameTag(replay.winner_tag,tag))teams.add(winner);
 if(sameTag(replay.loser_tag,tag))teams.add(loser);
 for(const p of replay.players??[])if(sameTag(p.tag,tag))teams.add(p.team);
 if(!teams.size)return null;
 if(teams.size!==1||![1,2].includes([...teams][0]))throw Error('WTApi: неоднозначная сторона полка.');
 const team=[...teams][0];
 const players=(replay.players??[]).filter(p=>p.team===team);
 if(players.some(p=>p.tag && p.tag!==String(team) && !sameTag(p.tag,tag)))throw Error('WTApi: состав содержит другой полк.');
 return validateBattle({id:replay.id,mode:'squadron_realistic',squadron:name,playedAt:new Date((replay.start_ts||replay.end_ts)*1000).toISOString(),result:team===winner?'win':'loss',players:players.map(p=>({nickname:p.name,tankKills:p.ground_kills,airKills:p.air_kills,deaths:p.deaths}))});
}
