import { DiscordSDK } from '@discord/embedded-app-sdk';

const $ = id => document.getElementById(id);
const qs = s => document.querySelector(s);
const qsa = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const proxy = new URLSearchParams(location.search).has('frame_id') ? '/.proxy' : '';

let sdk, socket, ticket, selfId='', selfName='', selfAvatar='', state=null, allBR=[], allMaps=[], mapImg={};
let currentMatch=null, animationNonce=0, rosterTimer=null, reconnectTimer=null, isLeader=false, dismissedMatchId='';
let clockOffset=0, syncBestRtt=Infinity, syncTimer=null;
let settings={teams:true,mode:true,br:true,allowed_br:[],squads:2};
let drawerPanel='';

function status(t){ console.debug('[JASAQ]',t); }
function phase(){}
function showError(t){ $('error').textContent=t; $('error').classList.remove('hidden'); clearTimeout(showError.t); showError.t=setTimeout(()=>$('error').classList.add('hidden'),4500); }
function avatarURL(user){ if(!user?.id||!user?.avatar) return ''; return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`; }
const AVATAR_SVG='<svg viewBox="0 0 40 40"><use href="#i-avatar" width="40" height="40"/></svg>';
function playerAvatar(p){ return `<span class="ava">${AVATAR_SVG}${p?.avatar?`<img src="${esc(p.avatar)}" alt="" loading="lazy">`:''}</span>`; }
document.addEventListener('error',e=>{ const t=e.target; if(t?.tagName==='IMG'&&(t.parentElement?.classList.contains('ava')||t.parentElement?.classList.contains('map-thumb')||t.classList.contains('map-img'))) t.remove(); },true);
const icon=(id,cls='')=>`<svg class="ic ${cls}"><use href="#${id}"/></svg>`;
const squadName=i=>`${i+1}-жасақ`;
function planSquads(plan){ if(plan?.squads?.length) return plan.squads; const out=[]; if(plan?.team_a?.length) out.push(plan.team_a); if(plan?.team_b?.length) out.push(plan.team_b); return out; }
function pcard(p){ return `<div class="pcard">${playerAvatar(p)}<div class="pcard-text"><div class="pcard-name">${esc(p.name)}</div></div></div>`; }
async function api(path, body){ const r=await fetch(proxy+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); let d={}; try{d=await r.json()}catch{} if(!r.ok) throw Error(d.error||`HTTP ${r.status}`); return d; }
function send(obj){ if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify(obj)); }

function connect(){
  clearTimeout(reconnectTimer); if(!ticket) return;
  const scheme=location.protocol==='https:'?'wss:':'ws:';
  socket=new WebSocket(`${scheme}//${location.host}${proxy}/ws?ticket=${encodeURIComponent(ticket)}`);
  socket.onopen=()=>{ status('Қосылды'); startClockSync(); };
  socket.onclose=()=>{ status('Байланыс үзілді'); clearInterval(syncTimer); reconnectTimer=setTimeout(connect,2200); };
  socket.onerror=()=>status('Қосылу қатесі');
  socket.onmessage=e=>{ try{ handle(JSON.parse(e.data)); }catch(err){ console.error(err); } };
}

function handle(m){
  if(m.type==='time_sync'){ applyClockSync(m); return; }
  if(m.type==='state') renderState(m);
  if(m.type==='match_start') beginMatch(m.match,m.at);
  if(m.type==='skip'){
    if(!currentMatch || !m.match || currentMatch.id===m.match.id){ currentMatch=m.match||currentMatch; forceResult(); }
  }
  if(m.type==='error') showError(m.error==='players'?'Кемінде 2 ойыншы қажет':m.error==='busy'?'Іріктеу жүріп жатыр':m.error==='offline'?'Бұл ойыншы JASAQ-ты ашпаған, лидерлікті бере алмайсыз':m.error);
}

