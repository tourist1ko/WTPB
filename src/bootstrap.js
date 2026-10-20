import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareStorage } from './storage-init.js';

// Railway mounts the volume after image build, so ownership must be fixed here.
try {
  prepareStorage();
  await import(pathToFileURL(resolve(process.argv[2] || 'src/index.js')).href);
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  console.error('Check the Volume mount and DATA_DIR. Database files have not been deleted.');
  process.exitCode = 1;
}
