import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('root-owned volume reproduces failure; bootstrap drops privileges and preserves SQLite data', {skip:process.getuid?.()!==0 || !readFileSync('/proc/self/uid_map','utf8').split('\n').some(line=>{const [start,host,count]=line.trim().split(/\s+/).map(Number);return start<=1000 && start+count>1000;})},()=>{
 const dir=mkdtempSync(join(tmpdir(),'pb-volume-'));
 try {
  const file=join(dir,'rank.sqlite');
  const db=new DatabaseSync(file);
  db.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('existing statistics');");db.close();chmodSync(file,0o600);
  const fail=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite'; new DatabaseSync(process.env.DATA_DIR+'/rank.sqlite');`],{uid:1000,gid:1000,env:{...process.env,DATA_DIR:dir},encoding:'utf8'});
  assert.notEqual(fail.status,0);
  const main=join(dir,'check.mjs');
  writeFileSync(main,`import assert from 'node:assert/strict'; import {DatabaseSync} from 'node:sqlite'; assert.equal(process.getuid(),1000);assert.equal(process.getgid(),1000);const db=new DatabaseSync(process.env.DATA_DIR+'/rank.sqlite');assert.equal(db.prepare('SELECT value FROM proof').get().value,'existing statistics');db.exec("PRAGMA journal_mode=WAL; INSERT INTO proof VALUES('new statistics');");db.close();console.log('volume write successful, previous data preserved');`);
  const result=spawnSync(process.execPath,[resolve('src/bootstrap.js'),main],{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/volume write successful/);
  const verify=new DatabaseSync(file);assert.equal(verify.prepare('SELECT count(*) AS n FROM proof').get().n,2);verify.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

import * as fs from 'node:fs';
import { prepareStorage } from '../src/storage-init.js';
test('prepare storage fixes existing DB ownership before dropping privileges, preserving data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'pb-storage-'));
 try {
  const file=join(dir,'rank.sqlite');const db=new DatabaseSync(file);db.exec("CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('kept');");db.close();
  const events=[];
  const files={...fs,chownSync:(path,uid,gid)=>{assert.equal(uid,1000);assert.equal(gid,1000);events.push(['chown',path]);}};
  const identity={getuid:()=>0,setgroups:g=>events.push(['groups',g]),setgid:g=>events.push(['gid',g]),setuid:u=>events.push(['uid',u])};
  const env={DATA_DIR:dir};prepareStorage({files,identity,env});
  assert.deepEqual(events.map(x=>x[0]),['chown','chown','groups','gid','uid']);
  assert.equal(events[1][1],file);assert.equal(events.at(-1)[1],1000);
  const verify=new DatabaseSync(file);assert.equal(verify.prepare('SELECT value FROM proof').get().value,'kept');verify.exec("INSERT INTO proof VALUES('next');");verify.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
