// 打包便携版:产出 dist/ds-fish-pet-win32-x64/ 与同名 zip
// 用法:npm run build
//
// 成品是「解压即用」的:别人从 GitHub Releases 下载 zip,解压后双击
// ds-fish-pet.exe 就能跑,不需要装 Node.js —— Electron 运行时已打进去。
//
// 这也正是仓库本身做不到的事:node_modules 里的 electron.exe 有 181MB,
// 超过 GitHub 单文件 100MB 的硬限制,推不上去,所以成品只能挂 Releases。

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { packager } = require('@electron/packager');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const NAME = 'ds-fish-pet';
const VERSION = require(path.join(ROOT, 'package.json')).version;
const PLATFORM = 'win32';
const ARCH = 'x64';
const EXE_NAME = '启动桌宠';      // 成品 exe 的名字
const FOLDER_NAME = '启动桌宠';   // 解压后用户看到的文件夹名
const BOM = '﻿';             // 记事本靠 BOM 才认出 UTF-8,否则中文全是乱码

const README_TXT = `🐟 DeepSeek 余额桌宠 · 使用说明

────────────────────────────────
一、启动
────────────────────────────────
双击本文件夹里的「${EXE_NAME}.exe」即可。

不需要安装 Node.js,不需要命令行 —— 双击就能用。

────────────────────────────────
二、配置 API Key(必做,否则查不到余额)
────────────────────────────────
1. 用记事本打开和 exe 放在同一个文件夹里的 config.json
2. 把   "apiKey": ""   改成你自己的 key,例如:
        "apiKey": "sk-你的密钥"
3. 保存,然后重新双击「${EXE_NAME}.exe」

API Key 从 https://platform.deepseek.com 免费获取。
没填 key 的话,首次启动会弹窗提示你。

────────────────────────────────
三、使用
────────────────────────────────
· 每 1 分钟自动查一次余额,头顶的思想气泡显示还剩多少钱
· 余额变少了 → 鱼醒过来认真工作
· 余额没变 / 充值了 → 鱼继续安心睡觉
· 点一下鱼 → 从头顶掉下一枚旋转的 token,并立刻刷新余额
· 按住鱼身可以拖到桌面任意位置,下次启动还记得

────────────────────────────────
四、退出
────────────────────────────────
右键任务栏右下角托盘区的小图标 →「退出」。

注意:直接关窗口不会退出,鱼会继续待在托盘里。

────────────────────────────────
五、说明
────────────────────────────────
· 用的是 DeepSeek 官方 /user/balance 接口,带你自己的 key,
  不消耗任何 token、不产生费用。
· 数据只在你自己机器上,不经过任何第三方。
· 桌宠是透明、无边框、点击穿透的窗口,而且是「非置顶」的,
  被最大化窗口盖住时会老实让位,不会一直霸在最上层。

项目地址:https://github.com/ChaosRulecpp/deepseek-balance-fish
`;

const mb = (n) => (n / 1048576).toFixed(1) + 'MB';
function dirSize(d) {
  let total = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

// 找本地已下载的 Electron 运行时 zip(安装 electron 时 @electron/get 存下来的)
//
// 为什么非要找它:packager 默认会连 GitHub 校验/下载,而国内到
// objects.githubusercontent.com 的连接经常直接挂住(不是超时,是一直 ESTABLISHED 不动),
// 构建就会无限期卡在 "打包中"。指定 electronZipDir 后 packager 直接用本地文件,
// 一个网络请求都不发。
function findCachedElectronZip(version) {
  const filename = `electron-v${version}-${PLATFORM}-${ARCH}.zip`;
  const home = os.homedir();
  const candidates = [
    process.env.ELECTRON_CACHE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'electron', 'Cache'),
    process.env.XDG_CACHE_HOME && path.join(process.env.XDG_CACHE_HOME, 'electron'),
    path.join(home, '.cache', 'electron'),
    path.join(home, 'Library', 'Caches', 'electron'),
  ].filter(Boolean);
  for (const dir of candidates) {
    const p = path.join(dir, filename);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  // 图标是生成物(未提交),缺了就现场生成一次
  const icon = path.join(ROOT, 'assets', 'icon.ico');
  if (!fs.existsSync(icon)) {
    console.log('>> 图标缺失,先生成 assets/icon.ico ...');
    execFileSync(process.execPath, [path.join(__dirname, 'make-icon.js')], { stdio: 'inherit' });
  }

  const electronVersion = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  const cachedZip = findCachedElectronZip(electronVersion);

  const opts = {
    dir: ROOT,
    name: NAME,
    executableName: EXE_NAME,   // 只改 exe 文件名,不影响输出目录名和用户数据目录
    platform: PLATFORM,
    arch: ARCH,
    icon,
    out: OUT,
    overwrite: true,
    prune: true,          // 本项目没有生产依赖,prune 后 node_modules 不会进包
    appVersion: VERSION,
    // 开发用的东西不进发布包:工具脚本、git、编辑器配置、以及那个给开发者用的 bat
    // (成品靠 exe 启动,bat 留在包里只会让人不知道该双击哪个)
    ignore: [/^\/tools($|\/)/, /^\/dist($|\/)/, /^\/\.git($|\/)/, /^\/\.claude($|\/)/, /^\/启动桌宠\.bat$/],
  };

  if (cachedZip) {
    console.log('>> 命中本地 Electron 运行时缓存,离线打包:');
    console.log('   ' + cachedZip);
    opts.electronZipDir = path.dirname(cachedZip);
  } else {
    process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
    console.log('>> 本地无运行时缓存,改走镜像下载(国内网络下可能较慢):');
    console.log('   ' + process.env.ELECTRON_MIRROR);
  }

  console.log('>> 打包中(packager 会把运行时和素材一起复制进去)...');
  const [packedDir] = await packager(opts);

  // packager 按 name 生成 ds-fish-pet-win32-x64/,这个目录名会原样出现在用户
  // 解压后的文件夹上。改成中文,用户一眼就知道这是什么东西。
  const appDir = path.join(OUT, FOLDER_NAME);
  if (path.resolve(packedDir) !== path.resolve(appDir)) {
    fs.rmSync(appDir, { recursive: true, force: true });
    fs.renameSync(packedDir, appDir);
  }
  console.log('>> 已产出:', path.relative(ROOT, appDir));

  // 成品里放一份中文说明 —— 用户解压后面对 70 多个 dll/pak,
  // 得有人明确告诉他双击哪个、key 填在哪
  fs.writeFileSync(path.join(appDir, '使用说明.txt'), BOM + README_TXT, 'utf8');

  const zip = path.join(OUT, `${NAME}-v${VERSION}-win32-x64.zip`);
  if (fs.existsSync(zip)) fs.unlinkSync(zip);

  console.log('>> 压缩中(几百 MB,需要一两分钟)...');
  execFileSync('powershell.exe', [
    '-NoProfile', '-Command',
    `Compress-Archive -Path '${appDir}' -DestinationPath '${zip}' -CompressionLevel Optimal`,
  ], { stdio: 'inherit' });

  console.log();
  console.log('   目录体积:', mb(dirSize(appDir)));
  console.log('   zip 体积:', mb(fs.statSync(zip).size));
  console.log('   zip 路径:', path.relative(ROOT, zip));
  console.log();
  console.log('   下一步:把上面这个 zip 拖到 GitHub Releases 的附件里。');
})().catch((e) => { console.error('打包失败:', e.message); process.exit(1); });
