import { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import ColorPicker from "./ColorPicker.jsx";

// Excalidraw 속성 패널의 선 색상 / 배경색 버튼을 누르면 기본 팝업 대신 이 선택기를 띄운다.
const KEY = { stroke: "strokeColor", bg: "backgroundColor" };
const CURRENT = { stroke: "currentItemStrokeColor", bg: "currentItemBackgroundColor" };

// 투명 배경이나 #rrggbbaa 같은 색은 앞 6자리만 쓴다
function parse(c) {
  const m = /^#([0-9a-f]{6})/i.exec(c || "");
  return m ? "#" + m[1].toLowerCase() : "#ffffff";
}

// 지금 선택된 요소들(없으면 다음에 그릴 요소)의 색
function readColor(api, type) {
  const s = api.getAppState();
  const sel = api.getSceneElements().find((el) => s.selectedElementIds[el.id]);
  return sel ? sel[KEY[type]] : s[CURRENT[type]];
}

export default function ElementColorPicker({ api, target }) {
  const [hex, setHex] = useState(() => parse(readColor(api, target.type)));
  const original = useRef(new Map()); // 처음 바꾸기 전의 색 (요소 id → 색)
  const last = useRef(null); // 마지막으로 고른 색
  const pending = useRef(false); // 드래그 중에는 한 프레임에 한 번만 장면을 고친다
  const frame = useRef(0);

  // 선택된 요소(와 도형 안 글자)의 색을 color(또는 id 별 색을 돌려주는 함수)로 바꾼다
  const paint = (color, captureUpdate) => {
    const key = KEY[target.type];
    const ids = api.getAppState().selectedElementIds;
    let touched = false;
    const elements = api.getSceneElementsIncludingDeleted().map((el) => {
      const hit = ids[el.id] || (key === "strokeColor" && el.containerId && ids[el.containerId]);
      if (!hit || el.isDeleted) return el;
      if (!original.current.has(el.id)) original.current.set(el.id, el[key]);
      const c = typeof color === "function" ? color(el.id) : color;
      if (c === undefined || el[key] === c) return el;
      touched = true;
      return newElementWith(el, { [key]: c });
    });
    api.updateScene({
      ...(touched && { elements }),
      ...(typeof color === "string" && { appState: { [CURRENT[target.type]]: color } }),
      captureUpdate,
    });
  };

  const flush = () => {
    frame.current = 0;
    if (!pending.current) return;
    pending.current = false;
    paint(last.current, CaptureUpdateAction.NEVER);
  };

  // 닫힐 때: 드래그 중 바꾼 색은 기록하지 않았으므로, 원래 색으로 되돌린 뒤 마지막 색을 한 번에 기록한다
  // (실행 취소 한 번이면 열기 전 색으로 돌아간다)
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (!last.current) return;
      paint((id) => original.current.get(id), CaptureUpdateAction.NEVER);
      paint(last.current, CaptureUpdateAction.IMMEDIATELY);
    },
    [api],
  );

  const apply = (color) => {
    setHex(color);
    last.current = color;
    pending.current = true;
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };

  return (
    <div className="bgpanel elpanel" style={{ left: target.left, top: target.top }}>
      <ColorPicker value={hex} onChange={apply} />
    </div>
  );
}
