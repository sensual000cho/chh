import { useCallback, useEffect, useRef, useState } from "react";
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from "./color.js";

// 색상환(링) + 마름모 채도/명도 선택기.
// 마름모: 위=흰색, 오른쪽=선택한 색상, 아래/왼쪽=검정.
const SIZE = 280;
const C = SIZE / 2;
const R_OUT = 130;
const R_IN = 100;
const D = 72; // 마름모 중심~꼭짓점 거리

export default function ColorWheel({ value, onChange }) {
  const ringRef = useRef(null);
  const diaRef = useRef(null);
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(value) || [0, 0, 0]));
  const [text, setText] = useState(value);
  const drag = useRef(null);
  const lastEmitted = useRef(value);

  // 바깥에서 값이 바뀌면(프리셋 선택 등) 동기화. 흑백일 때는 색상(h)을 유지한다.
  useEffect(() => {
    if (value.toLowerCase() === lastEmitted.current.toLowerCase()) return;
    const next = rgbToHsv(hexToRgb(value) || [0, 0, 0]);
    setHsv((prev) => ({ ...next, h: next.s === 0 ? prev.h : next.h }));
    setText(value);
    lastEmitted.current = value;
  }, [value]);

  // 색상환 (한 번만 그린다)
  useEffect(() => {
    const ctx = ringRef.current.getContext("2d");
    const g = ctx.createConicGradient(-Math.PI / 2, C, C);
    for (let i = 0; i <= 360; i += 10) {
      g.addColorStop(i / 360, rgbToHex(hsvToRgb(i, 1, 1)));
    }
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(C, C, R_OUT, 0, Math.PI * 2);
    ctx.arc(C, C, R_IN, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
  }, []);

  // 마름모: 색상이 바뀔 때마다 다시 그린다
  useEffect(() => {
    const ctx = diaRef.current.getContext("2d");
    const size = D * 2;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const xn = (x - D) / D + 1; // 0..2 : a+b (왼쪽 꼭짓점 기준)
        const yn = (y - D) / D; // -1..1 : a-b
        const a = (xn + yn) / 2;
        const b = (xn - yn) / 2;
        const i = (y * size + x) * 4;
        if (a < 0 || a > 1 || b < 0 || b > 1) continue;
        const [r, g, bl] = hsvToRgb(hsv.h, a, b);
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = bl;
        img.data[i + 3] = 255;
      }
    }
    // 오프스크린에 그린 뒤 마름모 경로로 잘라서 가장자리를 부드럽게 한다
    const off = document.createElement("canvas");
    off.width = off.height = size;
    off.getContext("2d").putImageData(img, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, D);
    ctx.lineTo(D, 0);
    ctx.lineTo(size, D);
    ctx.lineTo(D, size);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(off, 0, 0);
    ctx.restore();
  }, [hsv.h]);

  const emit = useCallback(
    (next) => {
      setHsv(next);
      const hex = rgbToHex(hsvToRgb(next.h, next.s, next.v));
      setText(hex);
      lastEmitted.current = hex;
      onChange(hex);
    },
    [onChange],
  );

  const pick = useCallback(
    (kind, e, rect) => {
      const px = e.clientX - rect.left - C;
      const py = e.clientY - rect.top - C;
      if (kind === "ring") {
        let h = (Math.atan2(py, px) * 180) / Math.PI + 90;
        if (h < 0) h += 360;
        emit({ ...hsv, h });
      } else {
        const xn = px / D + 1;
        const yn = py / D;
        const s = Math.min(1, Math.max(0, (xn + yn) / 2));
        const v = Math.min(1, Math.max(0, (xn - yn) / 2));
        emit({ ...hsv, s, v });
      }
    },
    [emit, hsv],
  );

  const onDown = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - C;
    const py = e.clientY - rect.top - C;
    const dist = Math.hypot(px, py);
    let kind = null;
    if (dist >= R_IN - 4 && dist <= R_OUT + 4) kind = "ring";
    else if (Math.abs(px) + Math.abs(py) <= D) kind = "dia";
    if (!kind) return;
    drag.current = { kind, rect };
    e.currentTarget.setPointerCapture(e.pointerId);
    pick(kind, e, rect);
  };
  const onMove = (e) => drag.current && pick(drag.current.kind, e, drag.current.rect);
  const onUp = () => (drag.current = null);

  // 핸들 위치
  const ang = ((hsv.h - 90) * Math.PI) / 180;
  const rm = (R_IN + R_OUT) / 2;
  const ringX = C + Math.cos(ang) * rm;
  const ringY = C + Math.sin(ang) * rm;
  const diaX = C - D + (hsv.s + hsv.v) * D;
  const diaY = C + (hsv.s - hsv.v) * D;
  const cur = rgbToHex(hsvToRgb(hsv.h, hsv.s, hsv.v));
  const hue = rgbToHex(hsvToRgb(hsv.h, 1, 1));

  return (
    <div className="cw">
      <div
        className="cw-stage"
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <canvas ref={ringRef} width={SIZE} height={SIZE} className="cw-layer" />
        <canvas
          ref={diaRef}
          width={D * 2}
          height={D * 2}
          className="cw-layer"
          style={{ left: C - D, top: C - D, width: D * 2, height: D * 2 }}
        />
        <span className="cw-handle" style={{ left: ringX, top: ringY, background: hue }} />
        <span className="cw-handle" style={{ left: diaX, top: diaY, background: cur }} />
      </div>
      <div className="cw-hex">
        <span className="cw-swatch" style={{ background: cur }} />
        <input
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
            setText(v);
            const rgb = hexToRgb(v);
            if (rgb) {
              const next = rgbToHsv(rgb);
              const hex = rgbToHex(rgb);
              lastEmitted.current = hex;
              setHsv((prev) => ({ ...next, h: next.s === 0 ? prev.h : next.h }));
              onChange(hex);
            }
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
