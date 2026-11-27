// 파일·영상 주소를 보드에 넣는 공통 처리 (붙여넣기, 끌어다 놓기, 파일 고르기)
import { restoreElements } from "@excalidraw/excalidraw";
import { insertImages } from "./images.js";
import { parseEmbedVideo, parseVideoFileUrl } from "./videoLinks.js";
import { readSources, videoUrlSource } from "./videos.js";

export async function insertFiles(api, files, anchor, mode, link = null) {
  const { sources, errors, linked } = await readSources(files, link);
  if (sources.length) await insertImages(api, sources, anchor, mode);
  if (errors.length) api.setToast({ message: `넣지 못했습니다: ${errors.join(" / ")}` });
  else if (linked) {
    api.setToast({
      message: "20MB가 넘는 영상은 원본 파일에 연결했습니다. 원본을 옮기거나 지우면 재생되지 않습니다.",
      duration: 6000,
    });
  }
  return sources.length;
}

// 유튜브·비메오 재생 카드
function insertEmbed(api, embed, anchor, mode) {
  const center = mode === "center";
  const [el] = restoreElements(
    [
      {
        type: "embeddable",
        id: `emb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        x: center ? anchor.x - embed.width / 2 : anchor.x,
        y: center ? anchor.y - embed.height / 2 : anchor.y,
        width: embed.width,
        height: embed.height,
        link: embed.link,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        strokeWidth: 1,
        version: 1,
      },
    ],
    null,
  );
  api.updateScene({
    elements: [...api.getSceneElements(), el],
    appState: { selectedElementIds: { [el.id]: true } },
  });
}

// 주소가 영상이면 넣고 true. 영상 주소가 아니면 false.
export async function insertVideoUrl(api, text, anchor, mode) {
  const embed = parseEmbedVideo(text);
  if (embed) {
    insertEmbed(api, embed, anchor, mode);
    return true;
  }
  const url = parseVideoFileUrl(text);
  if (!url) return false;
  api.setToast({ message: "영상을 불러오는 중입니다.", duration: 30000 });
  try {
    await insertImages(api, [await videoUrlSource(url)], anchor, mode);
    api.setToast(null);
  } catch (err) {
    api.setToast({ message: `영상을 불러오지 못했습니다: ${err.message || err}` });
  }
  return true;
}
