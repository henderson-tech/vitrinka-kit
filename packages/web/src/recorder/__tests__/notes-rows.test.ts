/**
 * The notes sheet's rows: one per original note, its edits folded in as
 * versions, numbered in capture order, newest first, queued while the
 * newest version waits.
 */
import { describe, expect, it } from 'bun:test';

import type { HudNote } from '../hud/controller';
import { filterRows, noteRows, walkRows } from '../hud/notes-rows';

const note = (cid: string, at: number, extra: Partial<HudNote> = {}): HudNote => ({
  cid,
  text: cid,
  at,
  route: '/forms',
  region: false,
  ...extra,
});

describe('noteRows', () => {
  it('folds an edit chain into its original, numbers in capture order and lists newest first', () => {
    const rows = noteRows(
      [
        note('a', 1, { region: true, w: 226, h: 194 }),
        note('b', 2),
        note('a2', 3, { text: 'a, corrected', replaces: 'a' }),
        note('a3', 4, { text: 'a, corrected twice', replaces: 'a2' }),
      ],
      ['a3'],
    );
    expect(rows.map((r) => r.number)).toEqual([2, 1]);
    const a = rows[1]!;
    expect(a).toMatchObject({ cid: 'a', latestCid: 'a3', text: 'a, corrected twice', region: true, queued: true });
    expect(a.versions.map((v) => v.cid)).toEqual(['a', 'a2', 'a3']);
    expect(rows[0]!.queued).toBe(false);
  });

  it('an edit of a note the log never saw stands as a note of its own', () => {
    const rows = noteRows([note('x', 1, { replaces: 'gone' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.versions).toHaveLength(1);
  });

  it('filters by kind and walks the visible rows', () => {
    const rows = noteRows([note('r', 1, { region: true }), note('n', 2)]);
    expect(filterRows(rows, 'regions').map((r) => r.cid)).toEqual(['r']);
    expect(walkRows(rows, null, 1)).toBe('n');
    expect(walkRows(rows, 'n', 1)).toBe('r');
    expect(walkRows(rows, 'r', 1)).toBe('r');
  });
});
