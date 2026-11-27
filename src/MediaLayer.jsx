// 움직이는 GIF 와 영상을 캔버스 위에 얹어 재생한다.
// 요소 자체(위치·크기·자르기·선택·저장)는 Excalidraw 이미지 요소 그대로이고, 여기서는 화면에 보이는 것만 겹쳐 그린다.
//   아래: 그림·영상 (캔버스와 선택 테두리 사이)   위: 재생 버튼 (선택 테두리 위, 앱 UI 아래)
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exportToSvg, getCommonBounds, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { isAnimatedImage } from "./animated.js";
import { cornerRadius, cropBox, layoutMedia, visibleArea } from "./mediaScene.js";
import { directSource, videoOf } from "./videos.js";

// 캔버스가 그리지 않고 건너뛸 요소 (vite.config.js 의 패치가 읽는다)
const live = (globalThis.__chhLive ??= new Set());

// dataURL → blob: 주소. 큰 dataURL 을 매번 다시 풀지 않도록 열쇠(파일·영상 id)마다 하나만 만든다.
const blobs = new Map();
function blobUrl(key, dataURL) {
  if (!blobs.has(key)) {
    blobs.set(
      key,
      fetch(dataURL)
        .then((r) => r.blob())
        .then((b) => URL.createObjectURL(b)),
    );
  }
  return blobs.get(key);
}
function pruneBlobs(used) {
  for (const [key, promise] of blobs) {
    if (used.has(key)) continue;
    blobs.delete(key);
    promise.then(URL.revokeObjectURL, () => {});
  }
}

function useSource(key, dataURL, direct) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!dataURL) return;
    let on = true;
    blobUrl(key, dataURL).then(
      (url) => on && setSrc(url),
      () => {},
    );
    return () => {
      on = false;
    };
  }, [key, dataURL]);
  return dataURL ? src : direct;
}

function Picture({ el, file, onReady }) {
  const src = useSource(el.fileId, file?.dataURL);
  if (!src) return null;
  return <img src={src} alt="" draggable={false} style={cropBox(el)} onLoad={onReady} />;
}

function Video({ el, video, state, onReady, onFail }) {
  const ref = useRef(null);
  const src = useSource(video.id || el.id, video.data, directSource(video));
  const { muted, paused } = state;

  // 화면 밖으로 나갔다 돌아오면 보던 곳부터 잇는다
  useLayoutEffect(() => {
    const v = ref.current;
    if (!v) return;
    state.node = v;
    return () => {
      state.time = v.currentTime;
      if (state.node === v) state.node = null;
      v.pause();
    };
  }, [state, src]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    if (paused) v.pause();
    else v.play().catch(() => {});
  }, [muted, paused, src]);

  useEffect(() => {
    if (!video.data && !src) onFail();
  }, [video, src, onFail]);

  if (!src) return null;
  return (
    <video
      ref={ref}
      src={src}
      loop
      muted
      playsInline
      preload="auto"
      disablePictureInPicture
      style={cropBox(el)}
      onLoadedMetadata={(e) => {
        if (state.time) e.currentTarget.currentTime = state.time;
      }}
      onLoadedData={onReady}
      onError={onFail}
    />
  );
}

// 영상 위에 겹친 선·글자·도형을 다시 그린다
function Cover({ els, cx, cy }) {
  const ref = useRef(null);
  const key = els.map((e) => `${e.id}:${e.versionNonce}`).join();
  const pad = 20; // 선 굵기나 화살촉이 경계 밖으로 나가는 만큼
  const latest = useRef(els);
  useEffect(() => {
    latest.current = els;
  });
  useEffect(() => {
    let on = true;
    const copy = latest.current.map((e) => ({ ...e, frameId: null }));
    const [x1, y1] = getCommonBounds(copy);
    exportToSvg({
      elements: copy,
      appState: { exportBackground: false, exportScale: 1, exportEmbedScene: false, exportWithDarkMode: false },
      files: null,
      exportPadding: pad,
      skipInliningFonts: true,
    }).then(
      (svg) => {
        const node = ref.current;
        if (!on || !node) return;
        svg.style.overflow = "visible";
        node.replaceChildren(svg);
        node.style.left = `${x1 - pad - cx}px`;
        node.style.top = `${y1 - pad - cy}px`;
      },
      () => {},
    );
    return () => {
      on = false;
    };
  }, [key, cx, cy]);
  return <div className="media-cover" ref={ref} />;
}

