// 영상 파일·주소를 보드에 넣을 수 있는 모양으로 바꾼다.
// 보드에는 첫 장면 그림(포스터)을 이미지 요소로 넣고, 영상 자체는 요소의 customData.video 에 담는다.
//   { id, mime, data }  보드에 함께 저장하는 짧은 영상 (data: dataURL)
//   { id, path }        이 컴퓨터의 원본 파일에 연결한 큰 영상
//   { id, url }         인터넷 영상 파일 주소
// 그래서 다른 프로그램이나 예전 버전에서 열어도 정지 그림으로 보이고, 복사·정렬·자르기가 이미지와 똑같이 된다.
import { fileMime, readAsDataURL } from "./images.js";
import { isHttpUrl } from "./links.js";
import { fileUrl, isLocalPath } from "./videoLinks.js";
import { chh } from "./chh.js";

const EMBED_LIMIT = 20 * 1024 * 1024; // 이보다 큰 영상은 보드에 넣지 않고 원본 위치만 기억한다
const VIDEO_EXT = /\.(mp4|webm|m4v|mov|mkv|ogv)$/i;
const POSTER_MAX = 1440;

export const isVideoFile = (file) => !!file.type?.startsWith("video/") || VIDEO_EXT.test(file.name || "");
export const isMediaFile = (file) => isVideoFile(file) || !!fileMime(file);

// 요소에 담긴 영상 정보 (없으면 null)
export function videoOf(el) {
  const v = el?.type === "image" ? el.customData?.video : null;
  return v && typeof v === "object" && (v.data || v.path || v.url) ? v : null;
}

// 저장된 값이 안전한 주소일 때만 재생 주소로 쓴다 (남이 만든 보드 파일일 수도 있다)
export function directSource(v) {
  if (v.path) return isLocalPath(v.path) ? fileUrl(v.path) : null;
  if (v.url) return isHttpUrl(v.url) ? v.url : null;
  return null;
}

function openVideo(src, crossOrigin) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    if (crossOrigin) v.crossOrigin = crossOrigin;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const finish = (run) => {
      clearTimeout(timer);
      v.onerror = null;
      v.onloadeddata = null;
      run();
    };
    const fail = (message) =>
      finish(() => {
        release(v);
        reject(new Error(message));
      });
    const timer = setTimeout(() => fail("불러오는 데 너무 오래 걸립니다"), 20000);
    v.onerror = () => fail("재생할 수 없는 영상입니다");
    v.onloadeddata = () => {
      if (v.videoWidth) finish(() => resolve(v));
      else fail("화면이 없는 영상입니다");
    };
    v.src = src;
  });
}

function release(video) {
  video.removeAttribute("src");
  video.load();
}

function canvasFor(video) {
  const k = Math.min(1, POSTER_MAX / video.videoWidth, POSTER_MAX / video.videoHeight);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(video.videoWidth * k));
  c.height = Math.max(1, Math.round(video.videoHeight * k));
  return c;
}

// 첫 장면. 다른 사이트 영상이라 그림을 읽을 수 없으면 빈 화면에 이름만 적는다.
function drawPoster(video, label) {
  const c = canvasFor(video);
  try {
    c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    const blank = canvasFor(video);
    const ctx = blank.getContext("2d");
    ctx.fillStyle = "#26262b";
    ctx.fillRect(0, 0, blank.width, blank.height);
    ctx.fillStyle = "#9a9aa5";
    ctx.font = `${Math.max(12, Math.round(blank.height / 22))}px "Malgun Gothic", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, blank.width / 2, blank.height * 0.85, blank.width * 0.9);
    return blank.toDataURL("image/png");
  }
}

const newId = () => `vid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function videoFileSource(file, link) {
  const linked = file.size > EMBED_LIMIT;
  const path = linked ? chh?.pathForFile?.(file) : null;
  if (linked && !isLocalPath(path)) {
    throw new Error(
      chh ? "20MB가 넘는 영상은 이 컴퓨터의 드라이브에 있어야 합니다" : "웹 버전에서는 20MB 이하 영상만 넣을 수 있습니다",
    );
  }
  const url = URL.createObjectURL(file);
  try {
    const v = await openVideo(url);
    const poster = drawPoster(v, file.name);
    release(v);
    const video = linked ? { id: newId(), path } : { id: newId(), mime: file.type || "video/mp4", data: await readAsDataURL(file) };
    return { dataURL: poster, link, customData: { video }, linked };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 파일 목록 → { sources: insertImages 에 넘길 목록, errors: [문장], linked: 원본에 연결한 영상 수 }
// link: 파일이 하나일 때만 붙이는 출처 주소 (여러 파일이면 어느 파일의 주소인지 알 수 없다)
export async function readSources(files, link = null) {
  const sources = [];
  const errors = [];
  for (const f of files) {
    const l = files.length === 1 ? link : null;
    try {
      sources.push(isVideoFile(f) ? await videoFileSource(f, l) : { dataURL: await readAsDataURL(f), mime: fileMime(f), link: l });
    } catch (err) {
      errors.push(`${f.name}: ${err.message || err}`);
    }
  }
  return { sources, errors, linked: sources.filter((s) => s.linked).length };
}

function nameOf(url) {
  const last = new URL(url).pathname.split("/").pop();
  try {
    return decodeURIComponent(last) || "영상";
  } catch {
    return last;
  }
}

// 인터넷 영상 파일 주소 → insertImages 에 넘길 항목
export async function videoUrlSource(url) {
  // 그림을 읽을 수 있게(crossOrigin) 먼저 열어 보고, 사이트가 허락하지 않으면 그냥 연다
  const v = await openVideo(url, "anonymous").catch(() => openVideo(url));
  const poster = drawPoster(v, nameOf(url));
  release(v);
  return { dataURL: poster, link: url, customData: { video: { id: newId(), url } } };
}
