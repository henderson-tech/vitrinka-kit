/**
 * The ⋯ menu: who the recorder is linked as, the open board, the device's
 * recent recordings and "Go to vitrinka", then the HUD's own settings —
 * size, verbose details, position (a miniature screen of the eight spots) —
 * and Unlink. A fixed float placed beside the dock by the caller; ↑/↓ move
 * between items, Esc closes.
 */
import { type KeyboardEvent, type ReactElement, type RefObject } from 'react';

import type { HudAccount, HudSize, HudSnapshot } from './controller';
import { HomeIcon, NewTabIcon, UnlinkIcon } from './icons';
import { isVertical, type Place, SPOT_NAMES, SPOTS, type Spot } from './spots';
import { fmtAgo, fmtDuration } from './status';

const SIZES: readonly { size: HudSize; label: string; name: string }[] = [
  { size: 'sm', label: 'S', name: 'Small' },
  { size: 'md', label: 'M', name: 'Medium' },
  { size: 'lg', label: 'L', name: 'Large' },
];

const STATUS_WORDS = { recording: 'recording', saved: 'saved', unsaved: 'not stopped', deleted: 'deleted' } as const;

/** The account line: `lukas@… · ADF`, or the key build's `Recorder key · <name> · project <p>`. */
export function accountLines(account: HudAccount | null, linked: boolean): { who: string; ws: string; sub: string } {
  if (!linked) return { who: 'Not linked', ws: '', sub: 'Link this device to record' };
  if (!account) return { who: 'Linked device', ws: '', sub: 'checking who this is…' };
  if (account.kind === 'key') {
    const bits = ['Recorder key', account.label, account.project ? `project ${account.project}` : null].filter(Boolean);
    return { who: bits.join(' · '), ws: '', sub: account.workspace.name };
  }
  return {
    who: account.user?.email || account.user?.name || 'Linked device',
    ws: account.workspace.name,
    sub: account.label ? `this device · ${account.label}` : 'this device',
  };
}

export interface MenuProps {
  snap: HudSnapshot;
  now: number;
  place: Place;
  className: string;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMove: (place: Place) => void;
  onSize: (size: HudSize) => void;
  onVerbose: (on: boolean) => void;
  onAskUnlink: () => void;
  onLink: () => void;
}

