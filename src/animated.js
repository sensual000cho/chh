// 움직이는 이미지(GIF, 움직이는 WebP·PNG)인지 파일 앞부분으로 알아낸다.

function head(dataURL, bytes) {
  const i = dataURL.indexOf(";base64,");
  if (i < 0) return "";
  try {
    return atob(dataURL.slice(i + 8, i + 8 + Math.ceil(bytes / 3) * 4));
  } catch {
    return "";
  }
}

export function isAnimatedImage(mimeType, dataURL) {
  if (!dataURL) return false;
  if (mimeType === "image/gif") return true;
  if (mimeType === "image/webp") {
    const h = head(dataURL, 24);
    return h.slice(12, 16) === "VP8X" && (h.charCodeAt(20) & 2) !== 0;
  }
  if (mimeType === "image/png") {
    const h = head(dataURL, 6000);
    const a = h.indexOf("acTL");
    const d = h.indexOf("IDAT");
    return a > 0 && (d < 0 || a < d);
  }
  return false;
}
