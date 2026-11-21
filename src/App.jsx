import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./excalidraw-dark.css"; // 라이트 테마(필터 없음) 위에 다크 UI 팔레트를 입힌다 (npm run gen:dark-css)
import TitleBar from "./TitleBar.jsx";
import ColorPicker from "./ColorPicker.jsx";
import ElementColorPicker from "./ElementColorPicker.jsx";
import ShortcutDialog from "./ShortcutDialog.jsx";
import HelpDialog from "./HelpDialog.jsx";
import ZoomBadge from "./ZoomBadge.jsx";
import { arrangeItems } from "./arrange.js";
import { createNote, finishNote, fitFrames, wrapInGroup } from "./notes.js";
import { formatAccelerator } from "./accelerator.js";
import { collectImages, fileMime, insertImages, isImageFile, readAsDataURL, viewCenter } from "./images.js";
import { BG_PRESETS } from "./color.js";
import { clearRecent, formatWhen } from "./recentFiles.js";
import { chh } from "./chh.js";
import { useBoardDocument } from "./hooks/useBoardDocument.js";
import { useClipboardBridge } from "./hooks/useClipboardBridge.js";
import { useDropImport } from "./hooks/useDropImport.js";
import { useHotkeys } from "./hooks/useHotkeys.js";
import { useTitleBarPeek, useWindowDrag } from "./hooks/useWindowChrome.js";
import { useCaptureAndToasts, useDesktopState } from "./hooks/useDesktopEvents.js";

const BG_KEY = "chh.bg";
const DEFAULT_STROKE = "#e6e6e6"; // 어두운 배경에서 잘 보이는 기본 선/글자 색
function loadBg() {
  try {
    const v = localStorage.getItem(BG_KEY);
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return v;
  } catch {}
  return BG_PRESETS[1].color;
}