function startClockSync(){
  clearInterval(syncTimer); syncBestRtt=Infinity;
  const ping=()=>send({type:'time_sync',client_at:Date.now()});
  ping(); setTimeout(ping,140); setTimeout(ping,320); setTimeout(ping,620);
  syncTimer=setInterval(ping,10000);
}
function applyClockSync(m){
  if(!m.client_at||!m.server_at) return;
  const now=Date.now(); const rtt=Math.max(0,now-m.client_at);
  const offset=m.server_at-((m.client_at+now)/2);
  if(rtt<syncBestRtt){ syncBestRtt=rtt; clockOffset=offset; }
}
function serverNow(){ return Date.now()+clockOffset; }

function renderState(m){
  const oldMatchId=state?.match?.id;
  state=m; settings={squads:2,...settings,...(m.settings||{})}; currentMatch=m.match||currentMatch;
  isLeader=!!selfId && m.leader_id===selfId;
  $('role').textContent=isLeader?'Лидер':'Көрермен';
  const locked=!!m.busy;
  const enough=(m.players?.length||0)>=2;
  const anyOn=settings.teams||settings.br||settings.mode;
  $('start').disabled=!isLeader||locked||!enough||!anyOn;
  $('again').disabled=!isLeader||locked||!enough||!anyOn;
  $('busyShade').classList.toggle('hidden',!locked);
  if(locked){ $('result').classList.add('hidden'); closeDrawer(); }
  qsa('.action').forEach(b=>{ const on=!!settings[b.dataset.key]; b.classList.toggle('active',on); b.setAttribute('aria-pressed',on); b.disabled=!isLeader||locked; });
  qsa('.gear').forEach(g=>g.disabled=locked);
  renderSummaries(); renderDrawer(); renderPlayers(m.players||[],m.leader_id); renderReserve(m.reserve||[]);
  if(isLeader) scheduleRoster(); else stopRoster();
  if(!locked && m.match && $('animation').classList.contains('hidden') && currentMatch?.id===m.match.id && dismissedMatchId!==m.match.id){ showResult(m.match); }
  if(oldMatchId && m.match?.id && oldMatchId!==m.match.id) $('result').classList.add('hidden');
}

function sortedMaps(){ const set=new Set(settings.maps||allMaps); return allMaps.filter(v=>set.has(v)); }
function sortedAllowed(){ const set=new Set(settings.allowed_br||[]); return allBR.filter(v=>set.has(v)); }
function renderSummaries(){
  const n=settings.squads||2; $('subTeams').textContent=`${n} жасақ`;
  const al=sortedAllowed();
  $('subBR').textContent=!al.length?'BR —':al.length===allBR.length?`BR ${allBR[0]} – ${allBR[allBR.length-1]}`:al.length===1?`BR ${al[0]}`:`BR ${al[0]} – ${al[al.length-1]} · ${al.length}`;
  const mp=sortedMaps(); $('subMaps').textContent=!allMaps.length||mp.length===allMaps.length?'Барлық карта':mp.length===1?mp[0]:`${mp.length} карта`;
}

