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
// Title is "<tag> <full name>". The tag may be "[ABC]", "[[_QZ_]]" or decorated
// like "┾105HP┿". Split by the requested full name instead of guessing tag shape,
// so a decorated tag is never treated as part of another squadron's name.
export function parseSquadronTitle(display,requested){
  const want=normalize(requested);
  for(let i=0;i<display.length;i++){
    if(!/\s/u.test(display[i]))continue;
    const name=display.slice(i+1).trim(),tag=display.slice(0,i).trim();
    if(tag&&name&&normalize(name)===want)return {name,tag:tag.replace(/^\[([\s\S]+)\]$/u,'$1')};
  }
  return null;
}
export function parseSquadronMembers(html){
  const members=new Map();
  for(const m of html.matchAll(/href\s*=\s*["'][^"']*userinfo\/?\?nick=([^"'&#]+)/gi)){
    let nick;
    try{nick=decodeURIComponent(decode(m[1]).replace(/\+/g,' ')).trim();}catch{continue;}
    if(nick&&nick.length<=64&&!/[\x00-\x1f\x7f]/u.test(nick)&&!members.has(nick.toLowerCase()))members.set(nick.toLowerCase(),nick);
    if(members.size>=256)break;
  }
  return [...members.values()];
}
export function parseSquadronProfile(html,requested){
  const title=html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bsquadrons-info__title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  // A generic HTTP 200 page or a verification screen is not a valid squadron.
  if(!title || !html.includes('squadrons-info__meta-item'))throw unavailable();
  const display=decode(title.replace(/<[^>]*>/g,'')).trim().replace(/\s+/gu,' ');
  if(!/\s/u.test(display))throw unavailable();
  const parsed=parseSquadronTitle(display,requested);
  if(!parsed)throw notFound();
  return {...parsed,members:parseSquadronMembers(html)};
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
