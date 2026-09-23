/**
 * The e2e host page: a tiny React app with the recorder mounted, bundled by
 * the spec into an IIFE (React, react-dom and rrweb included) and served by
 * a node:http fixture. `window.__VT_CFG` carries the stub's URL + a key.
 */
import { createElement, type ReactElement, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { VitrinkaRecorderPill, VitrinkaRecorderRoot } from '../../src/recorder';

declare global {
  interface Window {
    __VT_CFG: { url: string; key: string };
  }
}

function App(): ReactElement {
  const [count, setCount] = useState(0);
  return createElement(
    'main',
    { style: { padding: 40, fontFamily: 'sans-serif' } },
    createElement('h1', null, 'Fixture'),
    createElement('button', { id: 'buy', onClick: () => setCount((c) => c + 1) }, `Buy now (${count})`),
    createElement(
      'button',
      { id: 'go', onClick: () => history.pushState({}, '', '/orders/42') },
      'Go to order',
    ),
    createElement(
      'div',
      { id: 'target', style: { marginTop: 40, width: 400, maxWidth: '100%', height: 200, background: '#eee' } },
      'Drag a region over me',
    ),
    // ?underlink: a page link right under the HUD's resting spot (bottom right).
    new URLSearchParams(location.search).has('underlink') &&
      createElement(
        'a',
        { id: 'under-link', href: '/help', style: { position: 'fixed', right: 0, bottom: 0, width: 360, height: 160, background: '#dde' } },
        'Help centre',
      ),
  );
}

const cfg = window.__VT_CFG;
createRoot(document.getElementById('root')!).render(
  createElement(
    VitrinkaRecorderRoot,
    { url: cfg.url, recorderKey: cfg.key || undefined },
    createElement(App),
    createElement(VitrinkaRecorderPill, { title: 'e2e journey' }),
  ),
);