function playerRow(p,tools){ return `<div class="player" data-id="${esc(p.id)}">${playerAvatar(p)}<div class="player-info"><div class="player-name">${esc(p.name)}${p.id===state?.leader_id?icon('i-lead','lead-mark'):''}</div><small>${p.id===state?.leader_id?'Лидер':p.id===selfId?'Сіз':'Дауыс арнасы'}</small></div>${tools?`<div class="player-tools">${tools}</div>`:''}</div>`; }
function renderPlayers(players,leaderId){
  $('count').textContent=players.length;
  const online=new Set((state?.online||[]).map(p=>p.id));
  const ordered=[...players].sort((a,b)=>(b.id===leaderId)-(a.id===leaderId));
  const edit=canEdit();
  const html=ordered.length?ordered.map(p=>{
    if(!edit) return playerRow(p,'');
    let tools='';
    if(p.id!==leaderId && online.has(p.id)) tools+=`<button class="tool-btn" data-act="transfer" title="Лидерлікті беру" aria-label="Лидерлікті беру">${icon('i-lead')}</button>`;
    tools+=`<button class="tool-btn danger" data-act="exclude" title="Резервке шығару" aria-label="Резервке шығару">${icon('i-close')}</button>`;
    return playerRow(p,tools);
  }).join(''):'<div class="players-empty">Тізімде ойыншы жоқ</div>';
  if($('players').dataset.html!==html){ $('players').dataset.html=html; $('players').innerHTML=html; }
}
function renderReserve(list){
  $('reserveCount').textContent=list.length;
  const edit=canEdit();
  const html=list.length?list.map(p=>playerRow(p,edit?`<button class="tool-btn" data-act="include" title="Тізімге қайтару" aria-label="Тізімге қайтару">${icon('i-chevron','ic-up')}</button>`:'')).join(''):'<div class="reserve-empty">Резерв бос</div>';
  if($('reserveList').dataset.html!==html){ $('reserveList').dataset.html=html; $('reserveList').innerHTML=html; }
}
function playerAction(e){
  const b=e.target.closest('.tool-btn'); if(!b||!canEdit()) return;
  const id=b.closest('.player')?.dataset.id; if(!id) return;
  send({type:b.dataset.act,target_id:id});
}
$('players').onclick=playerAction; $('reserveList').onclick=playerAction;
$('reserveBtn').onclick=()=>{ const open=$('reserveList').classList.toggle('hidden')===false; $('reserveBtn').setAttribute('aria-expanded',open); };

let demoRoster=null;
async function readVoiceRoster(){
  if(demoRoster){ const ids=new Set(demoRoster.map(p=>p.id)); return [...demoRoster,...(state?.online||[]).filter(p=>!ids.has(p.id))]; }
  if(!sdk?.channelId) return state?.players||[];
  try{
    const ch=await sdk.commands.getChannel({channel_id:sdk.channelId});
    return (ch.voice_states||[]).filter(v=>!v.user?.bot).map(v=>({id:v.user.id,name:v.nick||v.user.global_name||v.user.username||'Player',avatar:avatarURL(v.user)}));
  }catch(e){ console.warn('getChannel',e); return state?.players||[]; }
}
function stopRoster(){ lastRoster=''; if(rosterTimer){clearInterval(rosterTimer);rosterTimer=null;} }
let lastRoster='';
async function pushRoster(){ if(!isLeader) return; const players=await readVoiceRoster(); const key=JSON.stringify(players); if(key===lastRoster) return; lastRoster=key; send({type:'roster',players}); }
function scheduleRoster(){ if(rosterTimer) return; pushRoster(); rosterTimer=setInterval(pushRoster,3000); }

