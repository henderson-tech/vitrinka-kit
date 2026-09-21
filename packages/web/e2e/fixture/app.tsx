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
      { id: 'target', style: { marginTop: 40, width: 400, height: 200, background: '#eee' } },
      'Drag a region over me',
    ),
  );
}

const cfg = window.__VT_CFG;
createRoot(document.getElementById('root')!).render(
  createElement(
    VitrinkaRecorderRoot,
    { url: cfg.url, recorderKey: cfg.key },
    createElement(App),
    createElement(VitrinkaRecorderPill, { title: 'e2e journey' }),
  ),
);
