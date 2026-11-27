// 앱 단축키: F1·? 도움말, Tab UI 숨기기, Esc 메인 메뉴, N 메모, Alt+G 묶기, Ctrl+F 찾기, Ctrl+N/O/S
import { useEffect, useRef } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { chh } from "../chh.js";

const isTyping = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// opts: { api, modalOpen, uiHidden, setUiHidden, colorPickerOpen, closeColorPickers, openHelp,
//         startNote(point), noteAtCenter, groupSelection, openSearch, newBoard, openDialog, save(saveAs) }
// 리스너는 한 번만 달고, 누를 때마다 가장 최근 opts 를 본다.
export function useHotkeys(opts) {
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });

  // N 키로 만드는 메모가 마우스 위치에 놓이도록 캔버스 위 마지막 마우스 위치를 기억한다
  const pointerRef = useRef(null);
  useEffect(() => {
    const onMove = (e) => {
      pointerRef.current = e.target?.tagName === "CANVAS" ? { clientX: e.clientX, clientY: e.clientY } : null;
    };
    window.addEventListener("pointermove", onMove, true);
    return () => window.removeEventListener("pointermove", onMove, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const o = latest.current;
      const api = o.api;
      if (!api || o.modalOpen) return;
      const typingNow = isTyping(e.target);
      const take = (run) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        run?.();
      };

      // F1: 앱 도움말
      if (e.key === "F1" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return take(o.openHelp);
      // ?: Excalidraw 는 캔버스에 포커스가 있을 때만 받으므로, 어디서 눌러도 되게 직접 받는다
      if (e.key === "?" && !e.ctrlKey && !e.altKey && !e.metaKey && !typingNow) return take(o.openHelp);

      // Tab: 모든 UI 켜기/끄기
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey && !typingNow) {
        return take(() => {
          if (!o.uiHidden) api.setToast({ message: "Tab 키로 UI를 다시 표시합니다", duration: 1500 });
          o.setUiHidden((v) => !v);
        });
      }

      if (e.key === "Escape") {
        if (o.uiHidden) return take(() => o.setUiHidden(false));
        if (o.colorPickerOpen) return take(o.closeColorPickers);
        const s = api.getAppState();
        // Excalidraw 대화상자는 안에 포커스가 있을 때만 Esc 로 닫힌다. 앱 도움말의 "그리기 단축키"로 열면
        // 포커스가 body 에 남아 Esc 가 먹지 않으므로 여기서 닫는다.
        if (s.openDialog && !(e.target instanceof Element && e.target.closest(".Modal"))) {
          return take(() => api.updateScene({ appState: { openDialog: null } }));
        }
        // 글자 입력, 대화상자, 그리던 중인 도형, 색상 팝업 등은 Excalidraw 기본 Esc 동작에 맡긴다.
        if (
          typingNow ||
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
        return take(() => api.updateScene({ appState: { openMenu: s.openMenu === "canvas" ? null : "canvas" } }));
      }

      // 메모(N), 묶기(Alt+G), 검색(Ctrl+F). 한글 입력 상태에서도 되도록 물리 키로 본다.
      if (!typingNow && !e.repeat) {
        const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
        if (plain && e.code === "KeyN") {
          const p = pointerRef.current;
          return take(() => (p ? o.startNote(viewportCoordsToSceneCoords(p, api.getAppState())) : o.noteAtCenter()));
        }
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === "KeyG") return take(o.groupSelection);
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === "KeyF") return take(o.openSearch);
      }

      // 파일 단축키는 데스크톱에서만
      if (!chh || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n" && !e.shiftKey) take(o.newBoard);
      else if (key === "o" && !e.shiftKey) take(o.openDialog);
      else if (key === "s") take(() => o.save(e.shiftKey));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
