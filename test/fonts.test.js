import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { leaderboardSVG, renderLeaderboard } from '../src/leaderboard.js';

function brightPixels(render,x0,y0,x1,y1){
 const pixels=render.pixels;let count=0;
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
  const i=(y*render.width+x)*4;
  if(pixels[i]>120&&pixels[i+1]>120&&pixels[i+2]>120&&pixels[i+3]>200)count++;
 }
 return count;
}
test('leaderboard draws Cyrillic headings and values with all system fonts disabled',()=>{
 const rows=[{nick:'tourist__',wins:1,losses:1,kd:2.5,wr:50,tanks:4,air:1}];
 const noFonts=new Resvg(leaderboardSVG(rows,'Beyond Alive',1,undefined,{theme:1}),{font:{loadSystemFonts:false}}).render();
 assert.equal(brightPixels(noFonts,90,165,1060,215),0,'reproduces blank text without fonts');
 const rendered=renderLeaderboard(rows,'Beyond Alive',1,undefined,{theme:1});
 assert.ok(brightPixels(rendered,40,40,600,80)>1000,'title is visible');
 assert.ok(brightPixels(rendered,90,165,1060,215)>500,'player nickname and numeric stats are visible');
});
test('empty leaderboard still draws the title',()=>{
 const rendered=renderLeaderboard([],'Полк',1,undefined,{theme:1});
 assert.ok(brightPixels(rendered,40,40,600,80)>500);
});
