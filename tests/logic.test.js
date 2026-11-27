import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arrangeItems } from "../src/arrange.js";
import { eventToAccelerator, formatAccelerator } from "../src/accelerator.js";
import { commonBounds, elementBounds, frameAt, frameBox } from "../src/sceneGeom.js";
import { isHttpUrl, parseDroppedLinks } from "../src/links.js";
import { fileUrl, isLocalPath, parseEmbedVideo, parseVideoFileUrl } from "../src/videoLinks.js";
import { isAnimatedImage } from "../src/animated.js";
import { cropBox, layoutMedia } from "../src/mediaScene.js";

const require = createRequire(import.meta.url);
const { atomicWrite, archiveFile, migrateUserData } = require("../electron/fsutil.cjs");
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

describe("migrateUserData", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "chh-migrate-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const old = () => path.join(dir, "CHH");
  const cur = () => path.join(dir, "Thinking Chair");
  const seedOld = () => {
    fs.mkdirSync(path.join(old(), "Local Storage", "leveldb"), { recursive: true });
    fs.writeFileSync(path.join(old(), "settings.json"), '{"a":1}');
    fs.writeFileSync(path.join(old(), "autosave.chh"), "board");
    fs.writeFileSync(path.join(old(), "Local Storage", "leveldb", "x.log"), "recent");
    fs.mkdirSync(path.join(old(), "Cache"));
  };

  it("새 폴더가 비어 있으면 사용자 데이터를 복사하고 예전 폴더는 남긴다", () => {
    seedOld();
    expect(migrateUserData(old(), cur())).toBe(true);
    expect(fs.readFileSync(path.join(cur(), "settings.json"), "utf8")).toBe('{"a":1}');
    expect(fs.readFileSync(path.join(cur(), "autosave.chh"), "utf8")).toBe("board");
    expect(fs.existsSync(path.join(cur(), "Local Storage", "leveldb", "x.log"))).toBe(true);
    expect(fs.existsSync(path.join(cur(), "Cache"))).toBe(false);
    expect(fs.existsSync(path.join(old(), "settings.json"))).toBe(true);
  });

  it("Electron 이 미리 만든 파일이 있어도 복사한다", () => {
    seedOld();
    fs.mkdirSync(cur());
    fs.writeFileSync(path.join(cur(), "lockfile"), "");
    expect(migrateUserData(old(), cur())).toBe(true);
    expect(fs.existsSync(path.join(cur(), "settings.json"))).toBe(true);
  });

  it("새 폴더를 이미 쓰고 있으면 덮어쓰지 않는다", () => {
    seedOld();
    fs.mkdirSync(cur());
    fs.writeFileSync(path.join(cur(), "settings.json"), '{"new":1}');
    expect(migrateUserData(old(), cur())).toBe(false);
    expect(fs.readFileSync(path.join(cur(), "settings.json"), "utf8")).toBe('{"new":1}');
    expect(fs.existsSync(path.join(cur(), "autosave.chh"))).toBe(false);
  });

  it("예전 폴더가 없으면 아무것도 하지 않는다", () => {
    expect(migrateUserData(old(), cur())).toBe(false);
    expect(fs.existsSync(cur())).toBe(false);
  });
});

