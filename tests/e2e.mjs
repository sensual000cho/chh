// 실제 Electron 앱을 임시 사용자 폴더로 띄워 저장·복원·종료 동작을 확인한다. (npm run test:e2e, 먼저 npm run build)
// 사용: node tests/e2e.mjs [큰 보드 파일 경로]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const electronBin = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "chh-e2e-"));
const shot = path.join(work, "shot.png");
let failed = 0;
let externalClip = "";

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failed++;
};

const rect = (id, version = 5) => ({
  id, type: "rectangle", x: 100, y: 100, width: 200, height: 120, strokeColor: "#e6e6e6",
  backgroundColor: "transparent", version, versionNonce: 1, seed: 1, isDeleted: false, groupIds: [],
  boundElements: null, angle: 0, opacity: 100, roughness: 1, strokeWidth: 2, strokeStyle: "solid",
  fillStyle: "solid", roundness: null, frameId: null, updated: 1, link: null, locked: false,
});
const board = (...els) =>
  JSON.stringify({ type: "excalidraw", version: 2, source: "e2e", elements: els, appState: { viewBackgroundColor: "#1e1e1e" }, files: {} });

const prelude = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const api = window.__chhApi;
  const state = () => ({ title: document.title, n: api.getSceneElements().length });
  const addRect = (id) => api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ${JSON.stringify(rect("__ID__", 1))}].map((e) => e.id === "__ID__" ? { ...e, id, version: 1 } : e) });
  // Excalidraw 는 포커스가 보드에 있고 커서가 캔버스 위일 때만 붙여넣기를 처리한다
  const hoverCanvas = () => {
    document.querySelector(".excalidraw")?.focus();
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 300, bubbles: true }));
  };
  const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