function Item({ item, file, video, state, ready, onReady, onFail }) {
  const { el, frame, covers } = item;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const clip = frame
    ? { left: frame.x, top: frame.y, width: frame.width, height: frame.height, overflow: "hidden", borderRadius: 8 }
    : { left: 0, top: 0 };
  const opacity = (el.opacity / 100) * (frame ? frame.opacity / 100 : 1);
  const [sx, sy] = el.scale || [1, 1];
  const readyNow = useCallback(() => onReady(el.id), [onReady, el.id]);
  const failNow = useCallback(() => onFail(el.id), [onFail, el.id]);
  return (
    <div className="media-clip" style={clip}>
      <div
        className="media-box"
        data-id={el.id}
        style={{
          left: el.x - (frame?.x || 0),
          top: el.y - (frame?.y || 0),
          width: el.width,
          height: el.height,
          transform: `rotate(${el.angle || 0}rad)`,
          borderRadius: cornerRadius(el),
          visibility: ready ? "visible" : "hidden",
        }}
      >
        <div className="media-fill" style={{ opacity, transform: `scale(${sx}, ${sy})` }}>
          {item.kind === "video" ? (
            <Video el={el} video={video} state={state} onReady={readyNow} onFail={failNow} />
          ) : (
            <Picture el={el} file={file} onReady={readyNow} />
          )}
        </div>
        {covers.length > 0 && (
          <div
            className="media-covers"
            style={{ left: el.width / 2, top: el.height / 2, transform: `rotate(${-(el.angle || 0)}rad)` }}
          >
            {covers.map((els) => (
              <Cover key={els[0].id} els={els} cx={cx} cy={cy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const icon = {
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M6 5h4v14H6zM14 5h4v14h-4z" />,
  sound: (
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
  ),
  muted: (
    <path d="M3 9v6h4l5 5V4L7 9H3zm19 .4L20.6 8 18 10.6 15.4 8 14 9.4l2.6 2.6L14 14.6l1.4 1.4 2.6-2.6 2.6 2.6 1.4-1.4-2.6-2.6z" />
  ),
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {icon[name]}
  </svg>
);

// 버튼을 눌러도 보드가 포커스를 잃지 않게 한다 (바로 이어서 단축키를 쓸 수 있도록)
const keepFocus = (e) => {
  e.preventDefault();
  e.stopPropagation();
};

function SeekBar({ state }) {
  const [time, setTime] = useState({ now: 0, total: 0 });
  useEffect(() => {
    let frame;
    const tick = () => {
      const v = state.node;
      if (v) {
        const total = Number.isFinite(v.duration) ? v.duration : 0;
        setTime((t) => (Math.abs(t.now - v.currentTime) < 0.05 && t.total === total ? t : { now: v.currentTime, total }));
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state]);
  const seek = (e) => {
    const v = state.node;
    if (!v || !Number.isFinite(v.duration)) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * v.duration;
  };
  return (
    <>
      <div
        className="media-seek"
        onPointerDown={(e) => {
          keepFocus(e);
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && e.currentTarget.hasPointerCapture(e.pointerId) && seek(e)}
      >
        <div className="media-seek-fill" style={{ width: `${time.total ? (time.now / time.total) * 100 : 0}%` }} />
      </div>
      <span className="media-time">
        {clock(time.now)} / {clock(time.total)}
      </span>
    </>
  );
}

function Controls({ el, state, hovered, wide, change }) {
  const idle = !state.started || state.paused;
  return (
    <div className="media-ctl" data-id={el.id} style={{ left: el.x, top: el.y, width: el.width, height: el.height }}>
      {state.error ? (
        <div className="media-error">{state.error}</div>
      ) : (
        idle && (
          <button
            className="media-big"
            title="재생"
            tabIndex={-1}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => change(el.id, { started: true, paused: false })}
          >
            <Icon name="play" />
          </button>
        )
      )}
      {state.started && !state.error && hovered && wide && (
        <div className="media-bar" onPointerDown={keepFocus} onMouseDown={keepFocus}>
          <button
            title={state.paused ? "재생" : "일시 정지"}
            tabIndex={-1}
            onClick={() => change(el.id, { paused: !state.paused })}
          >
            <Icon name={state.paused ? "play" : "pause"} />
          </button>
          <SeekBar state={state} />
          <button
            title={state.muted ? "소리 켜기" : "소리 끄기"}
            tabIndex={-1}
            onClick={() => change(el.id, { muted: !state.muted })}
          >
            <Icon name={state.muted ? "muted" : "sound"} />
          </button>
        </div>
      )}
    </div>
  );
}

// Excalidraw 안쪽에 겹쳐 그릴 자리를 만든다
function useHosts() {
  const [hosts, setHosts] = useState(null);
  useEffect(() => {
    const parent = document.querySelector(".excalidraw canvas.interactive")?.parentElement;
    if (!parent) return;
    const make = (cls) => {
      const d = document.createElement("div");
      d.className = `media-host ${cls}`;
      parent.appendChild(d);
      return d;
    };
    const made = { pictures: make("media-pictures"), controls: make("media-controls") };
    setHosts(made);
    return () => {
      made.pictures.remove();
      made.controls.remove();
    };
  }, []);
  return hosts;
}

const IDLE_TOOLS = new Set(["selection", "lasso", "hand"]);

export default function MediaLayer({ api }) {
  const hosts = useHosts();
  const [scene, setScene] = useState({ items: [], videos: [], showControls: true });
  const [hovered, setHovered] = useState(null);
  const [ready, setReady] = useState(() => new Set());
  const states = useRef(new Map()); // 영상 요소 id → 재생 상태
  const animated = useRef(new Map()); // fileId → 움직이는 그림인가
  const sigRef = useRef("");
  const updateRef = useRef(() => {});
  const videosRef = useRef([]);

  const stateOf = useCallback((id) => {
    let s = states.current.get(id);
    if (!s) {
      s = { started: false, paused: true, muted: true, time: 0, error: null, node: null, rev: 0 };
      states.current.set(id, s);
    }
    return s;
  }, []);

  const change = useCallback(
    (id, patch) => {
      const s = stateOf(id);
      Object.assign(s, patch);
      s.rev++;
      updateRef.current();
    },
    [stateOf],
  );

  // 장면에서 얹을 것을 다시 고른다. 바뀐 것이 없으면 화면을 다시 그리지 않는다.
  useEffect(() => {
    if (!hosts) return;
    let raf = 0;

    const isAnimated = (el) => {
      const file = api.getFiles()[el.fileId];
      if (!file) return false;
      const known = animated.current.get(el.fileId);
      if (known !== undefined) return known;
      const v = isAnimatedImage(file.mimeType, file.dataURL);
      animated.current.set(el.fileId, v);
      return v;
    };
    const kindOf = (el) => {
      if (videoOf(el)) {
        const s = stateOf(el.id);
        return s.started && !s.error ? "video" : null;
      }
      return isAnimated(el) ? "gif" : null;
    };

    const move = () => {
      const s = api.getAppState();
      const z = s.zoom.value;
      for (const host of [hosts.pictures, hosts.controls]) {
        host.style.transform = `scale(${z}) translate(${s.scrollX}px, ${s.scrollY}px)`;
        host.style.setProperty("--media-zoom", z);
        host.style.setProperty("--media-inv", 1 / z);
      }
    };

    const update = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      const s = api.getAppState();
      const z = s.zoom.value;
      const elements = api.getSceneElements();
      const skip = new Set(
        [s.croppingElementId, s.editingTextElement?.id, s.newElement?.id, s.multiElement?.id].filter(Boolean),
      );
      const items = layoutMedia(elements, { kindOf, view: visibleArea(s), zoom: z, skip });

      const view = visibleArea(s, 0);
      const videos = [];
      for (const el of elements) {
        if (!videoOf(el) || skip.has(el.id)) continue;
        if (el.x > view.x2 || el.y > view.y2 || el.x + el.width < view.x1 || el.y + el.height < view.y1) continue;
        if (Math.min(el.width, el.height) * z < 72) continue; // 너무 작으면 버튼을 빼 놓는다
        videos.push({ el, wide: el.width * z >= 200 });
      }
      const showControls =
        IDLE_TOOLS.has(s.activeTool.type) &&
        !s.selectedElementsAreBeingDragged &&
        !s.isResizing &&
        !s.isRotating &&
        !s.isCropping &&
        !s.selectionElement &&
        !s.openDialog;

      const sig = [
        showControls,
        ...items.map(
          (i) =>
            `${i.el.id}:${i.el.versionNonce}:${i.kind}:${i.frame ? `${i.frame.id}:${i.frame.versionNonce}` : ""}:` +
            i.covers.map((c) => c.map((e) => `${e.id}:${e.versionNonce}`).join("+")).join(),
        ),
        "|",
        ...videos.map((v) => `${v.el.id}:${v.el.versionNonce}:${v.wide}:${stateOf(v.el.id).rev}`),
      ].join(";");
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      videosRef.current = videos;
      setScene({ items, videos, showControls });

      const used = new Set();
      for (const el of api.getSceneElementsIncludingDeleted()) {
        if (el.type !== "image") continue;
        used.add(el.fileId);
        const v = videoOf(el);
        if (v) used.add(v.id || el.id);
      }
      pruneBlobs(used);
    };
    updateRef.current = update;

    const later = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const offChange = api.onChange(() => {
      move();
      update();
    });
    const offScroll = api.onScrollChange(() => {
      move();
      later();
    });
    move();
    update();
    return () => {
      cancelAnimationFrame(raf);
      offChange();
      offScroll();
    };
  }, [api, hosts, stateOf]);

  const onReady = useCallback((id) => setReady((r) => (r.has(id) ? r : new Set(r).add(id))), []);
  const onFail = useCallback(
    (id) => {
      const el = api.getSceneElements().find((e) => e.id === id);
      const v = videoOf(el);
      change(id, {
        error: v?.path ? `원본 영상을 열 수 없습니다\n${v.path}` : "영상을 재생할 수 없습니다",
        started: false,
      });
    },
    [api, change],
  );

  // 얹은 것이 준비되면 캔버스의 정지 그림을 빼고, 내리면 되돌린다
  useLayoutEffect(() => {
    const shown = new Set(scene.items.map((i) => i.el.id));
    const next = [...shown].filter((id) => ready.has(id));
    const same = next.length === live.size && next.every((id) => live.has(id));
    const gone = [...ready].filter((id) => !shown.has(id));
    if (gone.length) setReady((r) => new Set([...r].filter((id) => shown.has(id))));
    if (same) return;
    live.clear();
    next.forEach((id) => live.add(id));
    const raf = requestAnimationFrame(() => api.updateScene({ elements: api.getSceneElementsIncludingDeleted() }));
    return () => cancelAnimationFrame(raf);
  }, [api, scene, ready]);

  // Excalidraw 는 커서 바로 아래가 캔버스일 때만 붙여넣기와 휠을 처리한다.
  // 재생 버튼 위에 커서가 있어도 되도록, 붙여넣는 순간에는 버튼을 비켜 주고 휠은 캔버스로 넘긴다.
  useEffect(() => {
    if (!hosts) return;
    const host = hosts.controls;
    const onPaste = () => {
      host.classList.add("media-aside");
      setTimeout(() => host.classList.remove("media-aside"));
    };
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      host.parentElement?.querySelector("canvas.interactive")?.dispatchEvent(new WheelEvent("wheel", e));
    };
    window.addEventListener("paste", onPaste, true);
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("paste", onPaste, true);
      host.removeEventListener("wheel", onWheel);
    };
  }, [hosts]);

  // 마우스가 올라간 영상에만 조작 막대를 보여 준다
  useEffect(() => {
    const onMove = (e) => {
      const over = e.target?.closest?.(".media-ctl");
      let id = over?.dataset.id || null;
      if (!id && e.target?.tagName === "CANVAS") {
        const p = viewportCoordsToSceneCoords(e, api.getAppState());
        const found = videosRef.current.findLast(
          ({ el }) => p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height,
        );
        id = found?.el.id || null;
      }
      setHovered(id);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [api]);

  if (!hosts) return null;
  const files = api.getFiles();
  return (
    <>
      {createPortal(
        scene.items.map((item) => (
          <Item
            key={`${item.el.id}:${item.kind === "video" ? "v" : item.el.fileId}`}
            item={item}
            file={files[item.el.fileId]}
            video={videoOf(item.el)}
            state={stateOf(item.el.id)}
            ready={ready.has(item.el.id)}
            onReady={onReady}
            onFail={onFail}
          />
        )),
        hosts.pictures,
      )}
      {scene.showControls &&
        createPortal(
          scene.videos.map(({ el, wide }) => (
            <Controls key={el.id} el={el} state={stateOf(el.id)} wide={wide} hovered={hovered === el.id} change={change} />
          )),
          hosts.controls,
        )}
    </>
  );
}
