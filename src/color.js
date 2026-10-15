// 색상 유틸 + 캔버스 배경 프리셋.

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
