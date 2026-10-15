// 색상 유틸 + 캔버스 배경 프리셋.
//
// Excalidraw 다크 테마는 캔버스에 `invert(93%) hue-rotate(180deg)` 필터를 걸기 때문에
// viewBackgroundColor(저장값)와 화면에 보이는 색이 다르다.
// 사용자가 고른 "보이는 색"이 그대로 보이도록 toStored / toDisplay 로 변환한다.
// (기본 93% 로는 순수 검정/흰색이 나오지 않아 index.css 에서 100% 로 덮어쓴다)

export const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function hsvToRgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

export function rgbToHsv([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

// hue-rotate(180deg) 행렬 (CSS 필터 스펙)
const HR = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];
const INV = 1; // CSS(index.css)에서 --theme-filter 를 invert(100%) 로 덮어쓴다

const mul = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const HR_INV = invert3(HR);

// 저장값 -> 화면에 보이는 색
export function toDisplay(storedHex) {
  const rgb = hexToRgb(storedHex);
  if (!rgb) return storedHex;
  const inverted = rgb.map((c) => INV - (2 * INV - 1) * (c / 255));
  return rgbToHex(mul(HR, inverted).map((c) => clamp01(c) * 255));
}

// 화면에 보이길 원하는 색 -> 저장값
export function toStored(displayHex) {
  const rgb = hexToRgb(displayHex);
  if (!rgb) return displayHex;
  const before = mul(
    HR_INV,
    rgb.map((c) => c / 255),
  );
  return rgbToHex(before.map((c) => clamp01((INV - c) / (2 * INV - 1)) * 255));
}

// 고정 프리셋 (화면에 보이는 색 기준)
export const BG_PRESETS = [
  { name: "검정", color: "#000000" },
  { name: "짙은 회색", color: "#1e1e1e" },
  { name: "회색", color: "#808080" },
  { name: "연한 회색", color: "#d9d9d9" },
  { name: "흰색", color: "#ffffff" },
  { name: "남색", color: "#0f1b2e" },
  { name: "짙은 녹색", color: "#14241a" },
  { name: "갈색", color: "#2b1d14" },
];
