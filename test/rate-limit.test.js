import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import { RequestLimiter,enforceRateLimit } from '../src/rate-limit.js';

test('10 requests are allowed in any sliding minute, rejected retries do not extend it',()=>{
 let now=0;const limiter=new RequestLimiter({now:()=>now});
 for(let i=0;i<10;i++){now=i*1000;assert.equal(limiter.take('a').allowed,true);}
 now=50000;assert.deepEqual(limiter.take('a'),{allowed:false,retryAfterMs:10000});
 now=59999;assert.deepEqual(limiter.take('a'),{allowed:false,retryAfterMs:1});
 now=60000;assert.equal(limiter.take('a').allowed,true);assert.deepEqual(limiter.take('a'),{allowed:false,retryAfterMs:1000});
 now=61000;assert.equal(limiter.take('a').allowed,true);
});
test('another user has a separate budget and expired users are cleaned up',()=>{
 let now=0;const limiter=new RequestLimiter({now:()=>now});
 for(let i=0;i<10;i++)limiter.take('first');assert.equal(limiter.take('first').allowed,false);
 assert.equal(limiter.take('second').allowed,true);now=60000;assert.equal(limiter.take('third').allowed,true);
 assert.equal(limiter.entries.size,1);
});
function interaction({user='1',command='pb',button=false,guild='g',autocomplete=false}={}){
 const replies=[];return {replies,guildId:guild,user:{id:user},commandName:command,customId:button?'pbrank:page':'',
 isChatInputCommand:()=>!button&&!autocomplete,isButton:()=>button,isAutocomplete:()=>autocomplete,reply:async value=>replies.push(value)};
}
test('commands and page buttons share a budget, the limit reply is private and unrounded fractions never allow early retry',async()=>{
 let now=0;const limiter=new RequestLimiter({now:()=>now});
 for(let n=0;n<10;n++)assert.equal(await enforceRateLimit(interaction({command:n<5?'pb':'rank',button:n>=8}),'g',limiter),false);
 now=59001;const denied=interaction({command:'rank'});assert.equal(await enforceRateLimit(denied,'g',limiter),true);
 assert.match(denied.replies[0].content,/ещё 1 сек/);assert.equal(denied.replies[0].flags,MessageFlags.Ephemeral);
 assert.deepEqual(denied.replies[0].allowedMentions,{parse:[]});
 assert.equal(await enforceRateLimit(interaction({user:'2'}),'g',limiter),false);
});
test('concurrent requests cannot exceed the limit',async()=>{
 const limiter=new RequestLimiter({now:()=>0});
 const results=await Promise.all(Array.from({length:30},()=>enforceRateLimit(interaction(),'g',limiter)));
 assert.equal(results.filter(blocked=>!blocked).length,10);assert.equal(results.filter(Boolean).length,20);
});
test('autocomplete and unrelated interactions do not consume command capacity',async()=>{
 const limiter=new RequestLimiter({now:()=>0});
 for(let n=0;n<20;n++){
  assert.equal(await enforceRateLimit(interaction({autocomplete:true}),'g',limiter),false);
  assert.equal(await enforceRateLimit(interaction({guild:'other'}),'g',limiter),false);
  assert.equal(await enforceRateLimit(interaction({command:'unrelated'}),'g',limiter),false);
 }
 for(let n=0;n<10;n++)assert.equal(await enforceRateLimit(interaction(),'g',limiter),false);
 assert.equal(await enforceRateLimit(interaction(),'g',limiter),true);
});
