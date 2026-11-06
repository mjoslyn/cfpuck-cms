// Gallery sliders (.c-gallery.is-slider): the track scrolls natively (swipe, trackpad, keyboard);
// this adds previous/next buttons (when it has them), dots (.c-gallery__dots: one per stop) and, with
// data-autoplay="<seconds>", advances on a timer.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function init(gallery) {
    const track = gallery.querySelector(':scope > .c-gallery__track');
    const prev = gallery.querySelector(':scope > .c-gallery__prev');
    const next = gallery.querySelector(':scope > .c-gallery__next');
    const dots = gallery.querySelector(':scope > .c-gallery__dots');
    if (!track) return;

    const step = () => {
      const item = track.firstElementChild;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return item ? item.getBoundingClientRect().width + gap : track.clientWidth;
    };
    const atStart = () => track.scrollLeft <= 1;
    const atEnd = () => track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
    const stops = () => Math.max(1, Math.ceil((track.scrollWidth - track.clientWidth - 1) / step()) + 1);
    const current = () => (atEnd() ? stops() - 1 : Math.round(track.scrollLeft / step()));
    const fits = () => track.scrollWidth <= track.clientWidth + 1;
    const drawDots = () => {
      if (!dots) return;
      const n = fits() ? 0 : stops();
      dots.hidden = n < 2;
      if (dots.children.length !== n) {
        dots.replaceChildren(
          ...Array.from({ length: n }, (_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('aria-label', `${i + 1} of ${n}`);
            b.addEventListener('click', () => track.scrollTo({ left: i === n - 1 ? track.scrollWidth : i * step() }));
            return b;
          }),
        );
      }
      const at = current();
      Array.from(dots.children).forEach((b, i) => b.setAttribute('aria-current', String(i === at)));
    };
    const update = () => {
      if (prev && next) {
        prev.hidden = next.hidden = fits();
        prev.disabled = atStart();
        next.disabled = atEnd();
      }
      drawDots();
    };
    const go = (dir) => track.scrollBy({ left: dir * step() });

    prev?.addEventListener('click', () => go(-1));
    next?.addEventListener('click', () => go(1));
    track.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(track);
    update();

    const seconds = Number(gallery.dataset.autoplay);
    if (!(seconds > 0)) return;
    let paused = false;
    const pause = () => (paused = true);
    const resume = () => (paused = false);
    gallery.addEventListener('mouseenter', pause);
    gallery.addEventListener('mouseleave', resume);
    gallery.addEventListener('focusin', pause);
    gallery.addEventListener('focusout', resume);
    // A swipe means the visitor has taken over.
    track.addEventListener('touchstart', pause, { passive: true });
    setInterval(() => {
      if (paused || document.hidden || reduceMotion.matches || fits()) return;
      if (atEnd()) track.scrollTo({ left: 0 });
      else go(1);
    }, seconds * 1000);
  }

  document.querySelectorAll('.c-gallery.is-slider').forEach(init);
})();
