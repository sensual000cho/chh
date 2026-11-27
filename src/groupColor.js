// 색을 바꿀 때 어떤 요소가 대상인지 정한다.
// 선택한 요소, 선택한 묶음 안의 항목, (선 색이면) 선택한 도형 안의 글자와 선택한 묶음의 테두리.
// Excalidraw 는 묶음 테두리를 늘 같은 회색으로 그리므로, 묶음에 고른 선 색은 customData.chhBorder 에 두고
// vite.config.js 의 패치가 그 색으로 테두리를 그린다.
export const COLOR_KEY = { stroke: "strokeColor", bg: "backgroundColor" };
export const CURRENT_KEY = { stroke: "currentItemStrokeColor", bg: "currentItemBackgroundColor" };
const FRAME_BORDER = "#bbbbbb"; // Excalidraw 기본 묶음 테두리 색

const isFrame = (el) => el.type === "frame" || el.type === "magicframe";

export function isColorTarget(el, ids, key) {
  if (el.isDeleted) return false;
  if (isFrame(el)) return key === "strokeColor" && !!ids[el.id];
  return !!(ids[el.id] || (el.frameId && ids[el.frameId]) || (key === "strokeColor" && el.containerId && ids[el.containerId]));
}

// 요소의 지금 색 (묶음이면 테두리 색)
export function colorOf(el, key) {
  return isFrame(el) ? el.customData?.chhBorder || FRAME_BORDER : el[key];
}

// newElementWith 에 넘길 바뀐 속성
export function colorChange(el, key, color) {
  return isFrame(el) ? { customData: { ...el.customData, chhBorder: color } } : { [key]: color };
}

// 선택이 묶음만으로 이루어져 있으면 그 묶음들을, 아니면 빈 배열을 돌려준다
export function selectedFramesOnly(elements, ids) {
  const sel = elements.filter((el) => ids[el.id] && !el.isDeleted);
  return sel.length && sel.every(isFrame) ? sel : [];
}

// 지금 색: 직접 선택한 요소 → (선 색이면) 선택한 묶음의 테두리 → 선택한 묶음 안의 첫 항목 → 다음에 그릴 요소의 색
export function readColor(elements, appState, type) {
  const key = COLOR_KEY[type];
  const ids = appState.selectedElementIds;
  const el =
    elements.find((e) => ids[e.id] && !e.isDeleted && !isFrame(e)) ||
    elements.find((e) => isColorTarget(e, ids, key));
  return el ? colorOf(el, key) : appState[CURRENT_KEY[type]];
}
