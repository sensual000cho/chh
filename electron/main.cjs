// CHH — Electron 메인 프로세스
// 창 관리(항상 위, 투명도), 파일 열기/저장, 화면 캡처, 웹 이미지 가져오기를 담당한다.
const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  ClipboardItem,
  dialog,
  screen,
  desktopCapturer,
  globalShortcut,
  nativeImage,
  net,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { atomicWrite, archiveFile } = require("./fsutil.cjs");
const { fitBounds } = require("./windowBounds.cjs");

// 개발·테스트용 환경 변수는 패키징되지 않은 실행에서만 듣는다 (배포판에서 임의 코드가 실행되지 않도록)
const devEnv = app.isPackaged ? {} : process.env;
const isDev = devEnv.CHH_DEV === "1";
// 조용한 자동 점검: 화면 밖에서 포커스 없이 실행하고 전역 단축키도 잡지 않는다
const quiet = !!devEnv.CHH_QUIET;
const registerShortcut = (accel, fn) => (quiet ? true : globalShortcut.register(accel, fn));
if (devEnv.CHH_USERDATA) app.setPath("userData", devEnv.CHH_USERDATA);
const userDir = app.getPath("userData");
const AUTOSAVE_PATH = path.join(userDir, "autosave.chh");
const AUTOSAVE_META_PATH = path.join(userDir, "autosave.json");
const BACKUP_DIR = path.join(userDir, "autosave-backups");
const WINDOW_STATE_PATH = path.join(userDir, "window.json");
const SETTINGS_PATH = path.join(userDir, "settings.json");

let mainWindow = null;
let captureWindows = [];
let captureShots = new Map(); // displayId -> { image, display }
const DEFAULT_CAPTURE_SHORTCUT = "CommandOrControl+Shift+X";
const CLICK_THROUGH_SHORTCUT = "CommandOrControl+Shift+L";
let captureShortcut = null; // 지금 등록되어 있는 캡처 단축키
let captureShortcutOk = false;
let settings = loadSettings();
let allowClose = false; // 저장 확인을 마쳤으면 true
let closeWatchdog = null;
let wantOnTop = false; // 사용자가 켠 "항상 위" (클릭 통과 중에는 강제로 켜 둔다)
let clickThrough = false;
let wasVisibleBeforeCapture = true;
let pendingOpenPath = findBoardArg(process.argv);

// ---------- 단일 실행 (.chh 파일 더블클릭 시 기존 창에서 열기) ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const file = findBoardArg(argv);
    if (mainWindow) {
      setClickThrough(false); // 클릭 통과 중이었다면 앱을 다시 실행하는 것으로도 빠져나올 수 있다
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (file) mainWindow.webContents.send("open-path", file);
    }
  });
}

function findBoardArg(argv) {
  return argv.slice(1).find((a) => /\.(chh|excalidraw)$/i.test(a) && fs.existsSync(a)) || null;
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings() {
  atomicWrite(SETTINGS_PATH, JSON.stringify(settings)).catch(() => {});
}

// ---------- 창 ----------
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, "utf8"));
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const state = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() };
  try {
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state));
  } catch {}
}

// 실행 직후 로딩 중임을 알리는 스플래시 (아이콘이 화면 중앙에 뜬다)
let splash = null;
let splashShownAt = 0;
function showSplash() {
  splash = new BrowserWindow({
    width: 240,
    height: 240,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    focusable: false,
    show: true,
    icon: path.join(__dirname, "..", "build", "icon.png"),
  });
  splash.setAlwaysOnTop(true, "screen-saver"); // 항상 위로 설정된 메인 창보다도 위에 둔다
  splash.loadFile(path.join(__dirname, "splash.html"));
  splashShownAt = Date.now();
  splash.webContents.once("did-finish-load", () => splashProgress(10));
  splash.on("closed", () => (splash = null));
}
function splashProgress(v) {
  if (splash && !splash.isDestroyed()) splash.webContents.executeJavaScript(`window.setProgress?.(${v})`).catch(() => {});
}
function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

