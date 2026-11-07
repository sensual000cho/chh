import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arrangeItems } from "../src/arrange.js";
import { eventToAccelerator, formatAccelerator } from "../src/accelerator.js";
import { commonBounds, elementBounds, frameAt, frameBox } from "../src/sceneGeom.js";
import { isHttpUrl, parseDroppedLinks } from "../src/links.js";

const require = createRequire(import.meta.url);
const { atomicWrite, archiveFile } = require("../electron/fsutil.cjs");
const { fitBounds } = require("../electron/windowBounds.cjs");

describe("요소 위치 계산", () => {
  const box = { x: 100, y: 100, width: 100, height: 50 };
  it("선 요소는 점 기준으로 경계를 잡는다", () => {
    expect(elementBounds({ x: 10, y: 10, width: 50, height: 50, points: [[0, 0], [-20, 30]] })).toEqual({ x1: -10, y1: 10, x2: 10, y2: 40 });
  });
  it("90도 회전하면 가로세로가 바뀐다", () => {
    const b = elementBounds({ ...box, angle: Math.PI / 2 });
    expect(b.x2 - b.x1).toBeCloseTo(50);
    expect(b.y2 - b.y1).toBeCloseTo(100);
  });
  it("겹친 프레임 중 가장 위를 고른다", () => {
    const a = { ...box, id: "a", type: "frame" };
    const b = { ...box, id: "b", type: "frame" };
    expect(frameAt([a, b], 150, 120).id).toBe("b");
    expect(frameAt([a], 10, 10)).toBeNull();
  });
  it("묶음 상자는 요소들을 여백과 함께 감싼다", () => {
    expect(commonBounds([box, { x: 0, y: 0, width: 10, height: 10 }])).toEqual({ x1: 0, y1: 0, x2: 200, y2: 150 });
    expect(frameBox([box], 10)).toEqual({ x: 90, y: 90, width: 120, height: 70 });
  });
});

describe("웹 주소", () => {
  it("주소 하나만 있을 때만 주소로 본다", () => {
    expect(isHttpUrl(" https://a.com/b.png ")).toBe(true);
    expect(isHttpUrl("https://a.com 그리고 글자")).toBe(false);
    expect(isHttpUrl("file:///c:/a.png")).toBe(false);
  });
  it("링크 걸린 이미지: 이미지는 받아 오고 출처는 페이지로 남긴다", () => {
    const html = '<a href="https://site.com/p"><img class="x" src="https://cdn.com/a.png?x=1&amp;y=2"></a>';
    expect(parseDroppedLinks(html, "https://site.com/p")).toEqual({ image: "https://cdn.com/a.png?x=1&y=2", link: "https://site.com/p" });
  });
  it("늦게 불러오는 이미지는 진짜 주소를 쓰고 흐린 미리보기는 큰 이미지로 바꾼다", () => {
    expect(parseDroppedLinks('<img src="https://p.pstatic.net/a.jpg?type=w80_blur" data-lazy-src="https://p.pstatic.net/a.jpg?type=w773">', "https://blog.naver.com/x/1").image).toBe("https://p.pstatic.net/a.jpg?type=w773");
    expect(parseDroppedLinks('<img src="https://p.pstatic.net/a.jpg?type=w80_blur">', "").image).toBe("https://p.pstatic.net/a.jpg?type=w773");
    expect(parseDroppedLinks('<img src="//cdn.com/a.png">', "").image).toBe("https://cdn.com/a.png");
  });
  it("구글 이미지: 중간 주소에서 실제 페이지를 꺼내고, a 태그 주소도 출처로 쓴다", () => {
    const uri = "https://www.google.com/imgres?imgurl=https://x.com/a.png&imgrefurl=https://x.com/page";
    expect(parseDroppedLinks('<img src="data:image/jpeg;base64,AA">', uri)).toEqual({ image: "data:image/jpeg;base64,AA", link: "https://x.com/page" });
    expect(parseDroppedLinks('<a href="https://x.com/p"><img src="data:image/jpeg;base64,AA"></a>', "").link).toBe("https://x.com/p");
    expect(parseDroppedLinks('<a href="javascript:void(0)"><img src="data:image/jpeg;base64,AA"></a>', "").link).toBeNull();
  });
  it("이미지만 있으면 그 주소가 출처다", () => {
    expect(parseDroppedLinks("", "# 주석\nhttps://a.com/b.png")).toEqual({ image: "https://a.com/b.png", link: "https://a.com/b.png" });
  });
  it("data 이미지는 출처 없이 넣고, 쓸 수 없는 주소는 무시한다", () => {
    expect(parseDroppedLinks('<img src="data:image/png;base64,AA">', "")).toEqual({ image: "data:image/png;base64,AA", link: null });
    expect(parseDroppedLinks('<img src="/relative.png">', "")).toBeNull();
    expect(parseDroppedLinks("", "")).toBeNull();
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
