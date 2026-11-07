// 장면 요소의 위치 계산 (Excalidraw 없이 테스트할 수 있도록 분리)

// 요소의 화면상 경계 상자. 회전과 선 요소의 점 위치까지 반영한다. { x1, y1, x2, y2 }
export function elementBounds(el) {
  let x1 = el.x;
  let y1 = el.y;
  let x2 = el.x + el.width;
  let y2 = el.y + el.height;
  if (Array.isArray(el.points) && el.points.length) {
    const xs = el.points.map((p) => el.x + p[0]);
    const ys = el.points.map((p) => el.y + p[1]);
    x1 = Math.min(...xs);
    y1 = Math.min(...ys);
    x2 = Math.max(...xs);
    y2 = Math.max(...ys);
  }
  const angle = el.angle || 0;
  if (!angle) return { x1, y1, x2, y2 };
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ].map(([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
  return {
    x1: Math.min(...corners.map((c) => c[0])),
    y1: Math.min(...corners.map((c) => c[1])),
    x2: Math.max(...corners.map((c) => c[0])),
    y2: Math.max(...corners.map((c) => c[1])),
  };
}

export function commonBounds(elements) {
  const all = elements.map(elementBounds);
  return {
    x1: Math.min(...all.map((b) => b.x1)),
    y1: Math.min(...all.map((b) => b.y1)),
    x2: Math.max(...all.map((b) => b.x2)),
    y2: Math.max(...all.map((b) => b.y2)),
  };
}

const isFrame = (el) => el.type === "frame" || el.type === "magicframe";

// 이 점을 포함하는 가장 위의 프레임
export function frameAt(elements, x, y) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.isDeleted || !isFrame(el)) continue;
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) return el;
  }
  return null;
}

// 요소들을 감싸는 프레임의 위치와 크기
export function frameBox(elements, padding = 24) {
  const b = commonBounds(elements);
  return {
    x: b.x1 - padding,
    y: b.y1 - padding,
    width: b.x2 - b.x1 + padding * 2,
    height: b.y2 - b.y1 + padding * 2,
  };
}
