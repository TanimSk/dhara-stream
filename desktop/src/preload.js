// The only bridge between the dashboard UI and the machine: exposed as window.dharaDesktop.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=").slice(1).join("=");

contextBridge.exposeInMainWorld("dharaDesktop", {
  apiBase: arg("dhara-api"),
  version: arg("dhara-version"),
  platform: process.platform,
  getRefresh: () => ipcRenderer.invoke("dhara:getRefresh"),
  setRefresh: (t) => ipcRenderer.invoke("dhara:setRefresh", t),
  pickFiles: () => ipcRenderer.invoke("dhara:pickFiles"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probe: (p) => ipcRenderer.invoke("dhara:probe", p),
  encoders: () => ipcRenderer.invoke("dhara:encoders"),
  transcode: (jobId, p, opts) => ipcRenderer.invoke("dhara:transcode", jobId, p, opts),
  upload: (jobId, urls) => ipcRenderer.invoke("dhara:upload", jobId, urls),
  cancel: (jobId) => ipcRenderer.invoke("dhara:cancel", jobId),
  cleanup: (jobId) => ipcRenderer.invoke("dhara:cleanup", jobId),
  onProgress: (cb) => {
    const fn = (_e, p) => cb(p);
    ipcRenderer.on("dhara:progress", fn);
    return () => ipcRenderer.removeListener("dhara:progress", fn);
  },
});
