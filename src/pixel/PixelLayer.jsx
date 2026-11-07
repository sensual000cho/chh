import { useCallback, useEffect, useRef, useState } from "react";
import { sceneCoordsToViewportCoords, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import ColorPicker from "../ColorPicker.jsx";
import { hexToRgb } from "../color.js";
import {
  CHECKER_COLORS,
  SCALES,
  boardAt,
  checkerTile,
  clampSize,
  commitBoard,
  exportDataURL,
  fitExportScale,
  flatten,
  isPixelBoard,
  loadLayers,
  loadRaw,
  MAX_SIZE,
  newCanvas,
  pickSceneColor,
  pixelInfo,
} from "./board.js";
import { bresenham, fillData, inRect, mirrorStamps, normalizeRect, rectFilled, rectOutline } from "./tools.js";

const chh = window.chh;

const TOOLS = [
  { id: "brush", label: "브러시", key: "b", hint: "브러시 (B)" },
  { id: "eraser", label: "지우개", key: "e", hint: "지우개 (E)" },
  { id: "picker", label: "스포이드", key: "i", hint: "스포이드 (I, Alt+클릭). 판 밖의 레퍼런스 이미지에서도 색을 가져옵니다" },
  { id: "fill", label: "채우기", key: "g", hint: "채우기 (G)" },
  { id: "line", label: "직선", key: "l", hint: "직선 (L)" },
  { id: "rect", label: "사각형", key: "r", hint: "사각형 (R). Shift를 누르면 속을 채웁니다" },
  { id: "select", label: "선택", key: "m", hint: "선택 (M). 드래그로 영역을 잡고, 안쪽을 끌면 이동, Delete로 지우기" },
];
const PALETTE = [
  "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
];
const RECENT_KEY = "chh.pixel.recent";
const UNDO_LIMIT = 40;
const MAX_LAYERS = 16;
const COMMIT_DELAY = 300; // 마지막 획 후 이만큼 지나면 Excalidraw 요소에 반영 (ms)

// 되돌리기/스포이드/채우기가 픽셀을 자주 읽으므로 CPU 쪽 캔버스로 만든다
const ctx2d = (c) => c.getContext("2d", { willReadFrequently: true });

const uid = () => Math.random().toString(36).slice(2, 10);

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

// 픽셀판 가로/세로 입력칸: Enter 나 포커스를 뺄 때 적용, Esc 는 취소
function SizeInput({ value, onCommit, title }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const apply = () => {
    const v = clampSize(text);
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className="px-size"
      type="number"
      min="1"
      max={MAX_SIZE}
      value={text}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setText(String(value));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const isTyping = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function makeLayer({ id, name, visible }, w, h) {
  const canvas = newCanvas(w, h);
  return { id, name, visible, canvas, ctx: ctx2d(canvas), snap: null };
}

// ImageData 하나의 PNG 는 내용이 안 바뀌는 한 다시 만들지 않는다
const pngCache = new WeakMap();
function imgToCanvas(img) {
  const c = newCanvas(img.width, img.height);
  c.getContext("2d").putImageData(img, 0, 0);
  return c;
}
function imgToPng(img) {
  let url = pngCache.get(img);
  if (!url) {
    url = imgToCanvas(img).toDataURL("image/png");
    pngCache.set(img, url);
  }
  return url;
}

export default function PixelLayer({ api, hidden, autoEdit, onAutoEditDone, flushRef }) {
  const [view, setView] = useState(null);
  const [board, setBoard] = useState(null); // 선택된 픽셀판 요소
  const [editingId, setEditingId] = useState(null);
  const [tool, setToolState] = useState("brush");
  const [size, setSize] = useState(1);
  const [color, setColor] = useState("#ff004d");
  const [grid, setGrid] = useState(true);
  const [recent, setRecent] = useState(loadRecent);
  const [colorOpen, setColorOpen] = useState(false);
  const [hover, setHover] = useState(null);
  const [stack, setStack] = useState({ undo: 0, redo: 0 });
  const [exportScale, setExportScale] = useState(8);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layerInfo, setLayerInfo] = useState({ list: [], active: 0 });
  const [sel, setSelState] = useState(null); // 선택 영역 (픽셀 좌표)
  const [panReady, setPanReady] = useState(false); // 스페이스를 누르고 있는 동안

  const canvasRef = useRef(null); // 화면에 보이는 합성 결과
  const previewRef = useRef(null); // 직선/사각형 미리보기, 옮기는 중인 선택 영역
  const layersRef = useRef([]); // [{ id, name, visible, canvas, ctx, snap }]
  const activeRef = useRef(0);
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const drawing = useRef(null); // 지금 하고 있는 드래그 동작
  const panRef = useRef(null);
  const spaceRef = useRef(false);
  const selRef = useRef(null);
  const floatRef = useRef(null); // 들어 올린 선택 영역의 픽셀
  const ready = useRef(false);
  const editIdRef = useRef(null); // 그리기를 끝낸 뒤에도 남은 변경을 어느 판에 넣을지 기억한다
  const compositeFrame = useRef(0);
  const live = useRef({});
  live.current = { tool, size, color, board, editingId, colorOpen, mirrorX, mirrorY };

  const setSel = (r) => {
    selRef.current = r;
    setSelState(r);
  };

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
    setExportScale(fitExportScale(w, h));
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

  const syncStack = () => setStack({ undo: undoRef.current.length, redo: redoRef.current.length });
  const syncLayers = () =>
    setLayerInfo({
      list: layersRef.current.map(({ id, name, visible }) => ({ id, name, visible })),
      active: activeRef.current,
    });

  const composite = useCallback(() => {
    if (compositeFrame.current) cancelAnimationFrame(compositeFrame.current);
    compositeFrame.current = 0;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, c.width, c.height);
    for (const l of layersRef.current) if (l.visible) ctx.drawImage(l.canvas, 0, 0);
  }, []);

  const requestComposite = () => {
    if (!compositeFrame.current) compositeFrame.current = requestAnimationFrame(composite);
  };

  // ---- 그리기 모드: 레이어 불러오기 (판 크기가 바뀌어도 다시 불러온다) ----
  const boardDims = board ? `${pixelInfo(board).w}x${pixelInfo(board).h}` : "";
  useEffect(() => {
    if (!editingId || !api) return;
    ready.current = false;
    undoRef.current = [];
    redoRef.current = [];
    syncStack();
    const el = api.getSceneElements().find((e) => e.id === editingId);
    if (!el) return;
    const info = pixelInfo(el);
    editIdRef.current = editingId;
    let cancelled = false;
    loadLayers(info).then((loaded) => {
      if (cancelled) return;
      layersRef.current = loaded.map((l) => {
        const layer = makeLayer(l, info.w, info.h);
        layer.ctx.drawImage(l.canvas, 0, 0);
        return layer;
      });
      activeRef.current = Math.max(0, layersRef.current.length - 1);
      syncLayers();
      composite();
      ready.current = true;
    });
    return () => {
      cancelled = true;
      ready.current = false;
    };
  }, [editingId, api, boardDims, composite]);

  // ---- 되돌리기 기록: 레이어별 ImageData 를 찍어 둔다. 안 바뀐 레이어는 같은 ImageData 를 함께 쓴다 ----
  const snapshot = useCallback(() => {
    const list = layersRef.current;
    return {
      active: activeRef.current,
      layers: list.map((l) => {
        if (!l.snap) l.snap = l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height);
        return { id: l.id, name: l.name, visible: l.visible, img: l.snap };
      }),
    };
  }, []);

  const restore = useCallback(
    (snap) => {
      layersRef.current = snap.layers.map((s) => {
        const l = makeLayer(s, s.img.width, s.img.height);
        l.ctx.putImageData(s.img, 0, 0);
        l.snap = s.img;
        return l;
      });
      activeRef.current = snap.active;
      syncLayers();
      composite();
    },
    [composite],
  );

  const activeLayer = () => layersRef.current[activeRef.current];

  // 변경 직전에 호출한다. 이후 활성 레이어의 snap 은 무효가 된다.
  const pushUndo = useCallback(() => {
    undoRef.current.push(snapshot());
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    syncStack();
    const l = layersRef.current[activeRef.current];
    if (l) l.snap = null;
  }, [snapshot]);

  // 획마다 PNG 를 인코딩하면 느리므로, 마지막 획 뒤에 한 번만 요소에 반영한다.
  // 대기 중인 픽셀은 스냅샷으로 따로 보관해서 그리기가 끝나도 잃지 않는다.
  const pendingRef = useRef(null); // { id, snap }
  const commitTimer = useRef(0);

  const flushCommit = useCallback(() => {
    clearTimeout(commitTimer.current);
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!p || !api || !p.snap.layers.length) return;
    const { width: w, height: h } = p.snap.layers[0].img;
    const raw = flatten(
      p.snap.layers.map((l) => ({ visible: l.visible, canvas: imgToCanvas(l.img) })),
      w,
      h,
    );
    const meta = p.snap.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, data: imgToPng(l.img) }));
    commitBoard(api, p.id, raw, meta);
  }, [api]);

  const commit = useCallback(() => {
    const id = editIdRef.current;
    if (!id || !layersRef.current.length) return;
    pendingRef.current = { id, snap: snapshot() };
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(flushCommit, COMMIT_DELAY);
  }, [flushCommit, snapshot]);

  const clearPreview = () => {
    const p = previewRef.current;
    if (p) ctx2d(p).clearRect(0, 0, p.width, p.height);
  };

  // 옮기던 선택 영역을 레이어에 내려놓는다
  const dropFloat = useCallback(() => {
    const f = floatRef.current;
    if (!f) return;
    floatRef.current = null;
    const l = layersRef.current[activeRef.current];
    const r = selRef.current;
    if (l && r) {
      l.ctx.drawImage(f, r.x, r.y);
      l.snap = null;
    }
    clearPreview();
    composite();
    commit();
  }, [commit, composite]);

  const flushAll = useCallback(() => {
    dropFloat();
    flushCommit();
  }, [dropFloat, flushCommit]);

  // 저장·닫기 직전에 App 이 호출한다
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flushAll;
    return () => {
      flushRef.current = null;
    };
  }, [flushRef, flushAll]);

  // 그리기 모드를 끝내거나 판이 바뀌거나 사라질 때 남은 변경을 반영한다
  useEffect(() => {
    if (!editingId) return;
    return () => {
      flushAll();
      setSel(null);
      spaceRef.current = false;
      setPanReady(false);
    };
  }, [editingId, flushAll]);

  const setTool = useCallback(
    (t) => {
      if (live.current.tool === "select" && t !== "select") {
        dropFloat();
        setSel(null);
      }
      live.current.tool = t;
      setToolState(t);
    },
    [dropFloat],
  );

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

  // 브러시 크기와 대칭을 적용해 한 점을 찍는다
  const stamp = (ctx, x, y, erase) => {
    const { size: s, color: col, mirrorX: mx, mirrorY: my } = live.current;
    const c = canvasRef.current;
    const o = Math.floor(s / 2);
    if (!erase) ctx.fillStyle = col;
    for (const [lx, ly] of mirrorStamps(x - o, y - o, s, c.width, c.height, mx, my)) {
      if (erase) ctx.clearRect(lx, ly, s, s);
      else ctx.fillRect(lx, ly, s, s);
    }
  };

  const drawShape = (ctx, d) => {
    const fn = (x, y) => stamp(ctx, x, y, false);
    if (d.mode === "line") bresenham(d.start.x, d.start.y, d.end.x, d.end.y, fn);
    else if (d.shift) rectFilled(d.start, d.end, fn);
    else rectOutline(d.start, d.end, fn);
  };

  const drawPreview = () => {
    const p = previewRef.current;
    if (!p) return;
    const ctx = ctx2d(p);
    ctx.clearRect(0, 0, p.width, p.height);
    const d = drawing.current;
    if (d?.mode === "line" || d?.mode === "rect") drawShape(ctx, d);
    if (floatRef.current && selRef.current) ctx.drawImage(floatRef.current, selRef.current.x, selRef.current.y);
  };

  const clampPt = (p, c) => ({
    x: Math.max(-64, Math.min(c.width + 64, p.x)),
    y: Math.max(-64, Math.min(c.height + 64, p.y)),
  });

  const pickColor = (x, y) => {
    const c = canvasRef.current;
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    composite();
    const [r, g, b, a] = ctx2d(c).getImageData(x, y, 1, 1).data;
    if (a === 0) {
      setTool("eraser");
      return;
    }
    const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    setColor(hex);
    const t = live.current.tool;
    if (t === "eraser" || t === "picker") setTool("brush");
  };

  const liftSelection = () => {
    if (floatRef.current) return;
    const r = selRef.current;
    const l = activeLayer();
    pushUndo();
    const f = newCanvas(r.w, r.h);
    f.getContext("2d").drawImage(l.canvas, -r.x, -r.y);
    l.ctx.clearRect(r.x, r.y, r.w, r.h);
    floatRef.current = f;
    composite();
  };

  const deleteSelection = () => {
    const r = selRef.current;
    if (!r) return;
    if (floatRef.current) {
      floatRef.current = null;
      clearPreview();
    } else {
      pushUndo();
      activeLayer().ctx.clearRect(r.x, r.y, r.w, r.h);
    }
    composite();
    setSel(null);
    commit();
  };

  const onPointerDown = (e) => {
    const c = canvasRef.current;
    // 가운데 버튼 또는 스페이스+드래그: 화면 이동
    if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      const s = api.getAppState();
      panRef.current = { x: e.clientX, y: e.clientY, scrollX: s.scrollX, scrollY: s.scrollY, zoom: s.zoom.value };
      return;
    }
    if (e.button !== 0 || !ready.current) return;
    e.preventDefault();
    c.setPointerCapture(e.pointerId);
    setColorOpen(false);
    const p = toPixel(e.clientX, e.clientY);
    const { tool: t } = live.current;
    if (e.altKey || t === "picker") {
      pickColor(p.x, p.y);
      return;
    }
    const layer = activeLayer();
    if (!layer) return;
    if (!layer.visible) {
      api.setToast({ message: "숨긴 레이어에는 그릴 수 없습니다.", duration: 2000 });
      return;
    }
    if (t === "select") {
      if (inRect(selRef.current, p)) {
        liftSelection();
        const r = selRef.current;
        drawing.current = { mode: "sel-move", dx: p.x - r.x, dy: p.y - r.y };
        drawPreview();
      } else {
        dropFloat();
        setSel(null);
        drawing.current = { mode: "sel-new", start: p };
      }
      return;
    }
    if (t === "fill") {
      const rgb = hexToRgb(live.current.color) || [0, 0, 0];
      const before = snapshot();
      const { width: w, height: h } = layer.canvas;
      const img = new ImageData(new Uint8ClampedArray(layer.snap.data), w, h);
      let n = fillData(img.data, w, h, p.x, p.y, rgb);
      const { mirrorX: mx, mirrorY: my } = live.current;
      for (const [ax, ay] of mirrorStamps(p.x, p.y, 1, w, h, mx, my).slice(1)) {
        n += fillData(img.data, w, h, ax, ay, rgb);
      }
      if (n) {
        undoRef.current.push(before);
        if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
        redoRef.current = [];
        syncStack();
        layer.ctx.putImageData(img, 0, 0);
        layer.snap = null;
        composite();
        pushRecent(live.current.color);
        commit();
      }
      return;
    }
    if (t === "line" || t === "rect") {
      drawing.current = { mode: t, start: p, end: p, shift: e.shiftKey };
      drawPreview();
      return;
    }
    pushUndo();
    drawing.current = { mode: "stroke", last: p, erase: t === "eraser" };
    stamp(layer.ctx, p.x, p.y, t === "eraser");
    composite();
  };

  const onPointerMove = (e) => {
    if (panRef.current) {
      const pan = panRef.current;
      api.updateScene({
        appState: {
          scrollX: pan.scrollX + (e.clientX - pan.x) / pan.zoom,
          scrollY: pan.scrollY + (e.clientY - pan.y) / pan.zoom,
        },
      });
      return;
    }
    const d = drawing.current;
    if (!d) return;
    const c = canvasRef.current;
    if (d.mode === "stroke") {
      const layer = activeLayer();
      const evs = e.nativeEvent.getCoalescedEvents?.();
      for (const ev of evs?.length ? evs : [e.nativeEvent]) {
        const p = clampPt(toPixel(ev.clientX, ev.clientY), c);
        const l = clampPt(d.last, c);
        bresenham(l.x, l.y, p.x, p.y, (x, y) => stamp(layer.ctx, x, y, d.erase));
        d.last = p;
      }
      requestComposite();
      return;
    }
    const p = clampPt(toPixel(e.clientX, e.clientY), c);
    if (d.mode === "line" || d.mode === "rect") {
      d.end = p;
      d.shift = e.shiftKey;
      drawPreview();
    } else if (d.mode === "sel-new") {
      setSel(normalizeRect(d.start, p, c.width, c.height));
    } else if (d.mode === "sel-move") {
      const r = selRef.current;
      setSel({ ...r, x: p.x - d.dx, y: p.y - d.dy });
      drawPreview();
    }
  };

  const endStroke = () => {
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    const d = drawing.current;
    if (!d) return;
    drawing.current = null;
    if (d.mode === "line" || d.mode === "rect") {
      pushUndo();
      drawShape(activeLayer().ctx, d);
      clearPreview();
      composite();
      pushRecent(live.current.color);
      commit();
    } else if (d.mode === "stroke") {
      composite();
      if (!d.erase) pushRecent(live.current.color);
      commit();
    }
    // 선택 영역은 내려놓을 때 반영한다 (dropFloat)
  };

  const undo = useCallback(() => {
    if (!layersRef.current.length || !undoRef.current.length) return;
    const lifted = !!floatRef.current;
    floatRef.current = null;
    clearPreview();
    setSel(null);
    // 들어 올린 상태는 다시 실행으로 되돌아올 수 없으므로 기록하지 않는다
    if (!lifted) redoRef.current.push(snapshot());
    restore(undoRef.current.pop());
    syncStack();
    commit();
  }, [commit, restore, snapshot]);

  const redo = useCallback(() => {
    if (!layersRef.current.length || !redoRef.current.length) return;
    dropFloat();
    setSel(null);
    undoRef.current.push(snapshot());
    restore(redoRef.current.pop());
    syncStack();
    commit();
  }, [commit, dropFloat, restore, snapshot]);

  // ---- 레이어 조작 ----
  const changeLayers = (fn) => {
    dropFloat();
    pushUndo();
    fn();
    syncLayers();
    composite();
    commit();
  };
  const addLayer = () => {
    if (layersRef.current.length >= MAX_LAYERS) {
      api.setToast({ message: `레이어는 ${MAX_LAYERS}개까지 만들 수 있습니다.`, duration: 2000 });
      return;
    }
    changeLayers(() => {
      const first = layersRef.current[0].canvas;
      const name = `레이어 ${layersRef.current.length + 1}`;
      const layer = makeLayer({ id: uid(), name, visible: true }, first.width, first.height);
      layersRef.current = [...layersRef.current];
      layersRef.current.splice(activeRef.current + 1, 0, layer);
      activeRef.current += 1;
    });
  };
  const removeLayer = () => {
    if (layersRef.current.length < 2) return;
    changeLayers(() => {
      layersRef.current = layersRef.current.filter((_, i) => i !== activeRef.current);
      activeRef.current = Math.min(activeRef.current, layersRef.current.length - 1);
    });
  };
  const moveLayer = (delta) => {
    const i = activeRef.current;
    const j = i + delta;
    if (j < 0 || j >= layersRef.current.length) return;
    changeLayers(() => {
      const list = [...layersRef.current];
      [list[i], list[j]] = [list[j], list[i]];
      layersRef.current = list;
      activeRef.current = j;
    });
  };
  const mergeDown = () => {
    const i = activeRef.current;
    if (i < 1) return;
    changeLayers(() => {
      const upper = layersRef.current[i];
      const lower = layersRef.current[i - 1];
      lower.ctx.drawImage(upper.canvas, 0, 0);
      lower.snap = null;
      layersRef.current = layersRef.current.filter((_, k) => k !== i);
      activeRef.current = i - 1;
    });
  };
  const toggleLayer = (index) =>
    changeLayers(() => {
      const l = layersRef.current[index];
      l.visible = !l.visible;
    });
  const renameLayer = (index, name) => {
    const l = layersRef.current[index];
    if (!l || !name.trim() || name === l.name) return;
    l.name = name.trim();
    syncLayers();
    commit();
  };
  const selectLayer = (index) => {
    dropFloat();
    setSel(null);
    activeRef.current = index;
    syncLayers();
  };

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

  // ---- 키보드 (그리기 모드일 때만): Excalidraw 단축키는 모두 막는다 (Delete 로 판이 지워지거나 R 로 그리기가 풀리지 않도록) ----
  useEffect(() => {
    if (!editingId) return;
    const onKey = (e) => {
      if (isTyping(e.target)) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const k = e.key.toLowerCase();
      if (e.key === " ") {
        stop();
        spaceRef.current = true;
        setPanReady(true);
        return;
      }
      if (e.key === "Escape") {
        stop();
        if (live.current.colorOpen) setColorOpen(false);
        else if (selRef.current) {
          dropFloat();
          setSel(null);
        } else setEditingId(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (k === "z") {
          stop();
          if (e.shiftKey) redo();
          else undo();
        } else if (k === "y") {
          stop();
          redo();
        } else if (k === "a") {
          stop();
          const c = canvasRef.current;
          if (c && live.current.tool === "select") {
            dropFloat();
            setSel({ x: 0, y: 0, w: c.width, h: c.height });
          }
        } else if (!["s", "n", "o", "=", "+", "-", "0"].includes(k)) {
          e.stopImmediatePropagation(); // 복사·붙여넣기 등 Excalidraw 동작을 막는다
        }
        return; // 저장·열기·확대 단축키는 App / Excalidraw 로 넘긴다
      }
      if (e.key === "Tab" || /^F\d+$/.test(e.key)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.stopImmediatePropagation();
        return;
      }
      const tl = TOOLS.find((t) => t.key === k);
      if (tl) {
        stop();
        setTool(tl.id);
      } else if (e.key === "[" || e.key === "]") {
        stop();
        const next = Math.max(1, Math.min(16, live.current.size + (e.key === "]" ? 1 : -1)));
        live.current.size = next;
        setSize(next);
      } else if (k === "x") {
        stop();
        setMirrorX((v) => !v);
      } else if (k === "y") {
        stop();
        setMirrorY((v) => !v);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        stop();
        deleteSelection();
      } else if (e.key === "Enter") {
        stop();
        dropFloat();
      } else {
        stop();
      }
    };
    const onKeyUp = (e) => {
      if (e.key === " ") {
        spaceRef.current = false;
        setPanReady(false);
      }
    };
    // 복사/붙여넣기 이벤트가 보드로 넘어가면 판 선택이 풀린다
    const blockClipboard = (e) => {
      if (!isTyping(e.target)) e.stopImmediatePropagation();
    };
    // 스포이드: 판 밖을 누르면 그리기를 끝내는 대신 화면에 보이는 색을 가져온다
    const onDown = (e) => {
      if (e.button !== 0 || !(live.current.tool === "picker" || e.altKey)) return;
      if (e.target?.tagName !== "CANVAS" || e.target === canvasRef.current) return;
      const hex = pickSceneColor(e.clientX, e.clientY);
      if (!hex) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setColor(hex);
      if (live.current.tool === "picker") setTool("brush");
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("copy", blockClipboard, true);
    window.addEventListener("cut", blockClipboard, true);
    window.addEventListener("paste", blockClipboard, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("copy", blockClipboard, true);
      window.removeEventListener("cut", blockClipboard, true);
      window.removeEventListener("paste", blockClipboard, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
    // deleteSelection 은 ref 만 쓰므로 매번 다시 붙일 필요가 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, undo, redo, dropFloat, setTool]);

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

  // ---- 판 크기 바꾸기: 기존 그림은 왼쪽 위에 그대로 두고 잘라내거나 투명하게 늘린다 ----
  const resize = async (nw, nh) => {
    flushAll();
    const el = api.getSceneElements().find((e) => e.id === board?.id);
    if (!el) return;
    const info = pixelInfo(el);
    if (nw === info.w && nh === info.h) return;
    const loaded = await loadLayers(info);
    const resized = loaded.map((l) => {
      const canvas = newCanvas(nw, nh);
      canvas.getContext("2d").drawImage(l.canvas, 0, 0);
      return { ...l, canvas };
    });
    const meta = resized.map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      data: l.canvas.toDataURL("image/png"),
    }));
    commitBoard(api, el.id, flatten(resized, nw, nh), meta);
  };

  // ---- 내보내기 ----
  const doExport = async () => {
    flushAll();
    const el = api.getSceneElements().find((e) => e.id === board?.id);
    if (!el) return;
    const { w, h, data } = pixelInfo(el);
    const dataURL = exportDataURL(await loadRaw(data, w, h), exportScale);
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
    const cellH = cssH / h;
    const tile = checkerTile(w, h) * cell;
    const [A, B] = CHECKER_COLORS;
    const cursor = panReady ? "grab" : tool === "picker" ? "copy" : "crosshair";
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
            cursor,
            backgroundImage: `conic-gradient(${A} 25%, ${B} 0 50%, ${A} 0 75%, ${B} 0)`,
            backgroundSize: `${tile * 2}px ${tile * 2}px`,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onContextMenu={(e) => e.preventDefault()}
        />
        <canvas ref={previewRef} width={w} height={h} className="px-preview" />
        {grid && cell >= 6 && (
          <div className="px-grid" style={{ backgroundSize: `${cell}px ${cellH}px` }} />
        )}
        {sel && (
          <div
            className="px-sel"
            style={{ left: sel.x * cell, top: sel.y * cellH, width: sel.w * cell, height: sel.h * cellH }}
          />
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
            <ColorPicker value={color} onChange={setColor} />
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
        {layersOpen && editing && (
          <div className="px-layers">
            {layerInfo.list
              .map((l, i) => ({ l, i }))
              .reverse()
              .map(({ l, i }) => (
                <div
                  key={l.id}
                  className={`px-layer-row${i === layerInfo.active ? " on" : ""}`}
                  onClick={() => selectLayer(i)}
                >
                  <button
                    className={`px-layer-eye${l.visible ? "" : " off"}`}
                    title={l.visible ? "레이어 숨기기" : "레이어 보이기"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayer(i);
                    }}
                  >
                    ◉
                  </button>
                  <input
                    className="px-layer-name"
                    defaultValue={l.name}
                    key={l.name}
                    spellCheck={false}
                    onBlur={(e) => renameLayer(i, e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                  />
                </div>
              ))}
            <div className="px-layer-tools">
              <button className="px-btn" onClick={addLayer} title="새 레이어">추가</button>
              <button className="px-btn" onClick={removeLayer} disabled={layerInfo.list.length < 2} title="이 레이어 지우기">삭제</button>
              <button className="px-btn" onClick={() => moveLayer(1)} disabled={layerInfo.active >= layerInfo.list.length - 1} title="위로">▲</button>
              <button className="px-btn" onClick={() => moveLayer(-1)} disabled={layerInfo.active < 1} title="아래로">▼</button>
              <button className="px-btn" onClick={mergeDown} disabled={layerInfo.active < 1} title="아래 레이어와 합치기">합치기</button>
            </div>
          </div>
        )}
        <div className="px-bar">
          <span className="px-info">
            픽셀판
            <SizeInput value={info.w} onCommit={(v) => resize(v, info.h)} title="가로 픽셀 수 (Enter로 적용)" />
            ×
            <SizeInput value={info.h} onCommit={(v) => resize(info.w, v)} title="세로 픽셀 수 (Enter로 적용)" />
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
                  title={t.hint}
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
              <button className={`px-btn${mirrorX ? " on" : ""}`} onClick={() => setMirrorX((v) => !v)} title="좌우 대칭 (X)">
                좌우
              </button>
              <button className={`px-btn${mirrorY ? " on" : ""}`} onClick={() => setMirrorY((v) => !v)} title="상하 대칭 (Y)">
                상하
              </button>
              <button className={`px-btn${layersOpen ? " on" : ""}`} onClick={() => setLayersOpen((v) => !v)} title="레이어 패널">
                레이어
              </button>
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
