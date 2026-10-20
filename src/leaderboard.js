import { Resvg } from '@resvg/resvg-js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function leaderboard(rows,squad,page=1){
const pages=Math.max(1,Math.ceil(rows.length/15));page=Math.min(Math.max(1,page),pages);const selected=rows.slice((page-1)*15,page*15);const h=250+Math.max(1,selected.length)*54;
const text=(x,y,s,size=18,color='#dce4f2',anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-family="DejaVu Sans">${esc(s)}</text>`;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${h}"><rect width="1100" height="${h}" rx="24" fill="#0d1320"/><rect x="32" y="35" width="5" height="70" rx="2" fill="#54dfc4"/>`;
svg+=text(56,65,'ПОЛКОВЫЕ БОИ',15,'#54dfc4')+text(56,103,squad.slice(0,42),30)+text(1040,65,'РЕЙТИНГ',15,'#8d9bb2','end')+text(1040,102,`${rows.length} игроков`,20,'#8d9bb2','end');
for(const [x,s]of [[55,'#'],[110,'ИГРОК'],[510,'К/Д'],[640,'WINRATE'],[780,'ТАНКИ'],[910,'САМОЛЁТЫ'],[1040,'БОИ']])svg+=text(x,156,s,13,'#8d9bb2',x>110?'end':'start');
selected.forEach((r,i)=>{const y=177+i*54,rank=(page-1)*15+i+1;svg+=`<rect x="32" y="${y}" width="1036" height="46" rx="9" fill="${i%2?'#151e2e':'#1b2638'}"/>`;svg+=text(55,y+30,rank,18,rank<=3?'#f5cd76':'#8d9bb2')+text(110,y+30,r.nick.length>26?r.nick.slice(0,25)+'…':r.nick,18)+text(510,y+30,r.kd===Infinity?'∞':r.kd.toFixed(2),20,'#54dfc4','end')+text(640,y+30,r.wr.toFixed(1)+'%',18,'#dce4f2','end')+text(780,y+30,r.tanks,18,'#dce4f2','end')+text(910,y+30,r.air,18,'#dce4f2','end')+text(1040,y+30,r.wins+r.losses,18,'#8d9bb2','end');});
if(!selected.length)svg+=text(55,210,'Пока нет учтённых отчётов.');
svg+=text(40,h-26,`К/Д ↓  •  При равенстве: winrate ↓  •  Страница ${page}/${pages}`,14,'#8d9bb2')+'</svg>';
return new Resvg(svg).render().asPng();}
