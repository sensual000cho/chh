// CHH — Electron 메인 프로세스
// 창 관리(항상 위, 투명도), 파일 열기/저장, 화면 캡처, 웹 이미지 가져오기를 담당한다.
const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
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

const isDev = process.env.CHH_DEV === "1";
if (process.env.CHH_USERDATA) app.setPath("userData", process.env.CHH_USERDATA);
const userDir = app.getPath("userData");
const AUTOSAVE_PATH = path.join(userDir, "autosave.chh");
const WINDOW_STATE_PATH = path.join(userDir, "window.json");

let mainWindow = null;
let captureWindows = [];
let captureShots = new Map(); // displayId -> { image, display }
let captureShortcut = "CommandOrControl+Shift+X";
let wasVisibleBeforeCapture = true;
let pendingOpenPath = findBoardArg(process.argv);

// ---------- 단일 실행 (.chh 파일 더블클릭 시 기존 창에서 열기) ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const file = findBoardArg(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (file) mainWindow.webContents.send("open-path", file);
    }
  });
}

function findBoardArg(argv) {
  return argv.slice(1).find((a) => a.toLowerCase().endsWith(".chh") && fs.existsSync(a)) || null;
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
    show: false,
    icon: path.join(__dirname, "..", "build", "icon.png"),
  });
  splash.loadFile(path.join(__dirname, "splash.html"));
  splash.once("ready-to-show", () => splash?.show());
  splash.on("closed", () => (splash = null));
}
function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

function createMainWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width || 1280,
    height: state.height || 800,
    minWidth: 360,
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
      spellcheck: false,
    },
  });
  if (state.maximized) mainWindow.maximize();

  if (isDev) mainWindow.loadURL("http://localhost:5173");
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    closeSplash();
  });

  // 개발용 자가 점검: CHH_SHOT=경로 → 화면을 PNG로 저장하고 종료
  if (process.env.CHH_SHOT) {
    mainWindow.webContents.on("console-message", (_e, level, message) =>
      console.log(`[renderer:${level}] ${message}`),
    );
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        if (process.env.CHH_EVAL) {
          try {
            console.log("[eval]", await mainWindow.webContents.executeJavaScript(process.env.CHH_EVAL));
          } catch (err) {
            console.log("[eval error]", err.message);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        mainWindow.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 500));
        const img = await mainWindow.webContents.capturePage();
        fs.writeFileSync(process.env.CHH_SHOT, img.toPNG());
        app.quit();
      }, Number(process.env.CHH_SHOT_DELAY || 4000));
    });
  }
  mainWindow.on("close", saveWindowState);
  mainWindow.on("maximize", () => mainWindow.webContents.send("window-state", { maximized: true }));
  mainWindow.on("unmaximize", () => mainWindow.webContents.send("window-state", { maximized: false }));

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 파일을 창에 떨어뜨렸을 때 페이지가 이동하지 않도록
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("http://localhost:5173")) e.preventDefault();
  });
}

app.whenReady().then(() => {
  if (!isDev && !process.env.CHH_SHOT) showSplash();
  createMainWindow();
  registerCaptureShortcut(captureShortcut);
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
ipcMain.on("win:always-on-top", (_e, on) => mainWindow?.setAlwaysOnTop(!!on, "floating"));
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

function readBoard(filePath) {
  try {
    return { path: filePath, content: fs.readFileSync(filePath, "utf8") };
  } catch (err) {
    return { error: String(err.message || err) };
  }
}

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
    fs.writeFileSync(target, content, "utf8");
    return { path: target };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

ipcMain.handle("file:autosave-write", (_e, content) => {
  try {
    fs.writeFileSync(AUTOSAVE_PATH, content, "utf8");
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("file:autosave-read", () => {
  try {
    return fs.readFileSync(AUTOSAVE_PATH, "utf8");
  } catch {
    return null;
  }
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
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], "base64"));
    count++;
  }
  shell.openPath(dir);
  return { dir, count };
});

// 픽셀판 등 단일 PNG 내보내기 (투명 배경 유지)
ipcMain.handle("file:save-image", async (_e, { defaultName, dataURL }) => {
  // 개발 테스트: CHH_TEST_SAVE=폴더 → 대화상자 없이 그 폴더에 저장
  const res = process.env.CHH_TEST_SAVE
    ? { filePath: path.join(process.env.CHH_TEST_SAVE, defaultName || "image.png") }
    : await dialog.showSaveDialog(mainWindow, {
        title: "이미지 내보내기",
        defaultPath: path.join(app.getPath("pictures"), defaultName || "image.png"),
        filters: [{ name: "PNG 이미지", extensions: ["png"] }],
      });
  if (res.canceled || !res.filePath) return null;
  const m = /^data:image\/png;base64,(.*)$/s.exec(dataURL || "");
  if (!m) return { error: "PNG 데이터가 아닙니다" };
  try {
    fs.writeFileSync(res.filePath, Buffer.from(m[1], "base64"));
    if (!process.env.CHH_TEST_SAVE) shell.showItemInFolder(res.filePath);
    return { path: res.filePath };
  } catch (err) {
    return { error: String(err.message || err) };
  }
});

// 복사한 이미지 하나를 OS 클립보드에 비트맵으로도 넣는다.
// Excalidraw 는 요소 JSON(텍스트)만 복사하므로 PureRef 등 외부 앱은 이미지로 인식하지 못한다.
// 텍스트(JSON)는 그대로 두어 CHH 안에서의 붙여넣기(크기·위치 유지)는 유지한다.
ipcMain.handle("clipboard:add-image", (_e, pngDataURL) => {
  const image = nativeImage.createFromDataURL(pngDataURL || "");
  if (image.isEmpty()) return false;
  const text = clipboard.readText();
  clipboard.write(text ? { text, image } : { image });
  return true;
});

// 웹에서 끌어온 이미지 URL을 받아오기 (렌더러에서는 CORS로 막힐 수 있음)
ipcMain.handle("net:fetch-image", async (_e, url) => {
  try {
    const res = await net.fetch(url, { headers: { "User-Agent": "Mozilla/5.0 CHH" } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    let mime = (res.headers.get("content-type") || "").split(";")[0].trim();
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
  try {
    if (captureShortcut) globalShortcut.unregister(captureShortcut);
  } catch {}
  let ok = false;
  try {
    ok = globalShortcut.register(accel, startCapture);
  } catch {
    ok = false;
  }
  if (ok) captureShortcut = accel;
  return ok;
}

ipcMain.handle("capture:set-shortcut", (_e, accel) => registerCaptureShortcut(accel));
ipcMain.on("capture:start", () => startCapture());

async function startCapture() {
  if (captureWindows.length) return;
  wasVisibleBeforeCapture = !!mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
  // 보드 창이 캡처를 가리지 않도록 잠시 숨김
  if (wasVisibleBeforeCapture) mainWindow.hide();
  await new Promise((r) => setTimeout(r, 220));

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
      if (process.env.CHH_TEST_CAPTURE && idx === 0) {
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

ipcMain.on("capture:cancel", () => {
  closeCaptureWindows();
  restoreMain();
});

function closeCaptureWindows() {
  captureWindows.forEach((w) => !w.isDestroyed() && w.close());
  captureWindows = [];
}

function restoreMain() {
  if (!mainWindow) return;
  if (wasVisibleBeforeCapture || !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }
}
