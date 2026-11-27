import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import { COLOR_KEY, CURRENT_KEY, isColorTarget } from "./groupColor.js";

// 묶음을 선택하면 Excalidraw 속성 패널에는 색 칸이 없다.
// 그래서 다른 요소를 골랐을 때와 같은 모양의 "선 색상 / 배경색" 줄을 패널 맨 위에 끼워 넣는다.
// 빠른 색을 누르면 묶음 안의 항목 색이 한꺼번에 바뀌고, 오른쪽 큰 칸(active-color)을 누르면
// App 이 다른 요소와 똑같이 우리 색 선택기(ElementColorPicker)를 연다.
const PICKS = {
  stroke: ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"],
  bg: ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"],
};
const LABEL = { stroke: "선 색상", bg: "배경색" };
const TRIGGER_TITLE = { stroke: "윤곽선 색상 선택기 열기", bg: "배경 색상 선택기 열기" };

function paint(api, type, color) {
  const key = COLOR_KEY[type];
  const ids = api.getAppState().selectedElementIds;
  api.updateScene({
    elements: api
      .getSceneElementsIncludingDeleted()
      .map((el) => (isColorTarget(el, ids, key) && el[key] !== color ? newElementWith(el, { [key]: color }) : el)),
    appState: { [CURRENT_KEY[type]]: color },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

function Row({ api, type, value }) {
  const same = (c) => (value || "").toLowerCase() === c;
  return (
    <div>
      <h3 aria-hidden="true">{LABEL[type]}</h3>
      <div className="color-picker-container">
        <div className="color-picker__top-picks">
          {PICKS[type].map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              className={`color-picker__button${same(c) ? " active" : ""}${c === "transparent" ? " is-transparent" : ""}`}
              style={{ "--swatch-color": c }}
              onClick={() => paint(api, type, c)}
            >
              <div className="color-picker__button-outline" />
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: "1rem", backgroundColor: "var(--default-border-color)", margin: "0 auto" }} />
        <button
          type="button"
          className="color-picker__button active-color properties-trigger"
          aria-label={LABEL[type]}
          title={TRIGGER_TITLE[type]}
          style={{ "--swatch-color": value }}
        >
          <div className="color-picker__button-outline" />
        </button>
      </div>
    </div>
  );
}

export default function GroupColorRows({ api, stroke, bg, selKey }) {
  const [host, setHost] = useState(null);

  // 패널은 선택이 바뀔 때마다 다시 그려질 수 있어서, 선택이 바뀌면 자리를 새로 잡는다
  useLayoutEffect(() => {
    const column = document.querySelector(".App-menu__left .panelColumn");
    if (!column) return;
    const box = document.createElement("div");
    box.className = "group-color-rows";
    column.prepend(box);
    setHost(box);
    return () => {
      box.remove();
      setHost(null);
    };
  }, [selKey]);

  if (!host) return null;
  return createPortal(
    <>
      <Row api={api} type="stroke" value={stroke} />
      <Row api={api} type="bg" value={bg} />
    </>,
    host,
  );
}
