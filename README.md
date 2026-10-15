# CHH

Excalidraw + PureRef 스타일 레퍼런스 보드 (Electron 데스크톱 앱).

## 기능
- 항상 위 / 창 투명도 조절
- `.chh` 보드 저장·열기, `.excalidraw` 열기, 자동 저장
- 화면 영역 캡처 (Ctrl+Shift+X)
- 웹 이미지 드래그 가져오기, 레퍼런스 이미지 원본 내보내기

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
