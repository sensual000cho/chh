import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  loadFromBlob,
  serializeAsJSON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./excalidraw-dark.css"; // 라이트 테마(필터 없음) 위에 다크 UI 팔레트를 입힌다 (npm run gen:dark-css)
import TitleBar from "./TitleBar.jsx";
import ColorWheel from "./ColorWheel.jsx";
import PixelLayer from "./pixel/PixelLayer.jsx";
import PixelDialog from "./pixel/PixelDialog.jsx";
import { createBoard } from "./pixel/board.js";
import {
  collectImages,
  fileMime,
  insertImages,
  isImageFile,
  pickDropped,
  readAsDataURL,
  toPngDataURL,
  viewCenter,
} from "./images.js";
import { BG_PRESETS } from "./color.js";
import { addRecent, clearRecent, formatWhen, loadRecent, removeRecent } from "./recentFiles.js";

// Electron preload 가 노출하는 window.chh API (electron/preload.cjs) 는
// 브라우저(npm run dev)에서는 없으므로 항상 optional 로 접근한다.
const chh = window.chh;

const BG_KEY = "chh.bg";
const DEFAULT_STROKE = "#e6e6e6"; // 어두운 배경에서 잘 보이는 기본 선/글자 색
const AUTOSAVE_DELAY = 2000; // 마지막 변경 후 이만큼 지나면 자동 저장 (ms)
function loadBg() {
  try {
    const v = localStorage.getItem(BG_KEY);
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return v;
  } catch {}
  return BG_PRESETS[1].color;
}

