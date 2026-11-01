import { TacticalSource, archiveTeam, SourceError } from './tactical-source.js';
import { lookupSquadron } from './squadron.js';
import { currentRow,moscowDay } from './schedule.js';
import { seasonWindow, inSeason, battleTime, fallbackSeason } from './season.js';
import { randomUUID } from 'node:crypto';

export function seasonProgress(job){
 if(!job)return 'Сбор боёв сезона ещё не запускался. Он стартует автоматически.';
 const state={running:job.phase==='scan'?(job.mode==='incremental'?'Проверка новых боёв…':'Поиск боёв сезона…'):'Загрузка отчётов боёв…',done:'Статистика обновлена.',partial:'Проверка завершена, часть отчётов пока недоступна. Повтор автоматически.',paused:'Сбор приостановлен. Повтор автоматически.'}[job.status]??'Подготовка…';
 const lines=[`Сезон ${job.season.label}`,state];
 if(job.phase==='scan')lines.push(`Просмотрено: ${job.scanned} / ${job.sourceTotal??'…'}`);
 else if(Number.isSafeInteger(job.sourceTotal))lines.push(`Боёв полка в архиве (все сезоны): ${job.sourceTotal}`);
 lines.push(`Найдено ПБ: ${job.total??0}`,`Обработано: ${job.done??0} / ${job.total??0}`,`Недоступно: ${job.failed??0}`);
 if(job.firstBattle)lines.push('Первый найденный бой: '+moscowDay(new Date(job.firstBattle)).split('-').reverse().join('.'));
 if(job.updatedAt)lines.push('Последнее обновление: '+new Date(job.updatedAt).toISOString().slice(0,16).replace('T',' ')+' UTC');
 if(job.error)lines.push(String(job.error).slice(0,300));
 return lines.join('\n');
}