function createMainWindow() {
  const state = loadWindowState();
  const bounds = quiet
    ? { x: -6000, y: -6000, width: 1200, height: 760 }
    : fitBounds(state, screen.getAllDisplays().map((d) => d.workArea));
  mainWindow = new BrowserWindow({
    ...bounds,
    skipTaskbar: quiet,
    minWidth: 340,
    minHeight: 240,
    frame: false,
    backgroundColor: "#1e1e1e",
    title: "CHH",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !quiet,
      spellcheck: false,
      additionalArguments: devEnv.CHH_TEST ? ["--chh-test"] : [],
    },
  });
  splashProgress(30);
  const wc = mainWindow.webContents;
  wc.once("did-start-loading", () => splashProgress(45));
  wc.once("dom-ready", () => splashProgress(70));
  wc.once("did-finish-load", () => splashProgress(90));

  if (isDev) mainWindow.loadURL("http://localhost:5173");
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  mainWindow.once("ready-to-show", () => {
    splashProgress(100);
    // 스플래시가 너무 금방 사라져 안 보이지 않도록 최소 1.2초는 보여준 뒤 메인 창을 띄운다
    const wait = splash ? Math.max(300, 1200 - (Date.now() - splashShownAt)) : 0;
    setTimeout(() => {
      // maximize() 는 창을 곧바로 보이게 하므로 로딩이 끝난 지금 호출한다
      if (quiet) {
        mainWindow.showInactive();
        return;
      }
      if (state.maximized) mainWindow.maximize();
      mainWindow.show();
      closeSplash();
    }, wait);
  });

  // 개발용 자가 점검: CHH_SHOT=경로 → 화면을 PNG로 저장하고 종료
  if (devEnv.CHH_SHOT) {
    mainWindow.webContents.on("console-message", (e) => {
      if (e.level === "error" || e.level === "warning") console.log(`[renderer:${e.level}] ${e.message}`);
    });
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        if (devEnv.CHH_EVAL) {
          try {
            console.log("[eval]", await mainWindow.webContents.executeJavaScript(devEnv.CHH_EVAL));
          } catch (err) {
            console.log("[eval error]", err.message);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        mainWindow.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 500));
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(devEnv.CHH_SHOT, img.toPNG());
        if (!devEnv.CHH_TEST_REAL_CLOSE) allowClose = true;
        app.quit();
      }, Number(devEnv.CHH_SHOT_DELAY || 4000));
    });
  }
  // 닫기: 렌더러에게 저장 확인을 맡긴다. 렌더러가 응답하지 않으면(멈춤·로딩 중) 3초 뒤 그냥 닫는다.
  mainWindow.on("close", (e) => {
    saveWindowState();
    if (allowClose) return;
    const contents = mainWindow.webContents;
    if (contents.isCrashed() || contents.isLoading()) return;
    e.preventDefault();
    clearTimeout(closeWatchdog);
    closeWatchdog = setTimeout(forceClose, 3000);
    contents.send("app:close-request");
  });
  mainWindow.on("maximize", () => mainWindow.webContents.send("window-state", { maximized: true }));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window-state", { maximized: false }));

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 파일을 창에 떨어뜨렸을 때 페이지가 이동하지 않도록
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!(isDev && url.startsWith("http://localhost:5173"))) e.preventDefault();
  });
}

function forceClose() {
  allowClose = true;
  mainWindow?.close();
}
ipcMain.on("app:close-ack", () => clearTimeout(closeWatchdog)); // 렌더러가 살아 있다
ipcMain.on("app:close-response", (_e, ok) => {
  clearTimeout(closeWatchdog);
  if (ok) forceClose();
});

