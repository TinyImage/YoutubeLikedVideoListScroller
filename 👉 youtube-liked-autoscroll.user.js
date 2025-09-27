// ==UserScript==
// @name         YouTube Liked Videos Auto-Scroller
// @namespace    yt-liked-autoscroll-robust
// @version      2.0
// @description  Automatically loads all video snippets in the YouTube "Liked Videos" (LL) playlist
// @match        https://www.youtube.com/playlist?list=LL
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --- Settings ---
  const autoStartOnLL = true;
  const maxScrolls = 2000;             // Safety limit
  const idleStallChecks = 10;          // how many times no growth is allowed
  const waitBetweenScrollsMs = 700;    // Wait time after scroll
  const extraWaitAfterStallMs = 1600;  // additional patience for short stalls
  const afterSpinnerExtraWaitMs = 600; // extra wait if spinner was visible
  const debug = false;

  // --- State ---
  let running = false;
  let scrollCount = 0;
  let lastItemCount = 0;
  let stallCount = 0;

  // --- UI: Badge + Button ---
  const badge = document.createElement('div');
  Object.assign(badge.style, {
    position: 'fixed', right: '14px', bottom: '14px', zIndex: 999999,
    background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 10px',
    borderRadius: '10px', font: '12px system-ui, sans-serif', pointerEvents: 'none'
  });
  badge.textContent = 'Auto-Scroll: off';
  document.documentElement.appendChild(badge);
  function setBadge() {
    badge.textContent = `Auto-Scroll: ${running ? 'on' : 'off'} | Scrolls: ${scrollCount}`;
  }

  const btn = document.createElement('button');
  btn.textContent = 'Start autoscroll';
  Object.assign(btn.style, {
    position: 'fixed', right: '14px', bottom: '54px', zIndex: 999999,
    background: '#0f0f0f', color: '#fff', padding: '8px 10px',
    borderRadius: '10px', font: '12px system-ui, sans-serif', border: '1px solid #333',
    cursor: 'pointer'
  });
  btn.addEventListener('click', () => {
    if (!running) start();
    else stop('Manually stopped.');
  });
  document.documentElement.appendChild(btn);

  document.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === 'A' || e.key === 'a')) start();
    if (e.shiftKey && (e.key === 'X' || e.key === 'x')) stop('Manually stopped.');
  });

  // --- Helpers ---
  function log(...args) { if (debug) console.log('[YLAS2]', ...args); }

  function isOnLikedPlaylist() {
    // Liked Videos are usually a playlist with list=LL (private)
    return /[?&]list=LL(&|$)/.test(location.search);
  }

  function getScrollElement() {
    // By default, the document-wide scrolling element
    return document.scrollingElement || document.documentElement || document.body;
  }

  function getVideoItems() {
    // Primarily for playlist view:
    const playlistList = document.querySelector('ytd-playlist-video-list-renderer');
    let items = [];
    if (playlistList) {
      items = playlistList.querySelectorAll('ytd-playlist-video-renderer');
    }
    // Fallback: In case YT changes layout (Grid/Shelf)
    if (!items || items.length === 0) {
      items = document.querySelectorAll(
        'ytd-playlist-video-renderer,' +                      // Playlist item
        'ytd-rich-item-renderer ytd-rich-grid-media,' +      // Start/Grid view
        'ytd-video-renderer'                                 // general video renderer
      );
    }
    return Array.from(items);
  }

  function hasContinuation() {
    return !!document.querySelector(
      'ytd-continuation-item-renderer, ' +
      'yt-chip-cloud-chip-renderer[is-scrollable-continuation], ' + // rare
      '[continuation]'
    );
  }

  function isSpinnerVisible() {
    // Spinner/Progress bar variants
    return !!document.querySelector(
      'ytd-continuation-item-renderer paper-spinner,' +
      'ytd-continuation-item-renderer [role="progressbar"],' +
      'tp-yt-paper-spinner, ' +
      'yt-progress-bar[active]'
    );
  }

  function atBottom() {
    const el = getScrollElement();
    return el.scrollTop + window.innerHeight >= el.scrollHeight - 2;
  }

  function smartScrollToBottom() {
    const el = getScrollElement();
    // once all the way down
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    // little wiggle (often triggers lazy-load)
    el.scrollTo({ top: el.scrollHeight - 1, behavior: 'instant' });
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
    scrollCount++;
    setBadge();
  }

  function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

  function toast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'fixed', left: '50%', bottom: '88px', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.85)', color: '#fff', padding: '10px 14px',
      borderRadius: '10px', zIndex: 1000000, font: '13px system-ui, sans-serif'
    });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  // --- Core logic ---
  let loopPromise = null;

  async function loop() {
    let localIdle = 0;
    while (running) {
      const before = getVideoItems().length;
      if (!atBottom()) smartScrollToBottom();
      else smartScrollToBottom();

      await sleep(waitBetweenScrollsMs);

      // Wait if spinner is active
      let spinnerWaited = false;
      if (isSpinnerVisible()) {
        spinnerWaited = true;
        await sleep(700);
      }

      const after = getVideoItems().length;
      if (after > lastItemCount) {
        lastItemCount = after;
        stallCount = 0;
        localIdle = 0;
      } else {
        stallCount++;
        localIdle++;
      }

      if (spinnerWaited) {
        await sleep(afterSpinnerExtraWaitMs);
      } else if (localIdle >= 2) {
        await sleep(extraWaitAfterStallMs);
      }

      const cont = hasContinuation();
      const stillSpinning = isSpinnerVisible();

      // End conditions
      if (stallCount >= idleStallChecks && !stillSpinning && !cont) {
        stop('Done: No further videos to load found.');
        break;
      }
      if (scrollCount >= maxScrolls) {
        stop('Stopped: Safety limit reached.');
        break;
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    scrollCount = 0;
    lastItemCount = getVideoItems().length || 0;
    stallCount = 0;
    setBadge();
    btn.textContent = 'Stop autoscroll';
    toast('Autoscroll started (Shift+X to stop).');
    loopPromise = loop();
  }

  function stop(msg) {
    running = false;
    setBadge();
    btn.textContent = 'Start autoscroll';
    if (msg) toast(msg);
  }

  // --- YouTube SPA Navigation Hooks ---
  function onNavigate() {
    // on every route change, wait briefly, then autostart if applicable
    setTimeout(() => {
      if (autoStartOnLL && isOnLikedPlaylist()) start();
      else stop(); // automatically off on other pages
    }, 400);
  }

  // YouTube fires this event on SPA navigation
  window.addEventListener('yt-navigate-finish', onNavigate);
  // Fallback: History patches (in case above doesn’t fire)
  const _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(this, arguments);
    onNavigate();
  };
  window.addEventListener('popstate', onNavigate);

  // Initial
  setBadge();
  onNavigate();
})();
