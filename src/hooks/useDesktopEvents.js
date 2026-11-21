// 메인 프로세스에서 오는 알림: 화면 캡처 결과, 토스트, 클릭 통과 상태, 캡처 단축키
import { useCallback, useEffect, useState } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { formatAccelerator } from "../accelerator.js";
import { chh } from "../chh.js";

// 화면 캡처 결과를 현재 화면 가운데에 이미지로 붙인다
function insertCapture(api, { dataURL, scale }) {
  const img = new Image();
  img.onload = () => {
    const s = api.getAppState();
    const w = img.naturalWidth / (scale || 1);
    const h = img.naturalHeight / (scale || 1);
    const fileId = `cap_${Date.now()}`;
    api.addFiles([{ id: fileId, dataURL, mimeType: "image/png", created: Date.now() }]);
    const cx = -s.scrollX + s.width / 2 / s.zoom.value;
    const cy = -s.scrollY + s.height / 2 / s.zoom.value;
    const [el] = convertToExcalidrawElements([
      { type: "image", fileId, status: "saved", x: cx - w / 2, y: cy - h / 2, width: w, height: h },
    ]);
    api.updateScene({
      elements: [...api.getSceneElements(), el],
      appState: { selectedElementIds: { [el.id]: true } },
    });
  };
  img.src = dataURL;
}

export function useCaptureAndToasts(api) {
  useEffect(() => {
    if (!api || !chh) return;
    const offCapture = chh.onCaptureResult((result) => insertCapture(api, result));
    const offToast = chh.onToast((message) => api.setToast({ message }));
    return () => {
      offCapture();
      offToast();
    };
  }, [api]);
}

// 클릭 통과 켜짐 여부, 캡처 단축키. 돌려주는 값: { clickThrough, toggleClickThrough, captureKey, setCaptureKey }
export function useDesktopState(api) {
  const [clickThrough, setClickThrough] = useState(false);
  const [captureKey, setCaptureKey] = useState("CommandOrControl+Shift+X");

  useEffect(() => {
    if (!api || !chh) return;
    const off = chh.onClickThrough((on) => {
      setClickThrough(on);
      if (!on) api.setToast({ message: "클릭 통과를 해제했습니다.", duration: 1500 });
    });
    chh.getCaptureShortcut().then(({ accel, ok }) => {
      setCaptureKey(accel);
      if (!ok) {
        api.setToast({
          message: `캡처 단축키 ${formatAccelerator(accel)}를 등록하지 못했습니다. 다른 프로그램이 쓰고 있을 수 있어요. 메뉴에서 바꿀 수 있습니다.`,
        });
      }
    });
    return off;
  }, [api]);

  const toggleClickThrough = useCallback(async () => {
    const next = !clickThrough;
    const ok = await chh.setClickThrough(next);
    if (!ok) {
      api?.setToast({ message: "해제 단축키(Ctrl+Shift+L)를 등록하지 못해 클릭 통과를 켜지 않았습니다." });
    } else if (next) {
      api?.setToast({ message: "클릭 통과 켜짐: Ctrl+Shift+L로 해제합니다.", duration: 4000 });
    }
  }, [api, clickThrough]);

  return { clickThrough, toggleClickThrough, captureKey, setCaptureKey };
}
