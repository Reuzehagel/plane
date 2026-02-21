import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { PresentationState } from "../types";

interface PresentationOverlayProps {
  state: PresentationState;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}

export function PresentationOverlay({ state, onPrev, onNext, onExit }: PresentationOverlayProps): React.JSX.Element {
  const frame = state.frames[state.frameIndex];
  const total = state.frames.length;

  return (
    <div className="presentation-wrapper">
      <div className="presentation-bar">
        <button className="presentation-btn" onClick={onPrev} disabled={state.frameIndex <= 0}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span className="presentation-label">{frame?.label ?? ""}</span>
        <span className="presentation-progress">{state.frameIndex + 1} / {total}</span>
        <button className="presentation-btn" onClick={onNext} disabled={state.frameIndex >= total - 1}>
          <ChevronRight size={16} strokeWidth={2} />
        </button>
        <button className="presentation-btn presentation-exit" onClick={onExit}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
