// Pont entre la page du jeu et l'application (réseau Steam, presse-papiers…), sans ouvrir Node à la page.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = { message: 'net:message', status: 'net:status', 'join-request': 'net:join-request', display: 'display:changed', update: 'update:state' };

contextBridge.exposeInMainWorld('mam', {
  info: () => ipcRenderer.invoke('steam:info'),
  retrySteam: () => ipcRenderer.invoke('steam:retry'),
  host: () => ipcRenderer.invoke('net:host'),
  join: code => ipcRenderer.invoke('net:join', String(code)),
  leave: () => ipcRenderer.send('net:leave'),
  send: (data, unreliable) => ipcRenderer.send('net:send', String(data), !!unreliable),
  voice: data => { if (data instanceof Uint8Array) ipcRenderer.send('voice:send', data); },
  onVoice: fn => ipcRenderer.on('voice:message', (_e, from, data) => fn(from, data)),
  invite: () => ipcRenderer.send('net:invite'),
  display: () => ipcRenderer.invoke('display:get'),
  setDisplay: mode => ipcRenderer.send('display:set', String(mode)),
  copy: text => ipcRenderer.send('clipboard', String(text)),
  testWindow: () => ipcRenderer.send('dev:test-window'),
  update: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.send('update:check'),
  updateGo: () => ipcRenderer.send('update:go'),
  quit: () => ipcRenderer.send('app:quit'),
  on: (event, fn) => {
    if (EVENTS[event]) ipcRenderer.on(EVENTS[event], (_e, value) => fn(value));
  },
});