export function Menu(p: MenuProps): ReactElement {
  const { snap } = p;
  const lines = accountLines(snap.account, snap.linked);
  const current: Spot | null = 'spot' in p.place ? p.place.spot : null;
  const rec = snap.recording;
  const sizeIndex = SIZES.findIndex((s) => s.size === snap.prefs.size);

  // ↑/↓ walk the items (radios included); Home/End jump.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')];
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const root = e.currentTarget.getRootNode() as ShadowRoot | Document;
    const at = items.indexOf(root.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  const act = (fn: () => void) => () => {
    p.onClose();
    fn();
  };

  return (
    <div
      ref={p.menuRef}
      className={`float menu ${p.className}`}
      role="menu"
      aria-label="Recorder"
      data-e2e="recorder-menu"
      onKeyDown={onKey}
    >
      <div className="m-head" data-e2e="menu-account">
        {/* an email truncates; a key build's sentence wraps */}
        <div className={snap.account?.kind === 'key' ? 'm-who wraps' : 'm-who'}>
          <span className="email">{lines.who}</span>
          {lines.ws ? <span className="ws">· {lines.ws}</span> : null}
        </div>
        <div className="m-sub">
          {rec ? <span className="live">● recording · </span> : null}
          {lines.sub}
        </div>
      </div>
      {!snap.linked ? (
        <button type="button" role="menuitem" className="mi" onClick={act(p.onLink)}>
          <span>Link recorder</span>
        </button>
      ) : null}
      {rec?.boardUrl ? (
        <a role="menuitem" className="mi" href={rec.boardUrl} target="_blank" rel="noopener noreferrer" onClick={p.onClose}>
          <NewTabIcon /> Open this board
        </a>
      ) : null}
      <div className="m-rule" />
      <div className="m-label" aria-hidden="true">
        Recent
      </div>
      {snap.recents.length === 0 ? <div className="m-empty">No recordings on this device yet</div> : null}
      {snap.recents.map((r) => {
        const live = rec?.sessionId === r.sessionId;
        const meta = [
          live ? 'now' : fmtAgo(p.now - r.startedAt),
          r.durationMs !== undefined ? fmtDuration(r.durationMs) : null,
          live ? 'recording' : STATUS_WORDS[r.status],
        ].filter(Boolean);
        const status = live ? 'recording' : r.status;
        const body = (
          <>
            <span className="r-main">
              <span className="r-title">{r.title || 'Untitled recording'}</span>
              <span className="r-meta">
                <i data-status={status} />
                {meta.join(' · ')}
              </span>
            </span>
            {r.boardUrl ? (
              <span className="end">
                <NewTabIcon />
              </span>
            ) : null}
          </>
        );
        return r.boardUrl ? (
          <a
            key={r.sessionId}
            role="menuitem"
            className="mi recent"
            href={r.boardUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={p.onClose}
            data-e2e="recent"
          >
            {body}
          </a>
        ) : (
          <div key={r.sessionId} role="menuitem" aria-disabled="true" className="mi recent" data-e2e="recent">
            {body}
          </div>
        );
      })}
      <a role="menuitem" className="mi" href={snap.workspaceUrl} target="_blank" rel="noopener noreferrer" onClick={p.onClose}>
        <HomeIcon /> Go to vitrinka
        <span className="end">
          <NewTabIcon />
        </span>
      </a>
      <div className="m-rule" />
      <div className="m-row">
        <span id="vt-size">Size</span>
        <span className="sizes" role="group" aria-labelledby="vt-size" style={{ '--i': String(Math.max(0, sizeIndex)) } as Record<string, string>}>
          {SIZES.map((s) => (
            <button
              key={s.size}
              type="button"
              role="menuitemradio"
              aria-checked={snap.prefs.size === s.size}
              aria-label={`Size ${s.name}`}
              onClick={() => p.onSize(s.size)}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>
      <div
        className="m-row toggle"
        role="menuitemcheckbox"
        aria-checked={snap.prefs.verbose}
        tabIndex={-1}
        onClick={() => p.onVerbose(!snap.prefs.verbose)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          p.onVerbose(!snap.prefs.verbose);
        }}
      >
        <span>Technical details</span>
        <span className="switch" data-on={String(snap.prefs.verbose)} />
      </div>
      <div className="m-row">
        <span id="vt-move">Position</span>
        <span className="screen" role="group" aria-labelledby="vt-move">
          {SPOTS.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={current === s}
              aria-label={`Move to ${SPOT_NAMES[s]}`}
              data-v={isVertical(s) ? '' : undefined}
              style={gridCell(s)}
              onClick={act(() => p.onMove({ spot: s }))}
            />
          ))}
        </span>
      </div>
      {snap.canUnlink ? (
        <>
          <div className="m-rule" />
          <button type="button" role="menuitem" className="mi danger" onClick={act(p.onAskUnlink)}>
            <UnlinkIcon /> Unlink this device
          </button>
        </>
      ) : null}
      {snap.prefs.verbose ? <div className="m-foot">{snap.version}</div> : null}
    </div>
  );
}

/** The cell a spot takes in the 3×3 miniature (the centre stays empty). */
function gridCell(s: Spot): { gridRow: number; gridColumn: number } {
  const row = { t: 1, m: 2, b: 3 }[s[0] as 't' | 'm' | 'b'];
  const col = { l: 1, c: 2, r: 3 }[s[1] as 'l' | 'c' | 'r'];
  return { gridRow: row, gridColumn: col };
}
