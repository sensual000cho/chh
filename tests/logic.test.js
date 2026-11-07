import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arrangeItems } from "../src/arrange.js";
import { eventToAccelerator, formatAccelerator } from "../src/accelerator.js";
import { bresenham, fillData, inRect, mirrorStamps, normalizeRect, rectFilled, rectOutline } from "../src/pixel/tools.js";

const require = createRequire(import.meta.url);
const { atomicWrite, archiveFile } = require("../electron/fsutil.cjs");
const { fitBounds } = require("../electron/windowBounds.cjs");

describe("픽셀 도구", () => {
  it("bresenham 은 양 끝을 포함해 빈틈없이 잇는다", () => {
    const pts = [];
    bresenham(0, 0, 3, 1, (x, y) => pts.push([x, y]));
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([3, 1]);
    expect(pts).toHaveLength(4);
  });

  it("채우기는 경계 안쪽만 칠하고 바뀐 수를 돌려준다", () => {
    // 3×1: 투명, 빨강, 투명 → 왼쪽 칸만 칠해져야 한다
    const d = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]);
    expect(fillData(d, 3, 1, 0, 0, [0, 255, 0])).toBe(1);
    expect([...d.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect(d[11]).toBe(0);
    expect(fillData(d, 3, 1, 0, 0, [0, 255, 0])).toBe(0); // 이미 같은 색
    expect(fillData(d, 3, 1, 9, 0, [0, 255, 0])).toBe(0); // 판 밖
  });

  it("대칭은 브러시 크기를 고려해 마주 보는 자리에 찍는다", () => {
    expect(mirrorStamps(0, 0, 2, 8, 8, true, false)).toEqual([[0, 0], [6, 0]]);
    expect(mirrorStamps(1, 1, 1, 4, 4, true, true)).toHaveLength(4);
    expect(mirrorStamps(1, 0, 2, 4, 4, true, false)).toEqual([[1, 0]]); // 가운데는 한 번만
  });

  it("선택 영역은 판 안으로 잘린다", () => {
    expect(normalizeRect({ x: 5, y: 5 }, { x: -3, y: 2 }, 4, 4)).toEqual({ x: 0, y: 2, w: 4, h: 2 });
    expect(normalizeRect({ x: 9, y: 9 }, { x: 12, y: 12 }, 4, 4)).toBeNull();
    expect(inRect({ x: 1, y: 1, w: 2, h: 2 }, { x: 2, y: 2 })).toBe(true);
    expect(inRect({ x: 1, y: 1, w: 2, h: 2 }, { x: 3, y: 1 })).toBe(false);
    expect(inRect(null, { x: 0, y: 0 })).toBe(false);
  });

  it("사각형 도구: 테두리는 속이 비고 채움은 전부 칠한다", () => {
    const outline = new Set();
    rectOutline({ x: 0, y: 0 }, { x: 2, y: 2 }, (x, y) => outline.add(`${x},${y}`));
    expect(outline.size).toBe(8);
    expect(outline.has("1,1")).toBe(false);
    let filled = 0;
    rectFilled({ x: 2, y: 2 }, { x: 0, y: 0 }, () => filled++);
    expect(filled).toBe(9);
  });
});

describe("이미지 자동 정렬", () => {
  const items = [
    { id: "a", x: 100, y: 50, width: 200, height: 100 },
    { id: "b", x: 900, y: 900, width: 100, height: 300 },
    { id: "c", x: 300, y: 400, width: 150, height: 150 },
  ];

  it("왼쪽 위 기준을 유지하고 서로 겹치지 않는다", () => {
    const places = arrangeItems(items);
    const rects = items.map((i) => ({ ...i, ...places.get(i.id) }));
    expect(Math.min(...rects.map((r) => r.x))).toBe(100);
    expect(Math.min(...rects.map((r) => r.y))).toBe(50);
    for (const a of rects) {
      for (const b of rects) {
        if (a === b) continue;
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("빈 목록도 처리한다", () => {
    expect(arrangeItems([]).size).toBe(0);
  });
});

describe("단축키 변환", () => {
  it("한글 입력 상태에서도 물리 키 기준으로 만든다", () => {
    expect(eventToAccelerator({ code: "KeyX", key: "ㅌ", ctrlKey: true, shiftKey: true })).toBe(
      "CommandOrControl+Shift+X",
    );
  });
  it("수정 키 없는 일반 키나 수정 키만 누른 상태는 받지 않는다", () => {
    expect(eventToAccelerator({ code: "KeyX", key: "x" })).toBeNull();
    expect(eventToAccelerator({ code: "ControlLeft", key: "Control", ctrlKey: true })).toBeNull();
  });
  it("F 키는 단독으로 쓸 수 있다", () => {
    expect(eventToAccelerator({ code: "F9", key: "F9" })).toBe("F9");
  });
  it("화면 표시용으로 바꾼다", () => {
    expect(formatAccelerator("CommandOrControl+Shift+X")).toBe("Ctrl+Shift+X");
  });
});

describe("창 위치 복원", () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  it("보이는 위치는 그대로 둔다", () => {
    expect(fitBounds({ x: 100, y: 100, width: 800, height: 600 }, screens)).toEqual({ x: 100, y: 100, width: 800, height: 600 });
  });
  it("빠진 모니터에 있던 창은 위치를 버린다", () => {
    expect(fitBounds({ x: 3000, y: 100, width: 800, height: 600 }, screens)).toEqual({ width: 800, height: 600 });
  });
  it("더 큰 모니터 크기였으면 들어가게 줄인다", () => {
    expect(fitBounds({ x: -5000, y: 0, width: 3840, height: 2100 }, screens)).toEqual({ width: 1920, height: 1040 });
  });
  it("저장된 값이 없으면 기본 크기", () => {
    expect(fitBounds({}, screens)).toEqual({ width: 1280, height: 800 });
  });
});

describe("파일 쓰기", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chh-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("쓰기 후 임시 파일이 남지 않는다", async () => {
    const target = path.join(dir, "a.chh");
    await atomicWrite(target, "first");
    await atomicWrite(target, "second");
    expect(fs.readFileSync(target, "utf8")).toBe("second");
    expect(fs.readdirSync(dir)).toEqual(["a.chh"]);
  });

  it("쓰기에 실패하면 기존 파일은 그대로다", async () => {
    const target = path.join(dir, "a.chh");
    await atomicWrite(target, "original");
    await expect(atomicWrite(path.join(dir, "없는폴더", "b.chh"), "x")).rejects.toThrow();
    // 대상이 폴더라 교체에 실패하는 경우
    const folder = path.join(dir, "folder.chh");
    fs.mkdirSync(folder);
    await expect(atomicWrite(folder, "x")).rejects.toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("original");
    expect(fs.readdirSync(dir).sort()).toEqual(["a.chh", "folder.chh"]);
  });

  it("백업은 지정한 개수만 남긴다", async () => {
    const source = path.join(dir, "autosave.chh");
    fs.writeFileSync(source, "data");
    const backups = path.join(dir, "backups");
    for (let i = 1; i <= 7; i++) await archiveFile(source, backups, 5, new Date(2026, 0, i));
    const names = fs.readdirSync(backups).sort();
    expect(names).toHaveLength(5);
    expect(names[0]).toContain("20260103");
  });
});
