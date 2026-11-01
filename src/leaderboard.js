import { Resvg } from '@resvg/resvg-js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const fontFiles=['DejaVuSans.ttf','DejaVuSans-Bold.ttf'].map(name=>fileURLToPath(new URL('../assets/fonts/'+name,import.meta.url)));
const renderOptions={font:{loadSystemFonts:false,fontFiles,defaultFontFamily:'DejaVu Sans',sansSerifFamily:'DejaVu Sans'}};
export const PAGE_SIZE = 8;
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function pageState(total, requested=1) {
  const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const page=Math.min(pages,Math.max(1,Number.isSafeInteger(requested)?requested:1));
  return {page,pages,start:(page-1)*PAGE_SIZE};
}
const W=1100,HEAD=130,ROW=56;
const fmtKD=v=>v===Infinity?'∞':Number(v||0).toFixed(2);
// Ten plain styles. Pick one with the RANK_THEME variable (1–10).
// bg: background, fg: text, muted: labels, line: header underline,
// sep: row separators, zebra: every second row fill, bar: thin top bar.
export const THEMES={
 1:{name:'Графит',bg:'#1a1d18',fg:'#e6e6e6',muted:'#7c8276'},
 2:{name:'Белый',bg:'#ffffff',fg:'#1f2328',muted:'#8a9099',line:'#e3e5e8'},
 3:{name:'Хаки',bg:'#2b3122',fg:'#e9e7d8',muted:'#9a9c84',line:'#4a5338'},
 4:{name:'Тёмно-синий',bg:'#141c2b',fg:'#e3e8f0',muted:'#7a879c',sep:'#1e2838'},
 5:{name:'Зебра',bg:'#1b1d21',fg:'#e6e7ea',muted:'#7d828c',zebra:'#23262b'},
 6:{name:'Песочный',bg:'#efe9dc',fg:'#2b2721',muted:'#8d8473',line:'#d8cfbd'},
 7:{name:'Чёрный',bg:'#000000',fg:'#f2f2f2',muted:'#6b6b6b',sep:'#1c1c1c',line:'#333333'},
 8:{name:'Сталь',bg:'#262b31',fg:'#e8ebee',muted:'#8b939c',head:'#30363e'},
 9:{name:'Бирюза',bg:'#0f2a33',fg:'#e6f2f4',muted:'#7fa3ad',bar:'#00afca'},
 10:{name:'Серый светлый',bg:'#f3f4f6',fg:'#16181b',muted:'#5f656e',zebra:'#e1e4e8',head:'#d3d7dd',cols:'#c9ced5'},
};
export function themeNumber(value=process.env.RANK_THEME){const n=Number(value);return THEMES[n]?n:10;}
export function leaderboardSVG(rows,squad,page=1,season,{title,theme}={}) {
  const t=THEMES[themeNumber(theme)];
  const {start}=pageState(rows.length,page);
  const selected=rows.slice(start,start+PAGE_SIZE);
  const height=HEAD+30+Math.max(1,selected.length)*ROW+30;
  const text=(x,y,s,size=19,color=t.fg,anchor='start',weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}" font-family="DejaVu Sans">${esc(s)}</text>`;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}"><rect width="${W}" height="${height}" rx="14" fill="${t.bg}"/>`;
  if(t.bar)svg+=`<path d="M 14 0 H ${W-14} A 14 14 0 0 1 ${W} 14 V 6 H 0 V 14 A 14 14 0 0 1 14 0 Z" fill="${t.bar}"/>`;
  svg+=text(50,70,`${title||squad} | Полктік ойындар`.slice(0,60),30,t.fg,'start',700);
  if(season)svg+=text(50,98,'Маусым: '+season.label,15,t.muted);
  const hy=t.cols?HEAD+12:HEAD+6;
  if(t.head)svg+=`<rect x="30" y="${hy-24}" width="1040" height="36" rx="6" fill="${t.head}"/>`;
  const label=(x,s,a='end')=>text(x,hy,s,14,t.muted,a,t.cols?700:400);
  svg+=label(50,'#','start')+label(100,'Ойыншы','start')+label(560,'К/Д')+label(700,'Жеңіс %')+label(820,'Танктер')+label(940,'Ұшақтар')+label(1050,'Көмек');
  if(t.line)svg+=`<rect x="50" y="${hy+14}" width="1000" height="1" fill="${t.line}"/>`;
  if(!selected.length)svg+=text(50,HEAD+30+ROW/2+6,'Әзірге шайқас жоқ',18,t.muted);
  selected.forEach((r,i)=>{
    const rank=start+i+1,y=HEAD+30+i*ROW,mid=y+ROW/2;
    if(t.zebra&&i%2===0)svg+=t.cols?`<rect x="30" y="${y}" width="1040" height="${ROW}" fill="${t.zebra}"/>`:`<rect x="30" y="${y+4}" width="1040" height="${ROW-8}" rx="6" fill="${t.zebra}"/>`;
    if(t.sep&&i)svg+=`<rect x="50" y="${y}" width="1000" height="1" fill="${t.sep}"/>`;
    const nick=Array.from(r.nick);
    svg+=text(50,mid+7,rank,18)+text(100,mid+7,nick.length>22?nick.slice(0,21).join('')+'…':r.nick,20);
    svg+=text(560,mid+7,fmtKD(r.kd),20,t.fg,'end')+text(700,mid+7,(Number(r.wr)||0).toFixed(1)+'%',20,t.fg,'end');
    svg+=text(820,mid+7,r.tanks,20,t.fg,'end')+text(940,mid+7,r.air,20,t.fg,'end')+text(1050,mid+7,r.assists??0,20,t.fg,'end');
  });
  // Thin vertical lines between columns so each value is easy to follow.
  if(t.cols)for(const x of [88,440,580,720,840,960])svg+=`<rect x="${x}" y="${hy-24}" width="1" height="${HEAD+30+Math.max(1,selected.length)*ROW-(hy-24)}" fill="${t.cols}"/>`;
  return svg+'</svg>';
}
export function renderLeaderboard(rows,squad,page=1,season,opts){
  if(fontFiles.some(path=>!existsSync(path)))throw Error('Не найдены встроенные шрифты. Обнови папку assets/fonts вместе с ботом.');
  return new Resvg(leaderboardSVG(rows,squad,page,season,opts),renderOptions).render();
}
export function leaderboard(rows,squad,page=1,season,opts){return renderLeaderboard(rows,squad,page,season,opts).asPng();}
