// Excalidraw 의 다크 테마 UI 규칙(.theme--dark)을 라이트 테마용 selector(.chh-dark .excalidraw)로 옮겨
// src/excalidraw-dark.css 를 만든다.
//
// 왜: Excalidraw 다크 테마는 캔버스에 색 반전 필터를 걸고 이미지에도 보정 필터를 따로 적용해서
//     이미지/배경 색이 원본과 달라진다. 캔버스는 라이트 테마(필터 없음)로 그려 색을 정확히 유지하고,
//     UI 만 다크 팔레트를 입히기 위해 쓴다.
// 실행: npm run gen:dark-css   (@excalidraw/excalidraw 버전을 올렸을 때 다시 실행)
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";

const SRC = "node_modules/@excalidraw/excalidraw/dist/prod/index.css";
const OUT = "src/excalidraw-dark.css";

const root = postcss.parse(readFileSync(SRC, "utf8"));
const out = postcss.root();
let count = 0;

root.walkRules((rule) => {
  const darkSelectors = rule.selectors.filter((s) => /\.theme--dark(?![\w-])/.test(s));
  if (!darkSelectors.length) return;

  // 캔버스 반전 필터는 가져오지 않는다 (이게 색을 바꾸는 원인)
  const clone = rule.clone();
  // 라이트 테마에는 테마 class 가 붙지 않으므로, 앱 래퍼(.chh-dark) 아래의 .excalidraw 로 바꾼다
  clone.selectors = darkSelectors.map((s) =>
    s
      .replace(/\.excalidraw\.theme--dark(?![\w-])|\.theme--dark(?![\w-])\.excalidraw/g, ".chh-dark .excalidraw")
      .replace(/\.theme--dark(?![\w-])/g, ".chh-dark"),
  );
  clone.walkDecls((d) => {
    if (d.prop === "filter" && d.value.includes("--theme-filter")) d.remove();
  });
  if (!clone.nodes.length) return;

  // @media 등 상위 at-rule 이 있으면 그대로 감싼다
  let node = clone;
  for (let p = rule.parent; p && p.type === "atrule"; p = p.parent) {
    const wrap = postcss.atRule({ name: p.name, params: p.params });
    wrap.append(node);
    node = wrap;
  }
  out.append(node);
  count++;
});

const header =
  "/* 자동 생성 파일 — 직접 수정하지 마세요. `npm run gen:dark-css` (scripts/gen-dark-css.mjs) */\n";
writeFileSync(OUT, header + out.toString() + "\n");
console.log(`${count}개 규칙 → ${OUT}`);
