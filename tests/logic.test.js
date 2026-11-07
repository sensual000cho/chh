import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arrangeItems } from "../src/arrange.js";
import { eventToAccelerator, formatAccelerator } from "../src/accelerator.js";

const require = createRequire(import.meta.url);
const { atomicWrite, archiveFile } = require("../electron/fsutil.cjs");
const { fitBounds } = require("../electron/windowBounds.cjs");

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
