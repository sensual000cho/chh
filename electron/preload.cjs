const { contextBridge, ipcRenderer, webUtils } = require("electron");

function on(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("chh", {
  // 창
  minimize: () => ipcRenderer.send("win:minimize"),
  toggleMaximize: () => ipcRenderer.send("win:toggle-maximize"),
  close: () => ipcRenderer.send("win:close"),
  setAlwaysOnTop: (on) => ipcRenderer.send("win:always-on-top", on),
  setOpacity: (v) => ipcRenderer.send("win:opacity", v),
  dragStart: () => ipcRenderer.send("win:drag-start"),
  dragStop: () => ipcRenderer.send("win:drag-stop"),
  onWindowState: (cb) => on("window-state", cb),

  // 파일
  openDialog: () => ipcRenderer.invoke("file:open-dialog"),
  readFile: (p) => ipcRenderer.invoke("file:read", p),
  save: (args) => ipcRenderer.invoke("file:save", args),
  autosaveWrite: (content) => ipcRenderer.invoke("file:autosave-write", content),
  autosaveRead: () => ipcRenderer.invoke("file:autosave-read"),
  exportImages: (images) => ipcRenderer.invoke("file:export-images", images),
  saveImage: (args) => ipcRenderer.invoke("file:save-image", args),
  pendingOpen: () => ipcRenderer.invoke("app:pending-open"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onOpenPath: (cb) => on("open-path", cb),

  // 웹 이미지
  fetchImage: (url) => ipcRenderer.invoke("net:fetch-image", url),

  // 클립보드
  addImageToClipboard: (pngDataURL) => ipcRenderer.invoke("clipboard:add-image", pngDataURL),

  // 캡처
  startCapture: () => ipcRenderer.send("capture:start"),
  setCaptureShortcut: (accel) => ipcRenderer.invoke("capture:set-shortcut", accel),
  onCaptureResult: (cb) => on("capture-result", cb),
  onToast: (cb) => on("toast", cb),
});
