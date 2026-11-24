const { contextBridge, ipcRenderer } = require('electron');

/**
 * 平台桥（Desktop / Electron 实现）。
 * Android（WebView + JS Bridge）和鸿蒙（ArkWeb）后续只需实现同名方法，
 * 渲染层代码零改动即可复用。
 */
const progressListeners = new Set();

ipcRenderer.on('transcribe:progress', (_event, payload) => {
  for (const listener of progressListeners) {
    try {
      listener(payload);
    } catch {
      /* ignore listener errors */
    }
  }
});

contextBridge.exposeInMainWorld('purememo', {
  kind: 'electron',
  platform: process.platform,
  readMemo: () => ipcRenderer.invoke('memo:read'),
  writeMemo: (text) => ipcRenderer.invoke('memo:write', text),
  revealMemo: () => ipcRenderer.invoke('memo:reveal'),
  chooseMemo: () => ipcRenderer.invoke('memo:choose'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  probeBaoCut: () => ipcRenderer.invoke('baocut:probe'),
  chooseBaoCut: () => ipcRenderer.invoke('baocut:choose'),
  transcribe: (payload) => ipcRenderer.invoke('transcribe:run', payload),
  cancelTranscribe: () => ipcRenderer.invoke('transcribe:cancel'),
  onTranscribeProgress: (callback) => {
    progressListeners.add(callback);
    return () => progressListeners.delete(callback);
  },
});
