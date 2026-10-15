# CHH

Excalidraw + PureRef 스타일 레퍼런스 보드 (Electron 데스크톱 앱).

## 기능
- 항상 위 / 창 투명도 조절, 상단 제목 표시줄
- `.chh` 보드 저장·열기, `.excalidraw` 열기, 자동 저장, 최근 작업 파일
- 화면 영역 캡처 (Ctrl+Shift+X)
- **이미지 가져오기**: 제목 표시줄 "이미지" 버튼(여러 장 선택), 파일/웹 이미지 끌어다 놓기, 붙여넣기
- **픽셀판**: 정해진 크기(최대 512×512)의 픽셀 캔버스. 브러시/지우개/스포이드/채우기, 격자, 되돌리기,
  마우스를 올리면 가로×세로 크기 표시, 투명 배경 PNG 내보내기(1~32배, 보간 없음)
- **Tab**: 모든 UI 숨기기/보이기
- Esc: 메인 메뉴 열기/닫기 (픽셀 그리기 중에는 그리기 종료)
- 캔버스 배경색: 고정 8색 + 색상환 직접 선택

### 픽셀판 단축키 (그리기 중)
B 브러시 · E 지우개 · I 스포이드(또는 Alt+클릭) · G 채우기 · [ ] 크기 · Ctrl+Z / Ctrl+Y 되돌리기·다시 실행 · Esc 종료
선택한 픽셀판에서 Enter 또는 더블클릭으로 그리기를 시작합니다.

## 개발
```bash
npm install
npm run dev          # 브라우저에서 UI 개발 (http://localhost:5173)
npm run electron:dev # Vite dev 서버를 띄운 상태에서 Electron 창으로 실행
npm run build && npm run electron   # 빌드 결과(dist/)로 Electron 실행
```

## 구조
- `electron/` — 메인 프로세스, preload(`window.chh` API), 화면 캡처 창
- `src/` — React UI (Excalidraw)

## 참고
- 캔버스는 Excalidraw **라이트 테마(색 반전 필터 없음)** 로 그리고, UI 에만 다크 팔레트를 입힙니다.
  (다크 테마를 쓰면 이미지·배경 색이 원본과 달라집니다.) 다크 UI 규칙은 `npm run gen:dark-css` 로
  `src/excalidraw-dark.css` 를 자동 생성합니다. @excalidraw/excalidraw 버전을 올리면 다시 실행하세요.
- `npm run dist` → `release/CHH.exe` 를 만들고 프로젝트 루트의 `CHH.exe`, `CHH-공유용.zip` 을 덮어씁니다.
