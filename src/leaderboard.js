import { Resvg } from '@resvg/resvg-js';
export const PAGE_SIZE = 15;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function pageState(total, requested=1) {
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const page=Math.min(pages,Math.max(1,Number.isSafeInteger(requested)?requested:1));
  return {page,pages,start:(page-1)*PAGE_SIZE};
}
export function leaderboardSVG(rows,squad,page=1) {
  const {start}=pageState(rows.length,page);
  const selected=rows.slice(start,start+PAGE_SIZE);
  const height=205+Math.max(1,selected.length)*70;
  const text=(x,y,s,size=19,color='#edf0f7',anchor='start',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}" font-family="DejaVu Sans">${esc(s)}</text>`;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}"><rect width="1100" height="${height}" rx="20" fill="#111318"/>`;
  svg+=text(38,42,`${squad.slice(0,45)} · Полковые бои`,15,'#a0a8b8');
  svg+=text(38,88,'Лучшие в полку',30);
  svg+=text(50,151,'№',14,'#a0a8b8')+text(105,151,'Игрок',14,'#a0a8b8')+text(530,151,'К/Д',14,'#a0a8b8','end')+text(690,151,'WinRate',14,'#a0a8b8','end');
  svg+=text(855,138,'Танки',14,'#a0a8b8','end')+text(855,158,'(Убийство)',14,'#a0a8b8','end');
  svg+=text(1050,138,'Самолет',14,'#a0a8b8','end')+text(1050,158,'(Убийство)',14,'#a0a8b8','end');
  svg+='<path d="M 30 175 H 1070" stroke="#303540"/>';
  selected.forEach((r,i)=>{
    const rank=start+i+1,y=176+i*70;
    if(rank===1)svg+=`<rect x="20" y="${y}" width="1060" height="70" rx="8" fill="#22293c"/>`;
    svg+=text(50,y+42,rank,20,rank===1?'#a9b5ff':'#a0a8b8');
    const nick=Array.from(r.nick);svg+=text(105,y+30,nick.length>24?nick.slice(0,23).join('')+'…':r.nick,20);
    svg+=text(105,y+52,`${r.wins+r.losses} боёв`,13,'#a0a8b8');
    svg+=text(530,y+42,r.kd===Infinity?'∞':r.kd.toFixed(2),23,'#a9b5ff','end',500)+text(690,y+42,r.wr.toFixed(1)+'%',20,'#edf0f7','end')+text(855,y+42,r.tanks,20,'#edf0f7','end')+text(1050,y+42,r.air,20,'#edf0f7','end');
    if(i<selected.length-1)svg+=`<path d="M 30 ${y+70} H 1070" stroke="#303540"/>`;
  });
  if(!selected.length)svg+=text(38,218,'Пока нет статистики.',18,'#a0a8b8');
  return svg+'</svg>';
}
export function leaderboard(rows,squad,page=1){return new Resvg(leaderboardSVG(rows,squad,page)).render().asPng();}
