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

- **胖鱼动画**:工作 / 睡眠 / 两者过渡,共 4 套 × 97 帧 WebP 帧序列,24fps 无缝循环。
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

> 素材是**去背景的透明 WebP**。用的是**无损** WebP:alpha 通道与所有可见像素逐字节等同原 PNG,
> 只有全透明像素底下的 RGB 会被编码器丢弃(永远不可见,渲染结果完全一致),体积却只有原来的 **38%**
> —— 165MB → 62MB。Chromium 原生解码,渲染层无需任何解码库。
>
> 原始 PNG 帧已不在工作区(转换后即删除),但仍留在改动之前的 git 历史里。
> 想重跑转换,先取回 PNG 再执行:
>
> ```bash
> git checkout <转换前的提交> -- assets/transparent
> npm run assets:webp          # 就地转成 .webp 并校验像素,通过后删除原 PNG
> npm run assets:webp -- --keep-png   # 只生成不删除,便于人工比对
> ```

---

## 🚀 运行

### 方式一:下载成品(只想用,不想折腾环境)

去 **[Releases](../../releases)** 下载 `ds-fish-pet-*-win32-x64.zip`,解压后得到 `启动桌宠\` 文件夹,
双击里面的 **`启动桌宠.exe`** 即可 —— **不需要装 Node.js,不需要碰命令行**。

文件夹里有一份 `使用说明.txt`,照着做就行。要点:第一次启动后,文件夹里会生成
**`config.json`**(就在 exe 旁边),用记事本打开、把 `apiKey` 填上,再重启一次即可。

> zip 从网上下来会带 Windows 的「来自其他计算机」标记,双击 exe 可能被 SmartScreen 拦一下。
> 右键 zip →「属性」→ 勾选「解除锁定」再解压,可以避开。
>
> Electron 的 exe 必须和一堆 dll/pak 待在同一层,所以文件夹里文件很多,这是正常现象。

### 方式二:从源码运行(开发者)

环境要求:**Windows + Node.js ≥ 18**(项目基于 Electron 33)。

```bash
# 1. 安装依赖(Electron 本体 181MB,可能较慢)
npm install

# 2. 配置 DeepSeek API Key:编辑 config.json 的 apiKey 字段
#    (仓库里的 config.json 是空 key;填完建议执行
#     git update-index --skip-worktree config.json,避免 key 被提交)
```

之后**双击项目根目录的 `启动桌宠.bat`** 🐟

不会残留命令行窗口 —— 脚本用 `start` 把 Electron 甩到后台就立刻退出;`node_modules`
不存在(比如刚 clone 下来)时会自动先跑一次 `npm install`。脚本里已经预设了国内镜像,
否则从 GitHub Releases 拉那 181MB 的二进制很容易超时。

> ⚠️ 双击两下会开出两只鱼(没有单实例锁)。退出请右键**托盘图标 → 退出**。

开发时想在前台看日志,用 `npm start`。

API Key 从 <https://platform.deepseek.com> 获取。

---

## ⚙️ 配置(`config.json`)

**文件在哪**:源码运行时是项目根目录;打包版则是 **exe 同级目录**(首次启动自动生成一份默认配置)。

> 之所以分两处:打包后源码被收进只读的 `resources/app.asar`,里面的 `config.json`
> 用户既看不到也改不了。所以成品把配置放到 exe 旁边 —— 填 API Key 是使用前唯一的必做步骤。

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
启动桌宠.bat          # 双击启动(无命令行窗口)
main.js              # 主进程:窗口、托盘、定时轮询余额、IPC
preload.js           # 安全桥(渲染层与主进程的少量通道)
renderer/
  index.html         # 页面骨架(canvas)
  renderer.js        # 动画播放、命中检测、点击穿透、气泡绘制
assets/
  transparent/       # 去背景动画帧(无损 WebP)
  tray16/32.png      # 托盘图标(保持 PNG,Electron 的 nativeImage 读 PNG 最稳)
tools/
  convert-assets.js  # PNG → 无损 WebP,逐帧校验可见像素一致
  make-icon.js       # 从角色帧生成 assets/icon.ico
  build.js           # 打包便携版 + zip,供 GitHub Releases
config.json          # 默认配置(公开,key 留空,填上自己的 key 即可使用)
```

---

## 📦 发布(维护者)

**仓库里只有源码**,因为 `node_modules/electron/dist/electron.exe` 有 **181MB**,超过 GitHub
单文件 100MB 的硬限制,`git push` 会被直接拒绝。所以「解压即用」的成品走 Releases:

```bash
npm run build     # 产出 dist/ds-fish-pet-<版本>-win32-x64.zip
```

把 `dist/` 里那个 zip 拖到 GitHub Releases 当附件即可。打包用 `@electron/packager`,
`prune` 会剔掉全部 devDependencies(本项目没有生产依赖),成品里只有 Electron 运行时 + 源码 + 素材。

> `dist/` 已在 `.gitignore` 里。**别把 zip 提交进仓库** —— 几个版本下来仓库就废了。

---

## ⚖️ 说明

- 桌宠是**透明、无边框、点击穿透透明像素**的窗口;**非置顶**(被最大化/前台窗口盖住时会让位于后),只歇在桌面空白处。
- 余额查询用的是 [DeepSeek 官方余额接口](https://api-docs.deepseek.com/api/get-user-balance),`GET /user/balance`,带 `Authorization: Bearer <key>` 头。频率建议保持在 **每分钟一次** 以内,过高可能触发风控。

---

## 📚 技术栈

Electron 33 · 纯 JavaScript · `<canvas>` 帧序列动画 · 无前端框架。

---

*一条吐着思想气泡的大肥鱼,替你盯着 DeepSeek 的钱袋子。*
