import { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeTranscript } from '../core/transcript.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP_ID = 'app.purememo.desktop';
const TRANSCRIBE_TIMEOUT_MS = 20 * 60 * 1000;

app.setAppUserModelId(APP_ID);
app.setName('PureMemo');

const DEFAULT_SETTINGS = {
  memoPath: '',
  language: 'zh-CN',
  voiceMode: 'direct',
  baocutPath: '',
};

let mainWindow = null;
let tray = null;
let isQuitting = false;
let closePromptOpen = false;
let trayHintShown = false;
let settings = null;
let settingsFile = '';
let probeCache = { at: 0, value: null };
let activeTranscribeChild = null;
let transcribeCancelled = false;

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

function defaultMemoPath() {
  return path.join(app.getPath('documents'), 'PureMemo.md');
}

async function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  let stored = {};
  try {
    const raw = await fs.readFile(settingsFile, 'utf8');
    stored = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    stored = {};
  }
  settings = { ...DEFAULT_SETTINGS, ...stored };
  if (!settings.memoPath) settings.memoPath = defaultMemoPath();
  if (!['zh-CN', 'en', 'auto'].includes(settings.language)) settings.language = 'zh-CN';
  if (!['direct', 'edit'].includes(settings.voiceMode)) settings.voiceMode = 'direct';
}

async function saveSettings() {
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* 单一文件读写                                                        */
/* ------------------------------------------------------------------ */

async function readMemo() {
  const file = settings.memoPath;
  try {
    const text = await fs.readFile(file, 'utf8');
    return { path: file, text, exists: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: file, text: '', exists: false };
    throw error;
  }
}

async function writeMemo(text) {
  const file = settings.memoPath;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, String(text ?? ''), 'utf8');
  await fs.rename(tmp, file);
  return { path: file, bytes: Buffer.byteLength(String(text ?? ''), 'utf8') };
}

/* ------------------------------------------------------------------ */
/* BaoCut CLI                                                          */
/* ------------------------------------------------------------------ */

function baocutCandidates() {
  const list = [];
  if (settings?.baocutPath) list.push(settings.baocutPath);
  if (process.env.BAOCUT_CLI) list.push(process.env.BAOCUT_CLI);
  if (process.env.LOCALAPPDATA) {
    list.push(path.join(process.env.LOCALAPPDATA, 'BaoCut', 'bin', 'baocut.cmd'));
  }
  list.push('baocut.cmd', 'baocut');
  return [...new Set(list.filter(Boolean))];
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(command) {
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.bat', '.exe'] : [''];
  const hasExtension = Boolean(path.extname(command));
  const folders = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const folder of folders) {
    for (const extension of extensions) {
      const suffix = hasExtension ? '' : extension;
      const full = path.join(folder, command + suffix);
      if (await fileExists(full)) return full;
    }
  }
  return null;
}

async function resolveBaoCut() {
  for (const candidate of baocutCandidates()) {
    const isPath = candidate.includes(path.sep) || candidate.includes('/');
    if (isPath) {
      if (await fileExists(candidate)) return candidate;
      continue;
    }
    const found = await findOnPath(candidate);
    if (found) return found;
  }
  return null;
}

function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
}

/**
 * 运行 baocut（Windows 上是 .cmd，需要经 cmd.exe 启动）。
 * onLine 会收到 stderr / stdout 的每一行，用于展示任务进度。
 */
function runBaoCut(cli, args, { onLine, onSpawn, timeoutMs = TRANSCRIBE_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const command = isWin ? process.env.ComSpec || 'cmd.exe' : cli;
    const commandArgs = isWin ? ['/d', '/c', cli, ...args] : args;

    const child = spawn(command, commandArgs, {
      windowsHide: true,
      env: process.env,
    });
    if (onSpawn) onSpawn(child);

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const buffers = { out: '', err: '' };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };

    const emitLines = (chunk, key) => {
      buffers[key] += chunk;
      const parts = buffers[key].split(/\r?\n/);
      buffers[key] = parts.pop() ?? '';
      for (const line of parts) {
        if (line.trim() && onLine) onLine(line, key === 'err');
      }
    };

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      emitLines(text, 'out');
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      emitLines(text, 'err');
    });

    child.on('error', (error) => finish(reject, error));

    child.on('close', (code) => {
      const readout = (text) => {
        const lines = text.trim().split(/\r?\n/).filter(Boolean);
        return lines[lines.length - 1] ?? '';
      };
      if (code === 0) {
        finish(resolve, { stdout, stderr });
        return;
      }
      const error = new Error(`BaoCut 退出码 ${code}${readout(stderr) ? `：${readout(stderr)}` : ''}`);
      error.code = 'CLI_FAILED';
      error.stdout = stdout;
      error.stderr = stderr;
      finish(reject, error);
    });

    timer = setTimeout(() => {
      killTree(child);
      const error = new Error('转写超时，请缩短录音后重试');
      error.code = 'TIMEOUT';
      finish(reject, error);
    }, timeoutMs);
  });
}

