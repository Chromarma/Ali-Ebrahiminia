/* ==========================================================================
   resume.js — page choreography
   --------------------------------------------------------------------------
   Responsibilities
     1. mount the liquid-glass hero carousel (vendor/carousel/engine.js)
     2. scrub it from the document scroll, so the hero and the resume are one
        continuous motion instead of a wheel-trapping island
     3. GSAP entrance + micro-interaction layer for the hero chrome
     4. a "hand-off" reveal for the resume blocks exactly when robot.js seats
        them (the engine hides a block and shows a clone until it is placed)
   Deliberately NOT here: transforms on [data-robot-section] or their
   ancestors — robot.js measures those rects and clones those subtrees.
   ========================================================================== */

import gsap from 'gsap';
import { createCarousel } from './vendor/carousel/engine.js';
import { PROJECTS } from './vendor/carousel/config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ─────────────────────────── hero mount + state ─────────────────────────── */
const glass = $('#glass');
const stage = $('#hero-stage');
const hero = $('#hero');
const cursorEl = $('#custom-cursor');
const kickerText = $('#hero-kicker-text');
const brandEl = $('#project-brand');
const descEl = $('#project-desc');
const indexEl = $('#project-index');
const totalEl = $('#project-total');

let carousel = null;
let captionIndex = -1;      // must exist before the carousel's first tick
let p0 = 0;                 // progress that centres panel 0
const RANGE = 0.62;         // how much of the loop one hero scrub travels through
let scrollP = 0;            // damped 0..1 across the hero runway
let manualUntil = 0;        // button-driven glide gets the row to itself
let autoP = 0;              // mobile ambient drift
let lastRaw = 0;            // previous scrub target, for the magnetic pull
let anchor = 0;

try {
  carousel = createCarousel(glass, {
    cursorElement: cursorEl,
    onActiveChange: (i) => updateCaption(i),
  });
} catch (err) {
  // never take the page down because WebGL is unavailable
  console.warn('[hero] carousel unavailable:', err);
  glass.style.display = 'none';
  document.body.classList.add('no-webgl');
}

if (carousel) {
  carousel.setAnchor(0);

  // A finger drag on the canvas owns the row for a beat after it ends, so the
  // scroll scrub doesn't immediately yank the row back to its scroll-derived
  // spot (which would feel like the drag "didn't stick").
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  glass.addEventListener('pointerup', () => {
    if (coarsePointer.matches) manualUntil = performance.now() + 1100;
  }, { passive: true });
  glass.addEventListener('pointercancel', () => {
    if (coarsePointer.matches) manualUntil = performance.now() + 600;
  }, { passive: true });
  p0 = carousel.getProgress();
  const st = carousel.getState();
  if (totalEl) totalEl.textContent = String(st.total).padStart(2, '0');
  if (kickerText) kickerText.textContent = `رزومهٔ من · ${new Date().getFullYear()}`;
  // Desktop: the row is scrubbed by the page scroll, so a pointer drag would
  // fight it. Touch: there is no hover and no runway, so the thumb gets the row.
  const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  carousel.setInteraction({ drag: coarse });
}

/* ───────────────────────── caption crossfade ────────────────────────────── */
function updateCaption(i) {
  if (i === captionIndex) return;
  captionIndex = i;
  const proj = PROJECTS[i] || {};
  if (indexEl) indexEl.textContent = String(i + 1).padStart(2, '0');
  if (!brandEl || !descEl) return;
  if (REDUCED) {
    brandEl.textContent = proj.brand || '';
    descEl.textContent = proj.desc || '';
    return;
  }
  // Kept deliberately small: swap the copy, then one short "settle" tween on
  // the text nodes. A long out/in sequence can be interrupted mid-flight (fast
  // scrubbing ticks this several times a second) and would leave the caption
  // stranded at opacity 0 — so there is no "out" phase to get stuck in.
  brandEl.textContent = proj.brand || '';
  descEl.textContent = proj.desc || '';
  // starts at 0.3, never 0: even if the tween is throttled or killed halfway the
  // caption stays readable — the animation is a settle, not a reveal
  gsap.fromTo([brandEl, descEl],
    { yPercent: 24, autoAlpha: 0.3 },
    { yPercent: 0, autoAlpha: 1, duration: 0.42, ease: 'power3.out', stagger: 0.04, overwrite: true });
}

