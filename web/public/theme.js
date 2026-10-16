// Applies the saved Light / Dark / Auto theme before the app draws, so pages never flash white.
// Kept as a file (not inline) because the Content-Security-Policy allows only scripts from this site.
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
