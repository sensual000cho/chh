import { useCallback, useEffect, useRef, useState } from "react";
import { sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import ColorWheel from "../ColorWheel.jsx";
import { hexToRgb } from "../color.js";
import {
  CHECKER_COLORS,
  boardAt,
  checkerTile,
  commitBoard,
  exportDataURL,
  isPixelBoard,
  loadRaw,
  newCanvas,
  pixelInfo,
} from "./board.js";

const chh = window.chh;

const TOOLS = [
  { id: "brush", label: "브러시", key: "b" },
  { id: "eraser", label: "지우개", key: "e" },
  { id: "picker", label: "스포이드", key: "i" },
  { id: "fill", label: "채우기", key: "g" },
];
const SCALES = [1, 2, 4, 8, 16, 32];
const PALETTE = [
  "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
];
const RECENT_KEY = "chh.pixel.recent";
const UNDO_LIMIT = 40;
const COMMIT_DELAY = 300; // 마지막 획 후 이만큼 지나면 Excalidraw 요소에 반영 (ms)

// 되돌리기/스포이드/채우기가 픽셀을 자주 읽으므로 CPU 쪽 캔버스로 만든다
const ctx2d = (c) => c.getContext("2d", { willReadFrequently: true });

function loadRecent() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 12) : [];
  } catch {
    return [];
  }
}

const sameBoard = (a, b) =>
  a === b ||
  (!!a &&
    !!b &&
    a.id === b.id &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.angle === b.angle &&
    a.fileId === b.fileId);

function bresenham(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// 4방향 채우기. 바뀐 픽셀 수를 돌려준다.
// src(이미 읽어둔 ImageData)를 주면 캔버스에서 다시 읽지 않고 그 복사본으로 작업한다.
function floodFill(ctx, w, h, sx, sy, [r, g, b], src) {
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;
  const img = src
    ? new ImageData(new Uint8ClampedArray(src.data), w, h)
    : ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const at = (x, y) => (y * w + x) * 4;
  const i0 = at(sx, sy);
  const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  if (t[0] === r && t[1] === g && t[2] === b && t[3] === 255) return 0;
  const match = (i) => d[i] === t[0] && d[i + 1] === t[1] && d[i + 2] === t[2] && d[i + 3] === t[3];
  const stack = [sx, sy];
  let n = 0;
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    const i = at(x, y);
    if (!match(i)) continue;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = 255;
    n++;
    if (x > 0) stack.push(x - 1, y);
    if (x < w - 1) stack.push(x + 1, y);
    if (y > 0) stack.push(x, y - 1);
    if (y < h - 1) stack.push(x, y + 1);
  }
  ctx.putImageData(img, 0, 0);
  return n;
}

