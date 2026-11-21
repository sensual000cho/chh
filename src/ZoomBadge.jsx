import { useEffect, useState } from "react";

// 창이 좁아 Excalidraw가 모바일 레이아웃으로 바뀌면 아래쪽 배율 표시가 사라진다.
// 그때도 지금 배율을 보이게 하고, 누르면 화면 가운데를 기준으로 100%로 되돌린다.
// (보통 레이아웃에서는 CSS로 숨겨 Excalidraw 자체 표시와 겹치지 않게 한다)
export default function ZoomBadge({ api }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!api) return;
    setZoom(api.getAppState().zoom.value);
    return api.onScrollChange((_x, _y, z) => setZoom(z.value));
  }, [api]);

  const reset = () => {
    const s = api?.getAppState();
    if (!s) return;
    // 지금 화면 가운데에 있는 장면 좌표가 100%에서도 가운데에 오도록 스크롤을 맞춘다
    const cx = -s.scrollX + s.width / 2 / s.zoom.value;
    const cy = -s.scrollY + s.height / 2 / s.zoom.value;
    api.updateScene({ appState: { zoom: { value: 1 }, scrollX: s.width / 2 - cx, scrollY: s.height / 2 - cy } });
  };

  return (
    <button type="button" className="zoom-badge" title="배율 (누르면 100%로)" onClick={reset}>
      {Math.round(zoom * 100)}%
    </button>
  );
}