function parseJsonOutput(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try {
      return JSON.parse(lines[index]);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function probeBaoCut(force = false) {
  if (!force && probeCache.value && Date.now() - probeCache.at < 15000) {
    return probeCache.value;
  }
  const cli = await resolveBaoCut();
  let value = {
    available: false,
    cli: cli || '',
    model: '',
    version: '',
    reason: '未检测到 BaoCut',
  };

  if (!cli) {
    value.reason = '未找到 BaoCut CLI，可在设置中手动指定';
    probeCache = { at: Date.now(), value };
    return value;
  }

  try {
    const { stdout } = await runBaoCut(cli, ['status', '--json'], { timeoutMs: 30000 });
    const parsed = parseJsonOutput(stdout);
    const result = parsed?.result;
    if (parsed?.ok && result) {
      const capabilities = result.capabilities?.capabilities ?? [];
      const transcribe = capabilities.find((item) => item.capability === 'transcribe');
      const effective = transcribe?.effective;
      value = {
        available: Boolean(effective?.providerId),
        cli,
        model: effective?.modelId || '',
        version: result.runtime?.version || '',
        reason: effective?.providerId ? '' : 'BaoCut 未配置转写模型',
      };
    } else {
      value.reason = 'BaoCut 返回了无法识别的结果';
    }
  } catch (error) {
    const detail = (error.stderr || error.message || '').trim();
    value.reason = /not recognized|不是内部或外部命令|ENOENT/i.test(detail)
      ? '未找到 BaoCut CLI'
      : detail.split(/\r?\n/).pop() || 'BaoCut 不可用';
  }

  probeCache = { at: Date.now(), value };
  return value;
}

function describeProgress(line) {
  const text = line.trim();
  const fraction = text.match(/(\d+)\s*\/\s*(\d+)/);
  const percent = fraction ? Math.round((Number(fraction[1]) / Number(fraction[2])) * 100) : null;

  let stage = '正在转写';
  if (/starting|准备/i.test(text)) stage = '启动本地转写引擎';
  else if (/validating|校验/i.test(text)) stage = '校验音频';
  else if (/publishing|整理/i.test(text)) stage = '整理文稿';
  else if (/done|完成/i.test(text)) stage = '完成';
  else if (/transcrib|转写/i.test(text)) stage = '正在转写';

  return { stage, percent, raw: text };
}

async function transcribeAudio(payload) {
  const bytes = payload?.wav;
  if (!bytes) throw new Error('没有拿到录音数据');

  const buffer = Buffer.from(new Uint8Array(bytes));
  if (buffer.byteLength < 1000) throw new Error('录音太短，没有可转写的内容');

  const language = payload?.language || settings.language || 'zh-CN';
  const cli = await resolveBaoCut();
  if (!cli) {
    const error = new Error('未找到 BaoCut CLI，请在设置中指定 baocut.cmd 的位置');
    error.code = 'BAOCUT_NOT_FOUND';
    throw error;
  }

  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), 'purememo-'));
  const audioPath = path.join(jobDir, 'voice.wav');
  const outDir = path.join(jobDir, 'out');
  await fs.writeFile(audioPath, buffer);

  const send = (payloadProgress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcribe:progress', payloadProgress);
    }
  };

  const args = [
    '--json',
    'transcribe',
    '--file',
    audioPath,
    '--no-video',
    '--out-dir',
    outDir,
  ];
  if (language !== 'auto') args.push('--language', language);

  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let retried = false;
  transcribeCancelled = false;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      send({ stage: attempt === 0 ? '本地模型加载中' : '重试中', percent: null });
      try {
        const result = await runBaoCut(cli, args, {
          onSpawn: (child) => {
            activeTranscribeChild = child;
          },
          onLine: (line) => {
            const progress = describeProgress(line);
            send(progress);
          },
        });
        stdout = result.stdout;
        stderr = result.stderr;
        break;
      } catch (error) {
        if (transcribeCancelled) {
          const cancelled = new Error('CANCELLED::已取消转写');
          cancelled.code = 'CANCELLED';
          throw cancelled;
        }
        stderr = error.stderr || stderr;
        const runtimeGlitch = /RUNTIME_START_FAILED|runtime.*(start|启动).*(失败|failed)/i.test(stderr);
        if (attempt === 0 && !retried && runtimeGlitch) {
          retried = true;
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        throw error;
      }
    }

    const parsed = parseJsonOutput(stdout);
    const result = parsed?.result ?? {};
    const summary =
      result.job?.pipeline?.summary ??
      result.pipeline?.summary ??
      result.summary ??
      null;

    let txtPath = (summary?.files ?? []).find((file) => /\.txt$/i.test(file));
    if (!txtPath) {
      txtPath = (result.outputs ?? []).map((item) => item.path).find((file) => /\.txt$/i.test(file || ''));
    }
    if (!txtPath) throw new Error('BaoCut 没有生成文稿文件');

    let raw = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        raw = await fs.readFile(txtPath, 'utf8');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!raw) throw new Error('无法读取转写文稿');

    const text = normalizeTranscript(raw);
    if (!text) {
      const error = new Error('没有识别到语音，请靠近麦克风再试一次');
      error.code = 'EMPTY_TRANSCRIPT';
      throw error;
    }

    send({ stage: '完成', percent: 100 });
    return {
      text,
      language: summary?.language || language,
      model: summary?.modelId || probeCache.value?.model || '',
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error.code === 'CLI_FAILED' || error.code === 'ENOENT') {
      const detail = (error.stderr || '').trim().split(/\r?\n/).pop();
      error.hint = detail || '请确认本机已安装并登录 BaoCut';
    }
    throw error;
  } finally {
    activeTranscribeChild = null;
    fs.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* 窗口                                                                */
/* ------------------------------------------------------------------ */

function iconPath() {
  return process.platform === 'win32'
    ? path.join(ROOT, 'assets', 'icon.ico')
    : path.join(ROOT, 'assets', 'icon-512.png');
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon-32.png'));
  tray = new Tray(image);
  tray.setToolTip('PureMemo');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 PureMemo', click: showMainWindow },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#F6F2E9',
    title: 'PureMemo',
    icon: iconPath(),
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#F6F2E9',
      symbolColor: '#1C1B19',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        title: '关闭 PureMemo',
        message: '要退出 PureMemo 吗？',
        detail: '选择「留在托盘」后，程序会继续在系统通知区域待命，点击托盘图标可随时打开。',
        buttons: ['退出', '留在托盘'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          isQuitting = true;
          app.quit();
          return;
        }
        mainWindow?.hide();
        if (!trayHintShown && tray) {
          trayHintShown = true;
          tray.displayBalloon({
            title: 'PureMemo 仍在运行',
            content: '点击托盘图标可重新打开，右键托盘图标可退出。',
            iconType: 'info',
          });
        }
      })
      .finally(() => {
        closePromptOpen = false;
      })
      .catch(() => {
        closePromptOpen = false;
      });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.loadFile(path.join(ROOT, 'renderer', 'index.html'));
}