app.whenReady().then(() => {
  if (!isDev && !devEnv.CHH_SHOT) showSplash();
  createMainWindow();
  captureShortcutOk = registerCaptureShortcut(settings.captureShortcut || DEFAULT_CAPTURE_SHORTCUT);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());

// ---------- 창 제어 IPC ----------
ipcMain.on("win:minimize", () => mainWindow?.minimize());
ipcMain.on("win:toggle-maximize", () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("win:close", () => mainWindow?.close());
ipcMain.on("win:always-on-top", (_e, on) => {
  wantOnTop = !!on;
  if (!clickThrough) mainWindow?.setAlwaysOnTop(wantOnTop, "floating");
});
ipcMain.handle("win:is-maximized", () => !!mainWindow?.isMaximized());

// 클릭 통과: 창을 보이게 둔 채 마우스 입력을 아래 프로그램으로 넘긴다.
// 창을 눌러 끌 수 없으므로, 해제 단축키를 등록할 수 있을 때만 켠다. 단축키는 켜져 있는 동안만 차지한다.
function setClickThrough(on) {
  if (on === clickThrough || !mainWindow) return true;
  if (on) {
    let ok = false;
    try {
      ok = registerShortcut(CLICK_THROUGH_SHORTCUT, () => setClickThrough(false));
    } catch {}
    if (!ok) return false;
    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.setIgnoreMouseEvents(true);
  } else {
    globalShortcut.unregister(CLICK_THROUGH_SHORTCUT);
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(wantOnTop, "floating");
  }
  clickThrough = on;
  mainWindow.webContents.send("click-through", on);
  return true;
}
ipcMain.handle("win:click-through", (_e, on) => setClickThrough(!!on));
ipcMain.on("win:opacity", (_e, value) => {
  const v = Math.min(1, Math.max(0.15, Number(value) || 1));
  mainWindow?.setOpacity(v);
});
// 우클릭 드래그로 창 이동 (PureRef 방식): 커서 위치를 폴링해 창을 따라가게 한다
let dragTimer = null;
function stopWindowDrag() {
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
}
ipcMain.on("win:drag-start", () => {
  if (!mainWindow || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
  stopWindowDrag();
  const start = screen.getCursorScreenPoint();
  const b = mainWindow.getBounds();
  dragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return stopWindowDrag();
    const p = screen.getCursorScreenPoint();
    mainWindow.setBounds({ x: b.x + p.x - start.x, y: b.y + p.y - start.y, width: b.width, height: b.height });
  }, 8);
});
ipcMain.on("win:drag-stop", stopWindowDrag);
ipcMain.handle("app:pending-open", () => {
  const p = pendingOpenPath;
  pendingOpenPath = null;
  return p;
});

// 자동 점검용: 진짜 붙여넣기 이벤트를 일으킨다 (패키징되지 않은 실행에서 CHH_TEST 를 줬을 때만)
if (devEnv.CHH_TEST) {
  ipcMain.handle("test:paste", async (_e, text) => {
    if (text != null) await clipboard.writeText(text);
    mainWindow.webContents.focus();
    // Excalidraw 는 커서가 캔버스 위에 있을 때만 붙여넣기를 처리한다
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: 300, y: 300 });
    mainWindow.webContents.paste();
  });
  ipcMain.handle("test:cdp", async (_e, method, params) => {
    const dbg = mainWindow.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach("1.3");
    return dbg.sendCommand(method, params);
  });
  ipcMain.handle("test:copy", () => mainWindow.webContents.copy());
  ipcMain.handle("test:clipboard-image", async () => {
    const [item] = await clipboard.read();
    const blob = await item.getType("image/png");
    const buf = Buffer.from(await blob.arrayBuffer());
    return { dataURL: `data:image/png;base64,${buf.toString("base64")}`, text: await clipboard.readText() };
  });
}

// ---------- 파일 IPC ----------
const BOARD_FILTERS = [{ name: "CHH 보드", extensions: ["chh"] }];

ipcMain.handle("file:open-dialog", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "보드 열기",
    filters: [...BOARD_FILTERS, { name: "Excalidraw", extensions: ["excalidraw"] }],
    properties: ["openFile"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return readBoard(res.filePaths[0]);
});

ipcMain.handle("file:read", (_e, filePath) => readBoard(filePath));

async function readBoard(filePath) {
  try {
    return { path: filePath, content: await fs.promises.readFile(filePath, "utf8") };
  } catch (err) {
    return { error: String(err.message || err), code: err.code };
  }
}