/* watchdog: the caption must never stay hidden (interrupted tweens, tab
   switches, throttled frames) */
setInterval(() => {
  if (!brandEl || !descEl) return;
  const o = parseFloat(getComputedStyle(brandEl).opacity);
  // a settled caption is opaque; anything below 0.6 after a tick is a tween
  // that was killed mid-flight
  if (o < 0.6 && !gsap.isTweening(brandEl)) {
    gsap.set([brandEl, descEl], { autoAlpha: 1, yPercent: 0 });
  }
}, 1000);

/* ───────────────────────── hero entrance (GSAP) ─────────────────────────── */
function heroIntro() {
  const targets = {
    kicker: $('.hero-kicker'),
    eyebrow: $('.hero-copy .eyebrow'),
    title: $('.hero-title'),
    desc: $('.hero-desc'),
    buttons: $$('.hero-controls .icon-btn'),
    hint: $('.hero-hint'),
    cue: $('.hero-scroll-cue'),
    orbs: $$('.hero-ambient .amb'),
  };
  if (REDUCED) {
    gsap.set([targets.kicker, targets.eyebrow, targets.title, targets.desc, targets.buttons, targets.hint, targets.cue, targets.orbs],
      { clearProps: 'all', autoAlpha: 1 });
    return;
  }
  const tl = gsap.timeline({ delay: 0.12, defaults: { ease: 'power3.out' } });
  // opacity animates 0 -> 1 only: the gradients carry their own (low) alpha,
  // so overriding it here would paint the stage muddy
  tl.fromTo(targets.orbs, { autoAlpha: 0, scale: 0.9 }, { autoAlpha: 1, scale: 1, duration: 2.2, stagger: 0.14 }, 0)
    .fromTo(targets.kicker, { y: -12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7 }, 0.15)
    .fromTo(targets.eyebrow, { y: 14, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.6 }, 0.35)
    .fromTo(targets.title, { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9 }, 0.42)
    .fromTo(targets.desc, { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8 }, 0.55)
    .fromTo(targets.buttons, { scale: 0.82, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.6, stagger: 0.08 }, 0.6)
    .fromTo(targets.hint, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 0.8)
    .fromTo(targets.cue, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.8 }, 0.9);
}

/* ─────────────────────── hero chrome: magnetic buttons ──────────────────── */
function magnets() {
  if (REDUCED || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  $$('.hero-controls .icon-btn').forEach((btn) => {
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.45, ease: 'power3.out' });
    const yTo = gsap.quickTo(btn, 'y', { duration: 0.45, ease: 'power3.out' });
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.28);
    });
    btn.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

/* ───────────────────────── scroll scrubbing loop ────────────────────────── */
function runway() {
  if (!hero || !stage) return 0;
  return Math.max(0, hero.offsetHeight - stage.offsetHeight);
}

let last = performance.now();
let raf = 0;
function tick(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const run = runway();
  const docTop = hero ? hero.offsetTop : 0;
  const raw = run > 80 ? clamp01((window.scrollY - docTop) / run) : 0;

  // damped so a trackpad flick never snaps the row
  const k = 1 - Math.exp(-dt * 6.5);
  scrollP = lerp(scrollP, raw, k);

  // publish to CSS so the chrome can fade as the hero is consumed
  stage && stage.style.setProperty('--hero-p', scrollP.toFixed(4));

  if (carousel && !carousel.getState().focused) {
    const manual = now < manualUntil;
    if (manual) {
      // a button press is gliding the row — resync once it hands back
      if (now >= manualUntil) scrollP = clamp01((carousel.getProgress() - p0) / RANGE);
    } else if (run > 80) {
      // Magnetic scrub. While the page is moving, the row tracks the scroll
      // exactly (so the motion feels direct). The moment it stops, the pull to
      // the nearest panel centre rises to ~1, so the row always comes to rest
      // with a photograph centred and the glass tile sitting on it.
      const raw = p0 + scrollP * RANGE;
      const delta = Math.abs(raw - lastRaw);
      lastRaw = raw;
      const idle = 1 - Math.min(1, delta * 520);          // 1 at rest, 0 when moving
      carousel.setProgress(carousel.snapProgress(raw, 0.42 + 0.56 * idle));
      autoP = 0;
    } else {
      // no runway (mobile / reduced layout): slow ambient drift
      autoP = (autoP + dt * 0.011) % 1;
      carousel.setProgress(p0 + (REDUCED ? 0 : autoP) * RANGE);
    }
  }

  raf = requestAnimationFrame(tick);
}
raf = requestAnimationFrame(tick);
window.addEventListener('pagehide', () => cancelAnimationFrame(raf));