/* ---------- settings drawer ---------- */
function canEdit(){ return isLeader && !state?.busy; }
function pushSettings(patch){ if(!canEdit()) return; settings={...settings,...patch}; renderSummaries(); renderDrawer(); send({type:'settings',settings}); }
let mapsSeen=false;
function openDrawer(panel){
  drawerPanel=panel; if(panel==='maps') mapsSeen=true;
  $('drawerTitle').textContent={teams:'Жасаққа бөлу',br:'Соғыс рейтингі',maps:'Соғыс аймағы'}[panel];
  $('panelTeams').classList.toggle('hidden',panel!=='teams'); $('panelBR').classList.toggle('hidden',panel!=='br'); $('panelMaps').classList.toggle('hidden',panel!=='maps');
  qsa('.gear').forEach(g=>g.classList.toggle('open',g.dataset.panel===panel));
  renderDrawer();
  $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden','false'); $('drawerShade').classList.remove('hidden');
}
function closeDrawer(){ drawerPanel=''; $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden','true'); $('drawerShade').classList.add('hidden'); qsa('.gear').forEach(g=>g.classList.remove('open')); }
function renderDrawer(){
  const edit=canEdit(), n=settings.squads||2, players=state?.players?.length||0;
  qsa('#squadCount button').forEach(b=>{ b.classList.toggle('on',+b.dataset.n===n); b.disabled=!edit; });
  $('squadHint').textContent=players?`${players} ойыншы · әр жасақта ~${Math.max(1,Math.ceil(players/n))}`:'Ойыншылар әлі жоқ';
  const allowed=new Set(settings.allowed_br||[]);
  $('brPool').innerHTML=(allBR||[]).map(v=>`<button class="chip ${allowed.has(v)?'on':''}" data-v="${v}" ${edit?'':'disabled'}>${v}</button>`).join('');
  $('brHint').textContent=`${sortedAllowed().length}/${allBR.length}`;
  $('brAll').disabled=!edit;
  const maps=new Set(sortedMaps());
  const mapHtml=allMaps.map(v=>`<button class="chip map-chip ${maps.has(v)?'on':''}" data-v="${esc(v)}" ${edit?'':'disabled'}><span class="map-thumb"><svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><use href="#g-card-map"/></svg>${mapImg[v]&&mapsSeen?`<img src="${esc(mapImg[v])}" alt="" loading="lazy" decoding="async">`:''}</span><span class="map-chip-name">${esc(v)}</span></button>`).join('');
  if($('mapPool').dataset.html!==mapHtml){ $('mapPool').dataset.html=mapHtml; $('mapPool').innerHTML=mapHtml; }
  $('mapHint').textContent=`${maps.size}/${allMaps.length}`;
  $('mapAll').disabled=!edit;
  $('drawerDone').textContent=edit?'Дайын':'Жабу';
}
$('brPool').onclick=e=>{ const b=e.target.closest('.chip'); if(!b||!canEdit()) return; const set=new Set(settings.allowed_br||[]); set.has(b.dataset.v)?set.delete(b.dataset.v):set.add(b.dataset.v); if(!set.size){showError('Кемінде бір BR қалуы керек');return;} pushSettings({allowed_br:allBR.filter(v=>set.has(v))}); };
$('brAll').onclick=()=>pushSettings({allowed_br:[...allBR]});
$('mapPool').onclick=e=>{ const b=e.target.closest('.chip'); if(!b||!canEdit()) return; const set=new Set(sortedMaps()); set.has(b.dataset.v)?set.delete(b.dataset.v):set.add(b.dataset.v); if(!set.size){showError('Кемінде бір карта қалуы керек');return;} pushSettings({maps:allMaps.filter(v=>set.has(v))}); };
$('mapAll').onclick=()=>pushSettings({maps:[...allMaps]});
$('squadCount').onclick=e=>{ const b=e.target.closest('button'); if(b) pushSettings({squads:+b.dataset.n}); };
qsa('.gear').forEach(g=>g.onclick=()=>{ if(state?.busy) return; drawerPanel===g.dataset.panel?closeDrawer():openDrawer(g.dataset.panel); });
$('drawerClose').onclick=closeDrawer; $('drawerDone').onclick=closeDrawer; $('drawerShade').onclick=closeDrawer;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });

qsa('.action').forEach(b=>b.onclick=()=>{ const key=b.dataset.key; pushSettings({[key]:!settings[key]}); if(state) renderState({...state,settings}); });
$('start').onclick=()=>{ if(state?.busy||!isLeader)return; closeDrawer(); send({type:'start'}); };
$('again').onclick=()=>{ if(state?.busy||!isLeader)return; $('result').classList.add('hidden'); send({type:'start'}); };
$('closeResult').onclick=()=>{ if(currentMatch) dismissedMatchId=currentMatch.id; $('result').classList.add('hidden'); };