describe("영상 주소", () => {
  const yt = (u) => parseEmbedVideo(u)?.link;
  it("유튜브의 여러 주소 모양을 하나로 맞춘다", () => {
    const want = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
    for (const u of [
      "https://youtu.be/aqz-KE-bpKQ?si=abc",
      "https://m.youtube.com/watch?app=desktop&v=aqz-KE-bpKQ",
      "https://www.youtube.com/live/aqz-KE-bpKQ?feature=share",
      "https://music.youtube.com/watch?v=aqz-KE-bpKQ&list=RDx",
      " https://www.youtube.com/embed/aqz-KE-bpKQ ",
    ])
      expect(yt(u)).toBe(want);
  });
  it("시작 시각, 쇼츠, 재생 목록", () => {
    expect(yt("https://youtu.be/aqz-KE-bpKQ?t=1m5s")).toMatch(/&t=65$/);
    expect(yt("https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=90s")).toMatch(/&t=90$/);
    const shorts = parseEmbedVideo("https://www.youtube.com/shorts/aqz-KE-bpKQ");
    expect(shorts.height).toBeGreaterThan(shorts.width);
    expect(yt("https://www.youtube.com/playlist?list=PL_a-1")).toBe("https://www.youtube.com/playlist?list=PL_a-1");
  });
  it("비메오와 영상이 아닌 주소", () => {
    expect(yt("https://vimeo.com/channels/staffpicks/76979871")).toBe("https://vimeo.com/76979871");
    for (const u of ["https://www.youtube.com/@name", "https://www.youtube.com/", "https://a.com/watch?v=aqz-KE-bpKQ", "글자", "https://notyoutube.com/watch?v=aqz-KE-bpKQ"])
      expect(parseEmbedVideo(u)).toBeNull();
  });
  it("영상 파일 주소", () => {
    expect(parseVideoFileUrl("https://a.com/b/c.MP4?x=1")).toBe("https://a.com/b/c.MP4?x=1");
    expect(parseVideoFileUrl("https://i.imgur.com/abc.gifv")).toBe("https://i.imgur.com/abc.mp4");
    expect(parseVideoFileUrl("https://a.com/page?file=c.mp4")).toBeNull();
    expect(parseVideoFileUrl("file:///C:/a.mp4")).toBeNull();
  });
  it("원본 파일은 이 컴퓨터의 드라이브 경로만 받는다", () => {
    expect(isLocalPath("C:\\영상\\a.mp4")).toBe(true);
    for (const p of ["\\\\server\\a.mp4", "//server/a.mp4", "C:\\\\server\\a.mp4", "/a.mp4", "file:///c:/a", null, {}]) expect(isLocalPath(p)).toBe(false);
    expect(fileUrl("C:\\a b\\#1.mp4")).toBe("file:///C:/a%20b/%231.mp4");
  });
});

describe("움직이는 그림", () => {
  const url = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  it("GIF, 움직이는 WebP·PNG 를 알아본다", () => {
    const webp = (flag) => url("image/webp", [...Buffer.from("RIFF\0\0\0\0WEBPVP8X\n\0\0\0"), flag, 0, 0, 0]);
    expect(isAnimatedImage("image/gif", url("image/gif", [1]))).toBe(true);
    expect(isAnimatedImage("image/webp", webp(0x12))).toBe(true);
    expect(isAnimatedImage("image/webp", webp(0x10))).toBe(false);
    expect(isAnimatedImage("image/png", url("image/png", Buffer.from("xxxxIHDRxxacTLxxIDAT")))).toBe(true);
    expect(isAnimatedImage("image/png", url("image/png", Buffer.from("xxxxIHDRxxIDATxxacTL")))).toBe(false);
  });

  const el = (id, type, x, extra = {}) => ({ id, type, x, y: 0, width: 100, height: 100, angle: 0, ...extra });
  const run = (els, opts = {}) =>
    layoutMedia(els, { kindOf: (e) => (e.id.startsWith("gif") ? "gif" : null), view: { x1: 0, y1: 0, x2: 1000, y2: 1000 }, zoom: 1, ...opts });
  it("위에 겹친 요소만 다시 그린다", () => {
    const text = el("t", "text", 20, { containerId: "box" });
    const items = run([el("below", "rectangle", 0), el("gif1", "image", 0), el("box", "rectangle", 20, { boundElements: [{ type: "text", id: "t" }] }), text, el("far", "rectangle", 500), el("f", "frame", 0)]);
    expect(items.length).toBe(1);
    expect(items[0].covers.map((c) => c.map((e) => e.id))).toEqual([["box", "t"]]);
  });
  it("위에 겹친 정지 이미지는 함께 얹고, 안 겹친 이미지는 두고 온다", () => {
    const items = run([el("img0", "image", 0), el("gif1", "image", 0), el("img1", "image", 50), el("img2", "image", 600)]);
    expect(items.map((i) => [i.el.id, i.kind])).toEqual([["gif1", "gif"], ["img1", "still"]]);
  });
  it("화면 밖이거나 너무 작거나 빼 달라고 한 것은 얹지 않는다", () => {
    expect(run([el("gif1", "image", 5000)]).length).toBe(0);
    expect(run([el("gif1", "image", 0)], { zoom: 0.05 }).length).toBe(0);
    expect(run([el("gif1", "image", 0)], { skip: new Set(["gif1"]) }).length).toBe(0);
  });
  it("잘라낸 이미지의 원본 자리", () => {
    expect(cropBox({ width: 100, height: 50, crop: { x: 20, y: 10, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 } })).toEqual({ left: -10, top: -5, width: 200, height: 100 });
  });
});
