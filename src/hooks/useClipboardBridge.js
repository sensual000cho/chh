// 앱과 다른 프로그램 사이의 복사·붙여넣기 (이미지, 이미지 주소)
import { useEffect } from "react";
import { fileMime, insertImages, isImageFile, readAsDataURL, toPngDataURL, viewCenter } from "../images.js";
import { isHttpUrl } from "../links.js";
import { chh } from "../chh.js";

// 글자만 담은 붙여넣기 이벤트를 다시 보내 Excalidraw 기본 처리에 맡긴다
function repasteText(text) {
  const only = new DataTransfer();
  only.setData("text/plain", text);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: only, bubbles: true }));
}

export function useClipboardBridge(api) {
  useEffect(() => {
    if (!api || !chh?.addImageToClipboard) return;
    // 이미지 하나를 복사하면 OS 클립보드를 비트맵 하나로 바꿔 PureRef 등 외부 앱에 이미지만 붙여넣게 한다.
    // (Excalidraw 는 요소 JSON 텍스트만 복사한다 → 외부 앱에 긴 글자가 같이 붙음. JSON 은 메인 프로세스가 보관)
    const onCopy = () => {
      const s = api.getAppState();
      const sel = api.getSceneElements().filter((el) => s.selectedElementIds[el.id]);
      if (sel.length !== 1 || sel[0].type !== "image") return;
      const file = api.getFiles()[sel[0].fileId];
      if (!file?.dataURL) return;
      // Excalidraw 의 텍스트 복사(비동기)가 끝난 뒤 이미지로 바꾼다.
      setTimeout(async () => {
        try {
          await chh.addImageToClipboard(await toPngDataURL(file.dataURL));
        } catch {}
      }, 150);
    };
    // 반대로 앱 안에서 붙여넣을 때는 Excalidraw 가 이미지 파일을 JSON 보다 우선하므로,
    // 우리 요소 JSON 이 있으면 이미지를 뺀 붙여넣기 이벤트로 바꿔 크기·위치를 그대로 살린다.
    // 외부 이미지는 insertImages 로 넣어 파일 선택/드롭과 같은 크기 규칙을 따르게 한다.
    const onPaste = async (e) => {
      const dt = e.clipboardData;
      if (!e.isTrusted || !dt) return;
      const text = dt.getData("text/plain");
      const typing = /^(input|textarea)$/i.test(e.target?.tagName) || e.target?.isContentEditable;
      if (!dt.files?.length) {
        // 이미지 주소를 붙여넣으면 받아서 넣고, 이미지가 아니면 원래대로 글자 붙여넣기를 한다
        if (typing || !isHttpUrl(text)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const res = await chh.fetchImage(text.trim());
        if (res?.dataURL) insertImages(api, [{ dataURL: res.dataURL, link: text.trim() }], viewCenter(api), "center");
        else repasteText(text);
        return;
      }
      if (text.includes('"excalidraw/clipboard"')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        repasteText(text);
        return;
      }
      const files = [...dt.files].filter(isImageFile);
      if (!files.length || typing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // 앱에서 복사한 이미지면(클립보드엔 이미지만 있음) 보관해 둔 요소 JSON 으로 붙여넣는다
      const json = await chh.internalClipboard?.();
      if (json) {
        repasteText(json);
        return;
      }
      const sources = [];
      for (const f of files) sources.push({ dataURL: await readAsDataURL(f), mime: fileMime(f) });
      insertImages(api, sources, viewCenter(api), "center");
    };
    document.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste, true);
    };
  }, [api]);
}
