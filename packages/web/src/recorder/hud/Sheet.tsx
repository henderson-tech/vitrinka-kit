/**
 * The composer sheet — the extension's hud.html, as a component: ≤ 288px
 * anchored to the dock (a bottom sheet on phones), a 14px textarea (16px on
 * touch, so iOS never zooms), ✕ in the title row, a three-column footer
 * (board|task · context · ↑ Send) and the hint line (hidden on touch). Enter sends, ⇧Enter newlines, Esc
 * cancels. The DRAFT is owned by the caller so a cancel keeps it until the
 * next send (recorder-hud-polish D3); the board|task choice resets on every
 * open — a destination is per observation, not a mode.
 */
import { type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { ArrowUpIcon, CloseIcon } from './icons';

export interface SheetProps {
  /** Presence classes (`grow`/`rise` + `is-open`/`is-closing`). */
  className: string;
  /** The corner it grows from (`bottom-right`, …). */
  origin: string;
  title: string;
  ctx: string;
  /** True when the sheet composes an annotation (shows board|task). */
  pick: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string, task: boolean) => void;
  onClose: () => void;
}

export function Sheet({ className, origin, title, ctx, pick, draft, onDraft, onSend, onClose }: SheetProps): ReactElement {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [task, setTask] = useState(false);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const send = () => onSend(draft.trim(), task);
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  const onTaKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
  return (
    <div className={`pop ${className}`} data-origin={origin} role="dialog" aria-labelledby="vt-pop-title" onKeyDown={onKey}>
      <div className="pop-head">
        <span className="title">
          <i />
          <span id="vt-pop-title">{title}</span>
        </span>
        <button type="button" className="closeb" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <textarea
        ref={ta}
        placeholder="what's wrong / what to refine…"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onTaKey}
      />
      <div className={pick ? 'row' : 'row nodest'}>
        {pick ? (
          <span className="dest" role="group" aria-label="Where this snap lands">
            <button type="button" aria-pressed={!task} onClick={() => setTask(false)}>
              board
            </button>
            <button type="button" aria-pressed={task} onClick={() => setTask(true)}>
              task
            </button>
          </span>
        ) : null}
        <span className="ctx">{ctx}</span>
        <button type="button" className="sendb" onClick={send}>
          <ArrowUpIcon />
          <span>Send</span>
        </button>
      </div>
      <div className="hints">↩ send · ⇧↩ newline · esc cancel</div>
    </div>
  );
}