// 저장하지 않은 변경이 있을 때 묻는다: "save" | "discard" | "cancel"
ipcMain.handle("file:ask-unsaved", async (_e, name) => {
  if (devEnv.CHH_TEST_UNSAVED) return devEnv.CHH_TEST_UNSAVED;
  const res = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "저장되지 않은 변경",
    message: `"${name}"의 변경 내용을 저장할까요?`,
    detail: "저장하지 않으면 변경 내용은 보드에 반영되지 않습니다. (자동 저장 백업 폴더에는 복사본이 남습니다)",
    buttons: ["저장", "저장 안 함", "취소"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return ["save", "discard", "cancel"][res.response];
});

ipcMain.handle("file:save", async (_e, { filePath, content, saveAs }) => {
  let target = filePath;
  if (!target || saveAs) {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: "보드 저장",
      defaultPath: target || path.join(app.getPath("documents"), "새 보드.chh"),
      filters: BOARD_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  try {
    await atomicWrite(target, content);
    return { path: target };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 자동 저장은 순서대로 하나씩만 처리한다 (앞선 쓰기와 뒤섞이지 않도록)
let autosaveQueue = Promise.resolve();
const queued = (job) => {
  const run = autosaveQueue.then(job);
  autosaveQueue = run.catch(() => {});
  return run.then(
    () => true,
    () => false,
  );
};
const writeMeta = (meta) => atomicWrite(AUTOSAVE_META_PATH, JSON.stringify(meta || {}));

ipcMain.handle("file:autosave-write", (_e, content, meta) =>
  queued(async () => {
    await atomicWrite(AUTOSAVE_PATH, content);
    await writeMeta(meta);
  }),
);
ipcMain.handle("file:autosave-write-meta", (_e, meta) => queued(() => writeMeta(meta)));
ipcMain.handle("file:autosave-clear", () =>
  queued(async () => {
    await fs.promises.rm(AUTOSAVE_PATH, { force: true });
    await fs.promises.rm(AUTOSAVE_META_PATH, { force: true });
  }),
);
// 버리기 전에 복사본을 남긴다. 복사할 자동 저장본이 없으면 null.
ipcMain.handle("file:autosave-archive", async () => {
  await autosaveQueue;
  try {
    return await archiveFile(AUTOSAVE_PATH, BACKUP_DIR);
  } catch {
    return null;
  }
});
ipcMain.handle("file:autosave-read", async () => {
  await autosaveQueue;
  let meta = null;
  try {
    meta = JSON.parse(await fs.promises.readFile(AUTOSAVE_META_PATH, "utf8"));
  } catch {}
  let content = null;
  try {
    content = await fs.promises.readFile(AUTOSAVE_PATH, "utf8");
  } catch {}
  if (!meta && !content) return null;
  // 이전 버전의 자동 저장본에는 meta 가 없다: 저장 안 된 작업으로 취급한다
  const m = meta || { filePath: null, dirty: true };
  return { content, meta: { ...m, fileExists: !!m.filePath && fs.existsSync(m.filePath) } };
});
ipcMain.on("file:open-backups", async () => {
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true }).catch(() => {});
  shell.openPath(BACKUP_DIR);
});

// 레퍼런스 이미지를 폴더에 원본 그대로 저장
ipcMain.handle("file:export-images", async (_e, images) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "이미지를 저장할 폴더 선택",
    properties: ["openDirectory", "createDirectory"],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const dir = res.filePaths[0];
  let count = 0;
  for (const img of images) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(img.dataURL || "");
    if (!m) continue;
    let name = img.name;
    let i = 1;
    while (fs.existsSync(path.join(dir, name))) {
      const ext = path.extname(img.name);
      name = `${path.basename(img.name, ext)}_${i++}${ext}`;
    }
    try {
      await fs.promises.writeFile(path.join(dir, name), Buffer.from(m[2], "base64"));
      count++;
    } catch (err) {
      return { dir, count, error: String(err.message || err) };
    }
  }
  shell.openPath(dir);
  return { dir, count };
});

// 복사한 이미지 하나를 OS 클립보드에 비트맵으로도 넣는다.
// Excalidraw 는 요소 JSON(텍스트)만 복사하므로 PureRef 등 외부 앱은 이미지로 인식하지 못한다.
// 텍스트(JSON)는 그대로 두어 CHH 안에서의 붙여넣기(크기·위치 유지)는 유지한다.
ipcMain.handle("clipboard:add-image", async (_e, pngDataURL) => {
  const image = nativeImage.createFromDataURL(pngDataURL || "");
  if (image.isEmpty()) return false;
  const text = await clipboard.readText();
  const items = { "image/png": new Blob([image.toPNG()], { type: "image/png" }) };
  if (text) items["text/plain"] = text;
  await clipboard.write([new ClipboardItem(items)]);
  return true;
});

// 웹에서 끌어온 이미지 URL을 받아오기 (렌더러에서는 CORS로 막힐 수 있음)
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
// 일부 사이트(네이버 블로그 등)는 다른 곳에서 온 요청의 이미지를 막으므로 브라우저처럼 요청한다.
const BROWSER_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
function originOf(url) {
  try {
    return new URL(url).origin + "/";
  } catch {
    return null;
  }
}
// 한 번 요청한다. net.fetch 는 Referer 를 표준대로 막으므로 net.request 를 쓴다.
// 돌려주는 값: { status, mime, buf, tooLarge }. 웹 페이지이거나 너무 크면 본문을 받다가 끊는다.
function requestOnce(url, referer) {
  return new Promise((resolve, reject) => {
    // 다른 사이트 주소를 Referer 로 보내려면 정책을 지정해야 한다 (기본 정책에서는 요청이 막힌다)
    const req = net.request({ url, redirect: "follow", referrerPolicy: "unsafe-url" });
    req.setHeader("User-Agent", BROWSER_UA);
    req.setHeader("Accept", "image/*,*/*;q=0.8");
    if (referer) req.setHeader("Referer", referer);
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error("시간 초과"));
    }, 30000);
    const finish = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on("response", (res) => {
      const header = (name) => [].concat(res.headers[name] || "")[0];
      const mime = String(header("content-type")).split(";")[0].trim().toLowerCase();
      const status = res.statusCode;
      if (status < 200 || status >= 300 || mime.startsWith("text/")) {
        req.abort();
        finish({ status, mime, buf: null });
        return;
      }
      if (Number(header("content-length")) > MAX_IMAGE_BYTES) {
        req.abort();
        finish({ status, mime, buf: null, tooLarge: true });
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          req.abort();
          finish({ status, mime, buf: null, tooLarge: true });
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish({ status, mime, buf: Buffer.concat(chunks) }));
      res.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    req.end();
  });
}

