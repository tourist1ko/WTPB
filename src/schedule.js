import { readFileSync } from 'node:fs';

const DAY = 86400000;
export const SOURCES = [
  'https://forum.warthunder.ru/t/2509.json',
  'https://forum.warthunder.com/t/4446.json',
  'https://forum.warthunder.ru/t/raspisanie-polkovyh-boyov-rotacziya-br-vnutri-sezonov/2509',
  'https://forum.warthunder.com/t/season-schedule-for-squadron-battles/4446',
];

export function plainText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&(nbsp|mdash|ndash|amp|quot|lt|gt);/gi,
      (_, n) => ({nbsp:' ', mdash:'—', ndash:'–', amp:'&', quot:'"', lt:'<', gt:'>'})[n.toLowerCase()])
    .replace(/[\t\u00a0 ]+/g, ' ');
}

function dateKey(day, month, year) {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw new Error('Invalid schedule date');
  }
  return value.toISOString().slice(0, 10);
}

export function validateSchedule(schedule) {
  if (!schedule || !Array.isArray(schedule.rows) || !schedule.rows.length) throw new Error('Empty schedule');
  const rows = schedule.rows;
  if (rows[0].start !== schedule.start || rows.at(-1).end !== schedule.end) throw new Error('Incomplete season');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const key of [row.start, row.end, schedule.start, schedule.end]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || new Date(key).toISOString().slice(0, 10) !== key) throw new Error('Invalid date');
    }
    if (row.start > row.end || row.start < schedule.start || row.end > schedule.end ||
        !Number.isFinite(row.br) || row.br < 1 || row.br > 30) throw new Error('Invalid schedule row');
    if (i && Date.parse(row.start) - Date.parse(rows[i - 1].end) !== DAY) throw new Error('Schedule gap or overlap');
  }
  return schedule;
}

export function parseSchedule(html, title = '') {
  const text = plainText(`${title}\n${html}`);
  const header = text.match(/(?:Сезон|Season[^\d\n]{0,80})\s*\(?\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*[-—–]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!header) throw new Error('Season dates not found');
  const endYear = Number(header[6]);
  const startYear = header[3] ? Number(header[3]) : endYear - (Number(header[2]) > Number(header[5]) ? 1 : 0);
  const start = dateKey(Number(header[1]), Number(header[2]), startYear);
  const end = dateKey(Number(header[4]), Number(header[5]), endYear);
  if (Date.parse(end) - Date.parse(start) > 100 * DAY) throw new Error('Unexpected season length');
  const pattern = /(?:БР|BR)\s*[:=]?\s*(\d{1,2}(?:[.,]\d)?)\s*\(\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*[-—–]\s*(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s*\)/gi;
  const rows = [...text.matchAll(pattern)].map(m => {
    const year1 = m[4] ? Number(m[4]) : startYear + (Number(m[3]) < Number(header[2]) ? 1 : 0);
    const year2 = m[7] ? Number(m[7]) : year1 + (Number(m[6]) < Number(m[3]) ? 1 : 0);
    return { start:dateKey(Number(m[2]), Number(m[3]), year1), end:dateKey(Number(m[5]), Number(m[6]), year2), br:Number(m[1].replace(',', '.')) };
  });
  return validateSchedule({start, end, rows});
}

export function moscowDay(date = new Date()) {
  return new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 10);
}

export function currentRow(schedule, date = new Date()) {
  const day = moscowDay(date);
  return schedule.rows.find(r => r.start <= day && day <= r.end) ?? null;
}

export class ScheduleService {
  constructor({fetchImpl = fetch, now = () => new Date(), warn = console.warn, seed} = {}) {
    const initial = seed ?? JSON.parse(readFileSync(new URL('../data/schedule.json', import.meta.url), 'utf8'));
    this.schedules = [validateSchedule(initial)];
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.warn = warn;
    this.lastAttempt = 0;
    this.lastSuccess = 0;
    this.pending = null;
  }

  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; });
    return this.pending;
  }

  async load() {
    this.lastAttempt = this.now().getTime();
    for (const url of SOURCES) {
      try {
        const response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent':'PB-BR-Bot/1.0 (public season schedule)', Accept:'application/json,text/html' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        let schedule;
        if (url.endsWith('.json')) {
          const data = await response.json();
          const post = data.post_stream?.posts?.find(p => p.post_number === 1);
          if (!post || typeof post.cooked !== 'string') throw new Error('First official post missing');
          schedule = parseSchedule(post.cooked, data.title ?? '');
        } else {
          // Only the first post. Replies may quote obsolete seasons.
          const page = await response.text();
          const first = page.match(/<[^>]+itemprop=["']text["'][^>]*>([\s\S]*?)<\/div>/i);
          const title = page.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
          if (!first) throw new Error('Official post not found in HTML');
          schedule = parseSchedule(first[1], title);
        }
        if (!currentRow(schedule, this.now())) throw new Error('Published season does not cover today');
        this.schedules = [schedule, ...this.schedules.filter(s => s.start !== schedule.start)].slice(0, 4);
        this.lastSuccess = this.now().getTime();
        console.log(`Official schedule loaded: ${schedule.start} to ${schedule.end}`);
        return true;
      } catch (error) {
        this.warn(`Schedule source ${new URL(url).hostname}: ${error.name === 'TimeoutError' ? 'timeout' : error.message}`);
      }
    }
    return false;
  }

  async getBR() {
    if (this.pending) await this.pending;
    const now = this.now();
    const hasCurrent = this.schedules.some(s => currentRow(s, now));
    // Retry failed sources at most once every 5 minutes. Coalesce simultaneous calls.
    if ((!this.lastSuccess || now.getTime() - this.lastSuccess >= 3600000 || !hasCurrent) &&
        (!this.lastAttempt || now.getTime() - this.lastAttempt >= 300000)) await this.refresh();
    for (const schedule of this.schedules) {
      const row = currentRow(schedule, this.now());
      if (row) return row.br.toFixed(1);
    }
    return null;
  }
  async getSeason(){
    await this.getBR();
    const schedule=this.schedules.find(s=>currentRow(s,this.now()));
    return schedule?{start:schedule.start,end:schedule.end}:null;
  }
}
