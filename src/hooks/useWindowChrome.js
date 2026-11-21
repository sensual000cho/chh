// 데스크톱 창 다루기: 우클릭 드래그 이동, UI 숨김 중 제목 표시줄 엿보기 (PureRef 방식)
import { useEffect, useState } from "react";
import { chh } from "../chh.js";

// 우클릭 드래그로 창 이동. 거의 안 움직였으면 일반 우클릭 메뉴가 뜬다.
export function useWindowDrag() {
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
}

// UI를 숨긴 상태에서 창 맨 위에 마우스를 올리면 제목 표시줄이 잠깐 나타난다
export function useTitleBarPeek(uiHidden) {
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!chh || !uiHidden) {
      setPeek(false);
      return;
    }
    const onMove = (e) => setPeek((v) => (v ? e.clientY <= 44 : e.clientY <= 6));
    const onLeave = () => setPeek(false);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [uiHidden]);
  return peek;
}
