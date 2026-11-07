import { useEffect, useState } from "react";
import { eventToAccelerator, formatAccelerator } from "./accelerator.js";

// 캡처 단축키 바꾸기: 키 조합을 누르면 바로 등록을 시도하고, 실패하면 이유를 알려 준다.
export default function ShortcutDialog({ current, onChanged, onClose }) {
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const accel = eventToAccelerator(e);
      if (!accel) return; // Ctrl 만 누른 상태 등: 조합이 완성될 때까지 기다린다
      const ok = await window.chh.setCaptureShortcut(accel);
      if (ok) onChanged(accel);
      else setError(`${formatAccelerator(accel)}는 쓸 수 없습니다. 다른 프로그램이 쓰고 있을 수 있어요.`);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onChanged, onClose]);

  return (
    <div className="dlg-back" onPointerDown={onClose}>
      <div className="dlg" onPointerDown={(e) => e.stopPropagation()}>
        <h3>캡처 단축키 바꾸기</h3>
        <p className="dlg-hint">
          새 키 조합을 누르세요. Ctrl이나 Alt를 함께 눌러야 합니다 (F 키는 단독 가능). 다른 프로그램을 쓰는 중에도
          동작하는 단축키입니다.
        </p>
        <div className="shortcut-now">{formatAccelerator(current)}</div>
        {error && <p className="shortcut-error">{error}</p>}
        <div className="dlg-actions">
          <button className="dlg-btn" onClick={onClose}>
            취소 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}
