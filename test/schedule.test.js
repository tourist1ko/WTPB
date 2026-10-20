import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSchedule, validateSchedule, currentRow, ScheduleService, SOURCES} from '../src/schedule.js';
import {command, handleInteraction} from '../src/command.js';

const seed = JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url), 'utf8'));
const shortDate = iso => `${iso.slice(8)}.${iso.slice(5,7)}`;
const rows = seed.rows.map((r,i) => `${i+1} неделя мах БР ${r.br.toFixed(1)} (${shortDate(r.start)} — ${shortDate(r.end)})`).join('<br>');
const ru = `<p>Сезон 01.09.2026 — 31.10.2026</p><p>${rows}</p>`;
const at = value => new Date(value);

test('Official RU and EN formats parse the whole season', () => {
  const parsed = parseSchedule(ru);
  assert.deepEqual(parsed.rows, seed.rows);
  const en = rows.replaceAll('БР','BR').replaceAll('неделя','week');
  assert.deepEqual(parseSchedule(en, 'Season Schedule for Squadron Battles (01.09 - 31.10.2026)').rows, seed.rows);
  assert.deepEqual(parseSchedule(ru.replaceAll('—','&mdash;').replace('6.0','6,0')).rows, seed.rows);
});

test('BR changes on the scheduled Moscow calendar date', () => {
  assert.equal(currentRow(seed,at('2026-10-19T20:59:59Z')).br,7);
  assert.equal(currentRow(seed,at('2026-10-19T21:00:00Z')).br,6);
  assert.equal(currentRow(seed,at('2026-10-26T21:00:00Z')).br,5);
  assert.equal(currentRow(seed,at('2026-10-31T21:00:00Z')),null);
  assert.equal(currentRow(seed,at('2026-08-01T12:00:00Z')),null);
});

test('Reject incomplete, invalid or overlapping schedules', () => {
  assert.throws(() => parseSchedule('BR 6.0 (20.10 — 26.10)'));
  assert.throws(() => parseSchedule(ru.replace('01.09 — 07.09','01.09 — 06.09')));
  assert.throws(() => parseSchedule(ru.replace('20.10 — 26.10','19.10 — 26.10')));
  assert.throws(() => parseSchedule(ru.replace('27.10 — 31.10','27.10 — 32.10')));
  assert.throws(() => validateSchedule({...seed,rows:seed.rows.slice(0,-1)}));
});

test('Cross-year seasons assign row years correctly', () => {
  const schedule = parseSchedule('Сезон 01.12.2026 — 31.01.2027\nБР 8.0 (01.12 — 31.12)\nБР 7.0 (01.01 — 31.01)');
  assert.equal(currentRow(schedule,at('2027-01-10T12:00:00Z')).br,7);
});

test('Live schedule replaces bundled BR and cache prevents repeated requests', async () => {
  let calls = 0;
  const service = new ScheduleService({now:()=>at('2026-10-20T12:00:00Z'),warn:()=>{},fetchImpl:async()=>{
    calls++;
    return {ok:true,json:async()=>({title:'Schedule',post_stream:{posts:[{post_number:1,cooked:ru.replace('6.0','6.7')}]}})};
  }});
  const [a,b] = await Promise.all([service.getBR(),service.getBR()]);
  assert.equal(a,'6.7');
  assert.equal(b,'6.7');
  assert.equal(await service.getBR(),'6.7');
  assert.equal(calls,1);
});

test('Source failures use only a date-valid fallback and throttle retries', async () => {
  let calls = 0;
  const service = new ScheduleService({now:()=>at('2026-10-20T12:00:00Z'),warn:()=>{},fetchImpl:async()=>{calls++;throw new Error('offline');}});
  assert.equal(await service.getBR(),'6.0');
  assert.equal(await service.getBR(),'6.0');
  assert.equal(calls,SOURCES.length);
  service.now = ()=>at('2026-11-01T12:00:00Z');
  assert.equal(await service.getBR(),null);
});

test('HTML fallback isolates first post from obsolete reply quotes', async () => {
  const service = new ScheduleService({now:()=>at('2026-10-20T12:00:00Z'),warn:()=>{},fetchImpl:async url=>{
    if (url.endsWith('.json')) return {ok:false,status:403};
    return {ok:true,text:async()=>`<title>Расписание</title><div itemprop="text">${ru}</div><div itemprop="text">${ru}</div>`};
  }});
  assert.equal(await service.getBR(),'6.0');
  assert.ok(service.lastSuccess);
});

test('Unexpected response and expired live season never fabricate BR', async () => {
  const service = new ScheduleService({now:()=>at('2026-11-01T12:00:00Z'),warn:()=>{},fetchImpl:async()=>({ok:true,json:async()=>({post_stream:{posts:[{post_number:1,cooked:ru}]}}),text:async()=>'<h1>Access denied</h1>'})});
  assert.equal(await service.getBR(),null);
});

test('The only command is /pb br and its response contains only current BR', async () => {
  assert.equal(command.name,'pb');
  assert.deepEqual(command.options.map(o=>o.name),['br']);
  const messages=[];
  const interaction={isChatInputCommand:()=>true,commandName:'pb',guildId:'123',options:{getSubcommand:()=> 'br'},deferReply:async()=>messages.push('deferred'),editReply:async text=>messages.push(text)};
  await handleInteraction(interaction,{getBR:async()=> '6.0'},'123');
  assert.deepEqual(messages,['deferred','БР 6.0']);
  messages.length=0;
  await handleInteraction({...interaction,guildId:'456'},{getBR:async()=>{throw Error('wrong server');}},'123');
  assert.deepEqual(messages,[]);
});
