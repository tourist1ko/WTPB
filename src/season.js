const DAY=86400000;
const short=date=>date.split('-').reverse().join('.');
export function seasonWindow(value){
 const {start,end}=value??{};
 for(const date of [start,end])if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw Error('Не удалось определить даты сезона.');
 const startMs=Date.parse(start+'T00:00:00+03:00'),endMs=Date.parse(end+'T00:00:00+03:00')+DAY;
 if(endMs<=startMs||endMs-startMs>101*DAY)throw Error('Неверные границы сезона.');
 return {id:start+'_'+end,start,end,startMs,endMs,label:short(start)+' - '+short(end)};
}
export function battleTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const date=value.slice(0,10),time=Date.parse(value);
 if(!Number.isFinite(time)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return NaN;
 return time;
}
export function inSeason(playedAt,season){const time=battleTime(playedAt);return Number.isFinite(time)&&time>=season.startMs&&time<season.endMs;}
// Used only when the official schedule for today is not available yet (for
// example right after a season change). Squadron seasons run in two-month
// blocks starting in odd months (Sep–Oct, Nov–Dec, ...). Marked provisional.
export function fallbackSeason(now=Date.now()){
 const day=new Date(now+3*3600000);
 const year=day.getUTCFullYear(),month=day.getUTCMonth()+1;
 const first=month%2?month:month-1;
 const pad=n=>String(n).padStart(2,'0');
 const last=new Date(Date.UTC(year,first+1,0)).getUTCDate();
 return {start:`${year}-${pad(first)}-01`,end:`${year}-${pad(first+1)}-${pad(last)}`,provisional:true};
}