export default function App() {
  const [api, setApi] = useState(null);
  const apiRef = useRef(null);
  apiRef.current = api;
  const [initialBg] = useState(loadBg);
  const [bg, setBg] = useState(initialBg); // 화면에 보이는 캔버스 배경색
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPos, setPickerPos] = useState(null);
  const [elPicker, setElPicker] = useState(null); // 요소 선/배경 색 선택기 { type, left, top }
  const elPickerRef = useRef(null);
  elPickerRef.current = elPicker;
  const [uiHidden, setUiHidden] = useState(false); // Tab: 모든 UI 숨기기
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const editorHelpRef = useRef(false); // 앱 도움말에서 "그리기 단축키"를 눌러 연 Excalidraw 도움말인가
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);
  const appliedStored = useRef(initialBg); // 마지막으로 우리가 적용한 viewBackgroundColor
  const lastSeenStored = useRef(null);

  const { filePath, boardName, dirty, recent, setRecent, trackChange, save, openPath, openDialog, newBoard } =
    useBoardDocument({
      api,
      apiRef,
      initialBg,
      newBoardState: () => ({ viewBackgroundColor: appliedStored.current, currentItemStrokeColor: DEFAULT_STROKE }),
    });
  const { clickThrough, toggleClickThrough, captureKey, setCaptureKey } = useDesktopState(api);
  useCaptureAndToasts(api);
  useClipboardBridge(api);
  useDropImport(api, bodyRef, openPath);
  useWindowDrag();
  const tbPeek = useTitleBarPeek(uiHidden);

  const applyBg = useCallback((color) => {
    appliedStored.current = color;
    setBg(color);
    try {
      localStorage.setItem(BG_KEY, color);
    } catch {}
    apiRef.current?.updateScene({ appState: { viewBackgroundColor: color } });
  }, []);

  // ---- 메모 ----
  const noteRef = useRef(null); // 지금 글자를 쓰고 있는 메모
  const startNote = useCallback((point) => {
    const api = apiRef.current;
    if (!api) return;
    if (noteRef.current) finishNote(api, noteRef.current);
    noteRef.current = createNote(api, point);
  }, []);
  const noteAtCenter = useCallback(() => {
    if (apiRef.current) startNote(viewCenter(apiRef.current));
  }, [startNote]);

  const onSceneChange = useCallback(
    (els, appState) => {
      // Excalidraw 도움말(? 버튼, ? 키)은 앱 도움말로 돌린다. 앱 도움말의 "그리기 단축키"로 연 경우만 그대로 둔다.
      if (appState.openDialog?.name === "help") {
        if (!editorHelpRef.current) {
          setTimeout(() => {
            apiRef.current?.updateScene({ appState: { openDialog: null } });
            setHelpOpen(true);
          });
        }
      } else editorHelpRef.current = false;
      const note = noteRef.current;
      if (note) {
        if (appState.editingTextElement) note.editing = true;
        else if (note.editing) {
          noteRef.current = null;
          // onChange 안에서 장면을 바꾸지 않도록 다음 차례로 미룬다
          setTimeout(() => apiRef.current && finishNote(apiRef.current, note));
        }
      }
      // 파일 열기 등 바깥에서 배경이 바뀌면 선택 표시를 맞춘다
      // (적용 직후 이전 상태로 한 번 더 알림이 올 수 있어서, 직전에 본 값과 같으면 무시한다)
      const stored = appState.viewBackgroundColor;
      const changed = stored !== lastSeenStored.current;
      lastSeenStored.current = stored;
      if (changed && stored !== appliedStored.current) {
        appliedStored.current = stored;
        setBg(stored);
      }
      trackChange(els, stored);
    },
    [trackChange],
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

  // Excalidraw 속성 패널의 선 색상 / 배경색 버튼: 기본 팝업 대신 우리 선택기를 연다
  useEffect(() => {
    const TRIGGER = ".properties-trigger.active-color";
    const onDown = (e) => {
      const btn = e.target.closest?.(TRIGGER);
      if (!btn) {
        if (elPickerRef.current && !e.target.closest?.(".elpanel")) setElPicker(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.type !== "pointerdown") return;
      // 패널 안의 첫 번째 색 버튼이 선 색상, 두 번째가 배경색
      const panel = btn.closest(".Island") || btn.parentElement;
      const type = [...panel.querySelectorAll(TRIGGER)].indexOf(btn) === 1 ? "bg" : "stroke";
      const p = panel.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      setElPicker((cur) =>
        cur?.type === type
          ? null
          : { type, left: p.right + 4, top: Math.max(8, Math.min(b.top - 8, window.innerHeight - 260)) },
      );
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onDown, true);
    };
  }, []);

  // ---- 이미지 ----
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
    if (res?.error) api.setToast({ message: `${res.count}장 저장 후 실패했습니다: ${res.error}` });
    else if (res) api.setToast({ message: `${res.count}장을 저장했습니다.`, duration: 2500 });
  }, []);

  // 선택한 이미지(없으면 보드의 모든 이미지)를 크기 그대로 빈틈 적게 늘어놓는다
  const arrangeImages = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const selected = api.getAppState().selectedElementIds;
    const images = api.getSceneElements().filter((e) => e.type === "image" && !e.locked);
    // 선택한 이미지와 선택한 묶음 안의 이미지. 선택이 없으면 묶음에 들어 있지 않은 이미지 전체.
    const picked = images.filter((e) => selected[e.id] || selected[e.frameId]);
    const targets = picked.length >= 2 ? picked : images.filter((e) => !e.frameId);
    if (targets.length < 2) {
      api.setToast({ message: "정렬할 이미지가 2장 이상 필요합니다." });
      return;
    }
    const places = arrangeItems(targets);
    const moved = api
      .getSceneElementsIncludingDeleted()
      .map((e) => (places.has(e.id) ? newElementWith(e, places.get(e.id)) : e));
    api.updateScene({
      elements: fitFrames(moved, new Set(targets.map((e) => e.frameId).filter(Boolean))),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.scrollToContent(
      api.getSceneElements().filter((e) => places.has(e.id)),
      { fitToContent: true },
    );
    api.setToast({ message: `이미지 ${targets.length}장을 정렬했습니다. (Ctrl+Z로 되돌리기)`, duration: 2500 });
  }, []);

  const groupSelection = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (!wrapInGroup(api)) api.setToast({ message: "묶을 항목을 먼저 선택하세요.", duration: 2000 });
  }, []);

  // 보드 안 검색: 메모와 글자에서 찾는다
  const openSearch = useCallback(() => {
    setUiHidden(false);
    const api = apiRef.current;
    api?.updateScene({ appState: { openSidebar: { name: "default", tab: "search" }, openDialog: null, openMenu: null } });
    setTimeout(() => {
      const input = document.querySelector(".layer-ui__search input");
      input?.focus();
      input?.select();
    }, 80);
  }, []);

  useHotkeys({
    api,
    modalOpen: shortcutOpen || helpOpen, // 우리 대화상자가 떠 있는 동안 단축키를 쉬게 한다
    uiHidden,
    setUiHidden,
    colorPickerOpen: pickerOpen || !!elPicker,
    closeColorPickers: () => {
      setPickerOpen(false);
      setElPicker(null);
    },
    openHelp: () => setHelpOpen(true),
    startNote,
    noteAtCenter,
    groupSelection,
    openSearch,
    newBoard,
    openDialog,
    save,
  });

  // 자동 점검용: 패키징되지 않은 실행에서 CHH_TEST 를 줬을 때만 노출한다
  useEffect(() => {
    if (chh?.testMode) window.__chhApi = api;
  }, [api]);

  return (
    <div className={`app chh-dark${uiHidden ? " ui-hidden" : ""}${tbPeek ? " tb-peek" : ""}${clickThrough ? " click-through" : ""}`}>
      <TitleBar
        name={boardName}
        dirty={dirty}
        captureKey={formatAccelerator(captureKey)}
        clickThrough={clickThrough}
        onToggleClickThrough={toggleClickThrough}
        onArrange={arrangeImages}
        onNote={noteAtCenter}
        onGroup={groupSelection}
        onSearch={openSearch}
        onOpen={openDialog}
        onSave={() => save(false)}
        onCapture={() => chh.startCapture()}
        onImport={() => fileInputRef.current?.click()}
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
            <>
              <MainMenu.DefaultItems.LoadScene />
              <MainMenu.DefaultItems.Export />
            </>
          )}
          <MainMenu.Item onSelect={() => fileInputRef.current?.click()}>이미지 가져오기</MainMenu.Item>
          <MainMenu.Item onSelect={noteAtCenter} shortcut="N">
            새 메모
          </MainMenu.Item>
          <MainMenu.Item onSelect={groupSelection} shortcut="Alt+G">
            선택 항목 묶기
          </MainMenu.Item>
          <MainMenu.Item onSelect={arrangeImages}>이미지 자동 정렬</MainMenu.Item>
          <MainMenu.Item onSelect={openSearch} shortcut="Ctrl+F">
            보드에서 찾기
          </MainMenu.Item>
          {chh && (
            <>
              <MainMenu.Item onSelect={exportReferenceImages}>레퍼런스 이미지 폴더로 저장</MainMenu.Item>
              <MainMenu.Item onSelect={() => chh.openBackups()}>자동 저장 백업 폴더 열기</MainMenu.Item>
              <MainMenu.Item onSelect={() => setShortcutOpen(true)} shortcut={formatAccelerator(captureKey)}>
                캡처 단축키 바꾸기
              </MainMenu.Item>
            </>
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
                onClick={(e) => {
                  // 메뉴 오른쪽에 붙여서, 배경 색 줄과 같은 높이에 연다
                  const menu = e.currentTarget.closest(".dropdown-menu-container") || e.currentTarget.closest(".dropdown-menu");
                  const row = e.currentTarget.closest(".bg-item") || e.currentTarget;
                  if (menu) {
                    const m = menu.getBoundingClientRect();
                    const r = row.getBoundingClientRect();
                    setPickerPos({ left: m.right + 4, top: Math.max(8, Math.min(r.top, window.innerHeight - 330)) });
                  }
                  setPickerOpen((v) => !v);
                }}
              />
            </div>
          </MainMenu.ItemCustom>
          <MainMenu.Item onSelect={() => setHelpOpen(true)} shortcut="F1">
            도움말
          </MainMenu.Item>
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
      <ZoomBadge api={api} />
      {helpOpen && (
        <HelpDialog
          desktop={!!chh}
          captureKey={captureKey}
          onClose={() => setHelpOpen(false)}
          onShowEditorHelp={() => {
            setHelpOpen(false);
            editorHelpRef.current = true;
            api?.updateScene({ appState: { openDialog: { name: "help" } } });
          }}
        />
      )}
      {shortcutOpen && (
        <ShortcutDialog
          current={captureKey}
          onClose={() => setShortcutOpen(false)}
          onChanged={(accel) => {
            setCaptureKey(accel);
            setShortcutOpen(false);
            api?.setToast({ message: `캡처 단축키: ${formatAccelerator(accel)}`, duration: 2000 });
          }}
        />
      )}
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
      {elPicker && api && <ElementColorPicker key={elPicker.type} api={api} target={elPicker} />}
      {pickerOpen && (
        <div className="bgpanel" style={pickerPos || undefined}>
          <ColorPicker value={bg} onChange={applyBg} />
        </div>
      )}
      </div>
    </div>
  );
}
