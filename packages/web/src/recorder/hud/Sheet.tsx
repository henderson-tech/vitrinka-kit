/**
 * The composer sheet — the extension's hud.html, as a component: ≤ 288px
 * anchored to the dock (a bottom sheet on phones), a 14px textarea (16px on
 * touch, so iOS never zooms), ✕ in the title row, a three-column footer
 * (board|task · context · ↑ Send) and the hint line (hidden on touch). Enter sends, ⇧Enter newlines, Esc
 * cancels. The DRAFT is owned by the caller so a cancel keeps it until the
 * next send (recorder-hud-polish D3); the board|task choice resets on every
 * open — a destination is per observation, not a mode. The bug report is the
 * same sheet: a required description and "Mark on screen" in the board|task
 * slot.
 *
 * Images (recorder attachments), only when the caller passes `images`: the
 * paperclip beside Send picks them, an image paste on the textarea and a
 * drop onto the sheet add them (attach.ts normalizes each), a strip of
 * thumbnails above the footer removes them, at most `MAX_ATTACHMENTS`. Like
 * the text, the caller owns them, so a cancel keeps them. A refusal (not an
 * image, the cap) shows in the footer's context slot — one line, so the
 * footer never moves.
 */
import {
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

import { MAX_ATTACHMENTS, normalizeAttachment, pastedName } from './attach';
import type { HudAttachment } from './controller';
import { ArrowUpIcon, CloseIcon, PaperclipIcon, SpinnerIcon } from './icons';

/** How long a refusal holds the context slot. */
const REFUSAL_MS = 5000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A stable React key per image (a name can repeat, an index shifts on remove). */
const keys = new WeakMap<HudAttachment, number>();
let lastKey = 0;
function keyOf(image: HudAttachment): number {
  let k = keys.get(image);
  if (k === undefined) keys.set(image, (k = ++lastKey));
  return k;
}

/** A drag that carries files (not a text selection or a link). */
const carriesFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer.types).includes('Files');

function Thumb({ image, onRemove }: { image: HudAttachment; onRemove: () => void }): ReactElement {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(image.blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [image.blob]);
  return (
    <li className="att">
      {src ? <img src={src} alt={image.name} /> : null}
      <button type="button" className="attx" aria-label={`Remove ${image.name}`} onClick={onRemove}>
        <CloseIcon />
      </button>
    </li>
  );
}

export interface SheetProps {
  /** Presence classes (`grow`/`rise` + `is-open`/`is-closing`). */
  className: string;
  /** CSS transform-origin: the point nearest the dock it grows from. */
  origin: string;
  title: string;
  ctx: string;
  /** True when the sheet composes an annotation (shows board|task). */
  pick: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string, task: boolean) => void;
  onClose: () => void;
  placeholder?: string;
  /** Send stays off until the description has text. */
  required?: boolean;
  /** Shows "Mark on screen" (instead of board|task): pick a region or element. */
  onMark?: () => void;
  /** Something is marked (the button reads pressed). */
  marked?: boolean;
  /** The draft's images; absent = the host takes none (no paperclip, paste or drop). */
  images?: readonly HudAttachment[];
  onImages?: Dispatch<SetStateAction<readonly HudAttachment[]>>;
}

