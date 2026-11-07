// 포스트잇 메모와 묶음(프레임) 만들기
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import { frameAt, frameBox } from "./sceneGeom.js";

const NOTE_WIDTH = 280;
const NOTE_HEIGHT = 160;
const NOTE_COLOR = "#ffec99";
const NOTE_TEXT = "#1e1e1e";

// 선택된 요소에 대해 Excalidraw 기본 Enter 동작(글자 입력, 프레임 이름 편집)을 시작한다
function pressEnter() {
  setTimeout(() => {
    const box = document.querySelector(".excalidraw.excalidraw-container") || document.querySelector(".excalidraw");
    if (!box) return;
    box.focus();
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }, 60);
}

// point 를 가운데로 하는 메모를 만들고 바로 글자를 입력하게 한다.
// 돌려주는 값: 입력이 끝난 뒤 finishNote 에 넘길 정보
export function createNote(api, point) {
  const state = api.getAppState();
  const frame = frameAt(api.getSceneElements(), point.x, point.y);
  const [skeleton] = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: point.x - NOTE_WIDTH / 2,
      y: point.y - NOTE_HEIGHT / 2,
      width: NOTE_WIDTH,
      height: NOTE_HEIGHT,
      backgroundColor: NOTE_COLOR,
      strokeColor: NOTE_COLOR,
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
    },
  ]);
  const note = frame ? { ...skeleton, frameId: frame.id } : skeleton;
  api.setActiveTool({ type: "selection" });
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), note],
    // 메모 위에서 잘 보이도록 글자색을 잠시 어둡게 한다
    appState: { selectedElementIds: { [note.id]: true }, currentItemStrokeColor: NOTE_TEXT },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  pressEnter();
  return { id: note.id, strokeColor: state.currentItemStrokeColor, editing: false };
}

// 글자 입력이 끝나면 글자색을 되돌리고, 아무것도 안 쓴 메모는 지운다
export function finishNote(api, note) {
  const elements = api.getSceneElementsIncludingDeleted();
  const hasText = elements.some(
    (e) => e.type === "text" && e.containerId === note.id && !e.isDeleted && e.text.trim(),
  );
  api.updateScene({
    appState: { currentItemStrokeColor: note.strokeColor },
    ...(!hasText && {
      elements: elements.map((e) => (e.id === note.id ? newElementWith(e, { isDeleted: true }) : e)),
      captureUpdate: CaptureUpdateAction.NEVER,
    }),
  });
}

// 선택한 요소들을 이름 붙은 묶음(프레임)으로 감싼다. 묶은 요소 수를 돌려준다.
export function wrapInGroup(api) {
  const selected = api.getAppState().selectedElementIds;
  const all = api.getSceneElementsIncludingDeleted();
  const picked = all.filter(
    (e) => selected[e.id] && !e.isDeleted && e.type !== "frame" && e.type !== "magicframe",
  );
  if (!picked.length) return 0;
  const ids = new Set(picked.map((e) => e.id));
  const [frame] = convertToExcalidrawElements([{ type: "frame", children: [], name: "묶음", ...frameBox(picked) }]);
  const next = all.map((e) =>
    !e.isDeleted && (ids.has(e.id) || ids.has(e.containerId)) ? newElementWith(e, { frameId: frame.id }) : e,
  );
  api.updateScene({
    elements: [...next, frame],
    appState: { selectedElementIds: { [frame.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  pressEnter(); // 바로 이름을 쓸 수 있게 한다
  return picked.length;
}

// 묶음 안의 요소를 움직인 뒤 묶음이 그 요소들을 다시 감싸도록 크기를 맞춘다 (벗어난 부분은 잘려 보이므로)
export function fitFrames(elements, frameIds) {
  return elements.map((e) => {
    if (!frameIds.has(e.id) || e.isDeleted) return e;
    const children = elements.filter((c) => c.frameId === e.id && !c.isDeleted);
    return children.length ? newElementWith(e, frameBox(children)) : e;
  });
}
