// Applies the saved Light / Dark / Auto theme before the app draws, so pages never flash white.
// Kept as a file (not inline) because the Content-Security-Policy allows only scripts from this site.
// Same key and rules as web/src/lib/theme.ts — change both together.
(function () {
  try {
    var pref = localStorage.getItem('hzc-theme') || 'light';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    // Print pages (voucher sheets, receipts) always stay light.
    if (location.pathname.indexOf('/print') === 0) dark = false;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    /* storage blocked: stay light */
  }
})();

// Never shown inside another site's frame: a hidden frame could trick a signed-in owner into
// clicking buttons (the hosting cannot send a frame-ancestors header for a static site).
(function () {
  if (window.top === window.self) return;
  document.documentElement.style.display = 'none';
  try {
    window.top.location = window.self.location.href;
  } catch (e) {
    /* the other site blocks it: the page simply stays hidden */
  }
})();
