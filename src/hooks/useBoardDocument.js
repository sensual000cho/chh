// 보드 문서: 파일 열기·저장, 저장 안 된 변경 추적, 자동 저장, 시작 시 복원, 창 닫기 확인
import { useCallback, useEffect, useRef, useState } from "react";
import { loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import { autosaveDelay, sceneSignature, store } from "../boardStore.js";
import { addRecent, loadRecent, removeRecent } from "../recentFiles.js";
import { chh } from "../chh.js";

const serialize = (api) => serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
const nameOf = (path) => (path ? path.split(/[\\/]/).pop() : "새 보드");

// 다른 보드로 넘어갈 때 지금 보드의 이미지를 메모리에서 뺀다 (실행 취소 기록도 함께 비운 뒤에만 안전하다)
function dropUnusedFiles(api, elements) {
  const used = new Set(elements.map((e) => e.fileId).filter(Boolean));
  const files = api.getFiles();
  for (const id of Object.keys(files)) if (!used.has(id)) delete files[id];
}

// api: Excalidraw API (준비되기 전에는 null), apiRef: 같은 값을 담은 ref
// initialBg: 시작할 때의 캔버스 배경색, newBoardState(): 새 보드에 줄 appState
export function useBoardDocument({ api, apiRef, initialBg, newBoardState }) {
  const [filePath, setFilePath] = useState(null);
  const [dirty, setDirty] = useState(false); // 파일에 저장되지 않은 변경이 있는가
  const [recent, setRecent] = useState(loadRecent);

  const autosaveReady = useRef(false); // 시작 시 복원이 끝나기 전에는 자동 저장본을 덮어쓰지 않는다
  const autosaveTimer = useRef(0);
  const autosaveMs = useRef(0); // 지난번 자동 저장에 걸린 시간
  const lastSig = useRef(null); // 마지막으로 자동 저장을 예약한 장면
  const savedSig = useRef(null); // 파일과 같은 상태의 장면
  const dirtyRef = useRef(false);
  const filePathRef = useRef(null);
  const newBoardStateRef = useRef(newBoardState);
  useEffect(() => {
    newBoardStateRef.current = newBoardState;
  });

  const boardName = nameOf(filePath);
  useEffect(() => {
    document.title = `Thinking Chair - ${boardName}${dirty ? " •" : ""}`;
  }, [boardName, dirty]);

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

  const setPath = (path) => {
    filePathRef.current = path;
    setFilePath(path);
  };

  const stopAutosave = () => {
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = 0;
    autosaveReady.current = false;
  };

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
  }, [apiRef]);

  // Excalidraw onChange 에서 부른다: 저장 안 됨 표시를 맞추고 자동 저장을 예약한다
  const trackChange = useCallback(
    (elements, bgColor) => {
      if (!autosaveReady.current) return;
      // 화면 이동/확대만 바뀐 경우는 건너뛰도록 요소 버전 합과 배경색으로 변경 여부를 본다
      const sig = sceneSignature(elements, bgColor);
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      const isDirty = sig !== savedSig.current;
      if (isDirty !== dirtyRef.current) setDirtyNow(isDirty);
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(writeAutosave, autosaveDelay(autosaveMs.current));
    },
    [setDirtyNow, writeAutosave],
  );

  const openContent = useCallback(
    async (path, content, { restoredDirty = false } = {}) => {
      const api = apiRef.current;
      if (!api) return false;
      stopAutosave();
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
        setPath(path);
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
    [apiRef, markClean, setDirtyNow],
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
      setPath(res.path);
      setRecent(addRecent(res.path));
      // 저장하는 동안 더 그렸다면 그만큼은 여전히 저장 안 된 상태다
      savedSig.current = sig;
      const now = sceneSignature(api.getSceneElementsIncludingDeleted(), api.getAppState().viewBackgroundColor);
      setDirtyNow(now !== sig);
      await writeAutosave();
      api.setToast({ message: "저장했습니다.", duration: 1500 });
      return true;
    },
    [apiRef, setDirtyNow, writeAutosave],
  );

  // 지금 보드를 떠나도 되는지 확인한다: "clean" | "saved" | "discarded" | null(취소)
  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current) return "clean";
    const name = nameOf(filePathRef.current);
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
    [apiRef, confirmLeave, openContent],
  );

  const openDialog = useCallback(async () => {
    const res = await chh?.openDialog();
    if (!res) return;
    if (res.error) {
      apiRef.current?.setToast({ message: `파일을 읽지 못했습니다: ${res.error}` });
      return;
    }
    if (await confirmLeave()) openContent(res.path, res.content);
  }, [apiRef, confirmLeave, openContent]);

  const newBoard = useCallback(async () => {
    const api = apiRef.current;
    if (!api || !(await confirmLeave())) return;
    stopAutosave();
    api.resetScene();
    api.history.clear();
    dropUnusedFiles(api, []);
    const appState = newBoardStateRef.current();
    api.updateScene({ appState });
    setPath(null);
    markClean(sceneSignature(api.getSceneElementsIncludingDeleted(), appState.viewBackgroundColor));
    await store.writeMeta({ filePath: null, dirty: false });
    autosaveReady.current = true;
  }, [apiRef, confirmLeave, markClean]);

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

  return { filePath, boardName, dirty, recent, setRecent, trackChange, save, openPath, openDialog, newBoard };
}
