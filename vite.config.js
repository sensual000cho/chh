import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 설정으로 바꿀 수 없는 Excalidraw 동작(확대/축소 범위 10% ~ 3000% 등)은 번들을 읽을 때 코드를 바꾼다.
// - 범위: 1% ~ 300% (레퍼런스 보드라 크게 확대할 일은 적고, 멀리서 내려다볼 일이 많다)
// - 단계: 원래는 0.1(10%p)씩 더하고 빼서 10% 아래에선 한 번에 최소로 떨어진다.
//         배율에 비례해 바뀌게(한 칸에 ZOOM_RATIO 배) 해서 낮은 배율에서도 조금씩 움직이게 한다.
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 3;
const ZOOM_RATIO = 1.2;

// [이름, 찾을 식, 바꿀 내용] — 개발판(풀린 코드)과 배포판(압축 코드) 모두에 맞게 썼다
const PATCHES = [
  // 상수: 개발판 "var MIN_ZOOM = 0.1;\nvar MAX_ZOOM = 30;", 배포판 "ZOOM_STEP=.1,MIN_ZOOM=.1,MAX_ZOOM=30,"
  ["최소 배율(개발판)", /\bMIN_ZOOM = 0\.1;/, `MIN_ZOOM = ${MIN_ZOOM};`],
  ["최대 배율(개발판)", /\bMAX_ZOOM = 30;/, `MAX_ZOOM = ${MAX_ZOOM};`],
  ["배율 범위(배포판)", /(=\.1,[\w$]+=)\.1(,[\w$]+=)30,/, `$1${MIN_ZOOM}$2${MAX_ZOOM},`],
  // 확대/축소 버튼과 Ctrl+/-: zoom.value ± ZOOM_STEP → zoom.value ×/÷ ZOOM_RATIO
  [
    "버튼 단계",
    /(nextZoom: ?[\w$]+\([\w$]+\.zoom\.value) ?([+-]) ?[\w$]+\)/g,
    (_, head, op) => `${head} ${op === "+" ? "*" : "/"} ${ZOOM_RATIO})`,
  ],
  // Ctrl+휠: zoom.value - delta/100 (+ 100% 이상에서 덤) → 휠 한 칸에 ZOOM_RATIO 배
  // (Excalidraw 가 delta 를 ±10 으로 자르므로 휠 한 칸 = delta 10)
  [
    "휠 단계",
    /([\w$]+) ?= ?this\.state\.zoom\.value ?- ?([\w$]+) ?\/ ?100;/,
    `$1 = this.state.zoom.value * Math.pow(${ZOOM_RATIO}, -$2 / 10);`,
  ],
  ["휠 덤 제거", /Math\.log10\(Math\.max\(1, ?this\.state\.zoom\.value\)\)/, "0"],
  // 화면에 맞추기: 0.1 단위로 내림하면 10% 아래에선 0 → 최소 배율이 되므로 0.01 단위로 내림
  [
    "맞추기 단위",
    /(\([\w$]+, ?)[\w$]+(, ?"floor"\), ?[\w$]+, ?[\w$]+\))/,
    `$1${MIN_ZOOM}$2`,
  ],
  // 움직이는 GIF·영상을 캔버스 위에 얹는 동안(MediaLayer.jsx)에는 캔버스에 같은 그림을 그리지 않는다
  // (투명한 부분으로 정지 그림이 비치지 않도록). 이미지로 내보낼 때는 그대로 그린다.
  [
    "움직이는 요소 건너뛰기(개발판)",
    /(ShapeCache\.generateElementShape\((element), (renderConfig)\);\s*)(?=if \(renderConfig\.isExporting\))/,
    "$1if (!$3.isExporting && globalThis.__chhLive?.has($2.id)) break;\n      ",
  ],
  [
    "움직이는 요소 건너뛰기(배포판)",
    /(case"embeddable":\{)(?=if\([\w$]+\.generateElementShape\(([\w$]+),([\w$]+)\),\3\.isExporting\))/,
    "$1if(!$3.isExporting&&globalThis.__chhLive?.has($2.id))break;",
  ],
  // 묶음(프레임) 테두리는 원래 늘 같은 회색이다. 묶음에 고른 선 색(customData.chhBorder, groupColor.js)이 있으면 그 색으로 그린다.
  [
    "묶음 테두리 색(개발판)",
    /(context\.fillStyle = "rgba\(0, 0, 200, 0\.04\)";\s*context\.lineWidth = FRAME_STYLE\.strokeWidth \/ appState\.zoom\.value;\s*context\.strokeStyle = )FRAME_STYLE\.strokeColor;/,
    "$1element.customData?.chhBorder || FRAME_STYLE.strokeColor;",
  ],
  [
    "묶음 테두리 색(배포판)",
    /(\.translate\(([\w$]+)\.x\+[\w$]+\.scrollX,[^)]*\),[\w$]+\.fillStyle="rgba\(0, 0, 200, 0\.04\)",[\w$]+\.lineWidth=([\w$]+)\.strokeWidth\/[\w$]+\.zoom\.value,[\w$]+\.strokeStyle=)\3\.strokeColor/,
    "$1$2.customData?.chhBorder||$3.strokeColor",
  ],
  [
    "SVG 묶음 테두리 색(개발판)",
    /(rect\.setAttribute\("fill", "none"\);\s*rect\.setAttribute\("stroke", )FRAME_STYLE\.strokeColor\)/,
    "$1element.customData?.chhBorder || FRAME_STYLE.strokeColor)",
  ],
  [
    "SVG 묶음 테두리 색(배포판)",
    /(\.setAttribute\("width",`\$\{([\w$]+)\.width\}px`\)[^;]{0,300}?\.setAttribute\("fill","none"\),[\w$]+\.setAttribute\("stroke",)([\w$]+)\.strokeColor\)/,
    "$1$2.customData?.chhBorder||$3.strokeColor)",
  ],
];

function excalidrawPatch() {
  const applied = new Set();
  return {
    name: "chh-excalidraw-patch",
    transform(code, id) {
      if (!/[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/]/.test(id)) return null;
      let next = code;
      for (const [name, re, to] of PATCHES) {
        const before = next;
        next = next.replace(re, to);
        if (next !== before) applied.add(name);
      }
      return next === code ? null : { code: next, map: null };
    },
    // Excalidraw 를 올린 뒤 코드 모양이 바뀌어 고치지 못하면 조용히 넘어가지 않고 빌드를 멈춘다
    generateBundle() {
      const dev = applied.has("최소 배율(개발판)") || applied.has("최대 배율(개발판)");
      const need = PATCHES.map(([n]) => n).filter((n) => !n.includes(dev ? "배포판" : "개발판"));
      const missing = need.filter((n) => !applied.has(n));
      if (applied.size && missing.length) this.error(`Excalidraw 패치를 못 했습니다: ${missing.join(", ")}`);
    },
  };
}

// Electron이 file:// 로 dist/index.html 을 열기 때문에 상대 경로로 빌드한다.
export default defineConfig({
  base: "./",
  plugins: [react(), excalidrawPatch()],
  // 개발 서버는 의존성을 미리 묶어 두므로 그 단계에도 같은 처리를 건다
  optimizeDeps: { rolldownOptions: { plugins: [excalidrawPatch()] } },
  server: { port: 5173, strictPort: true },
});
