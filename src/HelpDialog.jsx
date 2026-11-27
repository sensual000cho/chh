import { Fragment, useEffect } from "react";
import { formatAccelerator } from "./accelerator.js";

// CHH 도움말: 이 앱에서 더한 기능과 단축키를 Excalidraw 도움말과 같은 모양(이름 + 키)으로 보여 준다.
// 그리기 도구 단축키는 "그리기 단축키" 버튼으로 Excalidraw 도움말을 연다.

// keys: 키 묶음 목록 (묶음 사이는 "또는"). hint: 키 대신 오른쪽에 쓰는 짧은 안내.
const row = (label, keys, hint) => ({ label, keys, hint });

function Keys({ keys }) {
  return keys.map((combo, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="help-or">또는</span>}
      {combo.map((k) => (
        <kbd key={k} className="help-key">
          {k}
        </kbd>
      ))}
    </Fragment>
  ));
}

export default function HelpDialog({ desktop, captureKey, onShowEditorHelp, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const capture = formatAccelerator(captureKey).split("+");

  const board = desktop
    ? [
        row("새 보드", [["Ctrl", "N"]]),
        row("보드 열기", [["Ctrl", "O"]]),
        row("저장", [["Ctrl", "S"]]),
        row("다른 이름으로 저장", [["Ctrl", "Shift", "S"]]),
        row(".chh 파일 열기", [["끌어다 놓기"], ["더블클릭"]]),
        row("최근 작업 파일", null, "메인 메뉴"),
        row("자동 저장 · 복구", null, "자동"),
        row("자동 저장 백업 폴더", null, "메인 메뉴"),
      ]
    : [
        row("자동 저장", null, "브라우저에 자동"),
        row("파일로 저장", null, "메인 메뉴 → 다른 이름으로 저장"),
      ];

  const collect = [
    desktop && row("화면 캡처", [capture]),
    desktop && row("캡처 취소", [["Esc"]]),
    row("이미지 · GIF · 영상 가져오기", [["Ctrl", "V"], ["끌어다 놓기"]]),
    row("유튜브 · 비메오 · 영상 주소", [["Ctrl", "V"], ["끌어다 놓기"]]),
    row("유튜브 카드 재생", null, "가운데를 클릭"),
    row("파일 고르기", null, desktop ? "제목 표시줄 · 메인 메뉴" : "메인 메뉴"),
    row("메모", [["N"]]),
    row("웹 이미지 출처 링크", null, "자동"),
  ];

  const organize = [
    row("선택 항목 묶기 / 묶음 풀기", [["Alt", "G"]]),
    row("묶음 이름 바꾸기", [["Enter"]]),
    row("이미지 자동 정렬", null, desktop ? "제목 표시줄 · 메인 메뉴" : "메인 메뉴"),
    row("보드에서 찾기", [["Ctrl", "F"]]),
    row("되돌리기", [["Ctrl", "Z"]]),
    desktop && row("이미지를 다른 앱으로 복사", [["Ctrl", "C"]]),
    desktop && row("레퍼런스 이미지 폴더로 저장", null, "메인 메뉴"),
  ];

  const view = [
    row("UI 숨기기 / 보이기", [["Tab"]]),
    row("메인 메뉴", [["Esc"]]),
    row("도움말", [["F1"], ["?"]]),
    desktop && row("창 이동", [["우클릭 드래그"]]),
    desktop && row("클릭 통과 해제", [["Ctrl", "Shift", "L"]]),
    desktop && row("항상 위 · 투명도", null, "제목 표시줄"),
    row("캔버스 배경색", null, "메인 메뉴"),
    row("선 · 배경 색", null, "속성 패널 색 버튼"),
  ];

  const island = (title, rows) => (
    <section className="help-island">
      <h4>{title}</h4>
      <div className="help-island-content">
        {rows.filter(Boolean).map((r) => (
          <div className="help-shortcut" key={r.label}>
            <span>{r.label}</span>
            <span className="help-keys">{r.keys ? <Keys keys={r.keys} /> : <span className="help-hint">{r.hint}</span>}</span>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="dlg-back" onPointerDown={onClose}>
      <div className="help-dlg" role="dialog" aria-label="도움말" onPointerDown={(e) => e.stopPropagation()}>
        <div className="help-head">
          <h2>도움말</h2>
          <button className="help-close" title="닫기 (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="help-body">
          <div className="help-col">
            {island("보드", board)}
            {island("모으기", collect)}
          </div>
          <div className="help-col">
            {island("정리", organize)}
            {island("화면과 창", view)}
          </div>
        </div>
        <div className="help-foot">
          <button className="help-btn" onClick={onShowEditorHelp}>
            그리기 도구 단축키 보기
          </button>
        </div>
      </div>
    </div>
  );
}
