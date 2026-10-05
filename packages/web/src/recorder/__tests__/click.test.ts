/**
 * `shortSelector` — the extension's heuristic — and the click's text, which
 * never shows more than the DOM lane does; on minimal Element stand-ins.
 */
import { afterEach, describe, expect, it } from 'bun:test';

import { clickText, elementText, shortSelector } from '../capture/click';
import { setRedactionPolicy } from '../capture/redact';

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

interface TextFake {
  tag: string;
  text?: string;
  value?: string;
  /** A mask class on this element or an ancestor (what `closest` finds). */
  within?: string;
  /** A mask class on a descendant (what `querySelector` finds). */
  around?: string;
}

function textEl(f: TextFake): Element {
  const has = (sel: string, cls: string | undefined) => cls !== undefined && sel.split(',').includes(cls);
  const node = {
    tagName: f.tag.toUpperCase(),
    innerText: f.text ?? '',
    value: f.value,
    matches: (sel: string) => sel.split(',').includes(f.tag),
    closest: (sel: string): unknown => (has(sel, f.within) ? node : null),
    querySelector: (sel: string): unknown => (has(sel, f.around) ? {} : null),
  };
  return node as unknown as Element;
}

describe('elementText', () => {
  it('never reads a form field, even one holding a value', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(elementText(textEl({ tag, value: 'hunter2', text: 'hunter2' }))).toBe('');
    }
    expect(elementText(textEl({ tag: 'button', text: '  Buy now  ' }))).toBe('Buy now');
  });

  it('is empty at, under or around an rr-mask / rr-block element', () => {
    expect(elementText(textEl({ tag: 'span', text: '4111 1111 1111 1111', within: '.rr-mask' }))).toBe('');
    expect(elementText(textEl({ tag: 'a', text: 'Reset code 829104', within: '.rr-block' }))).toBe('');
    expect(elementText(textEl({ tag: 'button', text: 'Card 4111 1111', around: '.rr-mask' }))).toBe('');
  });
});

describe('clickText', () => {
  afterEach(() => setRedactionPolicy(null));

  it('records no text at all under a maskAllText policy', () => {
    const button = textEl({ tag: 'button', text: 'Pay 1200' });
    expect(clickText(button)).toBe('Pay 1200');
    setRedactionPolicy({ maskAllText: true });
    expect(clickText(button)).toBe('');
  });
});
