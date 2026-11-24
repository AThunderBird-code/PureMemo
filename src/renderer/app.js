import {
  appendEntry,
  countMemo,
  monthDayLabel,
  parseMemo,
  relativeDayLabel,
  weekdayOf,
  dateKey,
} from '../core/index.js';
import { platform } from './platform.js';

const $ = (selector, root = document) => root.querySelector(selector);
const MAX_RECORD_SECONDS = 300;
const SAMPLE_RATE = 16000;

const state = {
  raw: '',
  doc: { header: '', days: [] },
  settings: null,
  probe: null,
  query: '',
  saving: false,
  transcribing: false,
  recording: null,
  startingRecording: false,
  cancelRequested: false,
  pendingHighlight: null,
};

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const escapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => escapeMap[char]);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function friendlyError(error) {
  const message = String(error?.message || error || '未知错误');
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim();
}

function modelLabel(model) {
  if (!model) return '就绪';
  if (/moss/i.test(model)) return 'MOSS';
  if (/whisper/i.test(model)) return 'Whisper';
  if (/qwen.*asr/i.test(model)) return 'Qwen ASR';
  return model.split('@')[0];
}

let toastTimer = null;
function toast(message, duration = 2400) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function shakeComposer() {
  const composer = $('#composer');
  composer.classList.remove('shake');
  void composer.offsetWidth;
  composer.classList.add('shake');
  setTimeout(() => composer.classList.remove('shake'), 420);
}

function scrollToTop(smooth = true) {
  $('#page').scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}

function setBusy(busy) {
  $('#saveBtn').disabled = busy;
  $('#micBtn').disabled = busy;
  $('#input').disabled = busy;
}

/* ------------------------------------------------------------------ */
/* 渲染                                                                */
/* ------------------------------------------------------------------ */

function renderText(text, query) {
  if (!query) return escapeHtml(text);
  const source = String(text ?? '');
  const haystack = source.toLowerCase();
  let cursor = 0;
  let html = '';
  for (;;) {
    const index = haystack.indexOf(query, cursor);
    if (index === -1) {
      html += escapeHtml(source.slice(cursor));
      break;
    }
    html += escapeHtml(source.slice(cursor, index));
    html += `<mark>${escapeHtml(source.slice(index, index + query.length))}</mark>`;
    cursor = index + query.length;
  }
  return html;
}

function dayHtml(day, entries, totalCount) {
  const query = state.query.trim().toLowerCase();
  const relative = relativeDayLabel(day.key);
  const countText = query ? `${entries.length} / ${totalCount} 条` : `${totalCount} 条`;

  const items = entries
    .map((entry) => {
      const stamp = `${day.key}|${entry.time}|${entry.text}`;
      const isNew = state.pendingHighlight === stamp ? ' is-new' : '';
      const time = entry.time
        ? `<span class="entry-time">${escapeHtml(entry.time)}</span>`
        : '<span class="entry-time">·</span>';
      return `<li class="entry${isNew}">${time}<p class="entry-text">${renderText(
        entry.text,
        query,
      )}</p></li>`;
    })
    .join('');

  return `<section class="day">
    <header class="day-head">
      <h2 class="day-title">${escapeHtml(monthDayLabel(day.key))}</h2>
      <span class="day-week">${escapeHtml(weekdayOf(day.key))}</span>
      ${relative ? `<span class="day-now">${escapeHtml(relative)}</span>` : ''}
      <span class="day-count">${escapeHtml(countText)}</span>
    </header>
    <ol class="entries">${items}</ol>
  </section>`;
}

