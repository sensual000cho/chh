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
  pin: svg(<><path d="M9 4h6l-1 6 3 3H7l3-3z" /><path d="M12 13v8" /></>),
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

export default function TitleBar({ name, dirty, onOpen, onSave, onCapture }) {
  const chh = window.chh;
  const [maximized, setMaximized] = useState(false);
  const [onTop, setOnTop] = useState(() => localStorage.getItem("chh.onTop") === "1");
  const [opacity, setOpacity] = useState(() => {
    const v = Number(localStorage.getItem("chh.opacity"));
    return v >= 0.15 && v <= 1 ? v : 1;
  });
  const [showOpacity, setShowOpacity] = useState(false);
  const popRef = useRef(null);

  useEffect(() => chh?.onWindowState(({ maximized }) => setMaximized(maximized)), [chh]);

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
        <Btn title="화면 캡처 (Ctrl+Shift+X)" onClick={onCapture} label="캡처">{icons.capture}</Btn>
        <span className="tb-sep" />
        <Btn title={onTop ? "항상 위 끄기" : "항상 위"} active={onTop} onClick={() => setOnTop((v) => !v)}>
          {icons.pin}
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