function registerIpc() {
  ipcMain.handle('memo:read', () => readMemo());
  ipcMain.handle('memo:write', (_event, text) => writeMemo(text));
  ipcMain.handle('memo:reveal', () => {
    if (!settings.memoPath) return false;
    shell.showItemInFolder(settings.memoPath);
    return true;
  });

  ipcMain.handle('memo:choose', async () => {
    const current = settings.memoPath;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '选择 PureMemo 记录文件',
      defaultPath: current,
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: '纯文本', extensions: ['txt'] },
      ],
      properties: ['createDirectory'],
    });
    if (result.canceled || !result.filePath) return null;
    settings.memoPath = result.filePath;
    await saveSettings();
    return readMemo();
  });

  ipcMain.handle('settings:get', async () => ({
    memoPath: settings.memoPath,
    language: settings.language,
    voiceMode: settings.voiceMode,
    baocutPath: settings.baocutPath,
    defaultMemoPath: defaultMemoPath(),
    version: app.getVersion(),
    platform: process.platform,
    appId: APP_ID,
  }));

  ipcMain.handle('settings:update', async (_event, patch) => {
    if (!patch || typeof patch !== 'object') return null;
    if (typeof patch.memoPath === 'string' && patch.memoPath.trim()) {
      settings.memoPath = path.resolve(patch.memoPath.trim());
    }
    if (['zh-CN', 'en', 'auto'].includes(patch.language)) {
      settings.language = patch.language;
    }
    if (['direct', 'edit'].includes(patch.voiceMode)) {
      settings.voiceMode = patch.voiceMode;
    }
    if (typeof patch.baocutPath === 'string') {
      settings.baocutPath = patch.baocutPath.trim();
      probeCache = { at: 0, value: null };
    }
    await saveSettings();
    return {
      memoPath: settings.memoPath,
      language: settings.language,
      voiceMode: settings.voiceMode,
      baocutPath: settings.baocutPath,
    };
  });

  ipcMain.handle('baocut:probe', () => probeBaoCut(true));

  ipcMain.handle('baocut:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 BaoCut CLI',
      properties: ['openFile'],
      filters: [{ name: 'BaoCut CLI', extensions: ['cmd', 'exe', 'bat'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return null;
    settings.baocutPath = result.filePaths[0];
    await saveSettings();
    probeCache = { at: 0, value: null };
    return probeBaoCut(true);
  });

  ipcMain.handle('transcribe:run', (_event, payload) => transcribeAudio(payload));

  ipcMain.handle('transcribe:cancel', () => {
    if (!activeTranscribeChild) return false;
    transcribeCancelled = true;
    killTree(activeTranscribeChild);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await loadSettings();

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      return permission === 'media';
    });

    registerIpc();
    createWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showMainWindow();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
