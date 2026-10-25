// Member account (src/render/c/members.ts): messages take focus, so screen readers announce them.
(() => {
  document.querySelector('.c-account [data-focus]')?.focus();
})();
