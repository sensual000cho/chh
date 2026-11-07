// 이미지 가져오기: 파일 선택 / 드래그&드롭 / 웹 이미지 URL 을 보드에 이미지 요소로 넣는다.
import { convertToExcalidrawElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { parseDroppedLinks } from "./links.js";

// Excalidraw 가 그대로 쓸 수 있는 형식. 그 외(avif 등)는 PNG 로 변환해서 넣는다.
const NATIVE = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/bmp"];
const EXT_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

export function fileMime(file) {
  if (file.type?.startsWith("image/")) return file.type;
  const ext = file.name?.split(".").pop()?.toLowerCase();
  return EXT_MIME[ext] || "";
}

export const isImageFile = (file) => !!fileMime(file);

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 읽을 수 없습니다"));
    img.src = src;
  });
}

const mimeOfDataURL = (url) => /^data:([^;,]+)/.exec(url)?.[1] || "";

// dataURL 을 Excalidraw 가 지원하는 형식으로 맞추고 크기를 알아낸다.
async function prepare(dataURL, mime = mimeOfDataURL(dataURL)) {
  const img = await loadImage(dataURL);
  let url = dataURL;
  let type = mime;
  if (!NATIVE.includes(type)) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    url = c.toDataURL("image/png");
    type = "image/png";
  }
  return { dataURL: url, mimeType: type, width: img.naturalWidth || 100, height: img.naturalHeight || 100 };
}

// 외부 앱으로 복사할 때 쓰는 PNG dataURL (OS 클립보드는 PNG/JPEG 만 받는다)
export async function toPngDataURL(dataURL) {
  if (mimeOfDataURL(dataURL) === "image/png") return dataURL;
  const img = await loadImage(dataURL);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || 512;
  c.height = img.naturalHeight || 512;
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

// sources: [{ dataURL, mime?, link? }] (link: 출처 주소)  /  anchor: { x, y } 장면 좌표
// mode "center": 묶음의 중앙이 anchor, "corner": 묶음의 왼쪽 위가 anchor
export async function insertImages(api, sources, anchor, mode = "center") {
  const prepared = [];
  for (const s of sources) {
    try {
      prepared.push({ ...(await prepare(s.dataURL, s.mime)), link: s.link || null });
    } catch {
      /* 읽을 수 없는 파일은 건너뛴다 */
    }
  }
  if (!prepared.length) return 0;

  // 창 크기나 현재 확대/축소와 상관없이 항상 같은 크기로 넣는다 (아주 큰 사진만 긴 변 MAX 로 줄임).
  const MAX = 1440;
  const GAP = 24;
  const rowLimit = 4000;

  // 한 줄로 늘어놓다가 rowLimit 를 넘으면 줄바꿈
  const placed = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let maxX = 0;
  for (const p of prepared) {
    const k = Math.min(1, MAX / p.width, MAX / p.height);
    const w = p.width * k;
    const h = p.height * k;
    if (x > 0 && x + w > rowLimit) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    placed.push({ p, x, y, w, h });
    x += w + GAP;
    rowH = Math.max(rowH, h);
    maxX = Math.max(maxX, x - GAP);
  }
  const totalH = y + rowH;
  const ox = mode === "center" ? anchor.x - maxX / 2 : anchor.x;
  const oy = mode === "center" ? anchor.y - totalH / 2 : anchor.y;

  const stamp = Date.now();
  const files = placed.map(({ p }, i) => ({
    id: `img_${stamp}_${i}`,
    dataURL: p.dataURL,
    mimeType: p.mimeType,
    created: stamp,
  }));
  api.addFiles(files);
  const elements = convertToExcalidrawElements(
    placed.map(({ p, x, y, w, h }, i) => ({
      type: "image",
      fileId: files[i].id,
      status: "saved",
      x: ox + x,
      y: oy + y,
      width: w,
      height: h,
      link: p.link,
    })),
  );
  api.updateScene({
    elements: [...api.getSceneElements(), ...elements],
    appState: { selectedElementIds: Object.fromEntries(elements.map((e) => [e.id, true])) },
  });
  return elements.length;
}

// 화면 가운데의 장면 좌표
export function viewCenter(api) {
  const s = api.getAppState();
  return viewportCoordsToSceneCoords(
    { clientX: s.offsetLeft + s.width / 2, clientY: s.offsetTop + s.height / 2 },
    s,
  );
}

// 드롭된 DataTransfer 에서 가져올 것을 뽑는다: { files: File[], web: { image, link } | null }
// 브라우저가 이미지를 파일로 넘겨줘도 출처 주소를 함께 읽는다.
export function pickDropped(dt) {
  const files = [...(dt?.files || [])].filter(isImageFile);
  const web = parseDroppedLinks(dt?.getData("text/html"), dt?.getData("text/uri-list"));
  return { files, web };
}

// 레퍼런스 이미지 폴더 저장용 목록 (원본 그대로)
export function collectImages(api) {
  const files = api.getFiles();
  const seen = new Set();
  const out = [];
  for (const el of api.getSceneElements()) {
    if (el.type !== "image" || !el.fileId || seen.has(el.fileId)) continue;
    const f = files[el.fileId];
    if (!f) continue;
    seen.add(el.fileId);
    const ext = (f.mimeType.split("/")[1] || "png").replace("svg+xml", "svg").replace("jpeg", "jpg");
    out.push({ name: `image_${String(out.length + 1).padStart(3, "0")}.${ext}`, dataURL: f.dataURL });
  }
  return out;
}
