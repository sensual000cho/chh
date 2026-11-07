import { useEffect, useRef, useState } from "react";

const svg = (children) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const icons = {
  open: svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  save: svg(<><path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></>),
  capture: svg(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="12" r="3" /></>),
  image: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 9" /></>),
  pixel: svg(<><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M4 12h16M12 4v16M8 4v16M16 4v16M4 8h16M4 16h16" strokeWidth="1" /></>),
  pin: svg(<><path d="M9 4h6l-1 6 3 3H7l3-3z" /><path d="M12 13v8" /></>),
  arrange: svg(<><rect x="3" y="3" width="8" height="11" rx="1" /><rect x="13" y="3" width="8" height="6" rx="1" /><rect x="13" y="11" width="8" height="10" rx="1" /><rect x="3" y="16" width="8" height="5" rx="1" /></>),
  through: svg(<><path d="M5 3l6 16 2.5-6.5L20 10z" /><path d="M16 16l4 4" /></>),
  opacity: svg(<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />),
  min: svg(<path d="M5 12h14" />),
  max: svg(<rect x="5" y="5" width="14" height="14" rx="1" />),
  restore: svg(<><rect x="4" y="8" width="12" height="12" rx="1" /><path d="M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3" /></>),
  close: svg(<path d="M6 6l12 12M18 6L6 18" />),
};

function Btn({ title, onClick, active, danger, children, label }) {
  return (
    <button
      className={`tb-btn${active ? " active" : ""}${danger ? " danger" : ""}`}
      title={title}
      onClick={onClick}
    >
      {children}
      {label && <span className="tb-label">{label}</span>}
    </button>
  );
}

export default function TitleBar({
  name,
  dirty,
  captureKey,
  clickThrough,
  onToggleClickThrough,
  onArrange,
  onOpen,
  onSave,
  onCapture,
  onImport,
  onNewPixel,
}) {
  const chh = window.chh;
  const [maximized, setMaximized] = useState(false);
  const [onTop, setOnTop] = useState(() => localStorage.getItem("chh.onTop") === "1");
  const [opacity, setOpacity] = useState(() => {
    const v = Number(localStorage.getItem("chh.opacity"));
    return v >= 0.15 && v <= 1 ? v : 1;
  });
  const [showOpacity, setShowOpacity] = useState(false);
  const popRef = useRef(null);

  useEffect(() => {
    if (!chh) return;
    // 최대화 상태로 시작하면 알림이 페이지가 뜨기 전에 지나가므로 직접 물어본다
    chh.isMaximized?.().then(setMaximized);
    return chh.onWindowState(({ maximized }) => setMaximized(maximized));
  }, [chh]);

  useEffect(() => {
    chh?.setAlwaysOnTop(onTop);
    localStorage.setItem("chh.onTop", onTop ? "1" : "0");
  }, [chh, onTop]);

  useEffect(() => {
    chh?.setOpacity(opacity);
    localStorage.setItem("chh.opacity", String(opacity));
  }, [chh, opacity]);

  useEffect(() => {
    if (!showOpacity) return;
    const close = (e) => !popRef.current?.contains(e.target) && setShowOpacity(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showOpacity]);

  if (!chh) return null; // 브라우저(npm run dev)에서는 표시하지 않는다

  return (
    <div className="titlebar">
      <div className="tb-drag tb-title">
        <span className="tb-logo">CHH</span>
        <span className="tb-name">
          {name}
          {dirty ? " •" : ""}
        </span>
      </div>
      <div className="tb-drag tb-spacer" />
      <div className="tb-group">
        <Btn title="보드 열기 (Ctrl+O)" onClick={onOpen}>{icons.open}</Btn>
        <Btn title="저장 (Ctrl+S)" onClick={onSave}>{icons.save}</Btn>
        <span className="tb-sep" />
        <Btn title={`화면 캡처 (${captureKey || "Ctrl+Shift+X"})`} onClick={onCapture} label="캡처">{icons.capture}</Btn>
        <Btn title="이미지 가져오기 (파일 선택 · 끌어다 놓기 · 붙여넣기)" onClick={onImport} label="이미지">{icons.image}</Btn>
        <Btn title="새 픽셀판 만들기" onClick={onNewPixel} label="픽셀판">{icons.pixel}</Btn>
        <Btn title="이미지 자동 정렬 (선택한 이미지, 없으면 전체)" onClick={onArrange}>{icons.arrange}</Btn>
        <span className="tb-sep" />
        <Btn title={onTop ? "항상 위 끄기" : "항상 위"} active={onTop} onClick={() => setOnTop((v) => !v)}>
          {icons.pin}
        </Btn>
        <Btn
          title="클릭 통과: 창을 띄운 채 아래 프로그램을 조작합니다 (Ctrl+Shift+L로 해제)"
          active={clickThrough}
          onClick={onToggleClickThrough}
        >
          {icons.through}
        </Btn>
        <div className="tb-pop-wrap" ref={popRef}>
          <Btn title="창 투명도" active={showOpacity || opacity < 1} onClick={() => setShowOpacity((v) => !v)}>
            {icons.opacity}
          </Btn>
          {showOpacity && (
            <div className="tb-pop">
              <input
                type="range"
                min="15"
                max="100"
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              />
              <span>{Math.round(opacity * 100)}%</span>
            </div>
          )}
        </div>
      </div>
      <div className="tb-group tb-win">
        <Btn title="최소화" onClick={chh.minimize}>{icons.min}</Btn>
        <Btn title={maximized ? "이전 크기" : "최대화"} onClick={chh.toggleMaximize}>
          {maximized ? icons.restore : icons.max}
        </Btn>
        <Btn title="닫기" danger onClick={chh.close}>{icons.close}</Btn>
      </div>
    </div>
  );
}
