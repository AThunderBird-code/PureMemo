/**
 * PureMemo 单一文件格式（纯函数，无 Node / DOM 依赖）。
 *
 * 文件始终是「最新在最上面」的纯文本：
 *
 *   # PureMemo
 *
 *   【2026-11-24 周一】
 *   - 10:42 在会议室评审 PureMemo 的方案。
 *   - 09:15 昨天睡得不好，中午补了 20 分钟。
 *   【2026-11-24 · 结束】
 *
 *   【2026-11-23 周日】
 *   - 22:10 ...
 *   【2026-11-23 · 结束】
 *
 * 每天的开头与结尾都带日期，方便人读，也方便 AI 按天切分。
 */

import { dateKey, dayTitle, timeLabel, weekdayOf } from './date.js';

export const DEFAULT_HEADER =
  '# PureMemo\n\n极简记录。只写事实，不写感悟。最新的一条永远在最上面。';

const DAY_OPEN_RE = /^【(\d{4}-\d{2}-\d{2})(?:\s+([^】]*))?】$/;
const DAY_CLOSE_RE = /^【(\d{4}-\d{2}-\d{2})(?:\s+[^】]*)?\s*·\s*结束】$/;
const ENTRY_RE = /^-\s+(\d{1,2}:\d{2})\s?(.*)$/;
const NOTE_RE = /^-\s+(?!\d{1,2}:\d{2}\s)(.*)$/;

export function parseMemo(rawText) {
  const lines = String(rawText ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  const headerLines = [];
  const days = [];
  let current = null;
  let entry = null;

  const flushEntry = () => {
    if (current && entry) {
      entry.text = entry.text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      if (entry.text) current.entries.push(entry);
    }
    entry = null;
  };

  for (const line of lines) {
    const close = line.match(DAY_CLOSE_RE);
    if (close) {
      flushEntry();
      current = null;
      continue;
    }

    const open = line.match(DAY_OPEN_RE);
    if (open) {
      flushEntry();
      current = {
        key: open[1],
        title: `${open[1]} ${weekdayOf(open[1])}`,
        entries: [],
      };
      days.push(current);
      continue;
    }

    if (!current) {
      headerLines.push(line);
      continue;
    }

    const timed = line.match(ENTRY_RE);
    if (timed) {
      flushEntry();
      entry = { time: timed[1].padStart(5, '0'), text: timed[2] };
      continue;
    }

    const note = line.match(NOTE_RE);
    if (note) {
      flushEntry();
      entry = { time: '', text: note[1] };
      continue;
    }

    if (!entry) {
      if (line.trim()) entry = { time: '', text: line };
      continue;
    }

    if (line.trim() === '') {
      flushEntry();
      continue;
    }

    entry.text += '\n' + (line.startsWith('  ') ? line.slice(2) : line);
  }
  flushEntry();

  return {
    header: headerLines.join('\n').replace(/^\n+|\n+$/g, ''),
    days,
  };
}

export function serializeMemo(doc) {
  const blocks = [];
  const header = String(doc.header ?? '').trim();
  if (header) blocks.push(header);

  for (const day of doc.days) {
    const title = day.title || dayTitle(day.key);
    const lines = [`【${title}】`];

    for (const entry of day.entries) {
      const text = String(entry.text ?? '').replace(/\r\n?/g, '\n').trim();
      if (!text) continue;
      const [first, ...rest] = text.split('\n');
      lines.push(entry.time ? `- ${entry.time} ${first}` : `- ${first}`);
      for (const piece of rest) lines.push(`  ${piece}`);
    }

    lines.push('');
    lines.push(`【${title} · 结束】`);
    blocks.push(lines.join('\n'));
  }

  return `${blocks.join('\n\n')}\n`;
}

function cleanEntryBody(body) {
  return String(body ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 把一条事实追加到「今天」这一天的顶部（也就是整个文件的顶部）。
 * 返回新的完整文本，调用方负责写盘。
 */
export function appendEntry(rawText, body, now = new Date()) {
  const text = cleanEntryBody(body);
  if (!text) throw new Error('EMPTY_ENTRY');

  const doc = parseMemo(rawText);
  if (!doc.header.trim()) doc.header = DEFAULT_HEADER;

  const key = dateKey(now);
  let day = doc.days.find((item) => item.key === key);
  const isNewDay = !day;

  if (!day) {
    day = { key, title: dayTitle(key), entries: [] };
    doc.days.unshift(day);
  }

  day.entries.unshift({ time: timeLabel(now), text });

  return {
    text: serializeMemo(doc),
    dayKey: key,
    time: timeLabel(now),
    isNewDay,
  };
}

export function countMemo(doc) {
  let entries = 0;
  let chars = 0;
  for (const day of doc.days) {
    entries += day.entries.length;
    for (const entry of day.entries) chars += entry.text.replace(/\s/g, '').length;
  }
  return { entries, chars };
}