function renderStream() {
  const stream = $('#stream');
  const query = state.query.trim().toLowerCase();

  if (!state.doc.days.length) {
    stream.innerHTML = `<div class="empty">
      <svg class="empty-mark" aria-hidden="true"><use href="#i-logo"></use></svg>
      <p class="empty-title">还没有记录</p>
      <p class="empty-note">写下第一条事实，或按 <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> 说一句。</p>
    </div>`;
    $('#searchCount').textContent = '';
    return;
  }

  let matched = 0;
  const sections = [];

  for (const day of state.doc.days) {
    const total = day.entries.length;
    const entries = query
      ? day.entries.filter((entry) => entry.text.toLowerCase().includes(query))
      : day.entries;
    if (query && !entries.length) continue;
    matched += entries.length;
    sections.push(dayHtml(day, entries, total));
  }

  if (!sections.length) {
    stream.innerHTML = `<div class="empty">
      <svg class="empty-mark" aria-hidden="true"><use href="#i-search"></use></svg>
      <p class="empty-title">没有找到</p>
      <p class="empty-note">「${escapeHtml(state.query)}」没有匹配的记录，换个关键词试试。</p>
    </div>`;
    $('#searchCount').textContent = '0 条匹配';
  } else {
    stream.innerHTML = sections.join('');
    $('#searchCount').textContent = query ? `${formatNumber(matched)} 条匹配` : '';
  }

  state.pendingHighlight = null;
}

function renderStats() {
  const { entries, chars } = countMemo(state.doc);
  $('#stats').textContent = `${formatNumber(entries)} 条 · ${formatNumber(chars)} 字`;
}

function setFilePath(filePath) {
  const el = $('#filePath');
  el.textContent = filePath || 'PureMemo.md';
  el.parentElement.title = filePath ? `${filePath}\n点击在资源管理器中显示` : '';
  $('#settingPath').textContent = filePath || '未选择';
}

function updateComposerDate() {
  const now = new Date();
  $('#composerDate').textContent = `${monthDayLabel(dateKey(now))} · ${weekdayOf(dateKey(now))}`;
}

/* ------------------------------------------------------------------ */
/* 数据                                                                */
/* ------------------------------------------------------------------ */

async function refresh() {
  const memo = await platform.readMemo();
  state.raw = memo.text || '';
  state.doc = parseMemo(state.raw);
  setFilePath(memo.path);
  renderStream();
  renderStats();
}

async function saveEntry(body) {
  const text = String(body ?? '').trim();
  if (!text || state.saving) return false;
  state.saving = true;
  try {
    let latest = state.raw;
    try {
      const memo = await platform.readMemo();
      latest = memo.text ?? latest;
    } catch {
      /* 读不到就用内存里的内容 */
    }
    const result = appendEntry(latest, text, new Date());
    const saved = await platform.writeMemo(result.text);
    state.raw = result.text;
    state.doc = parseMemo(result.text);
    const firstEntry = state.doc.days[0]?.entries[0];
    state.pendingHighlight = firstEntry
      ? `${state.doc.days[0].key}|${firstEntry.time}|${firstEntry.text}`
      : null;
    setFilePath(saved.path);
    renderStream();
    renderStats();
    return true;
  } catch (error) {
    toast(`写入失败：${friendlyError(error)}`, 4200);
    return false;
  } finally {
    state.saving = false;
  }
}

async function submit() {
  if (state.recording || state.transcribing || state.saving) return;
  const input = $('#input');
  const body = input.value;
  if (!body.trim()) {
    shakeComposer();
    toast('先写点什么');
    input.focus();
    return;
  }
  const ok = await saveEntry(body);
  if (ok) {
    input.value = '';
    autosize();
    input.focus();
    scrollToTop(true);
    toast('已记下');
  }
}

/* ------------------------------------------------------------------ */
/* 搜索                                                                */
/* ------------------------------------------------------------------ */

function openSearch() {
  $('#searchPanel').hidden = false;
  const input = $('#searchInput');
  input.focus();
  input.select();
}

function closeSearch() {
  $('#searchPanel').hidden = true;
  $('#searchInput').value = '';
  state.query = '';
  renderStream();
}

/* ------------------------------------------------------------------ */
/* 录音                                                                */
/* ------------------------------------------------------------------ */

function buildWave() {
  const wave = $('#wave');
  wave.innerHTML = '';
  for (let index = 0; index < 30; index += 1) {
    wave.appendChild(document.createElement('span'));
  }
  return wave;
}