/* ---------- match flow ---------- */
const STAGES=['teamStage','mapStage','brStage'];
function cancelAnimation(){ animationNonce++; STAGES.forEach(id=>$(id).classList.add('hidden')); $('animation').classList.add('hidden'); phase(''); }
async function beginMatch(plan,at){
  if(!plan) return;
  currentMatch=plan; dismissedMatchId=''; $('result').classList.add('hidden'); closeDrawer();
  cancelAnimation(); const nonce=animationNonce; $('animation').classList.remove('hidden'); $('busyShade').classList.add('hidden');
  if(plan.use_mode && mapImg[plan.map]){ const im=new Image(); im.decoding='async'; im.src=mapImg[plan.map]; im.decode?.().catch(()=>{}); }
  const wait=Math.max(0,(at||serverNow())-serverNow()); if(wait) await sleep(wait); if(nonce!==animationNonce)return;
  try{
    if(plan.use_teams && planSquads(plan).length){ await animateSquads(plan,nonce); if(nonce!==animationNonce)return; }
    if(plan.use_mode && plan.map){ await animateMap(plan,nonce); if(nonce!==animationNonce)return; }
    if(plan.use_br){ await animateBR(plan,nonce); if(nonce!==animationNonce)return; }
    $('animation').classList.add('hidden'); phase(''); showResult(plan); if(isLeader) send({type:'finish',match_id:plan.id});
  }catch(e){ console.error(e); forceResult(); }
}
function forceResult(){ animationNonce++; STAGES.forEach(id=>$(id).classList.add('hidden')); $('animation').classList.add('hidden'); phase(''); if(currentMatch) showResult(currentMatch); }

