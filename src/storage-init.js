import * as fs from 'node:fs';
import { resolve, join } from 'node:path';

export function prepareStorage({ files=fs, identity=process, env=process.env }={}) {
  const directory = resolve(env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || './storage');
  if (directory === '/') throw new Error('DATA_DIR must point to a dedicated data directory, for example /data.');
  env.DATA_DIR = directory;
  files.mkdirSync(directory, { recursive: true });
  if (identity.getuid?.() === 0) {
    if (!files.lstatSync(directory).isDirectory()) throw new Error('DATA_DIR must be a directory.');
    files.chownSync(directory, 1000, 1000);
    files.chmodSync(directory, files.lstatSync(directory).mode | 0o700);
    for (const name of ['rank.sqlite', 'rank.sqlite-wal', 'rank.sqlite-shm', 'rank.sqlite-journal']) {
      const file = join(directory, name);
      let stat;
      try { stat = files.lstatSync(file); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!stat.isFile()) throw new Error(`Unexpected database path: ${name}`);
      files.chownSync(file, 1000, 1000);
      files.chmodSync(file, stat.mode | 0o600);
    }
    identity.setgroups([]);
    identity.setgid(1000);
    identity.setuid(1000);
  }
  return directory;
}
