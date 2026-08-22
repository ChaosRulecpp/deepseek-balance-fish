// 桌宠渲染层:帧序列动画 + 状态机 + 命中检测 + 拖拽 + token 下落 + 余额思想气泡
(function () {
  'use strict';

  // ---------- 动画资源定义 ----------
  const ANIMS = {
    work:        { dir: 'work',          frames: 97, fps: 24 },
    sleep:       { dir: 'sleep',         frames: 97, fps: 24 },
    workToSleep: { dir: 'work to sleep', frames: 97, fps: 24 },
    sleepToWork: { dir: 'sleep to work', frames: 97, fps: 24 },
  };
  const TOKEN = { dir: 'token/flip', frames: 24, fps: 24, size: 110 };
  const LOOKAHEAD = 14;         // 预加载前瞻帧数
  const CACHE_MAX = 128;        // 帧缓存上限(FIFO 淘汰)
  const CLICK_MOVE_THRESHOLD = 4; // 位移超过该值视为拖拽而非点击
  const TOKEN_GRAVITY = 500;    // token 下落加速度 px/s^2(调慢,让下落更柔和)
  const TOKEN_SPIN = 1.0;       // token 旋转速率倍率(=1 一行一圈;让落地前翻满一圈回到正面,避免停在反面)
  const TOKEN_START_Y = -(TOKEN.size * 1.5);  // token 起点更高(窗口上方远处),从屏幕顶部跌落进来
  const XFADE_MS = 130;         // 帧不连续(切换/回绕/跳变)时的透明度叠化时长(ms),溶解姿态突变

  // ---------- 余额思想气泡 ----------
  const BUBBLE_SRC = '../assets/transparent/chat bubble/bubble.png';
  const BUBBLE_W = 150;                                  // 气泡显示宽度
  const BUBBLE_H = Math.round(BUBBLE_W * 196 / 259);     // ≈114,与裁剪后素材等比
  const BUBBLE_LEFT = 18;                                // 距窗口左边缘
  const BUBBLE_TOP = 8;                                  // 距窗口顶边缘
  // 桌宠帧绘制起点:窗口顶部留气泡区,帧上移让鱼顶贴住气泡(work帧顶部自带76px透明)
  // 值为窗口高减去桌宠帧高360,与 main.js 的 BUBBLE_EXTRA 保持一致
  const PET_Y = 50;

  const canvas = document.getElementById('pet');
  const ctx = canvas.getContext('2d');

  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  // token 下落到"大肥鱼脸上"即消失(窗口坐标;鱼头约在窗口上部 46% 处,可按素材微调)
  const TOKEN_FACE_Y = H * 0.54;

  // ---------- 帧缓存(懒加载 + 降采样到显示尺寸) ----------
  const cache = new Map();
  const order = [];
  const pending = new Set();
  // ---------- 每帧内容 bbox 几何(供补帧做"位置+尺寸"运动插值) ----------
  const geo = new Map(); // key -> {x0,y0,x1,y1}(帧内坐标 0..W)
  function computeBBox(c) {
    const w = c.width, h = c.height;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return { x0, y0, x1, y1 };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function key(animKey, i) { return animKey + ':' + i; }
  function url(anim, i) { return '../assets/transparent/' + anim.dir + '/frame_' + String(i + 1).padStart(4, '0') + '.png'; }

  function load(animKey, anim, i, size) {
    const k = key(animKey, i);
    if (cache.has(k)) return Promise.resolve(cache.get(k));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, size, size);
        cache.set(k, c); order.push(k);
        geo.set(k, computeBBox(c));
        while (order.length > CACHE_MAX) { const ok = order.shift(); if (ok !== k) cache.delete(ok); }
        resolve(c);
      };
      img.onerror = () => resolve(null);
      img.src = url(anim, i);
    });
  }
  function preload(animKey, anim, start, size, count) {
    for (let k = 0; k < count; k++) {
      const i = (start + k) % anim.frames;
      const kk = key(animKey, i);
      if (!cache.has(kk) && !pending.has(kk)) {
        pending.add(kk);
        load(animKey, anim, i, size).finally(() => pending.delete(kk));
      }
    }
  }

  // ---------- 状态机 ----------
  // fade:统一的逐帧智能叠化 { fromKey, start, dur,fixedKey }
  //   fromKey = 上一绘制帧(叠化起点),当前帧为叠化目标,progress 从 0→1
  //   fixedKey 存在时,叠化期间目标帧锁定时为 fixedKey(避免目标随 loop 前进导致方向不稳)
  const state = { mode: 'work', transition: null, balance: null, lastBalance: null, hasBaseline: false, lastOk: true };
  let lastPetCtx = null;   // 最近绘制的宠物帧 canvas(用于 alpha 命中检测)
  let lastDrawnKey = null;  // 最近绘制的帧 key(用于检测"帧不连续"、设定叠化起点)
  let fade = null;          // 当前叠化,无则为 null

  function nowMs() { return performance.now(); }
  // 循环动画以 loopStartMs 为基准(而非绝对时间),切回循环时重置它即可从 frame0 开始
  let loopStartMs = nowMs();
  function loopIndex(anim) { return Math.floor((((nowMs() - loopStartMs) / 1000) * anim.fps) % anim.frames); }

  function currentFrame() {
    if (state.mode === 'transition' && state.transition) {
      const t = state.transition;
      const anim = ANIMS[t.animKey];
      const idx = Math.min(t.frames - 1, Math.floor(((nowMs() - t.start) / 1000) * anim.fps));
      return { animKey: t.animKey, index: idx, anim, to: t.to, endStart: t.start, frames: t.frames };
    }
    const anim = ANIMS[state.mode];
    return { animKey: state.mode, index: loopIndex(anim), anim, to: state.mode };
  }

  function startTransition(animKey, to) {
    // 叠化统一由 draw 的"帧不连续"检测触发(见 drawNeedsFade),此处只切换状态并预加载
    state.mode = 'transition';
    state.transition = { animKey, to, start: nowMs(), frames: ANIMS[animKey].frames };
    preload(animKey, ANIMS[animKey], 0, W, LOOKAHEAD);
  }

  function applyDelta(delta) {
    if (delta === 'down') {
      if (state.mode === 'sleep') startTransition('sleepToWork', 'work');
    } else { // same / up(充值按没变处理)
      if (state.mode === 'work') startTransition('workToSleep', 'sleep');
    }
  }

  function wakeToWork() {
    if (state.mode === 'sleep' || state.mode === 'transition') startTransition('sleepToWork', 'work');
    // work → 保持
  }

  // ---------- 余额思想气泡 ----------
  let bubbleCanvas = null; // 扣图后的气泡(含半透明白底 + 黑描边)
  function loadBubble() {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = BUBBLE_W; c.height = BUBBLE_H;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, BUBBLE_W, BUBBLE_H);
        bubbleCanvas = c;
        resolve(c);
      };
      img.onerror = () => resolve(null);
      img.src = BUBBLE_SRC;
    });
  }

  // 气泡透明度:工作=1, 睡眠=0, 过渡按进度淡入/淡出
  function bubbleAlpha() {
    if (state.mode === 'work') return 1;
    if (state.mode === 'sleep') return 0;
    const t = state.transition;
    const p = Math.min(1, ((nowMs() - t.start) / 1000) * ANIMS[t.animKey].fps / ANIMS[t.animKey].frames);
    return t.animKey === 'sleepToWork' ? p : 1 - p;
  }

  function balanceText() {
    if (state.balance === null || state.balance === undefined) return state.lastOk ? '查询中…' : '查询失败';
    return '¥' + Number(state.balance).toFixed(2);
  }

  function drawBubble() {
    const alpha = bubbleAlpha();
    if (alpha <= 0.01 || !bubbleCanvas) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(bubbleCanvas, BUBBLE_LEFT, BUBBLE_TOP);

    // 余额文字(气泡中心,略偏上让开尾巴)
    const cx = BUBBLE_LEFT + BUBBLE_W / 2 - 13; // 货币符号字形视觉中心偏右,左移13px使其居中于气泡
    const cy = BUBBLE_TOP + BUBBLE_H / 2 - 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 30;
    ctx.font = '600 ' + size + 'px "Microsoft YaHei", sans-serif';
    while (ctx.measureText(balanceText()).width > BUBBLE_W - 36 && size > 16) {
      size--; ctx.font = '600 ' + size + 'px "Microsoft YaHei", sans-serif';
    }
    ctx.fillStyle = (!state.lastOk && state.balance !== null) ? '#c0392b' : '#202020';
    ctx.fillText(balanceText(), cx, cy);
    ctx.restore();
  }

  // ---------- 渲染循环 ----------
  let token = null; // { start, active }
  function startTokenFall() { token = { start: nowMs(), active: true }; }

  function drawToken() {
    if (!token || !token.active) return;
    const el = (nowMs() - token.start) / 1000;
    const x = W / 2;
    const y = TOKEN_START_Y + 0.5 * TOKEN_GRAVITY * el * el;
    const dist = TOKEN_FACE_Y - y;                       // token 中心距"鱼脸"还有多远(px)
    if (dist <= 0) { token.active = false; return; }      // 落到鱼脸上即消失,不再下穿鱼身
    const idx = Math.floor(el * TOKEN.fps * TOKEN_SPIN) % TOKEN.frames;
    preload('token', TOKEN, idx, TOKEN.size, 4);
    const c = cache.get(key('token', idx));
    const alpha = Math.min(1, dist / 30);                // 离脸 30px 内渐隐消失
    if (alpha <= 0) { token.active = false; return; }
    ctx.save();
    ctx.globalAlpha = alpha;
    if (c) ctx.drawImage(c, x - TOKEN.size / 2, y - TOKEN.size / 2, TOKEN.size, TOKEN.size);
    ctx.restore();
  }

  // 真·透明度叠化:旧帧 a 恒定绘制(alpha=1),新帧 b 叠加其上 alpha 从 0→1 渐显。
  // 任意时刻主体层(b)渐显接管、a 保持清晰承托 —— 比"双向都半透明"干净(双向会在 p≈0.5 产生糊层,实测 mid 达 34%);
  // 主体位置一致时 a 被 b 逐步接替,错位时 a 仅边缘自然过渡,不会像素 lerp 叠出重影。
  // 几何补帧 + alpha 叠化:旧帧 a 原样承托;新帧 b 先"贴合到 a 的内容位姿"(位置+尺寸),
  // 随 prog 在 XFADE_MS 内逐渐回归自身本征位姿,期间 opacity 0→1。
  // 这样"位置/尺寸"跳变(如过渡末帧高挺→目标循环首帧矮沉)被平滑吸收,不会突然缩小或叠出重影;
  // 几何一致时(如自循环回绕)自动退化为纯 alpha 叠化。
  function drawXfade(a, b, prog, aKey, bKey) {
    ctx.save();
    ctx.globalAlpha = 1; ctx.drawImage(a, 0, PET_Y);
    ctx.globalAlpha = prog;
    const gA = geo.get(aKey), gB = geo.get(bKey);
    if (gA && gB && gA.x1 >= 0 && gB.x1 >= 0) {
      const sw = gB.x1 - gB.x0 + 1, sh = gB.y1 - gB.y0 + 1;
      const aw = gA.x1 - gA.x0 + 1, ah = gA.y1 - gA.y0 + 1;
      // 目标矩形 = 内容从"贴合 a"插值到"自身位置";b 源取内容区域,目标 x 加 PET_Y 定位到窗口绘制区
      const dx = lerp(gA.x0, gB.x0, prog);
      const dy = lerp(gA.y0, gB.y0, prog);
      const dw = lerp(aw, sw, prog);
      const dh = lerp(ah, sh, prog);
      ctx.drawImage(b, gB.x0, gB.y0, sw, sh, dx, dy + PET_Y, dw, dh);
    } else {
      ctx.drawImage(b, 0, PET_Y);
    }
    ctx.restore();
  }

  // 判断"帧不连续":需叠化的情形 = 动画切换,或同动画内的 index 跳变。
  // 相邻连续 = index 恰好前进 1(含普通外并情形)。回绕(末帧→首帧)虽模差为1,但 pi 接近帧末而 cf.index 接近帧首,
  // 属于跨周期跳变,需与"普通 +1"区分 —— 仅当 pi 位于尾部窗口且 cf.index 位于首部窗口时才判为跳。
  function isFrameJump(prevKey, cf) {
    if (!prevKey) return false;
    const pa = prevKey.split(':')[0], pi = parseInt(prevKey.split(':')[1], 10);
    if (pa !== cf.animKey) return true;                 // 动画切换(含过渡进出)
    const frames = cf.anim.frames;
    const raw = cf.index - pi;                          // 真实差(可为负,回绕时为负)
    const mod = ((raw % frames) + frames) % frames;     // 正向一圈之内的步数
    // 回绕:pi 在末段(距帧末 ≤8)且 cf 在首段(距帧首 ≤8),raw 为负 —— 跨周期跳变
    const piTail = pi > frames - 1 - 8;
    const cfHead = cf.index < 8;
    if (piTail && cfHead && raw < 0) return true;       // 回绕 96→0
    return mod > 1;                                      // 其他大于1的跳变(含动画中途快进/素材缺帧)
  }

  // 计算要绘制的帧对:{ a, b, prog, cf }
  function resolveFrame() {
    const cf = currentFrame(lastDrawnKey);
    const kb = key(cf.animKey, cf.index);
    const b = cache.get(kb);
    const isJump = isFrameJump(lastDrawnKey, cf);

    // 帧不连续(动画切换/回绕/跳变)→ 以"真正的上一帧"为叠化起点,重启叠化
    // (叠化期间 lastDrawnKey 仍更新,但每次 jump 都以新上一帧为起点,覆盖"过渡末帧→循环首帧"这类跨动画边界)
    if (isJump) fade = { fromKey: lastDrawnKey, start: nowMs(), dur: XFADE_MS };

    // 叠化:dur 内从 fromKey 过渡到当前帧;当前帧恢复连续(不 jump)且播满后结束
    if (fade) {
      const f = fade;
      const prog = Math.min(1, (nowMs() - f.start) / f.dur);
      if (prog >= 1 && !isJump) { fade = null; }
      else if (b) {
        const a = cache.get(f.fromKey) || null;
        if (a) return { a, b, prog, cf, fromKey: f.fromKey };
      }
    }

    return { a: null, b, prog: 1, cf, fromKey: null };
  }

  function draw() {
    const { a, b, prog, cf, fromKey } = resolveFrame();
    ctx.clearRect(0, 0, W, H);
    if (b) {
      // 有补帧(prog<1)时用"几何+alpha"叠化;否则直接画当前帧
      if (a && prog < 1) drawXfade(a, b, prog, fromKey, key(cf.animKey, cf.index));
      else ctx.drawImage(b, 0, PET_Y);
      // 命中检测用 b 的透明位(叠化中后帧逐渐清晰,以此为准)
      lastPetCtx = b.getContext('2d');
      lastDrawnKey = key(cf.animKey, cf.index);
    }
    preload(cf.animKey, cf.anim, cf.index, W, LOOKAHEAD);
    drawBubble();
    drawToken();
  }

  function tick() {
    if (state.mode === 'transition' && state.transition) {
      const t = state.transition;
      const dur = t.frames / ANIMS[t.animKey].fps;
      if ((nowMs() - t.start) / 1000 >= dur) {
        // 02:过渡结束,重置循环基准让新循环从 frame0 开始(切换帧叠化由 draw 的逐帧检测统一处理)
        loopStartMs = nowMs();
        state.mode = t.to; state.transition = null;
      }
    }
    draw();
    requestAnimationFrame(tick);
  }

  // ---------- 命中检测 / 点击穿透 ----------
  let ignoring = null;
  function setIgnore(ign) {
    if (ign !== ignoring) { ignoring = ign; window.api.setIgnoreMouse(ign); }
  }
  // 桌宠画在窗口下部(从 PET_Y 开始),气泡区/帧顶部透明处点击穿透
  function alphaAt(x, y) {
    if (!lastPetCtx) return 0;
    if (y < PET_Y) return 0;
    x = Math.floor(x); y = Math.floor(y - PET_Y);
    if (x < 0 || y < 0 || x >= W || y >= W) return 0;
    try { return lastPetCtx.getImageData(x, y, 1, 1).data[3]; } catch (e) { return 0; }
  }

  // ---------- 拖拽 vs 点击 ----------
  let dragging = false, dragMoved = false, down = null;
  canvas.addEventListener('mousedown', (e) => {
    if (alphaAt(e.clientX, e.clientY) <= 0) return;
    dragging = true; dragMoved = false;
    down = { sx: e.screenX, sy: e.screenY, ox: e.clientX, oy: e.clientY };
  });
  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    if (!dragMoved) onPetClick();
    // 拖拽后的位置由主进程 'moved' 事件持久化
  });

  document.addEventListener('mousemove', (e) => {
    if (dragging) {
      const dx = e.screenX - down.sx, dy = e.screenY - down.sy;
      if (Math.abs(dx) + Math.abs(dy) > CLICK_MOVE_THRESHOLD) dragMoved = true;
      if (dragMoved) window.api.moveWindow(e.screenX - down.ox, e.screenY - down.oy);
      return;
    }
    const a = alphaAt(e.clientX, e.clientY);
    if (a > 0) setIgnore(false);
    else setIgnore(true);
  });

  // ---------- 点击桌宠:token 下落 + 立即查余额 + 强制唤醒 ----------
  async function onPetClick() {
    startTokenFall();
    wakeToWork();
    try {
      const r = await window.api.requestBalance();
      if (r && r.ok) {
        state.balance = r.balance; state.lastBalance = r.balance; state.hasBaseline = true;
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---------- 余额事件(来自主进程的定时轮询) ----------
  window.api.onBalanceStatus((msg) => {
    if (msg.ok) {
      state.balance = msg.balance; state.lastBalance = msg.balance; state.lastOk = true;
      if (msg.first) { state.hasBaseline = true; /* 只记基线,不改变状态 */ }
      else { state.hasBaseline = true; applyDelta(msg.delta); }
    } else {
      state.lastOk = false; /* 查询失败不改变状态 */
    }
  });

  // ---------- 启动 ----------
  (async function init() {
    await loadBubble();
    try { await window.api.getConfig(); } catch (e) { /* 忽略 */ }
    try {
      const r = await window.api.requestBalance(); // 建立初始基线(不会触发状态变化)
      if (r && r.ok) { state.balance = r.balance; state.lastBalance = r.balance; state.hasBaseline = true; }
    } catch (e) { /* 忽略 */ }
    preload('work', ANIMS.work, 0, W, LOOKAHEAD);
    requestAnimationFrame(tick);
  })();
})();
