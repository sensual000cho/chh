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
  isMaximized: () => ipcRenderer.invoke("win:is-maximized"),
  setClickThrough: (on) => ipcRenderer.invoke("win:click-through", on),
  onClickThrough: (cb) => on("click-through", cb),
  onCloseRequest: (cb) => on("app:close-request", cb),
  closeAck: () => ipcRenderer.send("app:close-ack"),
  closeResponse: (ok) => ipcRenderer.send("app:close-response", ok),

  // 파일
  openDialog: () => ipcRenderer.invoke("file:open-dialog"),
  readFile: (p) => ipcRenderer.invoke("file:read", p),
  save: (args) => ipcRenderer.invoke("file:save", args),
  askUnsaved: (name) => ipcRenderer.invoke("file:ask-unsaved", name),
  autosaveWrite: (content, meta) => ipcRenderer.invoke("file:autosave-write", content, meta),
  autosaveWriteMeta: (meta) => ipcRenderer.invoke("file:autosave-write-meta", meta),
  autosaveRead: () => ipcRenderer.invoke("file:autosave-read"),
  autosaveArchive: () => ipcRenderer.invoke("file:autosave-archive"),
  autosaveClear: () => ipcRenderer.invoke("file:autosave-clear"),
  openBackups: () => ipcRenderer.send("file:open-backups"),
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
  getCaptureShortcut: () => ipcRenderer.invoke("capture:get-shortcut"),
  setCaptureShortcut: (accel) => ipcRenderer.invoke("capture:set-shortcut", accel),
  onCaptureResult: (cb) => on("capture-result", cb),
  onToast: (cb) => on("toast", cb),

  // 자동 점검용 (패키징되지 않은 실행에서 CHH_TEST 를 줬을 때만 true)
  testMode: process.argv.includes("--chh-test"),
  testPaste: (text) => ipcRenderer.invoke("test:paste", text),
  testCopy: () => ipcRenderer.invoke("test:copy"),
  testClipboardImage: () => ipcRenderer.invoke("test:clipboard-image"),
});
