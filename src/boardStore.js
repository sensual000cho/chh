// 자동 저장소: 데스크톱은 메인 프로세스의 파일, 웹은 IndexedDB 에 같은 형태로 저장한다.
//   read()  → { content, meta: { filePath, dirty, fileExists } } | null
//   write(content, meta), writeMeta(meta), archive(), clear()
const chh = window.chh;

// 변경 여부 판단용 서명. 삭제된 요소도 포함한 목록을 넘겨야 삭제가 변경으로 잡힌다.
export function sceneSignature(elements, background) {
  let sum = 0;
  for (const e of elements) sum += e.version;
  return `${elements.length}:${sum}:${background}`;
}

// 저장에 걸린 시간에 맞춰 자동 저장 간격을 늘린다 (큰 보드에서 계속 끊기지 않도록)
export const autosaveDelay = (lastMs, min = 2000, max = 30000) => Math.min(max, Math.max(min, lastMs * 20));

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("chh", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const webStore = {
  read: async () => (await idb("readonly", (s) => s.get("autosave"))) || null,
  write: (content, meta) => idb("readwrite", (s) => s.put({ content, meta }, "autosave")),
  writeMeta: async () => {},
  archive: async () => null,
  clear: () => idb("readwrite", (s) => s.delete("autosave")),
};

const desktopStore = chh && {
  read: () => chh.autosaveRead(),
  write: (content, meta) => chh.autosaveWrite(content, meta),
  writeMeta: (meta) => chh.autosaveWriteMeta(meta),
  archive: () => chh.autosaveArchive(),
  clear: () => chh.autosaveClear(),
};

export const store = desktopStore || webStore;
