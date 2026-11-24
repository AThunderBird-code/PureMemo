# PureMemo

<p align="center">
  <img src="src/assets/icon-256.png" width="112" alt="PureMemo icon" />
</p>

<p align="center">
  极简日记 · 一个文件 · 最新的一条永远在最上面<br />
  Minimal memo · one plain-text file · newest on top
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a> · <a href="LICENSE">MIT License</a>
</p>

---

## 中文

PureMemo 是一个极小化的 Windows 日记应用。它只做一件事：把你此刻想到的事实，以最低摩擦丢进**唯一一个纯文本文件的最顶部**。

不分类、不打标签、不设层级、不写感悟。Append-only，像剪贴板一样记流水账。灵感来自 Andrej Karpathy 与马伯庸的「单文件记录」方法：需要时直接搜索，或者把整份文件交给 AI 当记忆语料。

### 特性

- **只往顶部写**：每条新记录插入文件最上方，最近的内容永远第一眼可见
- **按天分隔**：每天开头和结尾都有完整日期标记，方便阅读，也方便 AI 按天切分
- **单文件纯文本**：默认 `文档/PureMemo.md`，可用任意编辑器打开，`Ctrl+F` 即可检索
- **语音记录**：调用本机 BaoCut 的 MOSS 模型离线转写，说完即记
- **转写结果可选**：直接写入，或先放进输入框修改后再写入
- **托盘待命**：点 × 可选择退出或留在系统通知区域
- **跨端预留**：核心逻辑与界面、平台桥分层，便于后续改造为 Android / 鸿蒙应用

### 安装与运行

Windows 10/11 x64。

**直接使用**：运行 `PureMemo-Setup-<version>.exe` 安装，或使用免安装的 `PureMemo-<version>-portable.exe`（构建产物不随仓库提交，可在本地执行 `npm run dist` 生成）。

**从源码运行**（Node.js 18+）：

```bash
npm install
npm start
```

**打包**：

```bash
npm run dist
```

产物位于 `dist/`：NSIS 安装包与 portable 单文件版。应用未做代码签名，Windows SmartScreen 可能提示「未知发布者」。

### 使用方法

- 在底部输入框写下事实，按 `Ctrl+Enter` 或点「记下」写入；`Enter` 换行
- `Ctrl+F` 搜索全部记录，`Esc` 关闭搜索
- `Ctrl+Shift+M` 开始 / 停止录音（也可点麦克风按钮）
- 点击右上角齿轮进入设置：
  - 更换记录文件位置
  - 选择转写语言（中文 / English / 自动）
  - 选择语音转写结果的处理方式：直接写入，或先放入输入框
  - 手动指定 `baocut.cmd` 路径
- 点击 × 后选择「退出」或「留在托盘」；托盘图标单击打开，右键可退出

### 语音转写

PureMemo 不内置语音模型，而是复用本机已安装的 BaoCut CLI 及其 MOSS 模型，完全离线：

1. 首次录音结束后会自动加载本地模型，耗时略长，请耐心等待
2. 应用会依次查找：设置中的路径 → 环境变量 `BAOCUT_CLI` → `%LOCALAPPDATA%\BaoCut\bin\baocut.cmd` → `PATH` 中的 `baocut`
3. 录音仅作为临时 WAV 存在系统临时目录，转写完成即删除，不会上传

若提示找不到 BaoCut，请在设置中手动指定 `baocut.cmd` 的位置。

### 记录格式

```markdown
# PureMemo

极简记录。只写事实，不写感悟。最新的一条永远在最上面。

【2026-11-24 周二】
- 10:31 下午三点在会议室评审 PureMemo 的方案。
- 10:30 取了快递，是三本书。

【2026-11-24 周二 · 结束】

【2026-11-23 周一】
- 20:40 早上跑了 3 公里，风很大。

【2026-11-23 周一 · 结束】
```

每一天是一个区块：日期标题在上，`结束` 标记在下；当天的新记录插在当天区块的最上面。

### 跨平台设计

代码分成三层，为 Android / 鸿蒙迁移预留：

