// Everything you'd want to edit lives here: the project list + all tunables.
// All of it can also be tweaked live via the lil-gui panel (see gui.js).

// Images shown in the carousel — 10 slots (img1 .. img10), Persian captions.
// Put your 10 images inside an "img" folder next to index.html.
export const PROJECTS = [
  { src: "./img/img1.png", aspect: null, brand: "علی ابراهیمی‌نیا", desc: "کارشناس ورود اطلاعات و پشتیبانی محتوا" },
  { src: "./img/img2.jpg", aspect: null, brand: "Microsoft Word", desc: "ورود اطلاعات، گزارش و مستندسازی" },
  { src: "./img/img3.jpg", aspect: null, brand: "StaxRip", desc: "انکود و فشرده‌سازی ویدئو · AV1 و H.265" },
  { src: "./img/img4.jpg", aspect: null, brand: "Microsoft Excel", desc: "جدول، داده و فرمول‌های پایه" },
  { src: "./img/img5.jpg", aspect: null, brand: "Google AI Studio", desc: "تبدیل صوت به متن با Gemini" },
  { src: "./img/img6.jpg", aspect: null, brand: "WordPress", desc: "بارگذاری و مدیریت محتوای سایت" },
  { src: "./img/img7.jpg", aspect: null, brand: "XnConvert", desc: "تبدیل دسته‌ای تصاویر به WebP" },
  { src: "./img/img8.jpg", aspect: null, brand: "آرشیو تصاویر", desc: "۲٬۵۰۰ عکس · ۷۰٪ کاهش حجم" },
  { src: "./img/img9.jpg", aspect: null, brand: "Photoshop", desc: "برش، تغییر اندازه و اصلاح رنگ" },
  { src: "./img/img10.jpg", aspect: null, brand: "خروجی PDF", desc: "گزارش نهایی و مستند چندقالبی" },
];

// Layout + scroll feel. Wheel and drag both move a target, the scroll lerps
// after it. Once input has been idle for SNAP_IDLE_MS the target is redirected
// onto the nearest panel center, so the row always settles on an image.
// 1. Detect tablet/mobile portrait mode
const isMobileOrTablet = typeof window !== "undefined" && window.innerWidth < 1024;
const isPortrait = typeof window !== "undefined" && window.innerWidth < window.innerHeight;

export const CONFIG = {
  PANEL_H: isMobileOrTablet ? 230 : 430, // 230px phones/iPads, 430px desktop
  GAP: 14,
  EASE: 0.09,
  // WHEEL: 0 -> the hero does NOT swallow the wheel. The page scrolls normally
  // and scrubs the row (see resume.js). This is what makes the hero and the
  // resume sections feel like one continuous environment instead of a trap.
  WHEEL: 0,
  DRAG: 1.2,
  FRICTION: 0.865,
  SNAP: true, // mobile drag still settles on a panel; the desktop scrub sets snapped itself
  SNAP_IDLE_MS: 120,
  SNAP_EASE: 0.05,
  SHRINK_MAX: 60,
  SHRINK_ATTACK: 0.25,
  SHRINK_DECAY: 0.06,
  // ---- rendering budget -------------------------------------------------
  // A 3x phone at 390pt would ask for a 1.5Mpx offscreen buffer plus a
  // 12-tap dispersion loop and a blur loop over it. Capping the ratio and the
  // sample count is what keeps a mid-range phone at 60fps instead of 25.
  DPR_CAP_DESKTOP: 2,
  DPR_CAP_MOBILE: 1.5,
  SAMPLES_MOBILE: 6,
  SAMPLES_DESKTOP: 12,
};

export const INTERACT = {
  drag: true,
  noClick: false,
  CLICK_SLOP: 6,
  FLICK_IDLE_MS: 90,
  TOUCH_DRAG: 1.35, // a finger travels less than a mouse; give it more travel
  TOUCH_EASE: 0.22,
  TOUCH_CLICK_SLOP: 12,
};