export function Sheet({
  className,
  origin,
  title,
  ctx,
  pick,
  draft,
  onDraft,
  onSend,
  onClose,
  placeholder = "what's wrong / what to refine…",
  required = false,
  onMark,
  marked = false,
  images,
  onImages,
}: SheetProps): ReactElement {
  const ta = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [task, setTask] = useState(false);
  // Files still being normalized; Send waits for them.
  const [busy, setBusy] = useState(0);
  const [refusal, setRefusal] = useState('');
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    if (!refusal) return;
    const t = setTimeout(() => setRefusal(''), REFUSAL_MS);
    return () => clearTimeout(t);
  }, [refusal]);
  const empty = required && draft.trim() === '';
  const held = images?.length ?? 0;
  const full = held + busy >= MAX_ATTACHMENTS;
  const send = () => {
    if (empty || busy > 0) {
      ta.current?.focus();
      return;
    }
    onSend(draft.trim(), task);
  };
  // Normalize in order (the strip keeps the order they came in); the cap is
  // re-checked as each lands, so two quick adds never pass it.
  const attach = (files: readonly File[], pasted = false) => {
    if (!onImages || !files.length) return;
    const take = files.slice(0, Math.max(0, MAX_ATTACHMENTS - held - busy));
    setRefusal(take.length < files.length ? `${MAX_ATTACHMENTS} images at most` : '');
    if (!take.length) return;
    setBusy((n) => n + take.length);
    void (async () => {
      for (const f of take) {
        try {
          const image = await normalizeAttachment(f, pasted ? pastedName(f) : f.name || 'image');
          onImages((prev) => (prev.length >= MAX_ATTACHMENTS ? prev : [...prev, image]));
        } catch (e) {
          setRefusal(errorText(e));
        } finally {
          setBusy((n) => n - 1);
        }
      }
    })();
  };
  const remove = (image: HudAttachment) => {
    onImages?.((prev) => prev.filter((x) => x !== image));
    setRefusal('');
    ta.current?.focus();
  };
  const browse = () => {
    if (full) {
      setRefusal(`${MAX_ATTACHMENTS} images at most`);
      return;
    }
    file.current?.click();
  };
  // An image paste attaches; a text paste stays a text paste (an office app
  // puts a picture of the copied cells beside their text), unless the text
  // is only a copied file's name.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onImages) return;
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    const text = e.clipboardData.getData('text/plain').trim();
    if (text && !files.some((f) => f.name && text.includes(f.name))) return;
    e.preventDefault();
    attach(files, true);
  };
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!onImages || !carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!onImages || !carriesFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    attach(Array.from(e.dataTransfer.files));
  };
  const sendb = (
    <button type="button" className="sendb" aria-disabled={empty || busy > 0 || undefined} onClick={send}>
      <ArrowUpIcon />
      <span>Send</span>
    </button>
  );
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
    <div
      className={`pop ${className}${dropping ? ' dropping' : ''}`}
      style={{ transformOrigin: origin }}
      role="dialog"
      aria-labelledby="vt-pop-title"
      onKeyDown={onKey}
      {...(onImages ? { onDragEnter: onDragOver, onDragOver, onDragLeave, onDrop } : {})}
    >
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
        placeholder={placeholder}
        aria-required={required || undefined}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onTaKey}
        {...(onImages ? { onPaste } : {})}
      />
      {images && (images.length > 0 || busy > 0) ? (
        <ul className="atts" aria-label="Attached images">
          {images.map((image) => (
            <Thumb key={keyOf(image)} image={image} onRemove={() => remove(image)} />
          ))}
          {Array.from({ length: busy }, (_, i) => (
            <li key={`busy${i}`} className="att busy" aria-label="Preparing image">
              <SpinnerIcon />
            </li>
          ))}
        </ul>
      ) : null}
      <div className={pick || onMark ? 'row' : 'row nodest'}>
        {onMark ? (
          <span className="dest">
            <button type="button" aria-pressed={marked} onClick={onMark}>
              Mark on screen
            </button>
          </span>
        ) : pick ? (
          <span className="dest" role="group" aria-label="Where this snap lands">
            <button type="button" aria-pressed={!task} onClick={() => setTask(false)}>
              board
            </button>
            <button type="button" aria-pressed={task} onClick={() => setTask(true)}>
              task
            </button>
          </span>
        ) : null}
        {refusal ? (
          <span className="ctx bad" title={refusal}>
            {refusal}
          </span>
        ) : (
          <span className="ctx">{ctx}</span>
        )}
        {onImages ? (
          <span className="acts">
            <button type="button" className="clipb" aria-label="Attach image" aria-disabled={full || undefined} onClick={browse}>
              <PaperclipIcon />
            </button>
            <input
              ref={file}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                attach(Array.from(e.currentTarget.files ?? []));
                // The same file picked again is a change too.
                e.currentTarget.value = '';
              }}
            />
            {sendb}
          </span>
        ) : (
          sendb
        )}
      </div>
      {onImages ? (
        <span className="sr" role="status">
          {refusal}
        </span>
      ) : null}
      <div className="hints">↩ send · ⇧↩ newline · esc cancel</div>
    </div>
  );
}