const isTyping = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export default function PixelLayer({ api, hidden, autoEdit, onAutoEditDone }) {
  const [view, setView] = useState(null);
  const [board, setBoard] = useState(null); // 선택된 픽셀판 요소
  const [editingId, setEditingId] = useState(null);
  const [tool, setTool] = useState("brush");
  const [size, setSize] = useState(1);
  const [color, setColor] = useState("#ff004d");
  const [grid, setGrid] = useState(true);
  const [recent, setRecent] = useState(loadRecent);
  const [colorOpen, setColorOpen] = useState(false);
  const [hover, setHover] = useState(null);
  const [stack, setStack] = useState({ undo: 0, redo: 0 });
  const [exportScale, setExportScale] = useState(8);

  const canvasRef = useRef(null);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const drawing = useRef(null);
  const ready = useRef(false);
  const live = useRef({});
  live.current = { tool, size, color, board, editingId, colorOpen };

  // ---- Excalidraw 상태 구독: 화면 이동/확대, 선택된 픽셀판 ----
  useEffect(() => {
    if (!api) return;
    const apply = (elements, s) => {
      const n = {
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        zoom: s.zoom,
        offsetLeft: s.offsetLeft,
        offsetTop: s.offsetTop,
        width: s.width,
        height: s.height,
      };
      setView((p) =>
        p &&
        p.scrollX === n.scrollX &&
        p.scrollY === n.scrollY &&
        p.zoom.value === n.zoom.value &&
        p.offsetLeft === n.offsetLeft &&
        p.offsetTop === n.offsetTop &&
        p.width === n.width &&
        p.height === n.height
          ? p
          : n,
      );
      const ids = Object.keys(s.selectedElementIds || {});
      let next = null;
      if (ids.length === 1) {
        const e = elements.find((x) => x.id === ids[0]);
        if (isPixelBoard(e)) next = e;
      }
      setBoard((p) => (sameBoard(p, next) ? p : next));
    };
    apply(api.getSceneElements(), api.getAppState());
    return api.onChange(apply);
  }, [api]);

  // 다른 걸 선택하거나 판이 사라지면 그리기 모드 종료
  useEffect(() => {
    if (editingId && board?.id !== editingId) setEditingId(null);
  }, [board, editingId]);

  // 판이 바뀌면 내보내기 배율 기본값: 긴 변이 512px 안에 드는 가장 큰 배율
  const boardKey = board?.id;
  useEffect(() => {
    if (!board) return;
    const { w, h } = pixelInfo(board);
    const fit = SCALES.filter((s) => Math.max(w, h) * s <= 512);
    setExportScale(fit.length ? fit[fit.length - 1] : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey]);

  const startEdit = useCallback(() => {
    if (live.current.board) {
      setColorOpen(false);
      setEditingId(live.current.board.id);
    }
  }, []);

  // 새로 만든 판은 바로 그리기 모드로
  useEffect(() => {
    if (autoEdit && board && board.id === autoEdit.id) {
      startEdit();
      onAutoEditDone?.();
    }
  }, [autoEdit, board, startEdit, onAutoEditDone]);

  // 픽셀판을 선택한 동안엔 Excalidraw 의 "이미지 자르기" 안내 문구를 숨긴다
  useEffect(() => {
    document.body.classList.toggle("px-board-selected", !!board);
    return () => document.body.classList.remove("px-board-selected");
  }, [board]);

  useEffect(() => {
    document.body.classList.toggle("px-editing", !!editingId);
    return () => document.body.classList.remove("px-editing");
  }, [editingId]);

  // 선택한 픽셀판에서 Enter / 더블클릭 = 그리기 시작 (Excalidraw 기본 동작은 이미지 자르기라 판이 깨진다)
  useEffect(() => {
    if (!board || editingId) return;
    const onKey = (e) => {
      if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey || isTyping(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      startEdit();
    };
    const onDbl = (e) => {
      if (!(e.target instanceof Element) || e.target.tagName !== "CANVAS") return;
      const sc = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const hit = boardAt(api.getSceneElements(), sc.x, sc.y);
      if (!hit || hit.el.id !== board.id) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      startEdit();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("dblclick", onDbl, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("dblclick", onDbl, true);
    };
  }, [api, board, editingId, startEdit]);

  // ---- 그리기 모드: 픽셀 버퍼 불러오기 ----
  useEffect(() => {
    if (!editingId || !api) return;
    ready.current = false;
    undoRef.current = [];
    redoRef.current = [];
    setStack({ undo: 0, redo: 0 });
    const el = api.getSceneElements().find((e) => e.id === editingId);
    if (!el) return;
    const { w, h, data } = pixelInfo(el);
    let cancelled = false;
    loadRaw(data, w, h).then((raw) => {
      const c = canvasRef.current;
      if (cancelled || !c) return;
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(raw, 0, 0);
      ready.current = true;
    });
    return () => {
      cancelled = true;
      ready.current = false;
    };
  }, [editingId, api]);

  const syncStack = () => setStack({ undo: undoRef.current.length, redo: redoRef.current.length });

  // 획마다 PNG 를 두 번 인코딩하면 느리므로, 마지막 획 뒤에 한 번만 요소에 반영한다.
  // 대기 중인 픽셀은 ImageData 로 따로 보관해서 캔버스가 사라져도 잃지 않는다.
  const pendingRef = useRef(null); // { id, img }
  const commitTimer = useRef(0);

  const flushCommit = useCallback(() => {
    clearTimeout(commitTimer.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p || !api) return;
    const raw = newCanvas(p.img.width, p.img.height);
    raw.getContext("2d").putImageData(p.img, 0, 0);
    commitBoard(api, p.id, raw);
  }, [api]);

  const commit = useCallback(() => {
    const c = canvasRef.current;
    const id = live.current.editingId;
    if (!c || !id) return;
    pendingRef.current = { id, img: ctx2d(c).getImageData(0, 0, c.width, c.height) };
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(flushCommit, COMMIT_DELAY);
  }, [flushCommit]);

  // 그리기 모드를 끝내거나 판이 바뀌거나 사라질 때 남은 변경을 반영한다
  useEffect(() => flushCommit, [editingId, flushCommit]);

  const pushRecent = useCallback((c) => {
    setRecent((prev) => {
      const next = [c, ...prev.filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 12);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // 화면 좌표 -> 픽셀 좌표 (판이 회전해 있어도 맞게)
  const toPixel = (clientX, clientY) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const a = live.current.board?.angle || 0;
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    const lx = dx * Math.cos(a) + dy * Math.sin(a);
    const ly = -dx * Math.sin(a) + dy * Math.cos(a);
    return {
      x: Math.floor(((lx + c.offsetWidth / 2) / c.offsetWidth) * c.width),
      y: Math.floor(((ly + c.offsetHeight / 2) / c.offsetHeight) * c.height),
    };
  };

  const paint = (x, y) => {
    const ctx = ctx2d(canvasRef.current);
    const { tool: t, size: s, color: col } = live.current;
    const o = Math.floor(s / 2);
    if (t === "eraser") ctx.clearRect(x - o, y - o, s, s);
    else {
      ctx.fillStyle = col;
      ctx.fillRect(x - o, y - o, s, s);
    }
  };

  const clampPt = (p, c) => ({
    x: Math.max(-64, Math.min(c.width + 64, p.x)),
    y: Math.max(-64, Math.min(c.height + 64, p.y)),
  });

  const pickColor = (x, y) => {
    const c = canvasRef.current;
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    const [r, g, b, a] = ctx2d(c).getImageData(x, y, 1, 1).data;
    if (a === 0) {
      setTool("eraser");
      return;
    }
    const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    setColor(hex);
    setTool((t) => (t === "eraser" || t === "picker" ? "brush" : t));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || !ready.current) return;
    e.preventDefault();
    const c = canvasRef.current;
    c.setPointerCapture(e.pointerId);
    setColorOpen(false);
    const p = toPixel(e.clientX, e.clientY);
    const { tool: t } = live.current;
    if (e.altKey || t === "picker") {
      pickColor(p.x, p.y);
      return;
    }
    const ctx = ctx2d(c);
    const before = ctx.getImageData(0, 0, c.width, c.height);
    if (t === "fill") {
      const rgb = hexToRgb(live.current.color) || [0, 0, 0];
      if (floodFill(ctx, c.width, c.height, p.x, p.y, rgb, before)) {
        undoRef.current.push(before);
        redoRef.current = [];
        if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
        syncStack();
        pushRecent(live.current.color);
        commit();
      }
      return;
    }
    undoRef.current.push(before);
    redoRef.current = [];
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    syncStack();
    drawing.current = { last: p };
    paint(p.x, p.y);
  };

  const onPointerMove = (e) => {
    if (!drawing.current) return;
    const c = canvasRef.current;
    const evs = e.nativeEvent.getCoalescedEvents?.();
    for (const ev of evs?.length ? evs : [e.nativeEvent]) {
      const p = clampPt(toPixel(ev.clientX, ev.clientY), c);
      const l = clampPt(drawing.current.last, c);
      bresenham(l.x, l.y, p.x, p.y, paint);
      drawing.current.last = p;
    }
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = null;
    if (live.current.tool === "brush") pushRecent(live.current.color);
    commit();
  };

  const undo = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !undoRef.current.length) return;
    const ctx = ctx2d(c);
    redoRef.current.push(ctx.getImageData(0, 0, c.width, c.height));
    ctx.putImageData(undoRef.current.pop(), 0, 0);
    syncStack();
    commit();
  }, [commit]);

  const redo = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !redoRef.current.length) return;
    const ctx = ctx2d(c);
    undoRef.current.push(ctx.getImageData(0, 0, c.width, c.height));
    ctx.putImageData(redoRef.current.pop(), 0, 0);
    syncStack();
    commit();
  }, [commit]);

  // 판 위에서의 휠(확대/이동)은 Excalidraw 캔버스로 넘긴다
  // (캔버스가 실제로 그려지는 동안에만 다시 붙이면 되므로 deps 를 둔다)
  const canvasShown = !!(editingId && board && view);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e) => {
      e.preventDefault();
      const target = document.querySelector(".excalidraw canvas.interactive");
      target?.dispatchEvent(
        new WheelEvent("wheel", {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          clientX: e.clientX,
          clientY: e.clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [canvasShown]);

  // ---- 키보드 (그리기 모드일 때만) ----
  useEffect(() => {
    if (!editingId) return;
    const onKey = (e) => {
      if (isTyping(e.target)) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === "Escape") {
        stop();
        if (live.current.colorOpen) setColorOpen(false);
        else setEditingId(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          stop();
          e.shiftKey ? redo() : undo();
        } else if (k === "y") {
          stop();
          redo();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tl = TOOLS.find((t) => t.key === e.key.toLowerCase());
      if (tl) {
        stop();
        live.current.tool = tl.id;
        setTool(tl.id);
      } else if (e.key === "[" || e.key === "]") {
        stop();
        const next = Math.max(1, Math.min(16, live.current.size + (e.key === "]" ? 1 : -1)));
        live.current.size = next;
        setSize(next);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editingId, undo, redo]);

  // ---- 마우스를 올리면 가로×세로 크기 표시 ----
  useEffect(() => {
    if (!api) return;
    let raf = 0;
    let last = null;
    const run = () => {
      raf = 0;
      const ev = last;
      const t = ev.target;
      if (!(t instanceof Element) || t.tagName !== "CANVAS") return setHover(null);
      const sc = viewportCoordsToSceneCoords({ clientX: ev.clientX, clientY: ev.clientY }, api.getAppState());
      const hit = boardAt(api.getSceneElements(), sc.x, sc.y);
      if (!hit) return setHover(null);
      const editing = live.current.editingId === hit.el.id;
      setHover({
        x: ev.clientX,
        y: ev.clientY,
        text: `${hit.w} × ${hit.h} px` + (editing ? ` · (${hit.px + 1}, ${hit.py + 1})` : ""),
      });
    };
    const onMove = (e) => {
      last = e;
      if (!raf) raf = requestAnimationFrame(run);
    };
    const onLeave = () => setHover(null);
    window.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [api]);

  // ---- 내보내기 ----
  const doExport = async () => {
    const el = api.getSceneElements().find((e) => e.id === board?.id);
    if (!el) return;
    const { w, h, data } = pixelInfo(el);
    const raw =
      editingId === el.id && canvasRef.current ? canvasRef.current : await loadRaw(data, w, h);
    const dataURL = exportDataURL(raw, exportScale);
    const name = `pixel-${w}x${h}${exportScale > 1 ? `@${exportScale}x` : ""}.png`;
    if (chh?.saveImage) {
      const res = await chh.saveImage({ defaultName: name, dataURL });
      if (res?.error) api.setToast({ message: `내보내기 실패: ${res.error}` });
      else if (res) api.setToast({ message: `내보냈습니다: ${res.path}`, duration: 3000 });
    } else {
      const a = document.createElement("a");
      a.href = dataURL;
      a.download = name;
      a.click();
    }
  };

  // ---- 렌더 ----
  let overlay = null;
  if (editingId && board && view) {
    const { w, h } = pixelInfo(board);
    const z = view.zoom.value;
    const tl = sceneCoordsToViewportCoords({ sceneX: board.x, sceneY: board.y }, view);
    const cssW = board.width * z;
    const cssH = board.height * z;
    const cell = cssW / w;
    const tile = checkerTile(w, h) * cell;
    const [A, B] = CHECKER_COLORS;
    overlay = (
      <div
        className="px-overlay"
        style={{ left: tl.x, top: tl.y, width: cssW, height: cssH, transform: `rotate(${board.angle || 0}rad)` }}
      >
        <canvas
          ref={canvasRef}
          width={w}
          height={h}
          className="px-canvas"
          style={{
            cursor: tool === "picker" ? "copy" : "crosshair",
            backgroundImage: `conic-gradient(${A} 25%, ${B} 0 50%, ${A} 0 75%, ${B} 0)`,
            backgroundSize: `${tile * 2}px ${tile * 2}px`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onContextMenu={(e) => e.preventDefault()}
        />
        {grid && cell >= 6 && (
          <div className="px-grid" style={{ backgroundSize: `${cell}px ${cell}px` }} />
        )}
      </div>
    );
  }

  const info = board ? pixelInfo(board) : null;
  const editing = !!editingId;

  const panel =
    !hidden && board && info ? (
      <div className="pxpanel" onPointerDown={(e) => e.stopPropagation()}>
        {colorOpen && editing && (
          <div className="px-colorpop">
            <ColorWheel value={color} onChange={setColor} />
            <div className="px-palette">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`px-chip${c === color.toLowerCase() ? " on" : ""}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        )}
        <div className="px-bar">
          <span className="px-info">
            픽셀판 {info.w} × {info.h}
          </span>
          {!editing ? (
            <button className="px-btn primary" onClick={startEdit} title="이 판에 그리기">
              ✎ 그리기
            </button>
          ) : (
            <>
              <span className="px-sep" />
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  className={`px-btn${tool === t.id ? " on" : ""}`}
                  onClick={() => setTool(t.id)}
                  title={`${t.label} (${t.key.toUpperCase()})`}
                >
                  {t.label}
                </button>
              ))}
              <span className="px-sep" />
              <label className="px-field" title="브러시/지우개 크기  [ ]">
                크기
                <input
                  type="range"
                  min="1"
                  max="16"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                />
                <b>{size}</b>
              </label>
              <span className="px-sep" />
              <button
                className={`px-color${colorOpen ? " on" : ""}`}
                style={{ background: color }}
                onClick={() => setColorOpen((v) => !v)}
                title="색상 선택"
              />
              {recent.slice(0, 6).map((c) => (
                <button
                  key={c}
                  className="px-chip"
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColor(c)}
                />
              ))}
              <span className="px-sep" />
              <button className={`px-btn${grid ? " on" : ""}`} onClick={() => setGrid((v) => !v)} title="격자 표시">
                격자
              </button>
              <button className="px-btn" disabled={!stack.undo} onClick={undo} title="되돌리기 (Ctrl+Z)">
                ↶
              </button>
              <button className="px-btn" disabled={!stack.redo} onClick={redo} title="다시 실행 (Ctrl+Y)">
                ↷
              </button>
            </>
          )}
          <span className="px-sep" />
          <label className="px-field">
            배율
            <select value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))}>
              {SCALES.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <span className="px-dim">
              {info.w * exportScale}×{info.h * exportScale}px
            </span>
          </label>
          <button className="px-btn" onClick={doExport} title="투명 배경 PNG로 저장">
            내보내기
          </button>
          {editing && (
            <button className="px-btn primary" onClick={() => setEditingId(null)} title="그리기 끝내기 (Esc)">
              완료
            </button>
          )}
        </div>
      </div>
    ) : null;

  return (
    <>
      {overlay}
      {panel}
      {hover && (
        <div className="px-hover" style={{ left: hover.x + 16, top: hover.y + 18 }}>
          {hover.text}
        </div>
      )}
    </>
  );
}
