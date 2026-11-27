// 보드 위에 얹을 움직이는 그림·영상 목록을 만든다 (Excalidraw 없이 테스트할 수 있도록 분리).
//
// 움직이는 화면은 캔버스 위에 뜨므로, 원래 그보다 위에 있던 요소가 가려진다. 그래서
//  - 위에 겹친 이미지는 정지 그림("still")으로 함께 얹고
//  - 위에 겹친 선·글자·도형은 covers 로 모아 그 영역 안에서만 다시 그린다.
import { elementBounds } from "./sceneGeom.js";

const MAX_COVERS = 300; // 이보다 많으면 덧그리기를 포기한다 (느려지지 않도록)
const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const NO_COVER = new Set(["frame", "magicframe", "embeddable", "iframe", "selection"]);

// elements: 아래에서 위 순서. kindOf(el): "gif" | "video" | null (지금 움직여야 하는 것)
// view: 화면에 보이는 장면 영역, zoom: 배율, skip: 빼놓을 요소 id (자르는 중, 글자 쓰는 중, 그리는 중)
// → [{ el, kind, frame, covers: [[요소, 묶인 글자?], ...] }]
export function layoutMedia(elements, { kindOf, view, zoom, skip = new Set(), minSize = 16 }) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const items = [];
  let covers = 0;
  for (const el of elements) {
    if (el.isDeleted || skip.has(el.id)) continue;
    if (el.type === "image") {
      const bounds = elementBounds(el);
      const small = Math.max(el.width, el.height) * zoom < minSize;
      const kind = !small && hit(bounds, view) ? kindOf(el) : null;
      if (kind || items.some((i) => hit(i.bounds, bounds))) {
        const frame = el.frameId ? byId.get(el.frameId) : null;
        items.push({ el, kind: kind || "still", bounds, frame: frame && !frame.isDeleted ? frame : null, covers: [] });
      }
      continue;
    }
    if (!items.length || NO_COVER.has(el.type)) continue;
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) continue; // 글자는 담긴 도형과 함께 그린다
    const bounds = elementBounds(el);
    let group = null;
    for (const item of items) {
      if (covers >= MAX_COVERS || !hit(item.bounds, bounds)) continue;
      if (!group) {
        const textId = el.boundElements?.find((b) => b.type === "text")?.id;
        const text = textId && !skip.has(textId) ? byId.get(textId) : null;
        group = text && !text.isDeleted ? [el, text] : [el];
      }
      item.covers.push(group);
      covers++;
    }
  }
  return items;
}

// 화면에 보이는 장면 영역 (margin: 화면 밖 여유, px)
export function visibleArea(s, margin = 100) {
  const z = s.zoom.value;
  return {
    x1: -s.scrollX - margin / z,
    y1: -s.scrollY - margin / z,
    x2: -s.scrollX + (s.width + margin) / z,
    y2: -s.scrollY + (s.height + margin) / z,
  };
}

// Excalidraw 이미지 모서리 둥글기
export function cornerRadius(el) {
  if (!el.roundness) return 0;
  const size = Math.min(el.width, el.height);
  if (el.roundness.type !== 3) return size * 0.25;
  const fixed = el.roundness.value ?? 32;
  return size <= fixed / 0.25 ? size * 0.25 : fixed;
}

// 잘라낸(crop) 이미지에서 원본 전체를 놓을 자리
export function cropBox(el) {
  const c = el.crop;
  if (!c) return { left: 0, top: 0, width: el.width, height: el.height };
  const kx = el.width / c.width;
  const ky = el.height / c.height;
  return { left: -c.x * kx, top: -c.y * ky, width: c.naturalWidth * kx, height: c.naturalHeight * ky };
}
