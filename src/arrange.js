// 이미지 자동 정렬: 크기는 그대로 두고 비슷한 높이끼리 줄을 맞춰 빈틈 적게 늘어놓는다.
// items: [{ id, x, y, width, height }]  →  Map(id → { x, y }). 묶음의 왼쪽 위는 원래 위치를 유지한다.
export function arrangeItems(items, gap = 24) {
  const out = new Map();
  if (!items.length) return out;
  const originX = Math.min(...items.map((i) => i.x));
  const originY = Math.min(...items.map((i) => i.y));
  const area = items.reduce((sum, i) => sum + (i.width + gap) * (i.height + gap), 0);
  const widest = Math.max(...items.map((i) => i.width));
  const rowLimit = Math.max(widest, Math.sqrt(area) * 1.25);

  const sorted = [...items].sort((a, b) => b.height - a.height);
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of sorted) {
    if (x > 0 && x + it.width > rowLimit) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    out.set(it.id, { x: originX + x, y: originY + y });
    x += it.width + gap;
    rowH = Math.max(rowH, it.height);
  }
  return out;
}
