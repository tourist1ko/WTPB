const NOT_FOUND='Полк с таким названием не найден. Укажи полное название полка из игры, а не тег.';
const UNAVAILABLE='Не удалось проверить полк: сайт War Thunder недоступен. Попробуй позже.';
export class SquadronLookupError extends Error {
  constructor(code,message){super(message);this.name='SquadronLookupError';this.code=code;}
}
const unavailable=()=>new SquadronLookupError('SOURCE_UNAVAILABLE',UNAVAILABLE);
const notFound=()=>new SquadronLookupError('NOT_FOUND',NOT_FOUND);
const normalize=s=>s.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
function decode(s){
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,value)=>{
    if(value.startsWith('#')){const n=value[1].toLowerCase()==='x'?parseInt(value.slice(2),16):parseInt(value.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):whole;}
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[value.toLowerCase()]??whole;
  });
}
export function parseSquadronProfile(html,requested){
  const title=html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bsquadrons-info__title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  // A generic HTTP 200 page or a verification screen is not a valid squadron.
  if(!title || !html.includes('squadrons-info__meta-item'))throw unavailable();
  const display=decode(title.replace(/<[^>]*>/g,'')).trim().replace(/\s+/gu,' ');
  const match=display.match(/^\[([\s\S]+?)\]\s+(.+)$/u);
  if(!match)throw unavailable();
  const name=match[2].trim();
  if(normalize(name)!==normalize(requested))throw notFound();
  return {name,tag:match[1]};
}
export async function lookupSquadron(input,{fetchImpl=fetch}={}){
  const requested=input.trim().replace(/\s+/gu,' ');
  if(!requested || requested.length>100 || /[\x00-\x1f\x7f]/u.test(requested))throw new SquadronLookupError('INVALID_NAME','Укажи полное название полка до 100 символов.');
  const url=`https://warthunder.com/en/community/claninfo/${encodeURIComponent(requested)}`;
  try{
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':'PB-Rank/1.1 (Discord squadron lookup)','Accept':'text/html'},redirect:'follow'});
    if(response.url){const final=new URL(response.url);if(!['warthunder.com','warthunder.ru'].includes(final.hostname)||final.protocol!=='https:')throw unavailable();}
    if(response.status===404)throw notFound();
    if(!response.ok)throw unavailable();
    const html=await response.text();
    if(html.length>3_000_000)throw unavailable();
    const profile=parseSquadronProfile(html,requested);
    return {...profile,url:`https://warthunder.com/en/community/claninfo/${encodeURIComponent(profile.name)}`};
  }catch(error){if(error instanceof SquadronLookupError)throw error;throw unavailable();}
}
