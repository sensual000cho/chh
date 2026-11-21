// Electron preload 가 노출하는 window.chh API (electron/preload.cjs) 는
// 브라우저(npm run dev, 웹 버전)에서는 없으므로 항상 optional 로 접근한다.
export const chh = window.chh;
