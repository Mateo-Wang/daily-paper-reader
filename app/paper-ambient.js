(function () {
  'use strict';

  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  const FINE_POINTER = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
  const MAX_PETALS = 8;
  const MIN_INTERVAL_MS = 125;
  const MIN_DISTANCE = 30;
  let layer = null;
  let lastAt = 0;
  let lastX = 0;
  let lastY = 0;

  const enabled = () => (
    document.body.classList.contains('dpr-paper-page') &&
    window.innerWidth > 1023 &&
    !(REDUCED_MOTION && REDUCED_MOTION.matches) &&
    !(FINE_POINTER && !FINE_POINTER.matches)
  );

  const ensureLayer = () => {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'dpr-cursor-petals';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    return layer;
  };

  const removeLayerWhenInactive = () => {
    if (!document.body.classList.contains('dpr-paper-page') && layer) {
      layer.remove();
      layer = null;
    }
  };

  const spawnPetal = (event) => {
    if (!enabled()) return;
    const now = Date.now();
    const distance = Math.hypot(event.clientX - lastX, event.clientY - lastY);
    if (now - lastAt < MIN_INTERVAL_MS || distance < MIN_DISTANCE) return;
    lastAt = now;
    lastX = event.clientX;
    lastY = event.clientY;

    const host = ensureLayer();
    while (host.childElementCount >= MAX_PETALS && host.firstElementChild) {
      host.firstElementChild.remove();
    }

    const petal = document.createElement('i');
    petal.className = 'dpr-cursor-petal';
    petal.style.left = `${event.clientX + (Math.random() * 8 - 4)}px`;
    petal.style.top = `${event.clientY + (Math.random() * 8 - 4)}px`;
    petal.style.setProperty('--dpr-petal-rotate', `${Math.round(Math.random() * 180)}deg`);
    petal.style.setProperty('--dpr-petal-drift', `${Math.round(Math.random() * 30 - 15)}px`);
    petal.addEventListener('animationend', () => petal.remove(), { once: true });
    host.appendChild(petal);
  };

  document.addEventListener('pointermove', spawnPetal, { passive: true });
  document.addEventListener('dpr-docsify-ready', removeLayerWhenInactive);
  window.addEventListener('hashchange', () => window.setTimeout(removeLayerWhenInactive, 180));
  if (window.MutationObserver && document.body) {
    new window.MutationObserver(removeLayerWhenInactive).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
})();