```text
src/
  core/      纯 JS 的文件格式、解析与追加逻辑，无平台依赖
  renderer/  Web 界面；Android WebView / 鸿蒙 ArkWeb 可直接加载
  main/      Electron 桌面壳、文件系统、录音与 BaoCut 调用
  assets/    Logo、图标与字体
```

移动端只需实现与 `platform.js` 相同的桥接接口（读写文件、录音、转写），即可复用 `core` 与 `renderer`。

### 隐私

所有记录与音频都只在本机处理，没有账号、没有云同步、没有遥测。

### 许可证

[MIT](LICENSE)

---

## English

PureMemo is a deliberately tiny Windows memo app. It does one thing: drop the fact you just thought of at the **very top of a single plain-text file**, with as little friction as possible.

No tags, no folders, no hierarchy, no commentary. Append-only, used like a clipboard. Inspired by the one-file note-taking practice of Andrej Karpathy and Ma Boyong: search when you need something, or hand the whole file to an AI as memory.

### Features

- **Newest on top** — every new entry is inserted at the top of the file
- **Daily boundaries** — each day starts and ends with a full date marker, easy for humans and LLMs to split
- **One plain-text file** — defaults to `Documents/PureMemo.md`; edit it anywhere, search with `Ctrl+F`
- **Voice capture** — records from the microphone and transcribes locally with BaoCut's MOSS model
- **Transcription handling** — write immediately, or put the text in the composer for editing first
- **Tray standby** — closing the window can exit or keep running in the notification area
- **Portable by design** — core, renderer and platform bridge are separated for future Android / HarmonyOS shells

### Install & run

Windows 10/11 x64.

Use `PureMemo-Setup-<version>.exe`, or the standalone `PureMemo-<version>-portable.exe` (build artifacts are not committed; generate them with `npm run dist`).

From source (Node.js 18+):

```bash
npm install
npm start
```

Build installers:

```bash
npm run dist
```

Outputs go to `dist/` (NSIS installer and portable executable). The build is unsigned, so SmartScreen may show an "Unknown publisher" warning.

### Usage

- Type a fact in the composer and press `Ctrl+Enter` or click **记下**; `Enter` inserts a newline
- `Ctrl+F` searches all entries, `Esc` closes search
- `Ctrl+Shift+M` starts / stops recording (or use the microphone button)
- Open settings with the gear icon to change the memo file, transcription language, how transcripts are handled, and the `baocut.cmd` path
- Closing the window asks whether to quit or stay in the tray; click the tray icon to reopen, right-click to quit

### Voice transcription

PureMemo ships no speech model. It reuses the locally installed BaoCut CLI and its MOSS model, fully offline:

1. The local model loads after the first recording, so the first transcription takes longer
2. Lookup order: configured path → `BAOCUT_CLI` → `%LOCALAPPDATA%\BaoCut\bin\baocut.cmd` → `baocut` on `PATH`
3. Audio lives only as a temporary WAV and is deleted right after transcription; nothing is uploaded

If BaoCut cannot be found, set the path to `baocut.cmd` in Settings.

### File format

```markdown
# PureMemo

Facts only. No commentary. Newest entry always on top.

【2026-11-24 Tue】
- 10:31 Reviewed the PureMemo proposal in the meeting room at 3 pm.
- 10:30 Picked up a parcel with three books.

【2026-11-24 Tue · End】

【2026-11-23 Mon】
- 20:40 Ran 3 km in the morning. Very windy.

【2026-11-23 Mon · End】
```

Each day is a block: date heading on top, an `End` marker at the bottom; new entries for the day go at the top of that block.

### Architecture

```text
src/
  core/      pure JS memo format, parsing and append logic
  renderer/  web UI, loadable by Android WebView / HarmonyOS ArkWeb
  main/      Electron shell, filesystem, recording and BaoCut calls
  assets/    logo, icons and fonts
```

A mobile shell only needs to implement the bridge contract in `platform.js` (files, recording, transcription) to reuse `core` and `renderer`.

### Privacy

All notes and audio stay on your machine. No account, no cloud sync, no telemetry.

### License

[MIT](LICENSE)
