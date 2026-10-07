// Nastaví téma ještě před vykreslením, aby stránka neproblikla světlou barvou.
(function () {
  try {
    var t = localStorage.getItem('st.theme') || 'dark';
    if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
