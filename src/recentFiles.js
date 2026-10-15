// 최근 작업 파일 목록 (경로 기준, 최신순). localStorage 에 저장한다.
const KEY = "chh.recentFiles";
const MAX = 10;

export function loadRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  return list;
}

export function addRecent(filePath) {
  const name = filePath.split(/[\\/]/).pop();
  const rest = loadRecent().filter((f) => f.path.toLowerCase() !== filePath.toLowerCase());
  return save([{ path: filePath, name, openedAt: Date.now() }, ...rest].slice(0, MAX));
}

export function removeRecent(filePath) {
  return save(loadRecent().filter((f) => f.path !== filePath));
}

export function clearRecent() {
  return save([]);
}

export function formatWhen(ts) {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