/* ─────────────────────────── prev / next buttons ────────────────────────── */
function step(dir) {
  if (!carousel) return;
  const st = carousel.getState();
  if (!st.ready) return;
  anchor = (st.centered + dir + st.total) % st.total;
  carousel.setAnchor(anchor);
  manualUntil = performance.now() + 900;
  if (runway() < 80) autoP = clamp01((carousel.getProgress() - p0) / RANGE);
}
$('#prev')?.addEventListener('click', () => step(-1));
$('#next')?.addEventListener('click', () => step(1));

/* keyboard: arrows steer the row while the hero is in view */
window.addEventListener('keydown', (e) => {
  if (!carousel) return;
  const r = hero?.getBoundingClientRect();
  if (!r || r.bottom < window.innerHeight * 0.4) return;
  if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
});

/* ─────────────────────────── scroll progress line ───────────────────────── */
const line = $('.scroll-line i');
function paintProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const p = max > 0 ? clamp01(window.scrollY / max) : 0;
  if (line) line.style.transform = `scaleX(${p.toFixed(4)})`;
}
window.addEventListener('scroll', paintProgress, { passive: true });
paintProgress();

/* ──────────────── content hand-off reveal (robot.js aware) ─────────────── */
const REVEALED = new WeakSet();

function reveal(section) {
  if (REVEALED.has(section)) return;
  REVEALED.add(section);
  if (REDUCED) return;
  // small, quick settle: the block has just been set down by the engine.
  const kids = $$(':scope > *', section);
  if (!kids.length) return;
  gsap.from(kids, {
    y: 14,
    autoAlpha: 0,
    duration: 0.62,
    ease: 'power2.out',
    stagger: 0.055,
    overwrite: true,
    clearProps: 'transform,opacity,visibility',
  });
}

const sections = $$('[data-robot-section]');
const robotOn = document.documentElement.getAttribute('data-robot') === 'on';

function boot() {
  const on = document.documentElement.getAttribute('data-robot') === 'on';
  if (!on) {
    // engine stood down (small screen / reduced motion): reveal on visibility
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => en.isIntersecting && reveal(en.target));
    }, { rootMargin: '0px 0px -12% 0px' });
    sections.forEach((s) => io.observe(s));
    return;
  }
  // engine live: reveal the instant it seats a block
  const mo = new MutationObserver((records) => {
    records.forEach((r) => {
      const el = r.target;
      if (el.getAttribute('data-seated') === 'true') reveal(el);
    });
  });
  sections.forEach((s) => {
    if (s.getAttribute('data-seated') === 'true') reveal(s);
    mo.observe(s, { attributes: true, attributeFilter: ['data-seated'] });
  });
}

// robot.js is deferred, so wait for the parse + first frame
window.addEventListener('load', () => setTimeout(boot, 60));
setTimeout(boot, 1200); // belt and braces

/* ─────────────────────────────── start ─────────────────────────────────── */
if (document.documentElement.classList.contains('js-hero')) {
  heroIntro();
  magnets();
}

// keep the row honest when the viewport changes under us
let rt = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(rt);
  rt = requestAnimationFrame(() => {
    scrollP = 0;
    if (carousel) carousel.refreshLayout?.();
  });
});

/* handy for debugging in the console */
window.__carousel = carousel;
window.__hero = {
  state: () => carousel?.getState(),
  progress: () => carousel?.getProgress(),
  step,
};
