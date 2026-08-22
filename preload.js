// 预加载脚本:通过 contextBridge 向渲染层暴露受控 IPC 接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', !!ignore),
  moveWindow: (x, y) => ipcRenderer.send('move-window', { x, y }),
  requestBalance: () => ipcRenderer.invoke('request-balance'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  onBalanceStatus: (cb) => ipcRenderer.on('balance-status', (e, msg) => cb(msg)),
});
