import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  CaptureUpdateAction,
  loadFromBlob,
  newElementWith,
  serializeAsJSON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./excalidraw-dark.css"; // 라이트 테마(필터 없음) 위에 다크 UI 팔레트를 입힌다 (npm run gen:dark-css)
import TitleBar from "./TitleBar.jsx";
import ColorPicker from "./ColorPicker.jsx";
import ElementColorPicker from "./ElementColorPicker.jsx";
import ShortcutDialog from "./ShortcutDialog.jsx";
import { arrangeItems } from "./arrange.js";
import { autosaveDelay, sceneSignature, store } from "./boardStore.js";
import { formatAccelerator } from "./accelerator.js";
import {
  collectImages,
  fileMime,
  insertImages,
  isHttpUrl,
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
  const [pickerPos, setPickerPos] = useState(null);
  const [elPicker, setElPicker] = useState(null); // 요소 선/배경 색 선택기 { type, left, top }
  const [uiHidden, setUiHidden] = useState(false); // Tab: 모든 UI 숨기기
  const [dirty, setDirty] = useState(false); // 파일에 저장되지 않은 변경이 있는가
  const [clickThrough, setClickThrough] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [captureKey, setCaptureKey] = useState("CommandOrControl+Shift+X");
  const uiHiddenRef = useRef(false);
  uiHiddenRef.current = uiHidden;
  const modalRef = useRef(false); // 우리 대화상자가 떠 있는 동안 전역 단축키를 쉬게 한다
  modalRef.current = shortcutOpen;
  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);
  const apiRef = useRef(null);
  apiRef.current = api;
  const pickerOpenRef = useRef(false);
  pickerOpenRef.current = pickerOpen;
  const elPickerRef = useRef(null);
  elPickerRef.current = elPicker;
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
  const autosaveMs = useRef(0); // 지난번 자동 저장에 걸린 시간
  const lastSig = useRef(null); // 마지막으로 자동 저장을 예약한 장면
  const savedSig = useRef(null); // 파일과 같은 상태의 장면
  const dirtyRef = useRef(false);
  const filePathRef = useRef(null);

  const serialize = (api) => serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");

  const setDirtyNow = useCallback((v) => {
    dirtyRef.current = v;
    setDirty(v);
  }, []);

  const markClean = useCallback(
    (sig) => {
      savedSig.current = sig;
      lastSig.current = sig;
      setDirtyNow(false);
    },
    [setDirtyNow],
  );

  // 변경이 있으면 내용까지, 없으면 "파일과 같다"는 표시만 남긴다 (큰 보드를 괜히 다시 쓰지 않도록)
  const writeAutosave = useCallback(async () => {
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = 0;
    const api = apiRef.current;
    if (!api) return;
    const meta = { filePath: filePathRef.current, dirty: dirtyRef.current };
    if (!meta.dirty) {
      await store.writeMeta(meta);
      return;
    }
    const started = performance.now();
    const content = serialize(api);
    await store.write(content, meta);
    autosaveMs.current = performance.now() - started;
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
      if (!autosaveReady.current) return;
      // 화면 이동/확대만 바뀐 경우는 건너뛰도록 요소 버전 합과 배경색으로 변경 여부를 본다
      const sig = sceneSignature(els, stored);
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      const isDirty = sig !== savedSig.current;
      if (isDirty !== dirtyRef.current) setDirtyNow(isDirty);
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(writeAutosave, autosaveDelay(autosaveMs.current));
    },
    [setDirtyNow, writeAutosave],
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

  const boardName = filePath ? filePath.split(/[\\/]/).pop() : "새 보드";
  useEffect(() => {
    document.title = `CHH - ${boardName}${dirty ? " •" : ""}`;
  }, [boardName, dirty]);

  // 다른 보드로 넘어갈 때 지금 보드의 이미지를 메모리에서 뺀다 (실행 취소 기록도 함께 비운 뒤에만 안전하다)
  const dropUnusedFiles = (api, elements) => {
    const used = new Set(elements.map((e) => e.fileId).filter(Boolean));
    const files = api.getFiles();
    for (const id of Object.keys(files)) if (!used.has(id)) delete files[id];
  };

  const openContent = useCallback(
    async (path, content, { restoredDirty = false } = {}) => {
      const api = apiRef.current;
      if (!api) return false;
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = 0;
      autosaveReady.current = false;
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
        dropUnusedFiles(api, scene.elements);
        api.scrollToContent(undefined, { fitToContent: true });
        filePathRef.current = path;
        setFilePath(path);
        const sig = sceneSignature(api.getSceneElementsIncludingDeleted(), scene.appState.viewBackgroundColor);
        if (restoredDirty) {
          // 자동 저장본 복원: 파일과 다른 상태이므로 저장 안 됨으로 표시한다
          savedSig.current = null;
          lastSig.current = sig;
          setDirtyNow(true);
        } else {
          markClean(sig);
          store.writeMeta({ filePath: path, dirty: false });
          if (path) setRecent(addRecent(path));
        }
        return true;
      } catch (err) {
        api.setToast({ message: `보드를 열 수 없습니다: ${err.message || err}` });
        return false;
      } finally {
        autosaveReady.current = true;
      }
    },
    [markClean, setDirtyNow],
  );

  const save = useCallback(
    async (saveAs = false) => {
      const api = apiRef.current;
      if (!api || !chh) return false;
      const sig = sceneSignature(api.getSceneElementsIncludingDeleted(), api.getAppState().viewBackgroundColor);
      const content = serialize(api);
      const res = await chh.save({ filePath: filePathRef.current, content, saveAs });
      if (!res) return false;
      if (res.error) {
        api.setToast({ message: `저장 실패: ${res.error}` });
        return false;
      }
      filePathRef.current = res.path;
      setFilePath(res.path);
      setRecent(addRecent(res.path));
      // 저장하는 동안 더 그렸다면 그만큼은 여전히 저장 안 된 상태다
      savedSig.current = sig;
      const now = sceneSignature(api.getSceneElementsIncludingDeleted(), api.getAppState().viewBackgroundColor);
      setDirtyNow(now !== sig);
      await writeAutosave();
      api.setToast({ message: "저장했습니다.", duration: 1500 });
      return true;
    },
    [setDirtyNow, writeAutosave],
  );

  // 지금 보드를 떠나도 되는지 확인한다: "clean" | "saved" | "discarded" | null(취소)
  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return "clean";
    const name = filePathRef.current ? filePathRef.current.split(/[\\/]/).pop() : "새 보드";
    const answer = chh
      ? await chh.askUnsaved(name)
      : window.confirm(`"${name}"의 변경 내용을 버릴까요?`)
        ? "discard"
        : "cancel";
    if (answer === "cancel") return null;
    if (answer === "save") return (await save(false)) ? "saved" : null;
    // 버리더라도 복사본은 백업 폴더에 남긴다
    await writeAutosave();
    await store.archive();
    return "discarded";
  }, [save, writeAutosave]);

  const openPath = useCallback(
    async (path) => {
      const res = await chh?.readFile(path);
      if (!res || res.error) {
        // 정말 없는 파일만 목록에서 뺀다. 잠겨 있거나 외장 드라이브가 빠진 경우는 남겨 둔다.
        const missing = res?.code === "ENOENT";
        if (missing) setRecent(removeRecent(path));
        apiRef.current?.setToast({
          message: missing ? "파일을 찾을 수 없어 목록에서 뺐습니다." : `파일을 읽지 못했습니다: ${res?.error || ""}`,
        });
        return false;
      }
      if (!(await confirmLeave())) return false;
      return openContent(res.path, res.content);
    },
    [confirmLeave, openContent],
  );

  const openDialog = useCallback(async () => {
    const res = await chh?.openDialog();
    if (!res) return;
    if (res.error) {
      apiRef.current?.setToast({ message: `파일을 읽지 못했습니다: ${res.error}` });
      return;
    }
    if (await confirmLeave()) openContent(res.path, res.content);
  }, [confirmLeave, openContent]);

  const newBoard = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !(await confirmLeave())) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = 0;
    autosaveReady.current = false;
    api.resetScene();
    api.history.clear();
    dropUnusedFiles(api, []);
    api.updateScene({
      appState: { viewBackgroundColor: appliedStored.current, currentItemStrokeColor: DEFAULT_STROKE },
    });
    filePathRef.current = null;
    setFilePath(null);
    markClean(sceneSignature(api.getSceneElementsIncludingDeleted(), appliedStored.current));
    await store.writeMeta({ filePath: null, dirty: false });
    autosaveReady.current = true;
  }, [confirmLeave, markClean]);

  // 창 닫기 요청: 저장 확인을 마친 뒤에 메인 프로세스에 답한다
  useEffect(() => {
    if (!chh?.onCloseRequest) return;
    return chh.onCloseRequest(async () => {
      chh.closeAck();
      let ok = true;
      try {
        const result = await confirmLeave();
        if (!result) ok = false;
        else if (result === "discarded") {
          dirtyRef.current = false;
          if (filePathRef.current) await store.writeMeta({ filePath: filePathRef.current, dirty: false });
          else await store.clear();
        } else await writeAutosave(); // 예약된 자동 저장이 남아 있으면 마무리한다
      } catch (err) {
        console.error(err);
      }
      chh.closeResponse(ok);
    });
  }, [confirmLeave, writeAutosave]);

  // 웹: 아직 자동 저장하지 못한 변경이 있으면 새로고침 전에 묻는다
  useEffect(() => {
    if (chh) return;
    const onBefore = (e) => {
      if (autosaveTimer.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
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
    if (res?.error) api.setToast({ message: `${res.count}장 저장 후 실패했습니다: ${res.error}` });
    else if (res) api.setToast({ message: `${res.count}장을 저장했습니다.`, duration: 2500 });
  }, []);

  // 선택한 이미지(없으면 보드의 모든 이미지)를 크기 그대로 빈틈 적게 늘어놓는다
  const arrangeImages = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    const selected = api.getAppState().selectedElementIds;
    const images = api.getSceneElements().filter((e) => e.type === "image" && !e.locked);
    const picked = images.filter((e) => selected[e.id]);
    const targets = picked.length >= 2 ? picked : images;
    if (targets.length < 2) {
      api.setToast({ message: "정렬할 이미지가 2장 이상 필요합니다." });
      return;
    }
    const places = arrangeItems(targets);
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((e) => (places.has(e.id) ? newElementWith(e, places.get(e.id)) : e)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.scrollToContent(
      api.getSceneElements().filter((e) => places.has(e.id)),
      { fitToContent: true },
    );
    api.setToast({ message: `이미지 ${targets.length}장을 정렬했습니다. (Ctrl+Z로 되돌리기)`, duration: 2500 });
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
      // .excalidraw 도 여기서 연다. 기본 처리에 맡기면 내용만 바뀌고 저장 경로는 이전 파일로 남는다.
      const board = [...(dt.files || [])].find((f) => /\.(chh|excalidraw)$/i.test(f.name));
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
        } else api.setToast({ message: "웹 버전에서는 웹 이미지를 끌어올 수 없습니다. 이미지를 저장한 뒤 넣어 주세요." });
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
    // 외부 이미지는 insertImages 로 넣어 파일 선택/드롭과 같은 크기 규칙을 따르게 한다.
    const onPaste = async (e) => {
      const dt = e.clipboardData;
      if (!e.isTrusted || !dt) return;
      const text = dt.getData("text/plain");
      const typing = /^(input|textarea)$/i.test(e.target?.tagName) || e.target?.isContentEditable;
      if (!dt.files?.length) {
        // 이미지 주소를 붙여넣으면 받아서 넣고, 이미지가 아니면 원래대로 글자 붙여넣기를 한다
        if (typing || !isHttpUrl(text) || !chh) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const res = await chh.fetchImage(text.trim());
        if (res?.dataURL) {
          insertImages(api, [{ dataURL: res.dataURL }], viewCenter(api), "center");
          return;
        }
        const only = new DataTransfer();
        only.setData("text/plain", text);
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: only, bubbles: true }));
        return;
      }
      if (text.includes('"excalidraw/clipboard"')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const only = new DataTransfer();
        only.setData("text/plain", text);
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: only, bubbles: true }));
        return;
      }
      const files = [...dt.files].filter(isImageFile);
      if (!files.length || typing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const sources = [];
      for (const f of files) sources.push({ dataURL: await readAsDataURL(f), mime: fileMime(f) });
      insertImages(api, sources, viewCenter(api), "center");
    };
    document.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste, true);
    };
  }, [api]);

  // 시작: 실행 인자로 받은 파일 → 저장 안 된 자동 저장본 → 마지막에 열었던 파일 순서로 연다
  const started = useRef(false);
  useEffect(() => {
    if (!api || started.current) return;
    started.current = true;
    (async () => {
      try {
        const pending = await chh?.pendingOpen();
        const saved = await store.read().catch(() => null);
        const unsaved = !!saved?.meta?.dirty && !!saved.content;
        if (pending) {
          const res = await chh.readFile(pending);
          if (unsaved) {
            // 지난번 저장 안 한 작업을 잃지 않도록 먼저 복사본을 남긴다
            await store.archive();
            api.setToast({ message: "지난번 저장하지 않은 작업은 자동 저장 백업 폴더에 보관했습니다." });
          }
          if (res?.content != null) await openContent(res.path, res.content);
          else api.setToast({ message: `파일을 읽지 못했습니다: ${res?.error || ""}` });
        } else if (unsaved) {
          const path = saved.meta.fileExists ? saved.meta.filePath : null;
          await openContent(path, saved.content, { restoredDirty: true });
        } else if (saved?.meta?.filePath && saved.meta.fileExists) {
          const res = await chh.readFile(saved.meta.filePath);
          if (res?.content != null) await openContent(res.path, res.content);
        }
      } finally {
        if (savedSig.current === null && !dirtyRef.current) {
          markClean(sceneSignature(api.getSceneElementsIncludingDeleted(), initialBg));
        }
        autosaveReady.current = true;
      }
    })();
  }, [api, openContent, markClean, initialBg]);

  // 이미 실행 중일 때 더블클릭한 보드 파일 열기
  useEffect(() => {
    if (!api || !chh) return;
    return chh.onOpenPath(openPath);
  }, [api, openPath]);

  // 자동 점검용: 패키징되지 않은 실행에서 CHH_TEST 를 줬을 때만 노출한다
  useEffect(() => {
    if (chh?.testMode) window.__chhApi = api;
  }, [api]);

  // 클릭 통과 상태 / 캡처 단축키 등록 결과
  useEffect(() => {
    if (!api || !chh) return;
    const off = chh.onClickThrough((on) => {
      setClickThrough(on);
      if (!on) api.setToast({ message: "클릭 통과를 해제했습니다.", duration: 1500 });
    });
    chh.getCaptureShortcut().then(({ accel, ok }) => {
      setCaptureKey(accel);
      if (!ok) {
        api.setToast({
          message: `캡처 단축키 ${formatAccelerator(accel)}를 등록하지 못했습니다. 다른 프로그램이 쓰고 있을 수 있어요. 메뉴에서 바꿀 수 있습니다.`,
        });
      }
    });
    return off;
  }, [api]);

  const toggleClickThrough = useCallback(async () => {
    const api = apiRef.current;
    const next = !clickThrough;
    const ok = await chh.setClickThrough(next);
    if (!ok) {
      api?.setToast({ message: "해제 단축키(Ctrl+Shift+L)를 등록하지 못해 클릭 통과를 켜지 않았습니다." });
    } else if (next) {
      api?.setToast({ message: "클릭 통과 켜짐: Ctrl+Shift+L로 해제합니다.", duration: 4000 });
    }
  }, [clickThrough]);

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
      if (!api || modalRef.current) return;

      const typingNow =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));

      // Tab: 모든 UI 켜기/끄기
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !typingNow) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!uiHiddenRef.current) api.setToast({ message: "Tab 키로 UI를 다시 표시합니다", duration: 1500 });
        setUiHidden((v) => !v);
        return;
      }

      if (e.key === "Escape") {
        if (uiHiddenRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setUiHidden(false);
          return;
        }
        if (pickerOpenRef.current || elPickerRef.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setPickerOpen(false);
          setElPicker(null);
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
  }, []);

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
  }, [uiHidden]);

  return (
    <div className={`app chh-dark${uiHidden ? " ui-hidden" : ""}${tbPeek ? " tb-peek" : ""}${clickThrough ? " click-through" : ""}`}>
      <TitleBar
        name={boardName}
        dirty={dirty}
        captureKey={formatAccelerator(captureKey)}
        clickThrough={clickThrough}
        onToggleClickThrough={toggleClickThrough}
        onArrange={arrangeImages}
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
          <MainMenu.Item onSelect={arrangeImages}>이미지 자동 정렬</MainMenu.Item>
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
