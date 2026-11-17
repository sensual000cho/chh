// 파일 쓰기 도우미: 저장 중 문제가 생겨도 기존 파일이 깨지지 않도록 임시 파일에 쓴 뒤 바꿔치기한다.
const fs = require("fs");
const path = require("path");

// Windows 에서는 백신 등이 파일을 잠깐 잡고 있으면 rename 이 실패할 수 있어 몇 번 다시 시도한다
async function renameWithRetry(from, to, tries = 6) {
  for (let i = 0; ; i++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (err) {
      const retryable = err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES";
      if (!retryable || i >= tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

async function atomicWrite(target, content) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  let handle = null;
  try {
    handle = await fs.promises.open(tmp, "w");
    await handle.writeFile(content, "utf8");
    await handle.sync(); // 디스크에 실제로 내려간 뒤에 바꿔치기한다
    await handle.close();
    handle = null;
    await renameWithRetry(tmp, target);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// 자동 저장본을 시각이 붙은 복사본으로 남기고, 오래된 것은 keep 개만 남긴다
async function archiveFile(source, dir, keep = 5, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  await fs.promises.mkdir(dir, { recursive: true });
  let target = path.join(dir, `자동저장-${stamp}.chh`);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `자동저장-${stamp}-${i}.chh`);
  await fs.promises.copyFile(source, target);
  const names = (await fs.promises.readdir(dir)).filter((n) => n.endsWith(".chh")).sort();
  for (const old of names.slice(0, Math.max(0, names.length - keep))) {
    await fs.promises.rm(path.join(dir, old), { force: true }).catch(() => {});
  }
  return target;
}

// 앱 이름이 바뀌면 설정 폴더도 바뀐다. 새 폴더에 아직 쓴 적이 없으면 예전 폴더의 사용자 데이터를 복사해 온다.
// (복사이므로 예전 폴더는 그대로 남는다. 실패해도 앱은 새 폴더로 그냥 시작한다)
const USER_DATA_ITEMS = ["autosave.chh", "autosave.json", "autosave-backups", "window.json", "settings.json", "Local Storage"];
function migrateUserData(oldDir, newDir) {
  try {
    if (!fs.existsSync(oldDir) || path.resolve(oldDir) === path.resolve(newDir)) return false;
    if (["window.json", "settings.json", "autosave.json"].some((n) => fs.existsSync(path.join(newDir, n)))) return false;
    fs.mkdirSync(newDir, { recursive: true });
    let copied = false;
    for (const name of USER_DATA_ITEMS) {
      const from = path.join(oldDir, name);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, path.join(newDir, name), { recursive: true, force: false, errorOnExist: false });
      copied = true;
    }
    return copied;
  } catch {
    return false;
  }
}

module.exports = { atomicWrite, archiveFile, migrateUserData };
