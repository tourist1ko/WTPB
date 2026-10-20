import test from 'node:test';
import assert from 'node:assert/strict';
import { MemberRoster, retryDelay } from '../src/members.js';

test('parallel commands and collectors share one full request and cache until expiration',async()=>{
 let now=0,calls=0,finish;
 const roster=new MemberRoster({now:()=>now,pause:async ms=>{now+=ms;}});
 const guild={members:{fetch:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}};
 const first=roster.get(guild);const concurrent=Array.from({length:20},()=>roster.get(guild));
 assert.ok(concurrent.every(p=>p===first));assert.equal(calls,1);
 finish(new Map([['a',{id:'a',nickname:'Alpha (A)'}]]));const cached=await first;
 assert.ok((await Promise.all(concurrent)).every(r=>r===cached));await roster.get(guild);assert.equal(calls,1);
 now=600001;const refreshed=roster.get(guild);assert.equal(calls,2);finish(new Map());assert.equal((await refreshed).size,0);
});
test('member joins, nick changes and removals update a complete roster without fetching',async()=>{
 let calls=0;const roster=new MemberRoster();const guild={members:{fetch:async()=>{calls++;return new Map([['a',{id:'a',nickname:'Alpha (A)'}]]);}}};
 await roster.get(guild);
 roster.change({id:'a',guild,nickname:'Renamed (A)'});roster.change({id:'b',guild,nickname:'Beta (B)'});
 const current=await roster.get(guild);assert.equal(current.get('a').nickname,'Renamed (A)');assert.equal(current.size,2);
 roster.change({id:'a',guild},true);assert.equal((await roster.get(guild)).has('a'),false);assert.equal(calls,1);
});
test('member events received during a chunked request override its stale results',async()=>{
 let finish;const roster=new MemberRoster();const guild={members:{fetch:()=>new Promise(resolve=>{finish=resolve;})}};
 const pending=roster.get(guild);roster.change({id:'a',guild},true);roster.change({id:'b',guild,nickname:'New (B)'});
 finish(new Map([['a',{id:'a',nickname:'Old (A)'}]]));const result=await pending;
 assert.equal(result.has('a'),false);assert.equal(result.get('b').nickname,'New (B)');
});
test('opcode 8 retry_after is seconds, concurrent callers share the automatic retry',async()=>{
 let now=0,calls=0;const waits=[],sent=[];
 const roster=new MemberRoster({now:()=>now,gap:0,pause:async ms=>{waits.push(ms);now+=ms;}});
 const guild={members:{fetch:async()=>{sent.push(now);if(++calls===1)throw {data:{opcode:8,retry_after:21.338},message:'request with opcode 8 was rate limited. Retry after 21.338 seconds'};return new Map();}}};
 const first=roster.get(guild);assert.equal(roster.get(guild),first);await first;
 assert.equal(calls,2);assert.deepEqual(waits,[21588]);assert.equal(sent[1],21588);
 assert.equal(retryDelay(Error('request with opcode 8 was rate limited. Retry after 21.338 seconds')),21338);
 assert.equal(retryDelay(Error('unrelated error')),null);
});
test('repeated rate limits retain cooldown and retries stay bounded',async()=>{
 let now=0,calls=0;const sent=[];
 const roster=new MemberRoster({now:()=>now,gap:0,pause:async ms=>{now+=ms;}});
 const guild={members:{fetch:async()=>{sent.push(now);if(++calls<=2)throw {data:{opcode:8,retry_after:5}};return new Map();}}};
 await assert.rejects(roster.get(guild),/Повтор через 6 сек/);assert.equal(calls,2);
 await roster.get(guild);assert.equal(calls,3);assert.deepEqual(sent,[0,5250,10500]);
});
test('connection changes invalidate membership and never authorize a partial stale snapshot',async()=>{
 let now=0,calls=0,finish;const roster=new MemberRoster({now:()=>now,gap:0,pause:async ms=>{now+=ms;}});
 const guild={members:{fetch:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}}};
 const first=roster.get(guild);roster.invalidate(guild);finish(new Map([['left',{id:'left'}]]));
 await assert.rejects(first,/Соединение Discord изменилось/);
 const next=roster.get(guild);finish(new Map());assert.equal((await next).size,0);assert.equal(calls,2);
});
