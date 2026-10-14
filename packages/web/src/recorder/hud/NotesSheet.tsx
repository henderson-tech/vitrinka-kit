/**
 * The notes sheet (recorder HUD polish D5/D12): this recording's notes and
 * annotations in the board annotation island's anatomy, ported onto the
 * HUD's tokens — a LIST face (№ · kind · age kicker, text, state dot; a
 * filter; ← → ↑ ↓ walk, ↵ opens) and a SPLIT face (the № rail beside the
 * open note: its versions, an edit box, ↳ reference). An edit is a new note
 * that replaces the newest version (D6); a reference opens the note composer
 * with the note as a ↳ chip (D7). Rows come from `noteRows` (notes-rows.ts).
 */
import { type KeyboardEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { AnnotateIcon, CheckIcon, CloseIcon, PencilIcon, ReplyIcon } from './icons';
import { filterRows, type NoteFilter, type NoteRow, walkRows } from './notes-rows';
import { fmtAgo } from './status';

export interface NotesSheetProps {
  /** Presence classes (`grow`/`rise` + `is-open`/`is-closing`). */
  className: string;
  origin: string;
  rows: readonly NoteRow[];
  now: number;
  onEdit: (row: NoteRow, text: string) => void;
  onReference: (row: NoteRow) => void;
  onClose: () => void;
}

const FILTERS: readonly { value: NoteFilter; label: string }[] = [
  { value: 'all', label: 'all' },
  { value: 'regions', label: 'regions' },
  { value: 'notes', label: 'notes' },
];

function kicker(r: NoteRow, now: number): string {
  const edited = r.versions.length > 1 ? ' · edited' : '';
  return `№${r.number} · ${r.region ? 'region' : 'note'} · ${fmtAgo(now - r.at)}${edited}`;
}

export function NotesSheet({ className, origin, rows, now, onEdit, onReference, onClose }: NotesSheetProps): ReactElement {
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [focused, setFocused] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const visible = filterRows(rows, filter);
  // The one tabbable row: the focused one while the filter shows it, else the first.
  const tabCid = visible.some((r) => r.cid === focused) ? focused : (visible[0]?.cid ?? null);
  const row = open ? rows.find((r) => r.cid === open) : undefined;

  // Opening a note puts its newest text in the edit box — only when ANOTHER
  // note opens: a sent edit of this one must not reset the box under the hand.
  const openText = row?.text ?? '';
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === open) return;
    opened.current = open;
    setEdit(openText);
  }, [open, openText]);

  const walk = (e: KeyboardEvent) => {
    // Esc steps back from an open note, else closes the sheet — from any control in it.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (open) setOpen(null);
      else onClose();
      return;
    }
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    if (e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    const next = walkRows(visible, open ?? focused, step);
    if (open) setOpen(next);
    else {
      setFocused(next);
      if (next) list.current?.querySelector<HTMLElement>(`[data-cid="${next}"]`)?.focus();
    }
  };
  const save = () => {
    if (!row) return;
    const text = edit.trim();
    if (!text || text === row.text) return;
    onEdit(row, text);
  };

  if (row) {
    return (
      <div className={`pop notes split ${className}`} style={{ transformOrigin: origin }} role="dialog" aria-label={`Note №${row.number}`} onKeyDown={walk}>
        <div className="pop-head">
          <span className="n-head">
            <button type="button" className="n-word" aria-label="Back to the list" onClick={() => setOpen(null)}>
              ‹
            </button>
            <span className="n-kick">{kicker(row, now)}</span>
          </span>
          <span className="n-acts">
            <button type="button" className="n-word" onClick={() => onReference(row)}>
              <ReplyIcon /> reference
            </button>
            <button type="button" className="closeb" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </span>
        </div>
        <div className="n-split">
          <nav className="n-rail" aria-label="Notes">
            <button type="button" className="n-word" onClick={() => setOpen(null)}>
              all {rows.length}
            </button>
            {visible.map((r) => (
              <button
                key={r.cid}
                type="button"
                className={r.cid === row.cid ? 'n-th on' : 'n-th'}
                aria-current={r.cid === row.cid || undefined}
                aria-label={`№${r.number}`}
                onClick={() => setOpen(r.cid)}
              >
                {r.region ? <AnnotateIcon /> : <PencilIcon />}
                <b>{r.number}</b>
              </button>
            ))}
          </nav>
          <div className="n-body">
            <div className="n-meta">
              {row.region && row.w !== undefined && row.h !== undefined ? `Region ${row.w}×${row.h} · ` : ''}
              {row.route || '/'}
            </div>
            {row.versions.map((v, i) => (
              <div key={v.cid} className={i === row.versions.length - 1 ? 'n-ver' : 'n-ver old'}>
                <span className="n-kick">
                  v{i + 1} · {fmtAgo(now - v.at)}
                  {i === row.versions.length - 1 ? ' · current' : ''}
                </span>
                {v.text || '(no text)'}
              </div>
            ))}
            <textarea
              className="n-edit"
              aria-label={`Edit note №${row.number}`}
              value={edit}
              onChange={(e) => setEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(null);
                }
              }}
            />
            <div className="row nodest">
              <span className="ctx">↩ save as v{row.versions.length + 1} · esc back</span>
              <button type="button" className="sendb" aria-disabled={!edit.trim() || edit.trim() === row.text || undefined} onClick={save}>
                <CheckIcon /> Save edit
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`pop notes ${className}`} style={{ transformOrigin: origin }} role="dialog" aria-label="Notes" onKeyDown={walk}>
      <div className="pop-head">
        <span className="n-title">
          Notes <span className="n-count">{rows.length}</span>
        </span>
        <button type="button" className="closeb" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="n-filter" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
            {f.label} {filterRows(rows, f.value).length}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="n-empty">{rows.length === 0 ? 'Notes and annotations you send while recording show here.' : `No ${filter} yet.`}</p>
      ) : (
        <div ref={list} className="n-list" role="list" aria-label="Notes">
          {visible.map((r) => (
            <div key={r.cid} role="listitem" className={r.cid === focused ? 'n-row on' : 'n-row'}>
              <button
                type="button"
                className="n-open"
                data-cid={r.cid}
                tabIndex={r.cid === tabCid ? 0 : -1}
                aria-label={`${kicker(r, now)} — ${r.text}`}
                onFocus={() => setFocused(r.cid)}
                onClick={() => setOpen(r.cid)}
              >
                <span className={r.region ? 'n-face' : 'n-face note'}>{r.region ? <AnnotateIcon /> : <PencilIcon />}</span>
                <span className="n-lines">
                  <span className="n-kick">{kicker(r, now)}</span>
                  <span className="n-text">{r.text || '(no text)'}</span>
                </span>
                <i className={r.queued ? 'n-dot queued' : r.versions.length > 1 ? 'n-dot edited' : 'n-dot sent'} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The notes sheet's CSS (appended to HUD_CSS): the island's grammar on the HUD's tokens. */
export const NOTES_CSS = `
.pop.notes { width:min(calc(400px * var(--s)), calc(100vw - 24px)); padding:0 0 8px; overflow:hidden; }
.pop.notes.split { width:min(calc(460px * var(--s)), calc(100vw - 24px)); }
.notes .pop-head { height:44px; padding:0 8px 0 16px; }
.n-title { font-weight:700; font-size:calc(var(--fs) + 2.5px); letter-spacing:-.02em; color:var(--fg); }
.n-count, .n-kick { font:500 var(--fs-s)/1.4 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing:.06em; text-transform:uppercase; color:var(--fg-3); }
.n-count { margin-left:6px; }
.n-head, .n-acts { display:flex; align-items:center; gap:6px; min-width:0; }
.n-head .n-kick { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.n-word { all:unset; cursor:pointer; display:inline-flex; align-items:center; gap:4px; padding:5px 7px; border-radius:6px;
  font:500 var(--fs-s)/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing:.06em; text-transform:uppercase; color:var(--fg-2); }
.n-word:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
@media (hover: hover) { .n-word:hover { color:var(--fg); background:var(--ink-2); } }
.n-filter { display:flex; gap:4px; padding:0 12px 8px; }
.n-filter button { all:unset; cursor:pointer; padding:4px 9px; border-radius:999px; font-size:calc(var(--fs) - .5px); font-weight:600; color:var(--fg-3); }
.n-filter button[aria-pressed="true"] { background:var(--ink-3); color:var(--fg); }
.n-filter button:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; }
.n-list { max-height:min(60vh, calc(360px * var(--s))); overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.n-row { position:relative; }
.n-row + .n-row { border-top:1px solid rgba(255,255,255,.07); }
.n-row.on::before { content:""; position:absolute; left:6px; top:50%; width:4px; height:4px; margin-top:-2px; border-radius:9px; background:var(--rec); }
.n-open { all:unset; box-sizing:border-box; cursor:pointer; width:100%; display:grid; grid-template-columns:calc(44px * var(--s)) minmax(0,1fr) 8px;
  gap:12px; align-items:center; padding:10px 16px; }
.n-open:focus-visible { outline:2px solid var(--rec); outline-offset:-2px; border-radius:8px; }
@media (hover: hover) { .n-open:hover { background:rgba(255,255,255,.04); } }
.n-face { display:grid; place-items:center; height:calc(32px * var(--s)); border-radius:5px; background:rgba(0,0,0,.28);
  box-shadow:inset 0 0 0 1.5px rgba(255,59,87,.6); color:var(--rec); }
.n-face.note { box-shadow:inset 0 0 0 1px var(--edge); color:var(--fg-3); }
.n-lines { display:flex; flex-direction:column; gap:2px; min-width:0; }
.n-text { color:var(--fg); font-size:calc(var(--fs) + .5px); line-height:1.35; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.n-dot { width:7px; height:7px; border-radius:50%; }
.n-dot.sent { background:var(--ok); }
.n-dot.queued { background:var(--warn); }
.n-dot.edited { background:#8fb8ff; }
.n-empty { margin:4px 16px 8px; font-size:var(--fs-s); color:var(--fg-3); }
.n-split { display:flex; min-height:0; }
.n-rail { flex:0 0 calc(60px * var(--s)); display:flex; flex-direction:column; align-items:center; gap:7px; padding:4px 0 8px;
  border-right:1px solid rgba(255,255,255,.08); max-height:min(60vh, calc(380px * var(--s))); overflow-y:auto; scrollbar-width:none; }
.n-th { all:unset; cursor:pointer; position:relative; display:grid; place-items:center; width:calc(40px * var(--s)); height:calc(30px * var(--s));
  border-radius:7px; background:rgba(0,0,0,.28); box-shadow:inset 0 0 0 1px var(--edge); color:var(--fg-3); opacity:.7; }
.n-th b { position:absolute; left:4px; bottom:2px; font:600 9px/1 ui-monospace, Menlo, monospace; color:var(--fg-2); }
.n-th.on { opacity:1; box-shadow:0 0 0 2px var(--rec); color:var(--fg); }
.n-th:focus-visible { outline:2px solid var(--rec); outline-offset:2px; }
.n-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; padding:4px 14px 4px;
  max-height:min(60vh, calc(380px * var(--s))); overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.n-meta { font-size:var(--fs-s); color:var(--fg-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.n-ver { padding:8px 10px; border-radius:9px; background:rgba(0,0,0,.22); box-shadow:inset 0 0 0 1px var(--edge);
  font-size:calc(var(--fs) + .5px); line-height:1.4; color:var(--fg); white-space:pre-wrap; overflow-wrap:anywhere; }
.n-ver .n-kick { display:block; margin-bottom:3px; }
.n-ver.old { color:var(--fg-3); text-decoration:line-through; text-decoration-color:rgba(244,239,234,.25); }
.n-ver.old .n-kick { text-decoration:none; }
textarea.n-edit { margin-top:0; min-height:calc(44px * var(--s)); resize:vertical; overflow-y:auto; }
.n-body .row { margin-top:0; }
`;
