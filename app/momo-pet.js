(function () {
  'use strict';

  var SPRITESHEET_URL = 'app/pets/momo/spritesheet.webp';
  var POSITION_KEY = 'dpr.momo.position.v1';
  var SESSION_HIDDEN_KEY = 'dpr.momo.hidden';
  var APPROACH_RADIUS = 250;
  var DRAG_THRESHOLD = 5;
  var VIEWPORT_MARGIN = 6;

  var ANIMATIONS = Object.freeze({
    idle: { row: 0, frames: 6, durations: [280, 110, 110, 140, 140, 320] },
    runRight: { row: 1, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
    runLeft: { row: 2, frames: 8, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
    wave: { row: 3, frames: 4, durations: [140, 140, 140, 280] },
    jump: { row: 4, frames: 5, durations: [140, 140, 140, 140, 280] },
    startled: { row: 5, frames: 8, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
    doze: { row: 6, frames: 6, durations: [150, 150, 150, 150, 150, 260] },
    play: { row: 7, frames: 6, durations: [120, 120, 120, 120, 120, 220] },
    preen: { row: 8, frames: 6, durations: [150, 150, 150, 150, 150, 280] },
  });

  // 挥翅/跳跃图集在保持羽翼完整时会留下更多透明留白。这里仅在对应帧播放时
  // 补偿画布留白，保证眼镜、头部和躯干在视觉上不忽大忽小；不改图集坐标。
  var FRAME_SCALE_COMPENSATION = Object.freeze({
    '3:1': 1.158,
    '3:2': 1.145,
    '4:1': 1.037,
    '4:2': 1.385,
  });

  function clamp(value, min, max) {
    return Math.min(Math.max(Number(value) || 0, min), max);
  }

  function directionIndex(dx, dy) {
    if (!dx && !dy) return null;
    var degrees = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (degrees < 0) degrees += 360;
    return Math.round(degrees / 22.5) % 16;
  }

  function directionCell(index) {
    var safe = ((Number(index) || 0) % 16 + 16) % 16;
    return { row: safe < 8 ? 9 : 10, column: safe % 8 };
  }

  function normalizedPosition(x, y, width, height, viewportWidth, viewportHeight) {
    var maxX = Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
    var maxY = Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);
    var safeX = clamp(x, VIEWPORT_MARGIN, maxX);
    var safeY = clamp(y, VIEWPORT_MARGIN, maxY);
    return {
      x: safeX,
      y: safeY,
      xRatio: maxX > VIEWPORT_MARGIN ? (safeX - VIEWPORT_MARGIN) / (maxX - VIEWPORT_MARGIN) : 1,
      yRatio: maxY > VIEWPORT_MARGIN ? (safeY - VIEWPORT_MARGIN) / (maxY - VIEWPORT_MARGIN) : 1,
    };
  }

  function framePosition(row, column) {
    return {
      x: (clamp(column, 0, 7) / 7) * 100,
      y: (clamp(row, 0, 10) / 10) * 100,
    };
  }

  var publicUtils = {
    ANIMATIONS: ANIMATIONS,
    clamp: clamp,
    directionIndex: directionIndex,
    directionCell: directionCell,
    normalizedPosition: normalizedPosition,
    framePosition: framePosition,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicUtils;
    return;
  }

  window.DPRMomoPetUtils = publicUtils;
  if (!document || !document.body || document.querySelector('.dpr-momo-pet')) return;

  var reducedMotionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener: function () {} };
  var reducedMotion = !!reducedMotionQuery.matches;
  var host = null;
  var stage = null;
  var sprite = null;
  var hideButton = null;
  var restoreButton = null;
  var animationTimer = 0;
  var autonomousTimer = 0;
  var lookTimer = 0;
  var animationToken = 0;
  var mode = 'idle';
  var hovering = false;
  var dragging = false;
  var pointerNearby = false;
  var pointerDown = null;
  var dragOrigin = null;
  var lastInteractionAt = Date.now();
  var savedPosition = readPosition();

  function safeStorage(storage, method, key, value) {
    try {
      if (!storage || typeof storage[method] !== 'function') return null;
      return storage[method](key, value);
    } catch (_) {
      return null;
    }
  }

  function readPosition() {
    var raw = safeStorage(window.localStorage, 'getItem', POSITION_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!Number.isFinite(parsed.xRatio) || !Number.isFinite(parsed.yRatio)) return null;
      return {
        xRatio: clamp(parsed.xRatio, 0, 1),
        yRatio: clamp(parsed.yRatio, 0, 1),
      };
    } catch (_) {
      return null;
    }
  }

  function savePosition(position) {
    savedPosition = { xRatio: position.xRatio, yRatio: position.yRatio };
    safeStorage(window.localStorage, 'setItem', POSITION_KEY, JSON.stringify(savedPosition));
  }

  function isHidden() {
    return safeStorage(window.sessionStorage, 'getItem', SESSION_HIDDEN_KEY) === '1';
  }

  function setHidden(hidden) {
    safeStorage(window.sessionStorage, hidden ? 'setItem' : 'removeItem', SESSION_HIDDEN_KEY, hidden ? '1' : undefined);
    if (host) host.hidden = !!hidden;
    if (restoreButton) restoreButton.hidden = !hidden;
    if (hidden) {
      clearTimers();
    } else {
      lastInteractionAt = Date.now();
      applySavedPosition();
      startIdle();
    }
  }

  function clearTimers() {
    window.clearTimeout(animationTimer);
    window.clearTimeout(autonomousTimer);
    window.clearTimeout(lookTimer);
    animationTimer = 0;
    autonomousTimer = 0;
    lookTimer = 0;
    animationToken += 1;
  }

  function setFrame(row, column) {
    if (!sprite) return;
    var pos = framePosition(row, column);
    sprite.style.backgroundPosition = pos.x + '% ' + pos.y + '%';
    var scale = FRAME_SCALE_COMPENSATION[String(row) + ':' + String(column)] || 1;
    sprite.style.transform = scale === 1 ? '' : 'scale(' + scale + ')';
    sprite.dataset.row = String(row);
    sprite.dataset.column = String(column);
  }

  function updateMode(nextMode) {
    mode = nextMode;
    if (host) host.dataset.state = nextMode;
  }

  function playAnimation(name, options) {
    var opts = options || {};
    var animation = ANIMATIONS[name] || ANIMATIONS.idle;
    var loops = Math.max(1, Number(opts.loops) || 1);
    var token = ++animationToken;
    var frame = 0;
    var loop = 0;
    window.clearTimeout(animationTimer);
    updateMode(name);

    if (reducedMotion) {
      var stillFrame = Number.isFinite(opts.reducedFrame) ? opts.reducedFrame : 0;
      setFrame(animation.row, clamp(stillFrame, 0, animation.frames - 1));
      if (typeof opts.onComplete === 'function') opts.onComplete();
      return;
    }

    function advance() {
      if (token !== animationToken || !host || host.hidden) return;
      setFrame(animation.row, frame);
      var duration = animation.durations[frame] || 150;
      frame += 1;
      if (frame >= animation.frames) {
        frame = 0;
        loop += 1;
        if (loop >= loops) {
          if (typeof opts.onComplete === 'function') opts.onComplete();
          return;
        }
      }
      animationTimer = window.setTimeout(advance, duration);
    }
    advance();
  }

  function scheduleAutonomous() {
    window.clearTimeout(autonomousTimer);
    if (reducedMotion || !host || host.hidden || hovering || dragging || pointerNearby) return;
    autonomousTimer = window.setTimeout(runAutonomous, 5500 + Math.round(Math.random() * 5500));
  }

  function startIdle() {
    if (!host || host.hidden || dragging || hovering) return;
    playAnimation('idle', {
      loops: 100000,
      onComplete: scheduleAutonomous,
    });
    scheduleAutonomous();
  }

  function finishAutonomous() {
    if (hovering) {
      setFrame(ANIMATIONS.wave.row, 2);
      updateMode('wave');
      return;
    }
    startIdle();
  }

  function playLookAround() {
    var token = ++animationToken;
    var sequence = [14, 15, 0, 1, 2, 1, 0, 15];
    var index = 0;
    updateMode('look');
    function next() {
      if (token !== animationToken || !host || host.hidden || hovering || dragging) return;
      var cell = directionCell(sequence[index]);
      setFrame(cell.row, cell.column);
      index += 1;
      if (index >= sequence.length) {
        finishAutonomous();
        return;
      }
      animationTimer = window.setTimeout(next, 260);
    }
    next();
  }

  function runAutonomous() {
    if (reducedMotion || hovering || dragging || pointerNearby || !host || host.hidden) return;
    if (Date.now() - lastInteractionAt < 2800) {
      scheduleAutonomous();
      return;
    }
    var choice = Math.random();
    if (choice < 0.28) {
      playAnimation('preen', { loops: 1, onComplete: finishAutonomous });
    } else if (choice < 0.52) {
      playLookAround();
    } else if (choice < 0.74) {
      playAnimation('doze', { loops: 2, onComplete: finishAutonomous });
    } else {
      playAnimation('play', { loops: 2, onComplete: finishAutonomous });
    }
  }

  function playWave() {
    lastInteractionAt = Date.now();
    playAnimation('wave', {
      loops: 1,
      reducedFrame: 2,
      onComplete: function () {
        if (hovering) {
          setFrame(ANIMATIONS.wave.row, 2);
          updateMode('wave');
        } else {
          startIdle();
        }
      },
    });
  }

  function playJump() {
    lastInteractionAt = Date.now();
    if (host) host.classList.add('is-celebrating');
    playAnimation('jump', {
      loops: 1,
      reducedFrame: 2,
      onComplete: function () {
        if (host) host.classList.remove('is-celebrating');
        if (hovering) playWave();
        else startIdle();
      },
    });
  }

  function applySavedPosition() {
    if (!host || !savedPosition) return;
    var rect = host.getBoundingClientRect();
    var maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    var maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    var x = VIEWPORT_MARGIN + savedPosition.xRatio * Math.max(0, maxX - VIEWPORT_MARGIN);
    var y = VIEWPORT_MARGIN + savedPosition.yRatio * Math.max(0, maxY - VIEWPORT_MARGIN);
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = Math.round(x) + 'px';
    host.style.top = Math.round(y) + 'px';
  }

  function currentHostPosition() {
    if (!host) return null;
    var rect = host.getBoundingClientRect();
    return normalizedPosition(rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
  }

  function beginDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    var rect = host.getBoundingClientRect();
    pointerDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    dragOrigin = { left: rect.left, top: rect.top };
    lastInteractionAt = Date.now();
    if (stage.setPointerCapture && event.pointerId !== undefined) {
      stage.setPointerCapture(event.pointerId);
    }
  }

  function moveDrag(event) {
    if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
    var dx = event.clientX - pointerDown.x;
    var dy = event.clientY - pointerDown.y;
    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      hovering = false;
      document.body.classList.add('dpr-momo-dragging');
      playAnimation(dx < 0 ? 'runLeft' : 'runRight', { loops: 100000 });
    }
    event.preventDefault();
    var rect = host.getBoundingClientRect();
    var next = normalizedPosition(
      dragOrigin.left + dx,
      dragOrigin.top + dy,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    );
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.left = Math.round(next.x) + 'px';
    host.style.top = Math.round(next.y) + 'px';
  }

  function endDrag(event) {
    if (!pointerDown || (event.pointerId !== undefined && pointerDown.pointerId !== event.pointerId)) return;
    var wasDragging = dragging;
    pointerDown = null;
    dragOrigin = null;
    dragging = false;
    document.body.classList.remove('dpr-momo-dragging');
    if (stage.releasePointerCapture && event.pointerId !== undefined) {
      try { stage.releasePointerCapture(event.pointerId); } catch (_) {}
    }
    if (wasDragging) {
      var position = currentHostPosition();
      if (position) savePosition(position);
      startIdle();
    } else {
      playJump();
    }
  }

  function cancelDrag(event) {
    if (!pointerDown || (event.pointerId !== undefined && pointerDown.pointerId !== event.pointerId)) return;
    pointerDown = null;
    dragOrigin = null;
    dragging = false;
    document.body.classList.remove('dpr-momo-dragging');
    startIdle();
  }

  function followPointer(event) {
    if (!host || host.hidden || hovering || dragging || pointerDown || reducedMotion) return;
    var rect = host.getBoundingClientRect();
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;
    var dx = event.clientX - centerX;
    var dy = event.clientY - centerY;
    var distance = Math.hypot(dx, dy);
    if (distance > APPROACH_RADIUS || distance < 22) {
      pointerNearby = false;
      if (mode === 'look') {
        window.clearTimeout(lookTimer);
        lookTimer = window.setTimeout(startIdle, 220);
      }
      return;
    }
    pointerNearby = true;
    lastInteractionAt = Date.now();
    window.clearTimeout(animationTimer);
    animationToken += 1;
    var index = directionIndex(dx, dy);
    var cell = directionCell(index);
    updateMode('look');
    setFrame(cell.row, cell.column);
  }

  function makeDom() {
    host = document.createElement('div');
    host.className = 'dpr-momo-pet';
    host.dataset.state = 'idle';
    host.setAttribute('aria-label', '网页宠物墨墨');

    stage = document.createElement('button');
    stage.type = 'button';
    stage.className = 'dpr-momo-stage';
    stage.setAttribute('aria-label', '和墨墨互动；可拖动调整位置');
    stage.title = '点击互动，拖动可以调整位置';

    var shadow = document.createElement('span');
    shadow.className = 'dpr-momo-shadow';
    shadow.setAttribute('aria-hidden', 'true');

    sprite = document.createElement('span');
    sprite.className = 'dpr-momo-sprite';
    sprite.setAttribute('aria-hidden', 'true');

    hideButton = document.createElement('button');
    hideButton.type = 'button';
    hideButton.className = 'dpr-momo-hide';
    hideButton.setAttribute('aria-label', '暂时隐藏墨墨');
    hideButton.title = '暂时隐藏墨墨';
    hideButton.textContent = '×';

    stage.appendChild(shadow);
    stage.appendChild(sprite);
    host.appendChild(stage);
    host.appendChild(hideButton);

    restoreButton = document.createElement('button');
    restoreButton.type = 'button';
    restoreButton.className = 'dpr-momo-restore';
    restoreButton.setAttribute('aria-label', '唤回墨墨');
    restoreButton.title = '唤回墨墨';
    restoreButton.innerHTML = '<span aria-hidden="true">🦉</span><span>唤回墨墨</span>';

    document.body.appendChild(host);
    document.body.appendChild(restoreButton);
  }

  function bindEvents() {
    stage.addEventListener('pointerenter', function () {
      if (dragging) return;
      hovering = true;
      playWave();
    });
    stage.addEventListener('pointerleave', function () {
      if (dragging) return;
      hovering = false;
      pointerNearby = false;
      startIdle();
    });
    stage.addEventListener('pointerdown', beginDrag);
    stage.addEventListener('pointermove', moveDrag);
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', cancelDrag);
    stage.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        playJump();
      }
    });
    hideButton.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
    hideButton.addEventListener('click', function (event) {
      event.stopPropagation();
      setHidden(true);
    });
    restoreButton.addEventListener('click', function () { setHidden(false); });
    document.addEventListener('pointermove', followPointer, { passive: true });
    window.addEventListener('resize', function () {
      if (savedPosition) applySavedPosition();
    });
    if (reducedMotionQuery && typeof reducedMotionQuery.addEventListener === 'function') {
      reducedMotionQuery.addEventListener('change', function (event) {
        reducedMotion = !!event.matches;
        clearTimers();
        startIdle();
      });
    }
  }

  function init() {
    var image = new Image();
    image.onload = function () {
      makeDom();
      bindEvents();
      applySavedPosition();
      setHidden(isHidden());
      if (!isHidden()) startIdle();
      document.dispatchEvent(new CustomEvent('dpr-momo-ready', { detail: { reducedMotion: reducedMotion } }));
    };
    image.onerror = function () {
      console.warn('[DPR] 墨墨动画素材加载失败，已跳过宠物增强。');
    };
    image.src = SPRITESHEET_URL;
  }

  init();
})();
