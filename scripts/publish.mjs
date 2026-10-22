// npm run dist 마지막 단계: release/CHH.exe 를 프로젝트 루트에 덮어쓰고 공유용 zip 도 새로 만든다.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const src = "release/CHH.exe";
if (!existsSync(src)) throw new Error(`${src} 가 없습니다. electron-builder 단계가 실패했습니다.`);

copyFileSync(src, "CHH.exe");
// 설치형: 한 번 설치하면 실행할 때 압축을 풀지 않아 시작 즉시 로딩 화면이 뜬다
if (existsSync("release/CHH-Setup.exe")) copyFileSync("release/CHH-Setup.exe", "CHH-Setup.exe");
rmSync("CHH-공유용.zip", { force: true });
execFileSync(
  "powershell",
  ["-NoProfile", "-Command", "Compress-Archive -LiteralPath CHH.exe -DestinationPath 'CHH-공유용.zip'"],
  { stdio: "inherit" },
);
console.log("→ CHH.exe, CHH-공유용.zip 갱신 완료");
