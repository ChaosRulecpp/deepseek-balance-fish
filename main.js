// 桌宠主进程:透明置顶窗口 + 系统托盘 + DeepSeek 余额轮询 + IPC
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

const ROOT = __dirname;
// 配置放在哪:打包后 __dirname 指向只读的 app.asar 内部,用户既看不见 config.json
// 也没法编辑它(填 API Key 就无从谈起)。所以成品让配置待在 exe 同级目录 ——
// 便携软件的惯例,也是用户解压后一眼能看到的位置。开发时仍是项目根目录。
const CONFIG_PATH = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'config.json')
  : path.join(ROOT, 'config.json');
const BALANCE_URL = { hostname: 'api.deepseek.com', path: '/user/balance', method: 'GET' };
const BUBBLE_EXTRA = 50; // 桌宠帧绘制起点(= renderer 的 PET_Y),窗口高 = 桌宠尺寸 + 该值

// ---------- 配置 ----------
const DEFAULT_CONFIG = { apiKey: '', checkIntervalMs: 60000, windowSize: 360, windowPosition: { x: null, y: null } };

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch (e) { console.error('读取 config.json 失败:', e.message); }
  return { ...DEFAULT_CONFIG };
}
function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) { console.error('写入 config.json 失败:', e.message); }
}
// 打包版首次启动时,在 exe 旁边落一份默认配置。
// 不落盘的话用户面前只有一个 exe,连要编辑的文件名都无处可寻。
function seedConfigIfMissing() {
  if (!app.isPackaged || fs.existsSync(CONFIG_PATH)) return;
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2)); }
  catch (e) { console.error('写入默认 config.json 失败:', e.message); }
}

seedConfigIfMissing();
let config = loadConfig();
let win = null;
let tray = null;
let balanceTimer = null;
let lastBalance = null;   // 上一次成功查询到的余额(用于对比)
let hasBaseline = false;  // 是否已有基线(第一次查询只记基线,不触发状态变化)

// ---------- 余额查询(官方接口,不消耗 token) ----------
function getBalance() {
  return new Promise((resolve) => {
    if (!config.apiKey) { resolve({ ok: false, error: 'no-api-key' }); return; }
    const req = https.request({
      ...BALANCE_URL,
      headers: { 'Authorization': 'Bearer ' + config.apiKey, 'Accept': 'application/json' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (res.statusCode !== 200 || j.is_available === false) { resolve({ ok: false, error: 'http-' + res.statusCode }); return; }
          const info = (j.balance_infos && j.balance_infos[0]) || null;
          const balance = info ? parseFloat(info.total_balance) : null;
          resolve({ ok: true, balance });
        } catch (e) { resolve({ ok: false, error: 'parse-error' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: String((e && e.message) || e) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

// delta: 'down'(减少) | 'same'(没变或充值)
function computeDelta(bal) {
  if (lastBalance === null) return 'same';
  if (bal < lastBalance) return 'down';
  return 'same';
}

async function doBalanceCheck(sendEvent = true) {
  const r = await getBalance();
  if (r.ok) {
    const delta = computeDelta(r.balance);
    const first = !hasBaseline;
    lastBalance = r.balance;
    hasBaseline = true;
    if (sendEvent && win && !win.isDestroyed()) win.webContents.send('balance-status', { ok: true, balance: r.balance, delta, first });
  } else {
    if (sendEvent && win && !win.isDestroyed()) win.webContents.send('balance-status', { ok: false, balance: lastBalance, delta: 'same', first: false, error: r.error });
  }
  return r;
}

// ---------- 窗口 ----------
function createWindow() {
  const size = config.windowSize || 360;
  const height = size + BUBBLE_EXTRA; // 上方留气泡区,桌宠画在窗口下部
  win = new BrowserWindow({
    width: size, height,
    transparent: true, frame: false, resizable: false,
    alwaysOnTop: false, skipTaskbar: true, hasShadow: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // 已取消置顶(alwaysOnTop:false):桌宠是普通窗口,会被最大化/全屏/前台窗口盖住,不再霸最上层
  // 想恢复"悬浮又不挡全屏":改回 alwaysOnTop:true + setAlwaysOnTop(true,'floating')
  // 初始设为"点击穿透(转发鼠标移动)",渲染层根据命中像素动态切换
  win.setIgnoreMouseEvents(true, { forward: true });

  // 恢复上次位置
  const pos = config.windowPosition;
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    const { x, y } = pos;
    const wa = screen.getDisplayMatching({ x, y, width: size, height }).workArea;
    if (x >= wa.x && y >= wa.y && x < wa.x + wa.width && y < wa.y + wa.height) {
      win.setPosition(Math.round(x), Math.round(y));
    }
  }

  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  // 位置持久化(拖动时触发,防抖)
  let moveTimer = null;
  win.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      config.windowPosition = { x, y };
      saveConfig();
    }, 400);
  });

  win.on('closed', () => { win = null; });
}

// ---------- 托盘 ----------
function createTray() {
  let icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray16.png'));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray32.png'));
  tray = new Tray(icon);
  tray.setToolTip('DeepSeek 余额桌宠');
  // 余额已由工作模式下的思想气泡常驻显示,托盘只留退出
  const menu = Menu.buildFromTemplate([
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ---------- IPC ----------
ipcMain.on('set-ignore-mouse', (e, ignore) => {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('move-window', (e, p) => {
  if (win && !win.isDestroyed() && p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    win.setPosition(Math.round(p.x), Math.round(p.y));
  }
});
ipcMain.handle('request-balance', async () => {
  // 手动/点击触发的查询:只更新基线并返回数值,不触发状态变化(不派发 balance-status 事件)
  const r = await doBalanceCheck(false);
  if (!r.ok && r.error === 'no-api-key') {
    // 提示用户配置 API Key
    const r2 = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['去配置', '稍后'],
      title: '未配置 API Key',
      message: '尚未配置 DeepSeek API Key,\n请在项目根目录 config.json 的 apiKey 字段填入。',
    });
    if (r2.response === 0) require('electron').shell.openPath(CONFIG_PATH);
  }
  return r;
});
ipcMain.handle('get-config', () => ({ windowSize: config.windowSize || 360 }));

// ---------- 启动 ----------
app.whenReady().then(() => {
  createWindow();
  createTray();

  // 基线由渲染层加载后主动 request-balance 建立;这里只负责按间隔轮询(派发 balance-status)
  balanceTimer = setInterval(doBalanceCheck, config.checkIntervalMs || 60000);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  // 桌宠常驻托盘,不因关窗退出(除非明确退出)
  if (process.platform !== 'darwin') { /* 保持运行,由托盘退出 */ }
});

app.on('before-quit', () => {
  if (balanceTimer) clearInterval(balanceTimer);
});
