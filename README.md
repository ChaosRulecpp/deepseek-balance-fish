# 思想气泡 · DeepSeek 余额桌宠 🐟

🐟 一条住在桌面上的圆滚滚大肥鱼！

它会定时查看 **DeepSeek 官方 API 余额**，并用头顶的「思想气泡」告诉你余额还有多少。

余额没变化？安心睡觉，继续摸鱼💤  
余额变少了？立刻惊醒，开始认真工作！

点一下它，还会从头顶掉下一枚旋转的 **Token**，然后立刻进入工作状态。

一条会看余额、会摸鱼、会干活的 DeepSeek 大肥鱼！

**它不是爬虫** —— 用的是你自己的 API Key 调 DeepSeek 官方 `/user/balance` 接口,不消耗任何 token、不产生费用。

---

## ✨ 功能

- **胖鱼动画**:工作 / 睡眠 / 两者过渡,共 4 套 × 97 帧 PNG 帧序列,24fps 无缝循环。
- **余额监测**:每 1 分钟查一次余额(官方接口)。
  - 余额**减少** → 鱼从睡眠醒来去「工作」。
  - 余额**没变 / 充值** → 鱼去「睡觉」。
  - 查询失败 → 不改变状态,下次再查。
- **思想气泡**:大肥鱼身上,头顶弹出半透明气泡显示当前余额。
- **点一下**:鱼会根据像素命中检测触发,**从头顶掉下一枚旋转的 token**,同时立即再查一次余额、刷新气泡,并且开始工作。
- **可拖动**:按住鱼身拖动到任意位置,退出时记住位置。
- **系统托盘**:不在任务栏显示,托盘一个图标,右键「退出」。

---

## 🖼 素材

| 用途            | 路径                                | 帧数 | 尺寸    |
| --------------- | ----------------------------------- | ---- | ------- |
| 工作(循环)      | `assets/transparent/work/`          | 97   | 720×720 |
| 睡眠(循环)      | `assets/transparent/sleep/`         | 97   | 720×720 |
| 工作→睡眠过渡   | `assets/transparent/work to sleep/` | 97   | 720×720 |
| 睡眠→工作过渡   | `assets/transparent/sleep to work/` | 97   | 720×720 |
| 掉落 token 旋转 | `assets/transparent/token/flip/`    | 24   | 512×512 |

> 素材是**去背景的透明 PNG**(`assets/frames/` 里的原始帧不含,已在 `.gitignore` 排除)。

---

## 🚀 运行

环境要求:**Windows + Node.js ≥ 18**(项目基于 Electron 33)。

```bash
# 1. 安装依赖(Electron 本体,可能较大)
npm install

# 2. 配置你的 DeepSeek API Key
#    直接编辑 config.json,把 apiKey 填成你的
#    (默认 config.json 里 key 是空的;填完 key 后建议执行
#     git update-index --skip-worktree config.json,避免 key 被提交上传)

# 3. 启动
npm start
```

首次运行若未配置 key,程序会弹窗提示。API Key 从 <https://platform.deepseek.com> 获取。

---

## ⚙️ 配置(`config.json`)

| 字段              | 说明                            | 默认            |
| ----------------- | ------------------------------- | --------------- |
| `apiKey`          | 你的 DeepSeek API Key(**必填**) | `""`            |
| `checkIntervalMs` | 余额轮询间隔(毫秒)              | `60000`(1 分钟) |
| `windowSize`      | 桌宠窗口边长(像素)              | `360`           |
| `windowPosition`  | 上次拖到的位置(自动记忆)        | `null`          |

> **安全**:仓库默认提交的 `config.json` 里 key 是空的,无需复制模板,填上自己的 key 就能用。填入 key 后,建议执行 `git update-index --skip-worktree config.json`,这样本地改动不会进入提交,key 就不会被上传。

---

## 🗂 项目结构

```
main.js              # 主进程:窗口、托盘、定时轮询余额、IPC
preload.js           # 安全桥(渲染层与主进程的少量通道)
renderer/
  index.html         # 页面骨架(canvas)
  renderer.js        # 动画播放、命中检测、点击穿透、气泡绘制
assets/transparent/  # 去背景动画帧
config.json          # 默认配置(公开,key 留空,填上自己的 key 即可使用)
```

---

## ⚖️ 说明

- 桌宠是**透明、无边框、点击穿透透明像素**的窗口;**非置顶**(被最大化/前台窗口盖住时会让位于后),只歇在桌面空白处。
- 余额查询用的是 [DeepSeek 官方余额接口](https://api-docs.deepseek.com/api/get-user-balance),`GET /user/balance`,带 `Authorization: Bearer <key>` 头。频率建议保持在 **每分钟一次** 以内,过高可能触发风控。

---

## 📚 技术栈

Electron 33 · 纯 JavaScript · `<canvas>` 帧序列动画 · 无前端框架。

---

*一条吐着思想气泡的大肥鱼,替你盯着 DeepSeek 的钱袋子。*
