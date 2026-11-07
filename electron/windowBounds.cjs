// 저장된 창 위치가 지금 연결된 모니터 안에 보이는지 확인한다 (보조 모니터를 뺐을 때 창이 사라지지 않도록).
const MIN_VISIBLE_W = 120;
const MIN_VISIBLE_H = 40;
const DEFAULT = { width: 1280, height: 800 };

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { w, h };
}

// state: 저장된 창 상태, workAreas: 모니터별 작업 영역 [{x,y,width,height}]
// 돌려주는 값에 x,y 가 없으면 Electron 이 알아서 가운데에 띄운다.
function fitBounds(state, workAreas) {
  const width = Number(state?.width) > 0 ? state.width : DEFAULT.width;
  const height = Number(state?.height) > 0 ? state.height : DEFAULT.height;
  if (!Number.isFinite(state?.x) || !Number.isFinite(state?.y)) return { width, height };
  const win = { x: state.x, y: state.y, width, height };
  const seen = workAreas.some((area) => {
    const o = overlap(win, area);
    return o.w >= MIN_VISIBLE_W && o.h >= MIN_VISIBLE_H;
  });
  if (seen) return win;
  // 어느 모니터에도 안 보이면 위치를 버리고, 첫 모니터에 들어가는 크기로 줄인다
  const first = workAreas[0];
  return first
    ? { width: Math.min(width, first.width), height: Math.min(height, first.height) }
    : { width, height };
}

module.exports = { fitBounds };
