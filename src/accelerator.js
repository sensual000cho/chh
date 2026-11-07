// 키 입력을 Electron 전역 단축키 표기로 바꾼다. 아직 조합이 완성되지 않았으면 null.
const SPECIAL = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Enter: "Enter",
  Insert: "Insert",
  Delete: "Delete",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  PrintScreen: "PrintScreen",
};

function keyName(e) {
  // 한글 입력 상태에서도 같은 단축키가 되도록 e.code 를 먼저 본다
  const letter = /^Key([A-Z])$/.exec(e.code || "");
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(e.code || "");
  if (digit) return digit[1];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key;
  return SPECIAL[e.key] || null;
}

export function eventToAccelerator(e) {
  const name = keyName(e);
  if (!name) return null;
  const isFn = /^F\d+$/.test(name);
  // 전역 단축키이므로 평소 타자와 겹치지 않게 Ctrl 이나 Alt 를 요구한다 (F 키는 단독 허용)
  if (!isFn && !e.ctrlKey && !e.altKey && !e.metaKey) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(name);
  return parts.join("+");
}

export const formatAccelerator = (accel) => (accel || "").replace("CommandOrControl", "Ctrl");
