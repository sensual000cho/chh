// 픽셀판: Excalidraw 이미지 요소 + customData.chhPixel = { w, h, data } 로 표현한다.
//  - data      : w×h 짜리 원본 픽셀 PNG(dataURL). 편집/내보내기의 기준 데이터.
//  - 요소의 이미지(fileId): 화면에 선명하게 보이도록 정수배로 키우고 체크무늬를 깐 "표시용" 이미지.
// 요소는 일반 이미지처럼 이동/크기 조절/삭제/저장/열기가 된다.
import { convertToExcalidrawElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { loadImage } from "../images.js";

export const PIXEL_KEY = "chhPixel";
export const MAX_SIZE = 512;

export const isPixelBoard = (el) =>
  !!el && !el.isDeleted && el.type === "image" && !!el.customData?.[PIXEL_KEY];
export const pixelInfo = (el) => el.customData[PIXEL_KEY];

export function newCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// 원본 픽셀 PNG 를 1:1 로 캔버스에 올린다 (보간 없음)
export async function loadRaw(dataURL, w, h) {
  const c = newCanvas(w, h);
  if (dataURL) {
    const img = await loadImage(dataURL);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
  }
  return c;
}

// 체크무늬 한 칸의 크기(픽셀 단위): 판이 클수록 크게
export const checkerTile = (w, h) => Math.max(1, Math.round(Math.max(w, h) / 16));
const CHECK_A = "#cfcfcf";
const CHECK_B = "#e4e4e4";
export const CHECKER_COLORS = [CHECK_A, CHECK_B];

// 화면 표시용 이미지: 정수배 확대(보간 없음) + 체크무늬
export function bake(raw) {
  const { width: w, height: h } = raw;
  const S = Math.max(1, Math.min(32, Math.floor(1024 / Math.max(w, h))));
  const c = newCanvas(w * S, h * S);
  const ctx = c.getContext("2d");
  const t = checkerTile(w, h);
  for (let ty = 0; ty * t < h; ty++) {
    for (let tx = 0; tx * t < w; tx++) {
      ctx.fillStyle = (tx + ty) % 2 === 0 ? CHECK_B : CHECK_A;
      ctx.fillRect(tx * t * S, ty * t * S, t * S, t * S);
    }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raw, 0, 0, w * S, h * S);
  return c.toDataURL("image/png");
}

// 내보내기용: 투명 배경 그대로, 정수배 확대
export function exportDataURL(raw, scale) {
  const c = newCanvas(raw.width * scale, raw.height * scale);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(raw, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

const uid = () => Math.random().toString(36).slice(2, 10);

// 화면 가운데에 w×h 픽셀판을 만들고 요소를 돌려준다
export function createBoard(api, w, h) {
  const raw = newCanvas(w, h);
  const fileId = `pxl_${Date.now()}_${uid()}`;
  api.addFiles([{ id: fileId, dataURL: bake(raw), mimeType: "image/png", created: Date.now() }]);

  // 화면에서 한 칸이 대략 정수 픽셀이 되도록, 화면 짧은 변의 45% 정도로 보이는 크기를 고른다
  const st = api.getAppState();
  const cellScreen = Math.max(1, Math.min(40, Math.floor((0.45 * Math.min(st.width, st.height)) / Math.max(w, h))));
  const cell = Math.max(1, Math.round(cellScreen / st.zoom.value));
  const width = w * cell;
  const height = h * cell;

  const center = viewportCoordsToSceneCoords(
    { clientX: st.offsetLeft + st.width / 2, clientY: st.offsetTop + st.height / 2 },
    st,
  );
  const [skeleton] = convertToExcalidrawElements([
    {
      type: "image",
      fileId,
      status: "saved",
      x: Math.round(center.x - width / 2),
      y: Math.round(center.y - height / 2),
      width,
      height,
    },
  ]);
  const el = { ...skeleton, customData: { [PIXEL_KEY]: { w, h, data: raw.toDataURL("image/png") } } };
  api.updateScene({
    elements: [...api.getSceneElements(), el],
    appState: { selectedElementIds: { [el.id]: true } },
  });
  return el;
}

// 편집한 픽셀을 요소에 반영한다 (원본 데이터 + 표시용 이미지)
export function commitBoard(api, id, raw) {
  const fileId = `pxl_${Date.now()}_${uid()}`;
  api.addFiles([{ id: fileId, dataURL: bake(raw), mimeType: "image/png", created: Date.now() }]);
  const data = raw.toDataURL("image/png");
  api.updateScene({
    elements: api.getSceneElements().map((e) =>
      e.id === id
        ? {
            ...e,
            fileId,
            customData: { ...e.customData, [PIXEL_KEY]: { w: raw.width, h: raw.height, data } },
            version: e.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: Date.now(),
          }
        : e,
    ),
  });
}

// 장면 좌표(sx, sy) 아래의 가장 위 픽셀판과, 그 안에서의 픽셀 좌표를 찾는다
export function boardAt(elements, sx, sy) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isPixelBoard(el)) continue;
    const dx = sx - (el.x + el.width / 2);
    const dy = sy - (el.y + el.height / 2);
    const cos = Math.cos(el.angle || 0);
    const sin = Math.sin(el.angle || 0);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    if (Math.abs(lx) > el.width / 2 || Math.abs(ly) > el.height / 2) continue;
    const { w, h } = pixelInfo(el);
    return {
      el,
      w,
      h,
      px: Math.min(w - 1, Math.floor(((lx + el.width / 2) / el.width) * w)),
      py: Math.min(h - 1, Math.floor(((ly + el.height / 2) / el.height) * h)),
    };
  }
  return null;
}