`;

// app 실행 → eval 결과를 돌려준다. eval 이 끝나면 앱이 스스로 종료한다.
function launch({ userData, args = [], script, env = {}, delay = 3000, timeout = 60000, onSpawn }) {
  return new Promise((resolve) => {
    const child = spawn(electronBin, [".", ...args], {
      cwd: root,
      env: {
        ...process.env,
        CHH_TEST: "1",
        CHH_USERDATA: userData,
        CHH_SHOT: shot,
        CHH_SHOT_DELAY: String(delay),
        CHH_EVAL: `(async () => { ${prelude} ${script} })().then((v) => JSON.stringify(v))`,
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => kill(child), timeout);
    onSpawn?.(child);
    child.on("exit", (code) => {
      clearTimeout(timer);
      const m = /\[eval\] (.*)/.exec(out);
      let result = null;
      try {
        result = m ? JSON.parse(m[1]) : null;
      } catch {}
      if (!result && !env.CHH_TEST_REAL_CLOSE) console.log(out.split("\n").slice(-6).join("\n"));
      resolve({ code, out, result, errors: out.split("\n").filter((l) => /\[renderer:error\]|\[eval error\]/.test(l)) });
    });
  });
}

const kill = (child) => spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);

function profile(name, files = {}) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c);
  return dir;
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const backups = (dir) => {
  const b = path.join(dir, "autosave-backups");
  return fs.existsSync(b) ? fs.readdirSync(b) : [];
};

async function main() {
  // 1. 예전 형식 자동 저장본 복원 → 저장 안 됨 표시 → Ctrl+N 취소/버리기
  console.log("\n[1] 자동 저장본 복원과 새 보드 확인");
  let dir = profile("p1", { "autosave.chh": board(rect("seed")) });
  let r = await launch({
    userData: dir,
    env: { CHH_TEST_UNSAVED: "cancel" },
    script: `const a = state(); key("n", { ctrlKey: true }); await wait(800); return { a, b: state() };`,
  });
  check("예전 자동 저장본이 복원된다", r.result?.a.n === 1, JSON.stringify(r.result?.a));
  check("복원본은 저장 안 됨으로 표시된다", r.result?.a.title.includes("•"));
  check("Ctrl+N 에서 취소하면 그대로다", r.result?.b.n === 1);

  r = await launch({
    userData: dir,
    env: { CHH_TEST_UNSAVED: "discard" },
    script: `key("n", { ctrlKey: true }); await wait(1500); return state();`,
  });
  check("버리기를 고르면 비워진다", r.result?.n === 0 && !r.result?.title.includes("•"), JSON.stringify(r.result));
  check("버린 내용은 백업 폴더에 남는다", backups(dir).length === 1, backups(dir).join());
  const backup = readJson(path.join(dir, "autosave-backups", backups(dir)[0]));
  check("백업에 원래 요소가 들어 있다", backup.elements.length === 1);
  r = await launch({ userData: dir, script: `return state();` });
  check("버린 뒤 다시 켜면 빈 보드다", r.result?.n === 0);

  // 2. 파일 열기 → 수정 → 저장 → 다시 켜기 → 강제 종료 복구
  console.log("\n[2] 파일 저장과 강제 종료 복구");
  dir = profile("p2");
  const file = path.join(work, "저장 테스트.chh");
  fs.writeFileSync(file, board(rect("one")));
  r = await launch({
    userData: dir,
    args: [file],
    script: `const a = state(); addRect("two"); await wait(100); const b = state(); key("s", { ctrlKey: true }); await wait(1000); return { a, b, c: state() };`,
  });
  check("파일을 열면 변경 없음", r.result && !r.result.a.title.includes("•"), r.result?.a.title);
  check("수정하면 변경 표시", r.result?.b.title.includes("•") && r.result?.b.n === 2);
  check("Ctrl+S 후 변경 표시가 사라진다", r.result && !r.result.c.title.includes("•"));
  check("파일에 저장됐다", readJson(file).elements.length === 2);
  check("임시 파일이 남지 않는다", !fs.readdirSync(work).some((n) => n.endsWith(".tmp")));

  r = await launch({ userData: dir, script: `return state();` });
  check("다시 켜면 마지막 파일이 연결된 채 열린다", r.result?.title.includes("저장 테스트") && r.result?.n === 2, r.result?.title);

  // 저장하지 않고 강제 종료
  let child;
  const killed = launch({
    userData: dir,
    delay: 3000,
    timeout: 45000,
    onSpawn: (c) => (child = c),
    script: `addRect("three"); await wait(30000); return state();`,
  });
  const meta = path.join(dir, "autosave.json");
  for (let i = 0; i < 80; i++) {
    await new Promise((res) => setTimeout(res, 250));
    try {
      if (readJson(meta).dirty) break;
    } catch {}
  }
  kill(child);
  await killed;
  check("강제 종료 전 원본 파일은 그대로다", readJson(file).elements.length === 2);
  r = await launch({ userData: dir, script: `return state();` });
  check("강제 종료 후 저장 안 한 작업이 복구된다", r.result?.n === 3 && r.result?.title.includes("•"), JSON.stringify(r.result));
  check("복구해도 파일 연결이 유지된다", r.result?.title.includes("저장 테스트"));

  // 3. 다른 파일을 열어도 저장 안 한 작업은 백업된다
  console.log("\n[3] 저장 안 한 작업이 있을 때 파일로 시작");
  const other = path.join(work, "다른 보드.chh");
  fs.writeFileSync(other, board(rect("x")));
  const before = backups(dir).length;
  r = await launch({ userData: dir, args: [other], script: `return state();` });
  check("요청한 파일이 열린다", r.result?.title.includes("다른 보드") && r.result?.n === 1, r.result?.title);
  check("이전 작업은 백업된다", backups(dir).length === before + 1);

  // 4. 창 닫기
  console.log("\n[4] 창 닫기 확인");
  dir = profile("p4");
  const closeFile = path.join(work, "닫기.chh");
  fs.writeFileSync(closeFile, board(rect("one")));
  r = await launch({
    userData: dir,
    args: [closeFile],
    env: { CHH_TEST_UNSAVED: "cancel", CHH_TEST_REAL_CLOSE: "1" },
    timeout: 15000,
    script: `addRect("two"); await wait(100); window.chh.close(); await wait(1000); return state();`,
  });
  check("닫기에서 취소하면 창이 남는다", r.result?.n === 2, JSON.stringify(r.result));

  const started = Date.now();
  r = await launch({
    userData: dir,
    args: [closeFile],
    env: { CHH_TEST_UNSAVED: "save", CHH_TEST_REAL_CLOSE: "1" },
    timeout: 20000,
    script: `addRect("three"); await wait(50); window.chh.close(); await wait(15000); return "still-open";`,
  });
  check("저장을 고르면 저장하고 닫힌다", r.result !== "still-open" && readJson(closeFile).elements.length >= 2, `${Date.now() - started}ms`);

  dir = profile("p5");
  r = await launch({
    userData: dir,
    env: { CHH_TEST_REAL_CLOSE: "1" },
    timeout: 20000,
    script: `window.chh.close(); await wait(15000); return "still-open";`,
  });
  check("변경이 없으면 묻지 않고 닫힌다", r.result !== "still-open");

  // 5. 깨진 자동 저장본 / 없는 파일
  console.log("\n[5] 잘못된 파일 처리");
  dir = profile("p6", {
    "autosave.chh": "{ 깨진 파일",
    "autosave.json": JSON.stringify({ filePath: null, dirty: true }),
  });
  r = await launch({ userData: dir, script: `return state();` });
  check("깨진 자동 저장본이어도 앱이 뜬다", r.result?.n === 0, r.errors.join(" ").slice(0, 200));

  // 6. 창 상태와 클릭 통과, 캡처
  console.log("\n[6] 창 상태, 클릭 통과, 캡처");
  dir = profile("p7", {
    "window.json": JSON.stringify({ x: 50000, y: 50000, width: 900, height: 600 }),
  });
  r = await launch({
    userData: dir,
    script: `
      const pos = [window.screenX, window.screenY];
      const on = await window.chh.setClickThrough(true);
      await wait(200);
      const cls = document.querySelector(".app").className;
      const off = await window.chh.setClickThrough(false);
      await wait(200);
      const cls2 = document.querySelector(".app").className;
      return { pos, on, off, cls, cls2, max: await window.chh.isMaximized() };`,
  });
  check("빠진 모니터 위치는 복원하지 않는다", r.result && r.result.pos[0] < 40000, JSON.stringify(r.result?.pos));
  check("클릭 통과가 켜지고 표시된다", r.result?.on && r.result.cls.includes("click-through"));
  check("클릭 통과가 꺼진다", r.result?.off && !r.result.cls2.includes("click-through"));

  dir = profile("p8", { "window.json": JSON.stringify({ x: 10, y: 10, width: 900, height: 600, maximized: true }) });
  r = await launch({ userData: dir, script: `await wait(1000); return { max: await window.chh.isMaximized(), icon: !!document.querySelector('[title="이전 크기"]') };` });
  check("최대화 복원 시 제목 표시줄 아이콘이 맞다", r.result?.max && r.result?.icon, JSON.stringify(r.result));

  dir = profile("p9");
  r = await launch({
    userData: dir,
    env: { CHH_TEST_CAPTURE: "1" },
    script: `window.chh.startCapture();
      for (let i = 0; i < 60 && !api.getSceneElements().length; i++) await wait(250);
      const els = api.getSceneElements(); return { n: els.length, type: els[0]?.type, visible: document.visibilityState };`,
  });
  check("화면 캡처가 이미지로 들어온다 (Electron 업그레이드 확인)", r.result?.n === 1 && r.result?.type === "image", JSON.stringify(r.result));

  console.log("\n[7] 캡처 단축키");
  dir = profile("p10");
  r = await launch({
    userData: dir,
    script: `const ok = await window.chh.setCaptureShortcut("CommandOrControl+Alt+F9"); await wait(300); return { ok, now: await window.chh.getCaptureShortcut(), bad: await window.chh.setCaptureShortcut("CommandOrControl+Shift+L") };`,
  });
  check("캡처 단축키를 바꾼다", r.result?.ok && r.result?.now.accel === "CommandOrControl+Alt+F9", JSON.stringify(r.result));
  check("클릭 통과 해제 키와 겹치면 거부한다", r.result?.bad === false);
  r = await launch({ userData: dir, script: `return await window.chh.getCaptureShortcut();` });
  check("다시 켜도 유지된다", r.result?.accel === "CommandOrControl+Alt+F9" && r.result?.ok, JSON.stringify(r.result));

  // 8. 이미지 주소 붙여넣기 / 자동 정렬
  console.log("\n[8] 이미지 주소, 자동 정렬");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  );
  const server = http.createServer((req, res) => {
    if (req.url.endsWith(".png")) {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(png);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html></html>");
    }
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${server.address().port}`;
  dir = profile("p11");
  r = await launch({
    userData: dir,
    script: `
      const img = await window.chh.fetchImage(${JSON.stringify(base + "/a.png")});
      const page = await window.chh.fetchImage(${JSON.stringify(base + "/page")});
      const scheme = await window.chh.fetchImage("file:///C:/Windows/win.ini");
      await window.chh.testPaste(${JSON.stringify(base + "/a.png")});
      await wait(2000);
      const pasted = api.getSceneElements().filter((e) => e.type === "image").length;
      hoverCanvas();
      await window.chh.testPaste(${JSON.stringify(base + "/page")});
      await wait(1500);
      const els = api.getSceneElements();
      return { img: !!img.dataURL, page: page.error, scheme: scheme.error, pasted, images: els.filter((e) => e.type === "image").length, others: els.filter((e) => e.type !== "image").map((e) => e.type) };`,
  });
  server.close();
  check("이미지 주소를 받아 온다", r.result?.img, JSON.stringify(r.result));
  check("웹 페이지와 file: 주소는 이미지로 받지 않는다", !!r.result?.page && !!r.result?.scheme);
  check("이미지 주소를 붙여넣으면 이미지가 들어온다", r.result?.pasted === 1);
  check("이미지가 아닌 주소는 이미지로 들어오지 않는다", r.result?.images === 1);
  check("이미지가 아닌 주소는 원래대로 붙여넣어진다", r.result?.others.length === 1, JSON.stringify(r.result?.others));

  console.log("\n[8-2] 자동 정렬, 예전 픽셀판, 복사");
  const server2 = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
  });
  await new Promise((res) => server2.listen(0, "127.0.0.1", res));
  dir = profile("p13");
  r = await launch({
    userData: dir,
    script: `
      const url = "http://127.0.0.1:${server2.address().port}/a.png";
      await window.chh.testPaste(url); await wait(1200);
      await window.chh.testPaste(url); await wait(1200);
      await window.chh.testPaste(url); await wait(1200);
      const box = () => api.getSceneElements().filter((e) => e.type === "image").map((e) => [e.x, e.y, e.width, e.height]);
      const before = box();
      document.querySelector('[title^="이미지 자동 정렬"]').click();
      await wait(500);
      return { before, after: box(), toast: document.querySelector(".Toast")?.innerText, title: document.title };`,
  });
  server2.close();
  const placed = r.result?.after || [];
  const overlapping = placed.some((a, i) => placed.some((b, j) => i !== j && a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]));
  check("자동 정렬 후 이미지가 겹치지 않는다", placed.length === 3 && !overlapping, JSON.stringify(placed));
  check("자동 정렬 전에는 겹쳐 있었다 (시험 조건)", new Set((r.result?.before || []).map(String)).size === 1);

  dir = profile("p14");
  // 다른 프로그램 입장에서 클립보드에 이미지가 보이는지 Windows 쪽에서 직접 확인한다
  const clipTimer = setTimeout(() => {
    const ps = spawnSync("powershell", [
      "-NoProfile",
      "-STA",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; $i=[Windows.Forms.Clipboard]::GetImage(); if($i){\"$($i.Width)x$($i.Height)\"}else{'none'}",
    ]);
    externalClip = String(ps.stdout).trim();
  }, 6000);
  r = await launch({
    userData: dir,
    script: `
      // 픽셀판을 없애기 전에 저장된 보드: customData.chhPixel 이 붙은 이미지
      const raw = document.createElement("canvas");
      raw.width = raw.height = 4;
      const rc = raw.getContext("2d");
      rc.fillStyle = "#ff0000";
      rc.fillRect(0, 0, 4, 4);
      const data = raw.toDataURL("image/png");
      api.addFiles([{ id: "oldpx", dataURL: data, mimeType: "image/png", created: 1 }]);
      const base = ${JSON.stringify({ ...rect("__p"), type: "image", fileId: "oldpx", status: "saved", scale: [1, 1], crop: null })};
      api.updateScene({
        elements: [{ ...base, id: "pix", customData: { chhPixel: { w: 4, h: 4, data } } }],
        appState: { selectedElementIds: { pix: true } },
      });
      await wait(400);
      hoverCanvas();
      await window.chh.testCopy();
      await wait(900);
      const clip = await window.chh.testClipboardImage();
      const keptText = clip.text.includes("excalidraw/clipboard");
      await wait(3000); // 이 사이에 바깥에서 Windows 클립보드를 조회한다
      hoverCanvas();
      await window.chh.testPaste(null);
      await wait(1000);
      const els = api.getSceneElements();
      return { keptText, n: els.length, kept: !!els.find((e) => e.id === "pix").customData?.chhPixel, editing: document.body.className };`,
  });
  clearTimeout(clipTimer);
  check("다른 프로그램에서 클립보드 이미지가 보인다", /^\d+x\d+$/.test(externalClip), externalClip);
  check("복사 후에도 보드 안 붙여넣기용 글자가 남는다", r.result?.keptText === true);
  check("복사한 이미지를 보드에 붙여넣으면 요소 그대로 들어온다", r.result?.n === 2, String(r.result?.n));
  check("예전 픽셀판은 일반 이미지로 남는다", r.result?.kept === true, JSON.stringify(r.result));

  // 9. 실제 큰 보드 (선택)
  const big = process.argv[2];
  if (big && fs.existsSync(big)) {
    console.log("\n[9] 큰 보드");
    const copy = path.join(work, "큰 보드.chh");
    fs.copyFileSync(big, copy);
    const expected = readJson(copy);
    dir = profile("p12");
    r = await launch({
      userData: dir,
      args: [copy],
      delay: 6000,
      script: `
        const a = state();
        const files = Object.keys(api.getFiles()).length;
        const t0 = performance.now();
        JSON.stringify({ e: api.getSceneElements(), f: api.getFiles() }, null, 2);
        const serializeMs = Math.round(performance.now() - t0);
        addRect("big-new");
        await wait(100);
        const b = state();
        key("s", { ctrlKey: true });
        await wait(6000);
        return { a, b, c: state(), files, serializeMs };`,
    });
    const liveCount = expected.elements.filter((e) => !e.isDeleted).length;
    check("큰 보드가 변경 없음으로 열린다", r.result && !r.result.a.title.includes("•") && r.result.a.n === liveCount, JSON.stringify(r.result?.a));
    check("이미지 파일이 모두 있다", r.result?.files === Object.keys(expected.files).length, `${r.result?.files}개`);
    check("저장 후 변경 표시가 사라진다", r.result && !r.result.c.title.includes("•"), r.result?.c.title);
    const saved = readJson(copy);
    check("저장본에 새 요소와 이미지가 그대로 있다", saved.elements.filter((e) => !e.isDeleted).length === liveCount + 1 && Object.keys(saved.files).length === Object.keys(expected.files).length);
    check("바로 저장하면 자동 저장본을 따로 쓰지 않는다", !fs.existsSync(path.join(dir, "autosave.chh")));
    console.log(`       참고: 보드 전체 직렬화 약 ${r.result?.serializeMs}ms`);
  }

  fs.rmSync(work, { recursive: true, force: true });
  console.log(failed ? `\n실패 ${failed}건` : "\n모두 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
