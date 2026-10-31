import { useEffect, useRef, useState } from "react";
import { clamp01, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from "./color.js";

// 스펙트럼(채도·명도 사각형 + 색조 바) + hex 입력 + 저장한 색
const SAVED_KEY = "chh.savedColors";
const SLOTS = 7; // + 버튼과 합쳐 8칸 한 줄

function loadSaved() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY));
    if (Array.isArray(v)) return v.filter((c) => typeof c === "string" && hexToRgb(c)).slice(0, SLOTS);
  } catch {}
  return [];
}

function storeSaved(list) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {}
}

// 누르고 끄는 동안 요소 안의 상대 위치(0~1)를 넘겨준다
function useDrag(onMove) {
  const ref = useRef(null);
  const handlers = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e);
    },
    onPointerMove: (e) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e);
    },
  };
  function move(e) {
    const r = ref.current.getBoundingClientRect();
    onMove(clamp01((e.clientX - r.left - 6) / (r.width - 12)), clamp01((e.clientY - r.top - 6) / (r.height - 12)));
  }
  return [ref, handlers];
}

// 손잡이가 테두리에 잘리지 않도록 반지름(6px)만큼 안쪽에서 움직인다
const inset = (t) => `calc(6px + ${t} * (100% - 12px))`;

// value: "#rrggbb"
export default function ColorPicker({ value, onChange }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(loadSaved);
  const [editing, setEditing] = useState(-1); // 눌러서 고르고 있는 저장 칸
  // 채도가 0이 되어도 색조가 튀지 않게 hsv 를 따로 들고 있는다
  const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(value) || [0, 0, 0]));
  const lastHex = useRef(value.toLowerCase());

  useEffect(() => {
    setText(value);
    if (value.toLowerCase() === lastHex.current) return;
    lastHex.current = value.toLowerCase();
    const next = rgbToHsv(hexToRgb(value) || [0, 0, 0]);
    setHsv((cur) => ({ h: next.s && next.v ? next.h : cur.h, s: next.v ? next.s : cur.s, v: next.v }));
  }, [value]);

  const hueHex = rgbToHex(hsvToRgb(hsv.h, 1, 1));

  const updateSaved = (list) => {
    setSaved(list);
    storeSaved(list);
  };

  // 저장 칸을 고치는 중이면 고른 색이 그 칸에도 들어간다
  const pick = (hex) => {
    onChange(hex);
    if (editing >= 0) updateSaved(saved.map((c, i) => (i === editing ? hex : c)));
  };

  const commit = (next) => {
    setHsv(next);
    const hex = rgbToHex(hsvToRgb(next.h, next.s, next.v));
    lastHex.current = hex;
    pick(hex);
  };

  const [svRef, svDrag] = useDrag((x, y) => commit({ ...hsv, s: x, v: 1 - y }));
  const [hueRef, hueDrag] = useDrag((x) => commit({ ...hsv, h: Math.min(x * 360, 359.9) }));

  const cur = value.toLowerCase();

  return (
    <div className="cp" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cp-spectrum">
        <div ref={svRef} className="cp-sv" style={{ backgroundColor: hueHex }} {...svDrag}>
          <span className="cp-knob" style={{ left: inset(hsv.s), top: inset(1 - hsv.v), background: value }} />
        </div>
        <div ref={hueRef} className="cp-bar cp-hue" {...hueDrag}>
          <span className="cp-knob" style={{ left: inset(hsv.h / 360), background: hueHex }} />
        </div>
      </div>
      <div className="cp-row">
        <span className="cp-current">
          <span style={{ background: value }} />
        </span>
        <input
          className="cp-hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          title="색상 코드 직접 입력"
          onChange={(e) => {
            const v = e.target.value.startsWith("#") ? e.target.value : "#" + e.target.value;
            setText(v);
            if (hexToRgb(v)) pick(v.toLowerCase());
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="cp-saved">
        <button
          className="cp-save"
          title="지금 색 저장"
          onClick={() => {
            setEditing(-1);
            updateSaved([cur, ...saved.filter((c) => c !== cur)].slice(0, SLOTS));
          }}
        >
          +
        </button>
        {Array.from({ length: SLOTS }, (_, i) => {
          const c = saved[i];
          if (!c) return <span key={i} className="cp-slot" />;
          return (
            <button
              key={i}
              className={`cp-slot${i === editing ? " edit" : ""}`}
              style={{ background: c }}
              title={i === editing ? "색을 고르면 이 칸이 바뀝니다" : `${c} (누르면 이 색을 다시 고칠 수 있음, 우클릭: 삭제)`}
              onClick={() => {
                // 누른 칸을 골라 두고, 이후 스펙트럼으로 바꾸는 색이 그 칸에 들어간다. 다시 누르면 해제.
                setEditing(i === editing ? -1 : i);
                onChange(c);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditing(-1);
                updateSaved(saved.filter((_, j) => j !== i));
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
