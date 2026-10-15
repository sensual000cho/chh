import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  loadFromBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import TitleBar from "./TitleBar.jsx";
import ColorWheel from "./ColorWheel.jsx";
import { BG_PRESETS, toDisplay, toStored } from "./color.js";
import { addRecent, clearRecent, formatWhen, loadRecent, removeRecent } from "./recentFiles.js";

// Electron preload 가 노출하는 window.chh API (electron/preload.cjs) 는
// 브라우저(npm run dev)에서는 없으므로 항상 optional 로 접근한다.
const chh = window.chh;

const BG_KEY = "chh.bg";
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
  const apiRef = useRef(null);
  apiRef.current = api;
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const appliedStored = useRef(toStored(initialBg)); // 마지막으로 우리가 적용한 viewBackgroundColor(저장값)

  const applyBg = useCallback((display) => {
    const stored = toStored(display);
    appliedStored.current = stored;
    setBg(display);
    try {
      localStorage.setItem(BG_KEY, display);
    } catch {}
    apiRef.current?.updateScene({ appState: { viewBackgroundColor: stored } });
  }, []);

  // 파일 열기 등 바깥에서 배경이 바뀌면 선택 표시를 맞춘다
  // (적용 직후 이전 상태로 한 번 더 알림이 올 수 있어서, 직전에 본 값과 같으면 무시한다)
  const lastSeenStored = useRef(null);
  const onSceneChange = useCallback((_els, appState) => {
    const stored = appState.viewBackgroundColor;
    const changed = stored !== lastSeenStored.current;
    lastSeenStored.current = stored;
    if (changed && stored !== appliedStored.current) {
      appliedStored.current = stored;
      setBg(toDisplay(stored));
    }
  }, []);

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
      setFilePath(path);
      setRecent(addRecent(path));
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
      appState: { viewBackgroundColor: appliedStored.current },
    });
    setFilePath(null);
  }, []);

  // 실행 인자 / 이미 실행 중일 때 더블클릭한 .chh 파일 열기
  useEffect(() => {
    if (!api || !chh) return;
    chh.pendingOpen().then((p) => p && openPath(p));
    return chh.onOpenPath(openPath);
  }, [api, openPath]);

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

      if (e.key === "Escape") {
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

  return (
    <div className="app">
      <TitleBar
        name={filePath ? filePath.split(/[\\/]/).pop() : "새 보드"}
        onOpen={openDialog}
        onSave={() => save(false)}
        onCapture={() => chh.startCapture()}
      />
      <div className="app-body">
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onSceneChange}
        initialData={{ appState: { viewBackgroundColor: toStored(initialBg) } }}
        theme="dark"
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
      {pickerOpen && (
        <div className="bgpanel">
          <ColorWheel value={bg} onChange={applyBg} />
        </div>
      )}
      </div>
    </div>
  );
}