export default function App() {
  const [api, setApi] = useState(null);
  const [filePath, setFilePath] = useState(null);
  const [recent, setRecent] = useState(loadRecent);
  const [initialBg] = useState(loadBg);
  const [bg, setBg] = useState(initialBg); // 화면에 보이는 캔버스 배경색
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uiHidden, setUiHidden] = useState(false); // Tab: 모든 UI 숨기기
  const [pixelDialog, setPixelDialog] = useState(false);
  const [autoEdit, setAutoEdit] = useState(null);
  const uiHiddenRef = useRef(false);
  uiHiddenRef.current = uiHidden;
  const pixelDialogRef = useRef(false);
  pixelDialogRef.current = pixelDialog;
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);
  const apiRef = useRef(null);
  apiRef.current = api;
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const appliedStored = useRef(initialBg); // 마지막으로 우리가 적용한 viewBackgroundColor

  const applyBg = useCallback((color) => {
    appliedStored.current = color;
    setBg(color);
    try {
      localStorage.setItem(BG_KEY, color);
    } catch {}
    apiRef.current?.updateScene({ appState: { viewBackgroundColor: color } });
  }, []);

  // 파일 열기 등 바깥에서 배경이 바뀌면 선택 표시를 맞춘다
  // (적용 직후 이전 상태로 한 번 더 알림이 올 수 있어서, 직전에 본 값과 같으면 무시한다)
  const lastSeenStored = useRef(null);
  const autosaveReady = useRef(false); // 시작 시 복원이 끝나기 전에는 자동 저장본을 덮어쓰지 않는다
  const autosaveTimer = useRef(0);
  const lastSig = useRef(null);
  const scheduleAutosave = useCallback((els) => {
    // 화면 이동/확대만 바뀐 경우는 건너뛰도록 요소 버전 합으로 변경 여부를 본다
    let sum = 0;
    for (const e of els) sum += e.version;
    const sig = `${els.length}:${sum}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const content = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
      chh.autosaveWrite(content);
    }, AUTOSAVE_DELAY);
  }, []);

  const onSceneChange = useCallback(
    (els, appState) => {
      const stored = appState.viewBackgroundColor;
      const changed = stored !== lastSeenStored.current;
      lastSeenStored.current = stored;
      if (changed && stored !== appliedStored.current) {
        appliedStored.current = stored;
        setBg(stored);
      }
      if (chh && autosaveReady.current) scheduleAutosave(els);
    },
    [scheduleAutosave],
  );

  // 색상 선택 창 바깥을 누르면 닫는다
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (e) => {
      if (e.target.closest(".bgpanel, .bg-custom")) return;
      setPickerOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [pickerOpen]);

  useEffect(() => {
    const name = filePath ? filePath.split(/[\\/]/).pop() : "새 보드";
    document.title = `CHH - ${name}`;
  }, [filePath]);

  const openContent = useCallback(async (path, content) => {
    const api = apiRef.current;
    if (!api) return;
    try {
      const blob = new Blob([content], { type: "application/json" });
      const scene = await loadFromBlob(blob, null, null);
      api.updateScene({
        elements: scene.elements,
        // 파일에 저장된 테마 대신 지금 쓰는 테마를 유지한다.
        appState: { ...scene.appState, theme: api.getAppState().theme, openMenu: null },
      });
      api.addFiles(Object.values(scene.files || {}));
      api.history.clear();
      api.scrollToContent(undefined, { fitToContent: true });
      // path 가 null 이면 자동 저장본 복원: 파일에 연결하지 않는다
      setFilePath(path);
      if (path) setRecent(addRecent(path));
    } catch (err) {
      api.setToast({ message: `보드를 열 수 없습니다: ${err.message || err}` });
    }
  }, []);

  const openPath = useCallback(
    async (path) => {
      const res = await chh?.readFile(path);
      if (!res || res.error) {
        apiRef.current?.setToast({ message: "파일을 찾을 수 없어 목록에서 뺐습니다." });
        setRecent(removeRecent(path));
        return;
      }
      openContent(res.path, res.content);
    },
    [openContent],
  );

  const openDialog = useCallback(async () => {
    const res = await chh?.openDialog();
    if (res && !res.error) openContent(res.path, res.content);
  }, [openContent]);

  const save = useCallback(
    async (saveAs = false) => {
      const api = apiRef.current;
      if (!api || !chh) return;
      const content = serializeAsJSON(
        api.getSceneElements(),
        api.getAppState(),
        api.getFiles(),
        "local",
      );
      const res = await chh.save({ filePath, content, saveAs });
      if (!res) return;
      if (res.error) {
        api.setToast({ message: `저장 실패: ${res.error}` });
        return;
      }
      setFilePath(res.path);
      setRecent(addRecent(res.path));
      api.setToast({ message: "저장했습니다.", duration: 1500 });
    },
    [filePath],
  );

  const newBoard = useCallback(() => {
    apiRef.current?.resetScene();
    apiRef.current?.history.clear();
    apiRef.current?.updateScene({
      appState: { viewBackgroundColor: appliedStored.current, currentItemStrokeColor: DEFAULT_STROKE },
    });
    setFilePath(null);
  }, []);

  // ---- 이미지 가져오기 ----
  const importPicked = useCallback(async (fileList) => {
    const files = [...fileList].filter(isImageFile);
    if (!files.length || !apiRef.current) return;
    const sources = [];
    for (const f of files) sources.push({ dataURL: await readAsDataURL(f), mime: fileMime(f) });
    insertImages(apiRef.current, sources, viewCenter(apiRef.current), "center");
  }, []);

  const exportReferenceImages = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !chh) return;
    const images = collectImages(api);
    if (!images.length) {
      api.setToast({ message: "저장할 레퍼런스 이미지가 없습니다." });
      return;
    }
    const res = await chh.exportImages(images);
    if (res) api.setToast({ message: `${res.count}장을 저장했습니다.`, duration: 2500 });
  }, []);

  const createPixel = useCallback((w, h) => {
    const api = apiRef.current;
    if (!api) return;
    const el = createBoard(api, w, h);
    setPixelDialog(false);
    setAutoEdit({ id: el.id });
  }, []);

  // 파일/웹 이미지 끌어다 놓기 (.chh 파일은 보드로 열기)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !api) return;
    const types = (dt) => [...(dt?.types || [])];
    const onOver = (e) => {
      const t = types(e.dataTransfer);
      if (t.includes("Files") || t.includes("text/uri-list") || t.includes("text/html")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = async (e) => {
      const dt = e.dataTransfer;
      const board = [...(dt.files || [])].find((f) => /\.chh$/i.test(f.name));
      if (board && chh) {
        e.preventDefault();
        e.stopPropagation();
        const p = chh.pathForFile(board);
        if (p) openPath(p);
        return;
      }
      const { files, urls } = pickDropped(dt);
      if (!files.length && !urls.length) return; // 그 밖의 드롭은 Excalidraw 기본 처리
      e.preventDefault();
      e.stopPropagation();
      const at = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const sources = [];
      for (const f of files) sources.push({ dataURL: await readAsDataURL(f), mime: fileMime(f) });
      for (const u of urls) {
        if (u.startsWith("data:")) sources.push({ dataURL: u });
        else if (chh) {
          const r = await chh.fetchImage(u);
          if (r?.dataURL) sources.push({ dataURL: r.dataURL });
          else api.setToast({ message: `이미지를 가져오지 못했습니다: ${r?.error || ""}` });
        }
      }
      if (sources.length) insertImages(api, sources, at, "corner");
    };
    el.addEventListener("dragover", onOver, true);
    el.addEventListener("drop", onDrop, true);
    return () => {
      el.removeEventListener("dragover", onOver, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, [api, openPath]);

  // 이미지 하나를 복사하면 OS 클립보드에 비트맵도 함께 넣어 PureRef 등 외부 앱에 붙여넣을 수 있게 한다.
  // (Excalidraw 는 요소 JSON 텍스트만 복사한다 → PureRef 가 수백만 글자의 노트로 붙여넣으려 함)
  useEffect(() => {
    if (!api || !chh?.addImageToClipboard) return;
    const onCopy = () => {
      const s = api.getAppState();
      const sel = api.getSceneElements().filter((el) => s.selectedElementIds[el.id]);
      if (sel.length !== 1 || sel[0].type !== "image") return;
      const file = api.getFiles()[sel[0].fileId];
      if (!file?.dataURL) return;
      // Excalidraw 의 텍스트 복사(비동기)가 끝난 뒤 이미지를 덧붙인다.
      setTimeout(async () => {
        try {
          await chh.addImageToClipboard(await toPngDataURL(file.dataURL));
        } catch {}
      }, 150);
    };
    // 반대로 CHH 안에서 붙여넣을 때는 Excalidraw 가 이미지 파일을 JSON 보다 우선하므로,
    // 우리 요소 JSON 이 있으면 이미지를 뺀 붙여넣기 이벤트로 바꿔 크기·위치를 그대로 살린다.
    const onPaste = (e) => {
      const dt = e.clipboardData;
      if (!e.isTrusted || !dt?.files?.length) return;
      const text = dt.getData("text/plain");
      if (!text.includes('"excalidraw/clipboard"')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const only = new DataTransfer();
      only.setData("text/plain", text);
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: only, bubbles: true }));
    };
    document.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste, true);
    };
  }, [api]);

  // 실행 인자 / 이미 실행 중일 때 더블클릭한 .chh 파일 열기
  useEffect(() => {
    if (!api || !chh) return;
    chh.pendingOpen().then(async (p) => {
      if (p) {
        autosaveReady.current = true;
        openPath(p);
        return;
      }
      // 열 파일이 없으면 지난번 자동 저장본을 복원한다
      try {
        const content = await chh.autosaveRead();
        if (content) await openContent(null, content);
      } finally {
        autosaveReady.current = true;
      }
    });
    return chh.onOpenPath(openPath);
  }, [api, openPath, openContent]);

  // 화면 캡처 결과를 현재 화면 가운데에 이미지로 붙인다.
  useEffect(() => {
    if (!api || !chh) return;
    const offCapture = chh.onCaptureResult(({ dataURL, scale }) => {
      const img = new Image();
      img.onload = () => {
        const s = api.getAppState();
        const w = img.naturalWidth / (scale || 1);
        const h = img.naturalHeight / (scale || 1);
        const fileId = `cap_${Date.now()}`;
        api.addFiles([{ id: fileId, dataURL, mimeType: "image/png", created: Date.now() }]);
        const cx = -s.scrollX + s.width / 2 / s.zoom.value;
        const cy = -s.scrollY + s.height / 2 / s.zoom.value;
        const [el] = convertToExcalidrawElements([
          { type: "image", fileId, status: "saved", x: cx - w / 2, y: cy - h / 2, width: w, height: h },
        ]);
        api.updateScene({
          elements: [...api.getSceneElements(), el],
          appState: { selectedElementIds: { [el.id]: true } },
        });
      };
      img.src = dataURL;
    });
    const offToast = chh.onToast((message) => api.setToast({ message }));
    return () => {
      offCapture();
      offToast();
    };
  }, [api]);

  // 단축키: Esc = 메인 메뉴 열기/닫기, Ctrl+N/O/S, Ctrl+Shift+S
  useEffect(() => {
    const onKeyDown = (e) => {
      const api = apiRef.current;
      if (!api) return;

      const typingNow =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));

      // Tab: 모든 UI 켜기/끄기
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !typingNow && !pixelDialogRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!uiHiddenRef.current) api.setToast({ message: "Tab 키로 UI를 다시 표시합니다", duration: 1500 });
        setUiHidden((v) => !v);
        return;
      }

      // 픽셀 그리기 중의 Esc 는 PixelLayer 가 처리한다
      if (e.key === "Escape" && document.body.classList.contains("px-editing")) return;

      if (e.key === "Escape") {
        if (uiHiddenRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setUiHidden(false);
          return;
        }
        if (pickerOpenRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setPickerOpen(false);
          return;
        }
        const s = api.getAppState();
        const t = e.target;
        const typing =
          t instanceof HTMLElement &&
          (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        // 글자 입력, 대화상자, 그리던 중인 도형, 색상 팝업 등은 Excalidraw 기본 Esc 동작에 맡긴다.
        if (
          typing ||
          s.openDialog ||
          s.openPopup ||
          s.openSidebar ||
          s.editingTextElement ||
          s.newElement ||
          s.multiElement ||
          s.openMenu === "shape"
        ) {
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        api.updateScene({ appState: { openMenu: s.openMenu === "canvas" ? null : "canvas" } });
        return;
      }

      if (!chh || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      let action = null;
      if (key === "n" && !e.shiftKey) action = newBoard;
      else if (key === "o" && !e.shiftKey) action = openDialog;
      else if (key === "s") action = () => save(e.shiftKey);
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      action();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [newBoard, openDialog, save]);

  // 우클릭 드래그로 창 이동 (PureRef 방식). 거의 안 움직였으면 일반 우클릭 메뉴가 뜬다.
  useEffect(() => {
    if (!chh) return;
    let origin = null;
    let moved = false;
    const onDown = (e) => {
      if (e.button !== 2) return;
      origin = { x: e.screenX, y: e.screenY };
      moved = false;
      chh.dragStart();
    };
    const onMove = (e) => {
      if (!origin || moved) return;
      if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 4) moved = true;
    };
    const end = () => {
      if (!origin) return;
      origin = null;
      chh.dragStop();
    };
    const onUp = (e) => e.button === 2 && end();
    const onContext = (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("blur", end);
    window.addEventListener("contextmenu", onContext, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("blur", end);
      window.removeEventListener("contextmenu", onContext, true);
      end();
    };
  }, [chh]);

  // UI를 숨긴 상태에서 창 맨 위에 마우스를 올리면 제목 표시줄이 잠깐 나타난다 (PureRef 방식)
  const [tbPeek, setTbPeek] = useState(false);
  useEffect(() => {
    if (!chh || !uiHidden) {
      setTbPeek(false);
      return;
    }
    const onMove = (e) => {
      setTbPeek((v) => (v ? e.clientY <= 44 : e.clientY <= 6));
    };
    const onLeave = () => setTbPeek(false);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [chh, uiHidden]);

  return (
    <div className={`app chh-dark${uiHidden ? " ui-hidden" : ""}${tbPeek ? " tb-peek" : ""}`}>
      <TitleBar
        name={filePath ? filePath.split(/[\\/]/).pop() : "새 보드"}
        onOpen={openDialog}
        onSave={() => save(false)}
        onCapture={() => chh.startCapture()}
        onImport={() => fileInputRef.current?.click()}
        onNewPixel={() => setPixelDialog(true)}
      />
      <div className="app-body" ref={bodyRef}>
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onSceneChange}
        initialData={{ appState: { viewBackgroundColor: initialBg, currentItemStrokeColor: DEFAULT_STROKE } }}
        theme="light"
        langCode="ko-KR"
      >
        <MainMenu>
          {chh ? (
            <>
              <MainMenu.Item onSelect={newBoard} shortcut="Ctrl+N">
                새 보드
              </MainMenu.Item>
              <MainMenu.Item onSelect={openDialog} shortcut="Ctrl+O">
                보드 열기
              </MainMenu.Item>
              <MainMenu.Item onSelect={() => save(false)} shortcut="Ctrl+S">
                저장
              </MainMenu.Item>
              <MainMenu.Item onSelect={() => save(true)} shortcut="Ctrl+Shift+S">
                다른 이름으로 저장
              </MainMenu.Item>
            </>
          ) : (
            <MainMenu.DefaultItems.LoadScene />
          )}
          <MainMenu.Item onSelect={() => fileInputRef.current?.click()}>이미지 가져오기</MainMenu.Item>
          <MainMenu.Item onSelect={() => setPixelDialog(true)}>새 픽셀판</MainMenu.Item>
          {chh && (
            <MainMenu.Item onSelect={exportReferenceImages}>레퍼런스 이미지 폴더로 저장</MainMenu.Item>
          )}
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.ItemCustom className="bg-item">
            <div className="bg-title">캔버스 배경</div>
            <div className="bg-row">
              {BG_PRESETS.map((p) => (
                <button
                  key={p.color}
                  className={`bg-swatch${bg.toLowerCase() === p.color ? " selected" : ""}`}
                  style={{ background: p.color }}
                  title={p.name}
                  onClick={() => applyBg(p.color)}
                />
              ))}
              <span className="bg-sep" />
              <button
                className={`bg-swatch bg-custom${pickerOpen ? " selected" : ""}`}
                title="색상 직접 고르기"
                onClick={() => setPickerOpen((v) => !v)}
              />
            </div>
          </MainMenu.ItemCustom>
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />

          {chh && (
            <>
              <MainMenu.Separator />
              <MainMenu.Group title="최근 작업 파일">
                {recent.length === 0 ? (
                  <MainMenu.ItemCustom className="chh-recent-empty">
                    아직 작업한 파일이 없습니다
                  </MainMenu.ItemCustom>
                ) : (
                  <>
                    {recent.map((f) => (
                      <MainMenu.Item
                        key={f.path}
                        className="chh-recent-item"
                        title={f.path}
                        selected={f.path === filePath}
                        shortcut={formatWhen(f.openedAt)}
                        onSelect={() => openPath(f.path)}
                      >
                        {f.name}
                      </MainMenu.Item>
                    ))}
                    <MainMenu.Item onSelect={() => setRecent(clearRecent())}>
                      목록 지우기
                    </MainMenu.Item>
                  </>
                )}
              </MainMenu.Group>
            </>
          )}
        </MainMenu>
      </Excalidraw>
      <PixelLayer
        api={api}
        hidden={uiHidden}
        autoEdit={autoEdit}
        onAutoEditDone={() => setAutoEdit(null)}
      />
      {pixelDialog && <PixelDialog onCreate={createPixel} onClose={() => setPixelDialog(false)} />}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          importPicked(e.target.files);
          e.target.value = "";
        }}
      />
      {pickerOpen && (
        <div className="bgpanel">
          <ColorWheel value={bg} onChange={applyBg} />
        </div>
      )}
      </div>
    </div>
  );
}