function setRecordingUI(on) {
  $('#recorder').hidden = !on;
  $('#composer').classList.toggle('is-recording', on);
  $('#micBtn').hidden = on;
  $('#saveBtn').disabled = on;
  $('#input').disabled = on;
  if (!on) {
    $('#micBtn').hidden = false;
    $('#input').disabled = state.transcribing;
    $('#saveBtn').disabled = state.transcribing;
    $('#micBtn').disabled = state.transcribing;
  }
}

async function startRecording() {
  if (state.recording || state.startingRecording || state.transcribing) return;
  state.startingRecording = true;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (error) {
    state.startingRecording = false;
    if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
      toast('麦克风权限被拒绝：Windows 设置 › 隐私和安全性 › 麦克风，允许桌面应用访问', 5200);
    } else if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      toast('没有找到麦克风设备');
    } else {
      toast(`无法开始录音：${friendlyError(error)}`, 4200);
    }
    return;
  }

  let context;
  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    context = new AudioContext();
  }
  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch {
      /* ignore */
    }
  }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const processor = context.createScriptProcessor(2048, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;

  const chunks = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };

  source.connect(analyser);
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  const wave = buildWave();
  const bars = Array.from(wave.children);
  const frequency = new Uint8Array(analyser.frequencyBinCount);

  const startedAt = performance.now();
  const recording = {
    stream,
    context,
    source,
    analyser,
    processor,
    mute,
    chunks,
    sampleRate: context.sampleRate,
    startedAt,
    timerId: null,
    raf: 0,
  };
  state.recording = recording;
  state.startingRecording = false;

  setRecordingUI(true);
  $('#recTime').textContent = '00:00';

  const tick = () => {
    if (state.recording !== recording) return;
    analyser.getByteFrequencyData(frequency);
    for (let index = 0; index < bars.length; index += 1) {
      const value = frequency[Math.floor((index * frequency.length) / bars.length)] / 255;
      bars[index].style.height = `${4 + Math.min(1, value * 1.7) * 20}px`;
    }
    recording.raf = requestAnimationFrame(tick);
  };
  recording.raf = requestAnimationFrame(tick);

  recording.timerId = setInterval(() => {
    if (state.recording !== recording) return;
    const elapsed = (performance.now() - startedAt) / 1000;
    $('#recTime').textContent = formatClock(elapsed);
    if (elapsed >= MAX_RECORD_SECONDS) {
      toast('已到 5 分钟上限，自动停止');
      stopRecording();
    }
  }, 200);
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function mergeChunks(chunks, sampleRate) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return downsample(merged, sampleRate, SAMPLE_RATE);
}

