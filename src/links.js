// 붙여넣기·끌어다 놓기로 들어온 주소를 다룬다.

// 붙여넣은 글자가 http(s) 주소 하나뿐인가
export const isHttpUrl = (text) => /^https?:\/\/\S+$/i.test((text || "").trim());

const decode = (url) => url.replace(/&amp;/g, "&").replace(/^\/\//, "https://");
const isImageSource = (url) => /^(https?:|data:image\/)/i.test(url || "");

// 태그 안의 속성값. "src" 를 찾을 때 "data-src" 가 걸리지 않도록 앞의 공백까지 본다.
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
  return m ? decode(m[1]) : null;
}

// 늦게 불러오는 페이지는 src 에 흐린 미리보기를 두고 진짜 주소를 data-* 에 둔다
function imageFromHtml(html) {
  const tag = /<img\b[^>]*>/i.exec(html || "")?.[0];
  if (!tag) return null;
  const candidates = ["data-lazy-src", "data-original", "data-src", "src"].map((n) => attr(tag, n));
  const found = candidates.find(isImageSource);
  // 네이버 블로그 미리보기(type=w80_blur)가 남아 있으면 큰 이미지로 바꾼다
  return found ? found.replace(/([?&]type=)w\d+_blur\b/, "$1w773") : null;
}

// 구글 이미지 검색의 중간 주소에서 실제 페이지 주소를 꺼낸다
function unwrapSearchLink(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\./.test(u.hostname)) return url;
    return u.searchParams.get("imgrefurl") || u.searchParams.get("url") || url;
  } catch {
    return url;
  }
}

// 끌어다 놓은 웹 이미지에서 { image: 받아 올 이미지 주소, link: 출처로 남길 주소 } 를 뽑는다. 없으면 null.
// 링크가 걸린 이미지를 끌면 uri-list 는 그 페이지, html 의 img 는 이미지 파일을 가리키므로 페이지 쪽을 출처로 쓴다.
// 미리보기가 data: 로 박혀 있고 주소도 전혀 없으면 출처는 알 수 없다 (link 가 null).
export function parseDroppedLinks(html, uriList) {
  const src = imageFromHtml(html);
  const first = (uriList || "").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  const uri = isImageSource(first) ? first : null;
  const image = src || uri;
  if (!image) return null;
  const anchor = /<a\b[^>]*>/i.exec(html || "")?.[0];
  const href = anchor ? attr(anchor, "href") : null;
  const link = [uri, href, src].find((u) => isHttpUrl(u));
  return { image, link: link ? unwrapSearchLink(link) : null };
}
