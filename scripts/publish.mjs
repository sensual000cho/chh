// npm run dist 마지막 단계: release/ThinkingChair.exe 를 프로젝트 루트에 덮어쓰고 공유용 zip 도 새로 만든다.
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const src = "release/ThinkingChair.exe";
if (!existsSync(src)) throw new Error(`${src} 가 없습니다. electron-builder 단계가 실패했습니다.`);

copyFileSync(src, "ThinkingChair.exe");
// 설치형: 한 번 설치하면 실행할 때 압축을 풀지 않아 시작 즉시 로딩 화면이 뜬다
if (existsSync("release/ThinkingChair-Setup.exe")) copyFileSync("release/ThinkingChair-Setup.exe", "ThinkingChair-Setup.exe");
// 이름을 바꾸기 전(CHH)의 배포 파일은 지운다
for (const old of ["CHH.exe", "CHH-Setup.exe", "CHH-공유용.zip"]) rmSync(old, { force: true });
rmSync("ThinkingChair-공유용.zip", { force: true });
execFileSync(
  "powershell",
  ["-NoProfile", "-Command", "Compress-Archive -LiteralPath ThinkingChair.exe -DestinationPath 'ThinkingChair-공유용.zip'"],
  { stdio: "inherit" },
);
console.log("→ ThinkingChair.exe, ThinkingChair-Setup.exe, ThinkingChair-공유용.zip 갱신 완료");