function downsample(samples, fromRate, toRate) {
  if (!samples.length || fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(length);
  let cursor = 0;
  for (let index = 0; index < length; index += 1) {
    const next = Math.min(samples.length, Math.round((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let pos = cursor; pos < next; pos += 1) {
      sum += samples[pos];
      count += 1;
    }
    output[index] = count ? sum / count : 0;
    cursor = next;
  }
  return output;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

async function stopRecording({ cancel = false } = {}) {
  const recording = state.recording;
  if (!recording) return;
  state.recording = null;

  clearInterval(recording.timerId);
  cancelAnimationFrame(recording.raf);

  try {
    recording.processor.disconnect();
    recording.source.disconnect();
    recording.mute.disconnect();
    recording.analyser.disconnect();
  } catch {
    /* ignore */
  }
  for (const track of recording.stream.getTracks()) track.stop();
  try {
    await recording.context.close();
  } catch {
    /* ignore */
  }

  setRecordingUI(false);
  $('#recTime').textContent = '00:00';

  if (cancel) {
    toast('已取消录音');
    $('#input').focus();
    return;
  }

  const samples = mergeChunks(recording.chunks, recording.sampleRate);
  const seconds = samples.length / SAMPLE_RATE;
  if (seconds < 0.6) {
    toast('录音太短，再说一次');
    $('#input').focus();
    return;
  }

  await transcribeWav(encodeWav(samples, SAMPLE_RATE));
}

/* ------------------------------------------------------------------ */
/* 转写                                                                */
/* ------------------------------------------------------------------ */

function showTranscribing(text) {
  $('#transcribe').hidden = false;
  $('#transcribeText').textContent = text;
}

function hideTranscribing() {
  $('#transcribe').hidden = true;
}

async function transcribeWav(wav) {
  state.transcribing = true;
  state.cancelRequested = false;
  setBusy(true);
  showTranscribing('正在启动 BaoCut…');

  const unsubscribe = platform.onTranscribeProgress((payload) => {
    if (!state.transcribing) return;
    if (state.cancelRequested) return;
    const percent = payload?.percent != null ? ` · ${payload.percent}%` : '';
    showTranscribing(`${payload?.stage || '正在转写'}${percent}`);
  });

  try {
    const result = await platform.transcribe({
      wav,
      language: state.settings?.language || 'zh-CN',
    });

    if ((state.settings?.voiceMode || 'direct') === 'edit') {
      const input = $('#input');
      const existing = input.value.trim();
      input.value = existing ? `${existing}\n${result.text}` : result.text;
      const end = input.value.length;
      input.setSelectionRange(end, end);
      autosize();
      toast('已转写，修改后按 Ctrl+Enter 或「记下」写入', 4600);
      return;
    }

    const ok = await saveEntry(result.text);
    if (ok) {
      scrollToTop(true);
      toast(`语音已记下 · 用时 ${Math.max(1, Math.round(result.elapsedMs / 1000))} 秒`);
    } else {
      $('#input').value = result.text;
      autosize();
    }
  } catch (error) {
    const message = friendlyError(error);
    if (state.cancelRequested || message.includes('CANCELLED')) {
      toast('已取消转写');
    } else {
      toast(message || '转写失败', 5200);
    }
  } finally {
    state.transcribing = false;
    hideTranscribing();
    setBusy(false);
    unsubscribe?.();
    $('#input').focus();
  }
}

async function cancelTranscription() {
  if (!state.transcribing) return;
  state.cancelRequested = true;
  showTranscribing('正在取消…');
  try {
    await platform.cancelTranscribe();
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* BaoCut 状态                                                         */
/* ------------------------------------------------------------------ */

function setBaoStatus(mode, detail = '') {
  const dot = $('#baoDot');
  dot.classList.remove('ok', 'bad');
  const btn = $('#baoStatus');
  if (mode === 'ok') {
    dot.classList.add('ok');
    btn.textContent = `BaoCut · ${modelLabel(state.probe?.model)}`;
    btn.title = `${state.probe?.cli || ''}\n模型：${state.probe?.model || '—'}`;
  } else if (mode === 'bad') {
    dot.classList.add('bad');
    btn.textContent = 'BaoCut 未就绪';
    btn.title = detail || state.probe?.reason || '点击查看设置';
  } else {
    btn.textContent = 'BaoCut 检测中';
    btn.title = '正在检测本机 BaoCut';
  }
}

async function refreshBaoStatus() {
  setBaoStatus('checking');
  try {
    const probe = await platform.probeBaoCut();
    state.probe = probe;
    setBaoStatus(probe?.available ? 'ok' : 'bad', probe?.reason);
    $('#settingBao').textContent = probe?.available
      ? `可用 · ${probe.cli} · 模型 ${probe.model || '—'}`
      : `${probe?.cli || '未找到 CLI'} · ${probe?.reason || '不可用'}`;
  } catch (error) {
    setBaoStatus('bad', friendlyError(error));
    $('#settingBao').textContent = `检测失败：${friendlyError(error)}`;
  }
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function applySettingsUI() {
  const settings = state.settings || {};
  $('#settingPath').textContent = settings.memoPath || '未选择';
  $('#version').textContent = settings.version ? `v${settings.version}` : '';
  $('#langGroup').querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.lang === (settings.language || 'zh-CN'));
  });
  $('#voiceModeGroup').querySelectorAll('button').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === (settings.voiceMode || 'direct'));
  });
}

async function openSettings() {
  applySettingsUI();
  if (!state.probe) refreshBaoStatus();
  const dialog = $('#settingsDialog');
  if (!dialog.open) dialog.showModal();
}

async function updateLanguage(language) {
  state.settings = { ...(state.settings || {}), language };
  applySettingsUI();
  try {
    await platform.updateSettings({ language });
  } catch {
    /* ignore */
  }
}

async function updateVoiceMode(voiceMode) {
  state.settings = { ...(state.settings || {}), voiceMode };
  applySettingsUI();
  try {
    await platform.updateSettings({ voiceMode });
  } catch {
    /* ignore */
  }
}

async function changeMemoFile() {
  const memo = await platform.chooseMemo();
  if (!memo) return;
  state.raw = memo.text || '';
  state.doc = parseMemo(state.raw);
  setFilePath(memo.path);
  state.settings = { ...(state.settings || {}), memoPath: memo.path };
  renderStream();
  renderStats();
  scrollToTop(false);
  toast('已切换记录文件');
}

async function chooseBaoCut() {
  try {
    const probe = await platform.chooseBaoCut();
    if (!probe) return;
    state.probe = probe;
    setBaoStatus(probe.available ? 'ok' : 'bad', probe.reason);
    $('#settingBao').textContent = probe.available
      ? `可用 · ${probe.cli} · 模型 ${probe.model || '—'}`
      : `${probe.cli || '未找到 CLI'} · ${probe.reason || '不可用'}`;
  } catch (error) {
    toast(friendlyError(error));
  }
}

/* ------------------------------------------------------------------ */
/* 事件                                                                */
/* ------------------------------------------------------------------ */

function autosize() {
  const input = $('#input');
  input.style.height = 'auto';
  const max = Math.floor(window.innerHeight * 0.42);
  input.style.height = `${Math.min(input.scrollHeight, max)}px`;
}

function bindEvents() {
  $('#saveBtn').addEventListener('click', submit);

  const input = $('#input');
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  });

  $('#micBtn').addEventListener('click', startRecording);
  $('#recStop').addEventListener('click', () => stopRecording());
  $('#recCancel').addEventListener('click', () => stopRecording({ cancel: true }));
  $('#transcribeCancel').addEventListener('click', cancelTranscription);

  $('#searchBtn').addEventListener('click', openSearch);
  $('#searchClose').addEventListener('click', closeSearch);
  $('#searchInput').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderStream();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#baoStatus').addEventListener('click', openSettings);
  $('#fileLink').addEventListener('click', () => platform.revealMemo());

  $('#setPathBtn').addEventListener('click', changeMemoFile);
  $('#setBaoBtn').addEventListener('click', chooseBaoCut);
  $('#probeBtn').addEventListener('click', refreshBaoStatus);
  $('#revealBtn').addEventListener('click', () => platform.revealMemo());
  $('#doneBtn').addEventListener('click', () => $('#settingsDialog').close());

  $('#langGroup').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lang]');
    if (button) updateLanguage(button.dataset.lang);
  });

  $('#voiceModeGroup').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (button) updateVoiceMode(button.dataset.mode);
  });

  const dialog = $('#settingsDialog');
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;

    if (mod && !event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openSearch();
      return;
    }

    if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      if (state.recording) stopRecording();
      else startRecording();
      return;
    }

    if (event.key === 'Escape') {
      if (dialog.open) return;
      if (state.recording) {
        event.preventDefault();
        stopRecording({ cancel: true });
        return;
      }
      if (state.transcribing) {
        event.preventDefault();
        cancelTranscription();
        return;
      }
      if (!$('#searchPanel').hidden) {
        event.preventDefault();
        closeSearch();
      }
    }
  });

  window.addEventListener('resize', autosize);
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  bindEvents();
  updateComposerDate();
  setInterval(updateComposerDate, 60000);

  try {
    state.settings = await platform.getSettings();
  } catch {
    state.settings = { language: 'zh-CN' };
  }
  applySettingsUI();

  try {
    await refresh();
  } catch (error) {
    toast(`无法读取记录文件：${friendlyError(error)}`, 5200);
  }

  autosize();
  $('#input').focus();
  refreshBaoStatus();
}

init();
