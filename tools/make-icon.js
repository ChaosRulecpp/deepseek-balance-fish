// 从角色帧生成 Windows 应用图标 assets/icon.ico
// 用法:node tools/make-icon.js
//
// 生成的 .ico 内嵌多尺寸 PNG(Vista+ 的 ICO 支持直接塞 PNG 数据),
// 供 electron-packager 的 --icon 使用,也在任务栏/资源管理器里当图标。
//
// 素材是 720x720 画布、角色四周有大片透明留白,所以先 trim 掉透明边再
// 等比 contain 进正方形 —— 否则缩到 16px 时角色会小得看不清。

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT = path.join(ROOT, 'assets', 'icon.ico');

// 优先用 PNG 原图(转换工具跑过之后就只剩 WebP 了,两种都能读)
function findSource() {
  const base = path.join(ROOT, 'assets', 'transparent', 'work', 'frame_0001');
  for (const ext of ['.webp', '.png']) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  throw new Error('找不到源帧 assets/transparent/work/frame_0001.(webp|png)');
}

// 把一组 PNG buffer 打包成 ICO
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach((p, i) => {
    const e = 16 * i;
    const dim = p.size >= 256 ? 0 : p.size;  // 256 在 ICO 里用 0 表示
    dir.writeUInt8(dim, e + 0);              // width
    dir.writeUInt8(dim, e + 1);              // height
    dir.writeUInt8(0, e + 2);                // 调色板数(真彩为 0)
    dir.writeUInt8(0, e + 3);                // reserved
    dir.writeUInt16LE(1, e + 4);             // color planes
    dir.writeUInt16LE(32, e + 6);            // bits per pixel
    dir.writeUInt32LE(p.buf.length, e + 8);  // 数据长度
    dir.writeUInt32LE(offset, e + 12);       // 数据偏移
    offset += p.buf.length;
  });

  return Buffer.concat([header, dir, ...pngs.map((p) => p.buf)]);
}

(async () => {
  const src = findSource();
  console.log('源帧:', path.relative(ROOT, src));

  // 先用 trim 探出角色实际占用的范围,顺便打印出来方便核对
  const trimmed = await sharp(src).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
  console.log('透明边裁掉后:', trimmed.info.width + 'x' + trimmed.info.height);

  const pngs = [];
  for (const size of SIZES) {
    const buf = await sharp(trimmed.data)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    pngs.push({ size, buf });
  }

  fs.writeFileSync(OUT, buildIco(pngs));
  console.log('已写出:', path.relative(ROOT, OUT), '(' + (fs.statSync(OUT).size / 1024).toFixed(1) + 'KB,', SIZES.length, '个尺寸)');

  // 顺手导出一张 128px PNG,方便肉眼核对图标观感
  const preview = path.join(ROOT, 'tools', 'icon-preview-128.png');
  await sharp(trimmed.data).resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(preview);
  console.log('预览图:', path.relative(ROOT, preview));
})();
