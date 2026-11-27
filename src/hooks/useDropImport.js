// 파일/웹 이미지·영상 끌어다 놓기 (.chh, .excalidraw 파일은 보드로 열기)
import { useEffect } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { insertImages, pickDropped } from "../images.js";
import { insertFiles, insertVideoUrl } from "../insertMedia.js";
import { isVideoUrl } from "../videoLinks.js";
import { isMediaFile } from "../videos.js";
import { chh } from "../chh.js";

export function useDropImport(api, targetRef, openPath) {
  useEffect(() => {
    const el = targetRef.current;
    if (!el || !api) return;
    const types = (dt) => [...(dt?.types || [])];
    const onOver = (e) => {
      const t = types(e.dataTransfer);
      if (t.includes("Files") || t.includes("text/uri-list") || t.includes("text/html")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onDrop = async (e) => {
      const dt = e.dataTransfer;
      // .excalidraw 도 여기서 연다. 기본 처리에 맡기면 내용만 바뀌고 저장 경로는 이전 파일로 남는다.
      const board = [...(dt.files || [])].find((f) => /\.(chh|excalidraw)$/i.test(f.name));
      if (board && chh) {
        e.preventDefault();
        e.stopPropagation();
        const p = chh.pathForFile(board);
        if (p) openPath(p);
        return;
      }
      const { files: all, web } = pickDropped(dt);
      const files = all.filter(isMediaFile);
      if (!files.length && !web) return; // 그 밖의 드롭은 Excalidraw 기본 처리
      e.preventDefault();
      e.stopPropagation();
      const at = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const noLink = () =>
        api.setToast({ message: "이 페이지는 원본 주소를 넘겨주지 않아 출처 없이 넣었습니다.", duration: 3000 });
      if (files.length) {
        await insertFiles(api, files, at, "corner", web?.link);
        if (web && files.length === 1 && !web.link) noLink();
        return;
      }
      // 유튜브 주소나 영상 파일 주소는 재생할 수 있게 넣는다 (그림을 끌어온 경우에는 그림을 넣는다)
      if (isVideoUrl(web.image)) {
        await insertVideoUrl(api, web.image, at, "corner");
        return;
      }
      let source = null;
      if (web.image.startsWith("data:")) source = { dataURL: web.image, link: web.link };
      else if (chh) {
        const r = await chh.fetchImage(web.image, web.link);
        if (r?.dataURL) source = { dataURL: r.dataURL, link: web.link };
        else api.setToast({ message: `이미지를 가져오지 못했습니다: ${r?.error || ""}` });
      } else {
        api.setToast({ message: "웹 버전에서는 웹 이미지를 끌어올 수 없습니다. 이미지를 저장한 뒤 넣어 주세요." });
      }
      if (!source) return;
      if (!source.link) noLink();
      insertImages(api, [source], at, "corner");
    };
    el.addEventListener("dragover", onOver, true);
    el.addEventListener("drop", onDrop, true);
    return () => {
      el.removeEventListener("dragover", onOver, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, [api, targetRef, openPath]);
}
