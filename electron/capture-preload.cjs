const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("cap", {
  getShot: (id) => ipcRenderer.invoke("capture:get-shot", id),
  done: (id, rect) => ipcRenderer.send("capture:done", { id, rect }),
  cancel: () => ipcRenderer.send("capture:cancel"),
});
