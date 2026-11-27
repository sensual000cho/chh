// 영상 주소를 다룬다 (Excalidraw 없이 테스트할 수 있도록 분리).
import { isHttpUrl } from "./links.js";

const VIDEO_PATH = /\.(mp4|webm|m4v|mov|ogv)$/i;

function parseUrl(text) {
  if (!isHttpUrl(text)) return null;
  try {
    return new URL(text.trim());
  } catch {
    return null;
  }
}

// 유튜브 시작 시각: "90", "90s", "1h2m3s" → 초
function seconds(t) {
  if (!t) return 0;
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0;
}

// 유튜브·비메오 주소를 Excalidraw 가 알아보는 모양으로 바꾼다. { link, width, height } 또는 null.
// (모바일 주소, live, v 가 뒤에 오는 주소 등은 Excalidraw 가 그대로는 재생하지 못한다)
export function parseEmbedVideo(text) {
  const u = parseUrl(text);
  if (!u) return null;
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const first = parts[0] || "";
  const wide = { width: 640, height: 360 };

  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    let id = null;
    if (host === "youtu.be") id = first;
    else if (first === "watch") id = u.searchParams.get("v");
    else if (/^(shorts|live|embed|v)$/.test(first) && parts[1] !== "videoseries") id = parts[1];
    if (id && /^[\w-]{6,}$/.test(id)) {
      if (first === "shorts") return { link: `https://www.youtube.com/shorts/${id}`, width: 360, height: 640 };
      const t = seconds(u.searchParams.get("t") || u.searchParams.get("start"));
      return { link: `https://www.youtube.com/watch?v=${id}${t ? `&t=${t}` : ""}`, ...wide };
    }
    const list = u.searchParams.get("list");
    if (list && /^[\w-]+$/.test(list) && (first === "playlist" || parts[1] === "videoseries")) {
      return { link: `https://www.youtube.com/playlist?list=${list}`, ...wide };
    }
    return null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = parts.find((p) => /^\d{5,}$/.test(p));
    return id ? { link: `https://vimeo.com/${id}`, ...wide } : null;
  }
  return null;
}

// 영상 파일을 바로 가리키는 주소면 그 주소, 아니면 null
export function parseVideoFileUrl(text) {
  const u = parseUrl(text);
  if (!u) return null;
  if (/(^|\.)imgur\.com$/.test(u.hostname)) u.pathname = u.pathname.replace(/\.gifv$/i, ".mp4");
  return VIDEO_PATH.test(u.pathname) ? u.href : null;
}

export const isVideoUrl = (text) => !!(parseEmbedVideo(text) || parseVideoFileUrl(text));

// 이 컴퓨터의 드라이브 경로(C:\...)인가.
// 네트워크 경로(\\서버\...)는 보드를 여는 것만으로 그 서버에 접속하게 되므로 받지 않는다.
export const isLocalPath = (p) => typeof p === "string" && /^[a-z]:[\\/](?![\\/])/i.test(p);

export const fileUrl = (p) =>
  "file:///" +
  p
    .split(/[\\/]/)
    .map((s, i) => (i === 0 ? s : encodeURIComponent(s)))
    .join("/");