// ── The glass sheet ───────────────────────────────────────────────────────
// Restored to the original FULL-SCALE liquid-glass warp: one huge disc that
// spans the stage and whose rim lands on the far left/right edges. Sizes are
// HALF-EXTENTS in height-fraction units, so the lens is resolution independent.
//
// The trick that keeps it usable: the interior is a 1:1 passthrough (zoom 0,
// zero dispersion inside `rimStart`), so photographs, type and UI stay razor
// sharp, while every "underwater" behaviour — caustics, chromatic dispersion,
// rim blur, the wobble — lives exclusively in the thin band between `rimStart`
// and the boundary, i.e. on the flanks.
export const LENS = {
  shape: "circle",
  squareRound: 0,
  rotation: 0,        // the sheet is axis-aligned: its rim stays at the flanks
  spin: 0,
  // `edgeFit` widens the disc on wide screens so the rim always lands on the
  // left/right edges (otherwise an ultrawide monitor sees only the flat
  // interior and the whole effect disappears).
  edgeFit: true,
  sizeX: isPortrait ? (window.innerWidth / window.innerHeight) * 0.40 : 0.565,
  // vertical half-extent well past the frame, so the top/bottom rims never
  // enter the composition: every viewport reads as two glass flanks
  sizeY: 1.0,
  posX: 0.5,
  posY: 0.5,
  zoom: 0,            // 0 = no magnification: the centre stays pixel-true
  dispersion: 5.5,    // chromatic fringing — rim band only
  blur: 2.6,          // px of softening — rim band only (see uBlur in engine)
  glow: 3.0,
  whiteGlow: 0.0,     // no bloom on a full-bleed sheet: it veils the photos
  novaSize: 12,
  blueRing: 0.0,     // the ring would read as a seam at this scale
  ringRadius: 0.49,
  ringWidth: 0.009,
  shimmer: true,
  shimmerFreq: 12,
  shimmerSpeed: 3.2,
  shimmerDepth: 0.14,
  rimStart: 0.90,     // disturbance confined to the outer 10% of the radius
  rimTangential: 0.12,// liquid wobble at the flank only
  rimInward: 0,
  rimFreq1: 2,
  rimFreq2: 1,
  blueColor: "#f2b85d",
  rimLine: 0.0,      // no hard edge: the sheet is full-bleed, its rim is the frame
  rimLinePos: 0.488,
  rimLineWidth: 0.003,
  // ── the confined "underwater" layer ──
  caustic: 0.55,      // 0..1 strength of the caustic web in the rim + edges
  causticScale: 7.0,  // cells across the stage
  causticSpeed: 1.0,
  edgeBand: 0.26,     // width of each flank band, in screen UV (26% of width)
  vignette: 0,
  vignetteSize: 0.3,
  samples: isMobileOrTablet ? 6 : 12,
};

// Focus mode
export const FOCUS = {
  cardDuration: 0.7,
  focusDuration: 0.9,
  cardEase: "power4.out",
  focusEase: "power3.out",
  stagger: 0.06,
  dropDist: 1.4,
  centerScale: 1.18,
  lensFade: 0.85,
};

// Entry animation
export const ENTRY = {
  enabled: true,
  delay: 0.32,
  startH: 64,
  riseDuration: 0.85,
  stagger: 0.055,
  riseEase: "power3.out",
  fromBelow: 0.9,
  growDelay: 0.18,
  growDuration: 1.65,
  growEase: "expo.inOut",
  growStagger: 0.085,
  growDir: "inward",
  lensBloom: 1.4,
  lensBloomEase: "power2.inOut",
};

// Overlay text transitions
export const UI_ANIM = {
  duration: 0.4,
  ease: "power3.out",
  topShiftVh: -5,
  revealDuration: 1.6,
  revealEase: "power2.out",
  revealStagger: 0.18,
};