/* 3. Squad randomizer — cards dealt from a face-down deck into squads */
async function animateSquads(plan,nonce){
  phase('01 · ЖАСАҚҚА БӨЛУ');
  const stage=$('teamStage'); stage.classList.remove('hidden');
  const squads=planSquads(plan), n=squads.length;
  const grid=$('squadGrid'); grid.style.setProperty('--n',n);
  grid.innerHTML=squads.map((s,i)=>`<div class="squad"><div class="squad-head"><span>${squadName(i)}</span></div><div class="squad-slots"></div></div>`).join('');
  const deck=$('deck');
  deck.innerHTML=[0,1,2,3].map(i=>`<div class="deck-card" style="transform:translate(${(i-1.5)*3}px,${-i*3}px) rotate(${(i-1.5)*1.6}deg)"><svg viewBox="0 0 320 180"><use href="#g-card-back"/></svg></div>`).join('');
  const cols=qsa('#squadGrid .squad');
  cols.forEach((c,i)=>c.animate([{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'none'}],{duration:520,delay:i*90,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}));
  deck.animate([{opacity:0,transform:'translateY(-14px) scale(.92)'},{opacity:1,transform:'none'}],{duration:480,easing:'cubic-bezier(.16,1,.3,1)'});
  await sleep(650); if(nonce!==animationNonce)return;

  const seq=[]; const max=Math.max(...squads.map(s=>s.length));
  for(let r=0;r<max;r++) for(let i=0;i<n;i++) if(squads[i][r]) seq.push([i,r,squads[i][r]]);
  const step=Math.round(Math.min(380,Math.max(150,4600/Math.max(1,seq.length))));

  for(const [si,r,p] of seq){
    if(nonce!==animationNonce)return;
    const col=cols[si], slots=col.querySelector('.squad-slots');
    const wrap=document.createElement('div'); wrap.innerHTML=pcard(p); const el=wrap.firstElementChild;
    slots.appendChild(el);
    const d=deck.getBoundingClientRect(), e=el.getBoundingClientRect();
    const dx=d.left+d.width/2-(e.left+e.width/2), dy=d.top+d.height/2-(e.top+e.height/2);
    el.animate([
      {opacity:0,transform:`translate(${dx}px,${dy}px) scale(.42)`},
      {opacity:1,offset:.35},
      {opacity:1,transform:'translate(0,0) scale(1)'}
    ],{duration:560,easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards'});
    deck.firstElementChild?.animate([{transform:'translateY(0)'},{transform:'translateY(-6px)'},{transform:'translateY(0)'}],{duration:200,composite:'add'});
    await sleep(step);
  }
  await sleep(380); if(nonce!==animationNonce)return;
  deck.animate([{opacity:1},{opacity:0,transform:'scale(.9)'}],{duration:380,fill:'forwards'});
  await sleep(1100); if(nonce!==animationNonce)return;
  stage.classList.add('hidden');
}

/* 2. Map randomizer — card-back flips over to the map card */
async function animateMap(plan,nonce){
  const stage=$('mapStage'); stage.classList.remove('hidden');
  const card=$('flipCard'), front=$('flipFront');
  const BACK='<svg viewBox="0 0 320 180"><use href="#g-card-back"/></svg>';
  front.innerHTML=BACK; // while spinning both faces show the back, so nothing is revealed early
  card.animate([{opacity:0,transform:'translateY(24px) scale(.94)'},{opacity:1,transform:'none'}],{duration:450,easing:'cubic-bezier(.16,1,.3,1)'});
  await sleep(500); if(nonce!==animationNonce)return;
  const spin=card.animate([{transform:'rotateY(0deg)'},{transform:'rotateY(1080deg)'}],{duration:1400,easing:'cubic-bezier(.5,0,.75,.6)',fill:'forwards'});
  await sleep(1400); if(nonce!==animationNonce){spin.cancel();return;}
  front.innerHTML=`<svg viewBox="0 0 320 180"><use href="#g-card-map"/></svg>${mapImg[plan.map]?`<img class="map-img" src="${esc(mapImg[plan.map])}" alt="">`:''}<div class="map-shade"></div><div class="map-name">${esc(plan.map)}</div>`;
  const land=card.animate([{transform:'rotateY(1080deg)'},{transform:'rotateY(1620deg)'}],{duration:1400,easing:'cubic-bezier(.12,.7,.18,1)',fill:'forwards'});
  spin.cancel();
  await sleep(2600); land.cancel();
  if(nonce!==animationNonce)return;
  stage.classList.add('hidden');
}

/* 1. BR randomizer — horizontal digital drum, ~3.6s with deceleration */
async function animateBR(plan,nonce){
  phase('03 · СОҒЫС РЕЙТИНГІ');
  const stage=$('brStage'); stage.classList.remove('hidden');
  const target=plan.br; let pool=sortedAllowed(); if(!pool.includes(target)) pool=[...allBR];
  if(!pool.includes(target)) pool=[target];
  const items=[]; while(items.length<36) items.push(...pool);
  const idx=items.length+pool.indexOf(target);
  items.push(...pool); while(items.length<idx+6) items.push(...pool);
  const strip=$('brStrip'), drum=qs('.drum');
  const W=drum.getBoundingClientRect().width, cw=W*144/520, center=W/2;
  strip.innerHTML=items.map(v=>`<div class="drum-cell" style="width:${cw}px">${v}</div>`).join('');
  const x0=center-(2.5*cw), x1=center-((idx+.5)*cw);
  stage.animate([{opacity:0},{opacity:1}],{duration:300});
  const run=strip.animate([{transform:`translateX(${x0}px)`},{transform:`translateX(${x1}px)`}],{duration:3600,easing:'cubic-bezier(.15,.62,.12,1)',fill:'forwards'});
  await sleep(3600); if(nonce!==animationNonce){run.cancel();return;}
  const cell=strip.children[idx]; cell?.classList.add('hit');
  cell?.animate([{transform:'scale(1)'},{transform:'scale(1.18)'},{transform:'scale(1.06)'}],{duration:520,easing:'cubic-bezier(.16,1,.3,1)',fill:'forwards'});
  await sleep(1300); run.cancel(); if(nonce!==animationNonce)return; stage.classList.add('hidden');
}

function showResult(plan){
  if(!plan)return;
  $('result').classList.remove('hidden');
  const meta=[];
  if(plan.use_teams){ const s=planSquads(plan); if(s.length) meta.push(`<span class="meta-chip">${icon('i-squad')}<b>${s.length}</b> жасақ</span>`); }
  if(plan.use_mode && plan.map) meta.push(`<span class="meta-chip">${mapImg[plan.map]?`<span class="map-thumb sm"><img src="${esc(mapImg[plan.map])}" alt=""></span>`:icon('i-map')}${esc(plan.map)}</span>`);
  if(plan.use_br) meta.push(`<span class="meta-chip">${icon('i-rank')}BR <b>${esc(plan.br)}</b></span>`);
  $('resultMeta').innerHTML=meta.join('')||'<span class="meta-chip">Іріктеу аяқталды</span>';
  const squads=plan.use_teams?planSquads(plan):[];
  $('resultTeams').style.setProperty('--n',Math.max(1,squads.length));

  $('resultTeams').innerHTML=squads.map((s,i)=>`<div class="squad"><div class="squad-head"><span>${squadName(i)}</span></div><div class="squad-slots">${s.map(p=>pcard(p)).join('')}</div></div>`).join('');
}

function preloadShowcaseAssets(){
  const urls=[];
  for(const src of urls){ const img=new Image(); img.decoding='async'; img.src=src; img.decode?.().catch(()=>{}); }
}

async function startDemoFallback(config){
  if(config.allowedGuildId && sdk?.guildId && sdk.guildId!==config.allowedGuildId) throw Error('Бұл серверге рұқсат жоқ');
  const id=crypto.randomUUID?.()||String(Date.now()); const room=sdk?.instanceId||sdk?.channelId||'activity';
  const d=await api('/api/demo',{name:'Discord user',room,id}); selfId=d.id;selfName=d.name;selfAvatar='';ticket=d.ticket;status('Demo');connect();
}

async function initDiscord(config){
  sdk=new DiscordSDK(config.clientId); status('Discord күтілуде'); await sdk.ready();
  if(config.allowedGuildId && sdk.guildId!==config.allowedGuildId) throw Error('Бұл серверге рұқсат жоқ');
  try{
    const {code}=await sdk.commands.authorize({client_id:config.clientId,response_type:'code',state:'',prompt:'none',scope:['identify']});
    const data=await api('/api/auth',{code,room:sdk.instanceId||sdk.channelId||'activity',guild:sdk.guildId||''});
    selfId=data.id;selfName=data.name;selfAvatar=data.avatar||'';ticket=data.ticket;
    const auth=await sdk.commands.authenticate({access_token:data.access_token}); if(!auth) throw Error('Discord authenticate failed'); connect();
  }catch(e){ console.error('Discord OAuth failed',e); if(config.demo){ await startDemoFallback(config); return; } throw e; }
}

async function init(){
  preloadShowcaseAssets();
  try{
    const r=await fetch(proxy+'/api/config',{cache:'no-store'}); const c=await r.json(); allBR=c.allBR||[]; allMaps=c.allMaps||[]; (c.maps||[]).forEach(m=>{ mapImg[m.name]=`${proxy}/mapimg/${encodeURIComponent(m.file)}`; }); settings.allowed_br=[...allBR]; settings.maps=[...allMaps]; renderSummaries(); renderDrawer();
    const framed=new URLSearchParams(location.search).has('frame_id'); if(c.demo&&!framed){ $('demo').classList.remove('hidden'); status('Demo'); return; }
    if(!c.clientId) throw Error('DISCORD_CLIENT_ID орнатылмаған'); await initDiscord(c);
  }catch(e){ console.error(e); showError(e.message||'Іске қосу қатесі'); }
}

$('join').onclick=async()=>{ try{ const id=crypto.randomUUID?.()||String(Date.now()); const d=await api('/api/demo',{name:$('name').value,room:$('room').value,id}); selfId=d.id;selfName=d.name;ticket=d.ticket;$('demo').classList.add('hidden');connect(); const base=['Aidar','Orion','Nurtas','Kamila','Sultan','Bekzhan']; const nFake=Math.min(39,+new URLSearchParams(location.search).get('fake')||base.length); const fake=Array.from({length:nFake},(_,i)=>({id:`fake:${i}`,name:base[i]||`Player ${i+1}`,avatar:''})); demoRoster=[{id:selfId,name:selfName,avatar:''},...fake]; setTimeout(()=>send({type:'roster',players:demoRoster}),700); }catch(e){showError(e.message)} };

init();
