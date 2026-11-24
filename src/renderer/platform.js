/**
 * 平台桥：渲染层只依赖这一层，不直接碰 Node / Electron。
 *
 * 契约（Android WebView、鸿蒙 ArkWeb、桌面端各自实现同名方法即可无缝迁移）：
 *   readMemo()                -> { path, text, exists }
 *   writeMemo(text)           -> { path, bytes }
 *   revealMemo()              -> boolean
 *   chooseMemo()              -> memo | null
 *   getSettings()             -> { memoPath, language, baocutPath, version, platform }
 *   updateSettings(patch)     -> settings
 *   probeBaoCut()             -> { available, cli, model, version, reason }
 *   transcribe({ wav, language }) -> { text, language, model, elapsedMs }
 *   cancelTranscribe()        -> boolean
 *   onTranscribeProgress(cb)  -> unsubscribe
 */

const STORAGE_KEY = 'purememo.memo.text';
const SETTINGS_KEY = 'purememo.settings';

function createBrowserFallback() {
  const readStore = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    kind: 'browser-preview',
    platform: 'web',
    async readMemo() {
      return {
        path: '浏览器预览 · localStorage',
        text: localStorage.getItem(STORAGE_KEY) || '',
        exists: Boolean(localStorage.getItem(STORAGE_KEY)),
      };
    },
    async writeMemo(text) {
      localStorage.setItem(STORAGE_KEY, text);
      return { path: '浏览器预览 · localStorage', bytes: text.length };
    },
    async revealMemo() {
      return false;
    },
    async chooseMemo() {
      return null;
    },
    async getSettings() {
      return {
        memoPath: '浏览器预览 · localStorage',
        language: 'zh-CN',
        baocutPath: '',
        version: 'web-preview',
        platform: 'web',
        ...readStore(SETTINGS_KEY, {}),
      };
    },
    async updateSettings(patch) {
      const next = { ...readStore(SETTINGS_KEY, {}), ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    },
    async probeBaoCut() {
      return {
        available: false,
        cli: '',
        model: '',
        version: '',
        reason: '浏览器预览不支持本机转写',
      };
    },
    async transcribe() {
      throw new Error('浏览器预览模式不支持语音转写，请在 PureMemo 桌面应用中使用');
    },
    async cancelTranscribe() {
      return false;
    },
    onTranscribeProgress() {
      return () => {};
    },
  };
}

export const platform = window.purememo ?? createBrowserFallback();
export const isNativeShell = Boolean(window.purememo);
