/**
 * 跨平台日期工具（纯函数，无 Node / DOM 依赖）。
 * Android、鸿蒙等后续端的 core 层可直接复用。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function timeLabel(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function parseDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function weekdayOf(key) {
  return WEEKDAYS[parseDateKey(key).getDay()] || '';
}

export function dayTitle(key) {
  return `${key} ${weekdayOf(key)}`;
}

export function monthDayLabel(key) {
  const date = parseDateKey(key);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function diffDays(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((da - db) / 86400000);
}

/** 返回「今天 / 昨天 / 前天 / 空字符串」 */
export function relativeDayLabel(key, now = new Date()) {
  const delta = diffDays(parseDateKey(key), now);
  if (delta === 0) return '今天';
  if (delta === 1) return '昨天';
  if (delta === 2) return '前天';
  return '';
}
