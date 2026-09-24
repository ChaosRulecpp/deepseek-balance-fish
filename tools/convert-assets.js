// 一次性素材转换:assets/transparent 下的 PNG 帧序列 → 无损 WebP
// 用法:node tools/convert-assets.js [--keep-png]
//   --keep-png  只生成 .webp,不删除原 .png(转换后人工比对用)
//
// 之所以转:这批是平面卡通 + 大片透明区,无损 WebP 实测只占原体积的 38%,
// 画质零损失,直接把发布包砍掉一大半。chromium 原生支持 WebP,渲染层无需解码库。
//
// 注意:assets/ 顶层那两个托盘图标(tray16/tray32.png)保持 PNG 不动 ——
// Electron 的 nativeImage 读 PNG 最稳,且它们总共才 3KB,不值得冒险。

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'assets', 'transparent');
const KEEP_PNG = process.argv.includes('--keep-png');

const mb = (n) => (n / 1048576).toFixed(1) + 'MB';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
}

// 逐帧比对:确认"可见像素"逐字节一致
//
// 这里不能用整块 buffer 的 equals —— libwebp 的无损编码默认不保留
// alpha=0 像素底下的 RGB(那些像素永远不可见)。实测一帧里约 65% 的像素
// RGB 有差异,但差异像素的 alpha 全部为 0,可见区域零差异。
// 正确的判定标准是:alpha 通道全等,且 alpha>0 的像素 RGB 全等。
async function comparePixels(pngBuf, webpBuf) {
  const [a, b] = await Promise.all([
    sharp(pngBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(webpBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { ok: false, reason: '尺寸不一致' };
  if (a.data.length !== b.data.length) return { ok: false, reason: '通道数不一致' };

  let visible = 0, hidden = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const alphaDiff = a.data[i + 3] !== b.data[i + 3];
    const rgbDiff = a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2];
    if (alphaDiff || (rgbDiff && a.data[i + 3] > 0)) visible++;  // 可见像素变了 → 不算无损
    else if (rgbDiff) hidden++;                                  // 只动了透明像素的 RGB → 无影响
  }
  return { ok: visible === 0, visible, hidden };
}

(async () => {
  if (!fs.existsSync(TARGET)) {
    console.error('找不到目录:', TARGET);
    process.exit(1);
  }

  const files = walk(TARGET).sort();
  console.log('待转换 PNG:', files.length, '个');
  console.log('模式:', KEEP_PNG ? '保留原 PNG' : '转换后删除原 PNG');
  console.log();

  let pngBytes = 0, webpBytes = 0, done = 0, failed = 0, hiddenPx = 0;
  const failures = [];

  for (const src of files) {
    const pngBuf = fs.readFileSync(src);
    const dst = src.replace(/\.png$/i, '.webp');

    try {
      // lossless + 最高 effort:只为追求最小体积,转换是一次性的,慢点无所谓
      const webpBuf = await sharp(pngBuf).webp({ lossless: true, effort: 6 }).toBuffer();

      const cmp = await comparePixels(pngBuf, webpBuf);
      if (!cmp.ok) {
        // 可见像素出现差异 → 不写文件、保留原 PNG,宁可漏转也不能悄悄降质
        failed++;
        failures.push(path.relative(ROOT, src) + '  (' + (cmp.reason || cmp.visible + ' 个可见像素不一致') + ')');
        continue;
      }
      hiddenPx += cmp.hidden;

      fs.writeFileSync(dst, webpBuf);
      if (!KEEP_PNG) fs.unlinkSync(src);

      pngBytes += pngBuf.length;
      webpBytes += webpBuf.length;
      done++;

      if (done % 50 === 0) console.log(`  已处理 ${done}/${files.length} ...`);
    } catch (e) {
      failed++;
      failures.push(path.relative(ROOT, src) + '  (' + e.message + ')');
    }
  }

  console.log();
  console.log('=== 完成 ===');
  console.log('成功 :', done, '帧');
  console.log('失败 :', failed, '帧');
  if (failures.length) {
    console.log('失败清单:');
    for (const f of failures) console.log('  -', f);
  }
  if (done) {
    console.log();
    console.log('原 PNG 合计 :', mb(pngBytes));
    console.log('WebP 合计   :', mb(webpBytes));
    console.log('占比        :', ((webpBytes / pngBytes) * 100).toFixed(0) + '%');
    console.log('节省        :', mb(pngBytes - webpBytes));
    console.log();
    console.log('校验:所有 alpha>0 的像素逐字节一致(即画面完全无损)');
    console.log('     有', hiddenPx, '个全透明像素的 RGB 被编码器丢弃 —— 不可见,无影响');
  }
  if (failed) process.exitCode = 1;
})();
