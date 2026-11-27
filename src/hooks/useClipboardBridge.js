// 앱과 다른 프로그램 사이의 복사·붙여넣기 (이미지, 영상, 이미지·영상 주소)
import { useEffect } from "react";
import { insertImages, isImageFile, toPngDataURL, viewCenter } from "../images.js";
import { insertFiles, insertVideoUrl } from "../insertMedia.js";
import { isHttpUrl, parseDroppedLinks } from "../links.js";
import { isVideoUrl } from "../videoLinks.js";
import { isMediaFile, isVideoFile } from "../videos.js";
import { chh } from "../chh.js";

// 글자만 담은 붙여넣기 이벤트를 다시 보내 Excalidraw 기본 처리에 맡긴다
function repasteText(text) {
  const only = new DataTransfer();
  only.setData("text/plain", text);
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: only, bubbles: true }));
}

export function useClipboardBridge(api) {
  useEffect(() => {
    if (!api) return;
    const desktop = !!chh?.addImageToClipboard;
    let plainKey = false; // Ctrl+Shift+V: 주소도 글자 그대로 붙여넣는다
    const onKey = (e) => {
      if (e.code === "KeyV" && (e.ctrlKey || e.metaKey)) plainKey = e.shiftKey;
    };

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

    // 브라우저에서 복사한 GIF 는 클립보드에 정지 그림만 들어 있으므로 원본 주소에서 다시 받는다
    const originalGif = async (dt) => {
      const web = parseDroppedLinks(dt.getData("text/html"), "");
      if (!web || !/^https?:[^?#]*\.gif([?#]|$)/i.test(web.image)) return null;
      const res = await chh.fetchImage(web.image, web.link);
      return res?.dataURL?.startsWith("data:image/gif") ? { dataURL: res.dataURL, link: web.link } : null;
    };

    // 반대로 앱 안에서 붙여넣을 때는 Excalidraw 가 이미지 파일을 JSON 보다 우선하므로,
    // 우리 요소 JSON 이 있으면 이미지를 뺀 붙여넣기 이벤트로 바꿔 크기·위치를 그대로 살린다.
    // 외부 이미지는 insertImages 로 넣어 파일 선택/드롭과 같은 크기 규칙을 따르게 한다.
    const onPaste = async (e) => {
      const dt = e.clipboardData;
      if (!e.isTrusted || !dt) return;
      const plain = plainKey;
      plainKey = false;
      const text = dt.getData("text/plain");
      const typing = /^(input|textarea)$/i.test(e.target?.tagName) || e.target?.isContentEditable;
      const take = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (!dt.files?.length) {
        if (typing || plain || !isHttpUrl(text)) return;
        // 유튜브 등 영상 주소는 재생할 수 있게 넣는다
        if (isVideoUrl(text)) {
          take();
          insertVideoUrl(api, text, viewCenter(api), "center");
          return;
        }
        if (!desktop) return;
        // 이미지 주소를 붙여넣으면 받아서 넣고, 이미지가 아니면 원래대로 글자 붙여넣기를 한다
        take();
        const res = await chh.fetchImage(text.trim());
        if (res?.dataURL) insertImages(api, [{ dataURL: res.dataURL, link: text.trim() }], viewCenter(api), "center");
        else repasteText(text);
        return;
      }
      if (!desktop) {
        // 웹: 이미지는 Excalidraw 기본 처리에 맡기고, 영상이 섞여 있을 때만 우리가 넣는다
        const files = [...dt.files].filter(isMediaFile);
        if (typing || !files.some(isVideoFile)) return;
        take();
        insertFiles(api, files, viewCenter(api), "center");
        return;
      }
      if (text.includes('"excalidraw/clipboard"')) {
        take();
        repasteText(text);
        return;
      }
      const files = [...dt.files].filter(isMediaFile);
      if (!files.length || typing) return;
      take();
      // 이벤트가 끝나면 클립보드 내용을 읽을 수 없으므로 먼저 읽어 둔다
      const gif = files.length === 1 && isImageFile(files[0]) ? originalGif(dt) : null;
      // 앱에서 복사한 이미지면(클립보드엔 이미지만 있음) 보관해 둔 요소 JSON 으로 붙여넣는다
      const json = await chh.internalClipboard?.();
      if (json) {
        repasteText(json);
        return;
      }
      const source = await gif;
      if (source) insertImages(api, [source], viewCenter(api), "center");
      else insertFiles(api, files, viewCenter(api), "center");
    };
    window.addEventListener("keydown", onKey, true);
    if (desktop) document.addEventListener("copy", onCopy);
    window.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("copy", onCopy);
      window.removeEventListener("paste", onPaste, true);
    };
  }, [api]);
}
