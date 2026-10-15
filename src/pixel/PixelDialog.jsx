import { useEffect, useState } from "react";
import { MAX_SIZE } from "./board.js";

const PRESETS = [8, 16, 32, 64, 128];

const clampSize = (v) => Math.max(1, Math.min(MAX_SIZE, Math.round(Number(v) || 1)));

// 새 픽셀판 크기를 정하는 작은 창
export default function PixelDialog({ onCreate, onClose }) {
  const [w, setW] = useState("32");
  const [h, setH] = useState("32");

  const create = () => onCreate(clampSize(w), clampSize(h));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        create();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="pxdlg-back" onPointerDown={onClose}>
      <div className="pxdlg" onPointerDown={(e) => e.stopPropagation()}>
        <h3>새 픽셀판</h3>
        <p className="pxdlg-hint">정해진 크기의 픽셀 캔버스를 보드에 추가합니다. (최대 {MAX_SIZE} × {MAX_SIZE})</p>
        <div className="pxdlg-presets">
          {PRESETS.map((s) => (
            <button
              key={s}
              className={`px-btn${w === String(s) && h === String(s) ? " on" : ""}`}
              onClick={() => {
                setW(String(s));
                setH(String(s));
              }}
            >
              {s} × {s}
            </button>
          ))}
        </div>
        <div className="pxdlg-size">
          <label>
            가로
            <input
              type="number"
              min="1"
              max={MAX_SIZE}
              value={w}
              autoFocus
              onChange={(e) => setW(e.target.value)}
              onBlur={() => setW(String(clampSize(w)))}
            />
          </label>
          <span>×</span>
          <label>
            세로
            <input
              type="number"
              min="1"
              max={MAX_SIZE}
              value={h}
              onChange={(e) => setH(e.target.value)}
              onBlur={() => setH(String(clampSize(h)))}
            />
          </label>
          <span className="px-dim">px</span>
        </div>
        <div className="pxdlg-actions">
          <button className="px-btn" onClick={onClose}>
            취소
          </button>
          <button className="px-btn primary" onClick={create}>
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
