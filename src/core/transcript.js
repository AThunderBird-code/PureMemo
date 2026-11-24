/**
 * 语音转写文本清理（纯函数）。
 * BaoCut / MOSS 的 TXT 每行带说话人序号前缀，这里统一去掉并拼接成一段。
 */
export function normalizeTranscript(raw) {
  const lines = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\d+\t/, '')
        .replace(/^\s*\[[^\]]{1,30}\]\s*/, '')
        .trim(),
    )
    .filter((line) => line && !/^\d+$/.test(line));

  let out = '';
  for (const line of lines) {
    if (!out) {
      out = line;
      continue;
    }
    if (/[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]$/.test(out)) out += line;
    else out += ` ${line}`;
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
