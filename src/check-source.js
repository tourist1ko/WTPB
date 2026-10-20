import { ScheduleService } from './schedule.js';
const service = new ScheduleService();
if (!await service.refresh()) {
  console.error('Live official sources unavailable. Bundled schedule is only valid through 2026-10-31.');
  process.exitCode = 1;
} else {
  console.log(`Current BR: ${await service.getBR()}`);
}