// 원래 페이지 → 이미지 사이트 → 없음 순으로 Referer 를 바꿔 가며, 거절당했을 때만 다시 시도한다
async function fetchWithReferers(url, pageUrl) {
  const referers = [...new Set([/^https?:/i.test(pageUrl || "") ? pageUrl : originOf(url), originOf(url), null])];
  let res = null;
  let lastError = null;
  for (const referer of referers) {
    try {
      res = await requestOnce(url, referer);
      lastError = null;
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.status !== 401 && res.status !== 403) break;
  }
  if (lastError && !res) throw lastError;
  return res;
}

ipcMain.handle("net:fetch-image", async (_e, url, pageUrl) => {
  try {
    if (!/^https?:\/\//i.test(url || "")) return { error: "http(s) 주소만 가져올 수 있습니다" };
    const res = await fetchWithReferers(url, pageUrl || null);
    if (res.status === 401 || res.status === 403) return { error: `사이트가 이미지 가져오기를 막았습니다 (HTTP ${res.status})` };
    if (res.status < 200 || res.status >= 300) return { error: `HTTP ${res.status}` };
    if (res.tooLarge) return { error: "이미지가 너무 큽니다 (100MB 초과)" };
    if (!res.buf) return { error: "이미지가 아닙니다" }; // 웹 페이지 주소를 붙여넣은 경우
    const buf = res.buf;
    let mime = res.mime;
    if (!mime.startsWith("image/")) mime = sniffMime(buf);
    if (!mime) return { error: "이미지가 아닙니다" };
    // webp/avif 등은 PNG로 통일해 Excalidraw 호환성 확보
    if (!["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"].includes(mime)) {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return { error: "지원하지 않는 이미지 형식" };
      return { dataURL: img.toDataURL() };
    }
    return { dataURL: `data:${mime};base64,${buf.toString("base64")}` };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

function sniffMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}

// ---------- 화면 캡처 ----------
function registerCaptureShortcut(accel) {
  if (accel === CLICK_THROUGH_SHORTCUT) return false;
  const previous = captureShortcut;
  if (previous === accel) return true;
  if (previous) globalShortcut.unregister(previous);
  let ok;
  try {
    ok = registerShortcut(accel, startCapture);
  } catch {
    ok = false;
  }
  if (ok) captureShortcut = accel;
  // 등록에 실패하면 쓰던 단축키를 되살린다
  else if (previous) registerShortcut(previous, startCapture);
  return ok;
}

ipcMain.handle("capture:get-shortcut", () => ({
  accel: captureShortcut || settings.captureShortcut || DEFAULT_CAPTURE_SHORTCUT,
  ok: captureShortcutOk,
}));
ipcMain.handle("capture:set-shortcut", (_e, accel) => {
  const ok = registerCaptureShortcut(accel);
  if (ok) {
    captureShortcutOk = true;
    settings = { ...settings, captureShortcut: accel };
    saveSettings();
  }
  return ok;
});
ipcMain.on("capture:start", () => startCapture());

async function startCapture() {
  if (captureWindows.length) return;
  wasVisibleBeforeCapture = !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
  // 보드 창이 캡처를 가리지 않도록 잠시 숨김
  if (wasVisibleBeforeCapture) mainWindow.hide();
  await new Promise((r) => setTimeout(r, 220));
  // 모니터가 여러 대면 포커스가 없는 창에서는 Esc 를 못 받으므로 캡처 중에만 전역으로 잡는다
  try {
    globalShortcut.register("Escape", cancelCapture);
  } catch {}

  const displays = screen.getAllDisplays();
  const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)));
  const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)));
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: maxW, height: maxH },
    });
  } catch (err) {
    globalShortcut.unregister("Escape");
    restoreMain();
    mainWindow?.webContents.send("toast", "화면 캡처 실패: " + (err.message || err));
    return;
  }

  captureShots.clear();
  displays.forEach((display, idx) => {
    const src =
      sources.find((s) => String(s.display_id) === String(display.id)) || sources[idx] || sources[0];
    if (!src) return;
    captureShots.set(display.id, { image: src.thumbnail, display });

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      enableLargerThanScreen: true,
      show: false,
      backgroundColor: "#000000",
      webPreferences: {
        preload: path.join(__dirname, "capture-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setBounds(display.bounds);
    win.loadFile(path.join(__dirname, "capture.html"), { query: { id: String(display.id) } });
    win.once("ready-to-show", () => {
      win.show();
      win.focus();
      // 개발 테스트: 자동으로 영역 선택
      if (devEnv.CHH_TEST_CAPTURE && idx === 0) {
        setTimeout(() => {
          ipcMain.emit("capture:done", {}, { id: display.id, rect: { x: 0, y: 0, width: 480, height: 300 } });
        }, 600);
      }
    });
    captureWindows.push(win);
  });
}

ipcMain.handle("capture:get-shot", (_e, id) => {
  const shot = captureShots.get(Number(id)) || captureShots.get(id);
  return shot ? shot.image.toDataURL() : null;
});

ipcMain.on("capture:done", (_e, { id, rect }) => {
  const shot = captureShots.get(Number(id)) || captureShots.get(id);
  closeCaptureWindows();
  if (!shot || !rect || rect.width < 3 || rect.height < 3) {
    restoreMain();
    return;
  }
  const img = shot.image;
  const size = img.getSize();
  const sx = size.width / shot.display.bounds.width;
  const sy = size.height / shot.display.bounds.height;
  const crop = img.crop({
    x: Math.round(rect.x * sx),
    y: Math.round(rect.y * sy),
    width: Math.round(rect.width * sx),
    height: Math.round(rect.height * sy),
  });
  restoreMain();
  mainWindow?.webContents.send("capture-result", {
    dataURL: crop.toDataURL(),
    scale: sx,
  });
});

function cancelCapture() {
  closeCaptureWindows();
  restoreMain();
}
ipcMain.on("capture:cancel", cancelCapture);

function closeCaptureWindows() {
  globalShortcut.unregister("Escape");
  captureWindows.forEach((w) => !w.isDestroyed() && w.close());
  captureWindows = [];
  captureShots.clear(); // 화면 전체 이미지를 메모리에 남겨 두지 않는다
}

function restoreMain() {
  if (!mainWindow) return;
  if (wasVisibleBeforeCapture || !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
}
