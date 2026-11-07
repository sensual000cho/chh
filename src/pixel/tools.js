// 픽셀판 도구의 계산 부분 (캔버스 없이 테스트할 수 있도록 분리)

export function bresenham(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// RGBA 배열 d 에 4방향 채우기를 하고 바뀐 픽셀 수를 돌려준다
export function fillData(d, w, h, sx, sy, [r, g, b]) {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;
  const at = (x, y) => (y * w + x) * 4;
  const i0 = at(sx, sy);
  const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  if (t[0] === r && t[1] === g && t[2] === b && t[3] === 255) return 0;
  const match = (i) => d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2] && d[i + 3] === t[3];
  const stack = [sx, sy];
  let n = 0;
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const i = at(x, y);
    if (!match(i)) continue;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
    n++;
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }
  return n;
}

// 브러시 위치(왼쪽 위 lx, ly, 크기 s)와 대칭 설정으로 실제 찍을 왼쪽 위 좌표들을 돌려준다 (겹치는 건 한 번만)
export function mirrorStamps(lx, ly, s, w, h, mirrorX, mirrorY) {
  const xs = mirrorX ? [lx, w - lx - s] : [lx];
  const ys = mirrorY ? [ly, h - ly - s] : [ly];
  const out = [];
  const seen = new Set();
  for (const x of xs) {
    for (const y of ys) {
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([x, y]);
    }
  }
  return out;
}

// 두 점으로 정해지는 사각형 (양 끝 픽셀 포함). 판 밖으로 나가면 잘라내고, 남는 게 없으면 null.
export function normalizeRect(a, b, w, h) {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(w - 1, Math.max(a.x, b.x));
  const y1 = Math.min(h - 1, Math.max(a.y, b.y));
  if (x1 < x0 || y1 < y0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const inRect = (r, p) => !!r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

// 사각형 테두리 그리기 (fn 은 픽셀마다 호출)
export function rectOutline(a, b, fn) {
  bresenham(a.x, a.y, b.x, a.y, fn);
  bresenham(b.x, a.y, b.x, b.y, fn);
  bresenham(b.x, b.y, a.x, b.y, fn);
  bresenham(a.x, b.y, a.x, a.y, fn);
}

// 사각형 채우기
export function rectFilled(a, b, fn) {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn(x, y);
}
