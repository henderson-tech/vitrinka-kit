/** `shortSelector` — the extension's heuristic, on a minimal Element stand-in. */
import { describe, expect, it } from 'bun:test';

import { shortSelector } from '../capture/click';

interface Fake {
  id?: string;
  tag: string;
  classes?: string[];
  attrs?: Record<string, string>;
  parent?: Fake;
}

function el(f: Fake): Element {
  const node = {
    id: f.id ?? '',
    tagName: f.tag.toUpperCase(),
    classList: f.classes ?? [],
    getAttribute: (n: string) => f.attrs?.[n] ?? null,
    get parentElement() {
      return f.parent ? el(f.parent) : null;
    },
  };
  return node as unknown as Element;
}

describe('shortSelector', () => {
  it('prefers an id, then a test id, then a short tag.class path', () => {
    expect(shortSelector(el({ tag: 'button', id: 'buy' }))).toBe('#buy');
    expect(shortSelector(el({ tag: 'button', attrs: { 'data-testid': 'buy-now' } }))).toBe('[data-testid="buy-now"]');
    const deep = el({
      tag: 'span',
      classes: ['label', 'x', 'y'],
      parent: { tag: 'button', classes: ['btn'], parent: { tag: 'form', parent: { tag: 'main', parent: { tag: 'body' } } } },
    });
    expect(shortSelector(deep)).toBe('main > form > button.btn > span.label.x');
  });

  it('stops the path at an ancestor with an id', () => {
    const e = el({ tag: 'a', parent: { tag: 'li', parent: { tag: 'ul', id: 'nav' } } });
    expect(shortSelector(e)).toBe('#nav > li > a');
    expect(shortSelector(null)).toBe('');
  });
});