export class SeasonUpdate {
 constructor({store,guildId,service,live,source=new TacticalSource(),getSeason,lookup=lookupSquadron,now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}){
  Object.assign(this,{store,guildId,service,live,source,lookup,now,pause,log});
  this.provider=getSeason??(()=>service.getSeason());this.listeners=new Set();this.stopped=false;
  store.db.exec('CREATE TABLE IF NOT EXISTS season_jobs(guild TEXT,squadron TEXT,season TEXT,payload TEXT NOT NULL,PRIMARY KEY(guild,squadron,season));CREATE TABLE IF NOT EXISTS season_items(guild TEXT,squadron TEXT,season TEXT,battle TEXT,row TEXT NOT NULL,state TEXT NOT NULL,error TEXT NOT NULL DEFAULT \'\',PRIMARY KEY(guild,squadron,season,battle))');
  if(!store.db.prepare('PRAGMA table_info(season_items)').all().some(c=>c.name==='discovered_run'))store.db.exec("ALTER TABLE season_items ADD COLUMN discovered_run TEXT NOT NULL DEFAULT ''");
 }
 async currentSeason(refresh=false){
  const cached=!refresh&&this.service?.schedules?.find(s=>currentRow(s,new Date(this.now())));
  let value=cached;
  if(!value){try{value=await this.provider();}catch{value=null;}}
  // No official schedule for today yet: use the regular two-month block.
  if(!value)return {...seasonWindow(fallbackSeason(this.now())),provisional:true};
  return seasonWindow(value);
 }
 async apply(battle){
  const season=await this.currentSeason();
  if(!inSeason(battle.playedAt,season))return;
  this.store.ingestSeason(this.guildId,battle,season);
 }
 // Background loop: checks the current season automatically, no command needed.
 auto(intervalMs=300000){
  if(this.autoTimer)return;
  void this.kick();
  this.autoTimer=setInterval(()=>void this.kick(),intervalMs);this.autoTimer.unref?.();
 }
 async kick(){
  if(this.stopped||this.promise||!this.store.binding(this.guildId))return;
  try{await this.syncRoster();await this.start();this.lastError='';}catch(error){this.lastError=String(error?.message??error);this.log('Сезон: '+this.lastError);}
 }
 markRoster(name){this.rosterFor=name;this.rosterAt=this.now();}
 async syncRoster(force=false){
  const binding=this.store.binding(this.guildId);if(!binding)return 0;
  const key=binding.squadron;
  if(!force&&this.rosterFor===key&&this.now()-this.rosterAt<6*3600000)return 0;
  this.rosterFor=key;this.rosterAt=this.now();
  try{
   const profile=await this.lookup(binding.squadron);
   if(this.store.squad(this.guildId)!==binding.squadron)return 0;
   if(profile.tag&&!binding.tag)this.store.setTag(this.guildId,binding.squadron,profile.tag);
   return this.store.setRoster(this.guildId,binding.squadron,profile.members??[]);
  }catch(error){this.rosterAt=this.now()-5*3600000;this.log('Состав полка: '+(error?.message??error));return 0;}
 }
 subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
 key(job){return [this.guildId,job.squadron,job.season.id];}
 saved(season){const row=this.store.db.prepare('SELECT payload FROM season_jobs WHERE guild=? AND squadron=? AND season=?').get(this.guildId,this.store.squad(this.guildId)??'',season.id);return row?JSON.parse(row.payload):null;}
 snapshot(job=this.job){
  if(!job)return null;
  const counts=this.store.db.prepare('SELECT state,count(*) AS n FROM season_items WHERE guild=? AND squadron=? AND season=? GROUP BY state').all(...this.key(job));
  const values=Object.fromEntries(counts.map(c=>[c.state,c.n]));
  return {...job,total:(values.pending??0)+(values.done??0)+(values.failed??0),done:values.done??0,failed:values.failed??0};
 }
 save(){this.job.updatedAt=this.now();this.store.db.prepare('INSERT INTO season_jobs VALUES(?,?,?,?) ON CONFLICT(guild,squadron,season) DO UPDATE SET payload=excluded.payload').run(...this.key(this.job),JSON.stringify(this.job));}
 emit(){this.save();const value=this.snapshot();for(const listener of this.listeners)Promise.resolve().then(()=>listener(value)).catch(()=>{});}
 same(job){const binding=this.store.binding(this.guildId);return !this.stopped&&binding?.squadron===job.squadron&&binding.tag===job.tag;}
 check(job){if(!this.same(job))throw Error('Привязка полка изменилась или бот остановлен. Прогон приостановлен.');}
 async start({full=false}={}){
  if(this.stopped)throw Error('Бот останавливается.');
  if(this.promise){if(!this.same(this.job))throw Error('Предыдущий прогон останавливается. Повтори команду.');return this.snapshot();}
  const season=await this.currentSeason(true);
  if(this.promise){if(!this.same(this.job))throw Error('Предыдущий прогон останавливается. Повтори команду.');return this.snapshot();}
  let binding=this.store.binding(this.guildId);if(!binding)throw Error('Сначала привяжи полк через /pb register.');
  if(!binding.tag){const profile=await this.lookup(binding.squadron);if(this.store.squad(this.guildId)!==binding.squadron)throw Error('Привязка полка изменилась.');this.store.setTag(this.guildId,binding.squadron,profile.tag);binding=this.store.binding(this.guildId);}
  if(!binding?.tag)throw Error('Не удалось определить тег полка.');
  // Recheck after asynchronous profile/season lookup: only one background task may run.
  if(this.promise)return this.snapshot();
  let job=this.saved(season);
  if(job?.retryAt>this.now()){this.job=job;return this.snapshot();}
  if(!job||full||job.tag!==binding.tag){
   job={season,squadron:binding.squadron,tag:binding.tag,status:'running',runId:randomUUID(),mode:'full',phase:'scan',cursor:0,scanned:0,sourceTotal:null,firstBattle:null,error:'',retryAt:0};
   this.store.db.prepare('DELETE FROM season_items WHERE guild=? AND squadron=? AND season=?').run(...this.key(job));
  }else if(job.status==='done'||job.status==='partial'){
   job={...job,status:'running',runId:randomUUID(),mode:'incremental',phase:'scan',cursor:0,scanned:0,sourceTotal:null,error:'',retryAt:0};
   this.store.db.prepare("UPDATE season_items SET state='pending',error='' WHERE guild=? AND squadron=? AND season=? AND state='failed'").run(...this.key(job));
  }else{
   job={...job,runId:job.runId??randomUUID(),status:'running',error:'',retryAt:0};
   this.store.db.prepare("UPDATE season_items SET state='pending',error='' WHERE guild=? AND squadron=? AND season=? AND state='failed'").run(...this.key(job));
  }
  this.job=job;this.emit();
  this.promise=this.run(job).finally(()=>{this.promise=null;});
  return this.snapshot();
 }
 async run(job){
  if(this.live)this.live.seasonUpdating=true;
  try{
   while(job.phase==='scan'){
    this.check(job);
    const data=await this.source.list(job.tag,job.cursor);this.check(job);
    job.sourceTotal=data.total;
    if(!data.items.length&&job.cursor<data.total)throw Error('Архив вернул пустую страницу до конца списка. Повтори прогон позже.');
    let knownPage=true,eligibleRows=0,older=0;
    for(const row of data.items){
     const time=battleTime(row.playedAtUtc);
     if(!Number.isFinite(time))continue;
     if(time<job.season.startMs)older++;
     if(typeof row.sessionId!=='string'||!/^[0-9a-f]{16}$/i.test(row.sessionId))continue;
     if(!inSeason(row.playedAtUtc,job.season)||time>this.now()+300000||row.difficulty!=='realistic'||!archiveTeam(row,job.tag))continue;
     eligibleRows++;
     const known=this.store.db.prepare('SELECT discovered_run FROM season_items WHERE guild=? AND squadron=? AND season=? AND battle=?').get(...this.key(job),row.sessionId.toLowerCase());
     if(!known||known.discovered_run===job.runId)knownPage=false;
     this.store.db.prepare("INSERT OR IGNORE INTO season_items(guild,squadron,season,battle,row,state,discovered_run) VALUES(?,?,?,?,?,'pending',?)").run(...this.key(job),row.sessionId.toLowerCase(),JSON.stringify(row),job.runId);
     if(!job.firstBattle||time<Date.parse(job.firstBattle))job.firstBattle=row.playedAtUtc;
    }
    job.scanned+=data.items.length;job.cursor+=20;
    // The archive lists newest first: a page made only of older battles ends the season.
    if(job.cursor>=data.total||!data.items.length||older===data.items.length||(job.mode==='incremental'&&eligibleRows>0&&knownPage))job.phase='process';
    this.emit();if(job.phase==='scan')await this.pause(1000);
   }
   let consecutiveErrors=0;
   while(true){
    this.check(job);
    const item=this.store.db.prepare("SELECT battle,row FROM season_items WHERE guild=? AND squadron=? AND season=? AND state='pending' ORDER BY battle LIMIT 1").get(...this.key(job));
    if(!item)break;
    const row=JSON.parse(item.row);
    try{
     let battle=this.store.seasonReport(this.guildId,job.season,item.battle);
     if(!battle){await this.pause(1000);this.check(job);battle=await this.source.battle(row,job.squadron,job.tag);this.check(job);}
     if(!battle)throw Error('Полный отчёт боя пока недоступен.');
     this.store.ingestSeason(this.guildId,battle,job.season);
     this.store.db.prepare("UPDATE season_items SET state='done',error='' WHERE guild=? AND squadron=? AND season=? AND battle=?").run(...this.key(job),item.battle);consecutiveErrors=0;
    }catch(error){
     if(!this.same(job)||error.retryMs>=300000)throw error;
     this.store.db.prepare("UPDATE season_items SET state='failed',error=? WHERE guild=? AND squadron=? AND season=? AND battle=?").run(String(error.message).slice(0,300),...this.key(job),item.battle);
     // One unavailable report must not block the rest of the season. Only
     // repeated network/HTTP errors pause the run (retried automatically).
     if(error instanceof SourceError&&++consecutiveErrors>=3)throw Error('Архив боёв временно недоступен. Повтор автоматически.');
    }
    this.emit();
   }
   job.status=this.snapshot().failed?'partial':'done';job.error='';this.emit();
  }catch(error){
   job.status='paused';job.error=String(error.message??error);job.retryAt=error.retryMs?this.now()+error.retryMs:0;
   if(this.live&&job.retryAt)this.live.nextPoll=Math.max(this.live.nextPoll??0,job.retryAt);
   this.emit();this.log('Сезон: '+job.error);
  }finally{if(this.live)this.live.seasonUpdating=false;}
 }
 async status(){
  const season=await this.currentSeason();
  const job=this.promise&&this.job?.season.id===season.id?this.snapshot():this.snapshot(this.saved(season));
  let text=seasonProgress(job);
  const reasons=job?this.store.db.prepare("SELECT error,count(*) AS n FROM season_items WHERE guild=? AND squadron=? AND season=? AND state='failed' GROUP BY error ORDER BY n DESC LIMIT 3").all(...this.key(job)):[];
  if(reasons.length)text+='\nПричины пропуска:\n'+reasons.map(r=>`· ${r.error} (${r.n})`).join('\n');
  if(this.lastError)text+='\nПоследняя ошибка: '+this.lastError.slice(0,200);
  return text;
 }
 stop(){this.stopped=true;this.listeners.clear();clearInterval(this.autoTimer);}
}
