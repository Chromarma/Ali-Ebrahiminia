/* ==========================================================================
   engine/robot.js  —  RESUME-ROBOT  v1.3      (lit depth pass + scroll-safe)
   --------------------------------------------------------------------------
   The engine owns the mechanic only. It never styles your content and never
   applies a transform to your sections, so no theme can tilt the page or
   break the build order. Contract + rules: see AGENT_GUIDE.md.

   How it works
     · the document scrolls normally
     · each section reserves its final space; before it is built the real
       <section> is hidden and a clone of it hangs from the robot's crane
       plate, entering from below the fold
     · the clone is placed so that at lock time its top-left is EXACTLY the
       real section's getBoundingClientRect() top-left  ->  flush by math
     · the engine inserts small spacers so every section has room to be built
       on its own (the rhythm is self-tuning; no theme cooperation needed)
     · all state is a pure function of scroll, so scrolling back rebuilds
   ========================================================================== */
(function () {
  'use strict';

  /* --------------------------------------------------------------------- cfg */
  var CFG = {
    rhythm: 0.50,       // min distance between section tops, in viewports
    band: 0.52,         // travel needed to finish a build, in viewports (capped by rhythm*0.9)
    startInset: 0.10,   // the build starts when the top is this far above the fold
    seatAt: 0.88,       // ti at which the real section takes over
    approach: 0.12,     // ti at which the plate "grabs"  the section
    releaseTilt: 0.52,  // ti at which straightening begins (late, so the tilt reads)
    tiltMax: -0.11,     // rad the section is carried at (about 6.3 deg), straightened before the lock
    slideMax: 0.62,     // lateral slide-in during the ride, fraction of width
    liftExtra: 0.10,    // the section rises this much on its way in (in viewports)
    minViewport: 0,  // under this the gutter is too narrow to work in; engine stands down
    maxDpr: 2,
    hud: true
  };

  var QS = new URLSearchParams(location.search);
  var FORCE = QS.get('robot');                       // off | on | debug
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var sections = [].slice.call(document.querySelectorAll('[data-robot-section]'));
  if (!sections.length) return;

  /* ------------------------------------------------------- feature switches */
  var enabled = true;
  if (FORCE === 'off') enabled = false;
  if (REDUCED && FORCE !== 'on' && FORCE !== 'debug') enabled = false;
  if (window.innerWidth < CFG.minViewport && FORCE !== 'on' && FORCE !== 'debug') enabled = false;

  var root = document.documentElement;
  var DEBUG = FORCE === 'debug';

  function passiveReport(reason) {
    return { enabled: false, reason: reason || 'disabled', frames: 0, drew: false, glError: 0,
             active: -1, phase: 'off', spacers: 0, scrollHeight: 0,
             sections: sections.map(function (s, i) {
               return { i: i, label: s.getAttribute('data-robot-label') || ('section ' + (i + 1)),
                        ti: 1, seated: true, visible: true, transform: 'none', top: 0, height: 0, cloneDelta: 0 };
             }) };
  }

  if (!enabled) {
    sections.forEach(function (s) { s.setAttribute('data-seated', 'true'); });
    root.setAttribute('data-robot', 'off');
    window.__robot = { version: '1.3.0', ready: true, enabled: false,
                       report: function () { return passiveReport('switched off'); },
                       pixelCheck: function () { return 0; } };
    return;
  }

  /* --------------------------------------------------- engine DOM + own CSS */
  var style = document.createElement('style');
  style.id = 'robot-engine-css';
  style.textContent = [
    '#robot-stage{position:fixed;left:0;top:0;width:100%;height:100%;z-index:60;pointer-events:none;display:block;filter:drop-shadow(0 7px 8px rgba(16,18,24,.16))}',
    '#robot-carry{position:fixed;left:0;top:0;width:100%;height:100%;z-index:61;pointer-events:none;overflow:hidden}',
    '#robot-carry .rb-slot{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform,opacity}',
    '.rb-spacer{width:100%;height:0;pointer-events:none}',
    // the only rule the engine applies to theme content: hide what is not built yet
    'html[data-robot="on"] [data-robot-section][data-seated="false"]{visibility:hidden!important}',
    '.rb-hud{position:fixed;left:12px;bottom:12px;z-index:62;pointer-events:none;display:inline-flex;' +
      'align-items:center;gap:8px;padding:6px 11px;border-radius:999px;' +
      'font:10px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;' +
      'text-transform:uppercase;color:#3a4048;background:rgba(255,255,255,.86);' +
      'border:1px solid rgba(20,22,28,.10);box-shadow:0 2px 10px rgba(20,22,28,.06);' +
      '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}',
    '.rb-hud b{font-weight:600;color:#111418}',
    '.rb-hud i{width:54px;height:2px;background:rgba(20,22,28,.16);position:relative;overflow:hidden;display:block}',
    '.rb-hud i u{position:absolute;left:0;top:0;height:100%;width:0;background:#ff5a1f;text-decoration:none}',
    'html[data-robot-hud="off"] .rb-hud{display:none}'
  ].join('');
  document.head.appendChild(style);

  var canvas = document.createElement('canvas');
  canvas.id = 'robot-stage';
  var carry = document.createElement('div');
  carry.id = 'robot-carry';
  var hud = null;
  if (CFG.hud) {
    hud = document.createElement('div');
    hud.className = 'rb-hud';
    hud.innerHTML = '<b>robot</b><span class="rb-phase">starting</span><i><u></u></i><span class="rb-pct">0%</span>';
    document.body.appendChild(hud);
  }
  document.body.appendChild(canvas);
  document.body.appendChild(carry);
  root.setAttribute('data-robot', 'on');

  /* --------------------------------------------------------------- GL setup */
  function bail(reason) {
    canvas.remove(); carry.remove(); if (hud) hud.remove();
    root.setAttribute('data-robot', 'off');
    sections.forEach(function (s) { s.setAttribute('data-seated', 'true'); });
    window.__robot = { version: '1.3.0', ready: true, enabled: false, reason: reason,
                       report: function () { return passiveReport(reason); },
                       pixelCheck: function () { return 0; } };
  }

  var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) { bail('no webgl'); return; }

  var VS = [
    'attribute vec2 aPos;',
    'uniform vec4 uRect;',        // x, y, w, h  (css px, y down)
    'uniform float uAngle;',
    'uniform vec2 uPivot;',
    'uniform vec2 uRes;',
    'varying vec2 vLocal;',
    'void main(){',
    '  vec2 p = uRect.xy + aPos * uRect.zw;',
    '  vec2 d = p - uPivot;',
    '  float c = cos(uAngle), s = sin(uAngle);',
    '  p = uPivot + vec2(c*d.x - s*d.y, s*d.x + c*d.y);',
    '  gl_Position = vec4((p.x/uRes.x)*2.0-1.0, 1.0-(p.y/uRes.y)*2.0, 0.0, 1.0);',
    '  vLocal = aPos;',
    '}'
  ].join('\n');

  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 vLocal;',
    'uniform vec4 uRect;',
    'uniform float uRadius;',
    'uniform vec3 uColor;',
    'uniform float uAlpha;',
    'uniform float uGloss;',
    'float sdf(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    'void main(){',
    '  vec2 hs = uRect.zw * 0.5;',
    '  vec2 p = (vLocal - 0.5) * uRect.zw;',
    '  float r = min(uRadius, min(hs.x, hs.y));',
    '  float d = sdf(p, hs, r);',
    '  float a = 1.0 - smoothstep(-1.0, 1.0, d);',
    '  if (a < 0.004) discard;',
    '  float t = vLocal.y;',
    '  vec2 q = abs(p) - hs + r;',
    '  vec2 outside = max(q, 0.0);',
    '  vec2 n2;',
    '  if (length(outside) > 0.001) n2 = normalize(sign(p) * outside);',
    '  else if (hs.x - abs(p.x) < hs.y - abs(p.y)) n2 = vec2(sign(p.x), 0.0);',
    '  else n2 = vec2(0.0, sign(p.y));',
    '  vec2 light2 = normalize(vec2(-0.42, -0.78));',
    '  float key = max(dot(n2, light2), 0.0);',
    '  float shade = max(dot(n2, -light2), 0.0);',
    '  float bevel = 1.0 - smoothstep(0.0, 3.2, -d);',
    '  vec3 col = uColor * (1.14 - 0.42 * t) * (0.96 + 0.12 * key - 0.08 * shade);',
    '  col += uColor * bevel * key * 0.32;',
    '  col *= 1.0 - bevel * shade * 0.16;',
    '  float gloss = smoothstep(0.02, 0.26, t) * (1.0 - smoothstep(0.30, 0.55, t));',
    '  col += vec3(gloss * uGloss);',
    '  gl_FragColor = vec4(col, a * uAlpha);',
    '}'
  ].join('\n');

  function compile(src, type) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('robot: ' + gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  var vs = compile(VS, gl.VERTEX_SHADER), fs = compile(FS, gl.FRAGMENT_SHADER);
  if (!vs || !fs) { bail('shader compile failed'); return; }
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { bail('link failed: ' + gl.getProgramInfoLog(prog)); return; }
  gl.useProgram(prog);

  var U = {
    rect: gl.getUniformLocation(prog, 'uRect'), angle: gl.getUniformLocation(prog, 'uAngle'),
    pivot: gl.getUniformLocation(prog, 'uPivot'), res: gl.getUniformLocation(prog, 'uRes'),
    radius: gl.getUniformLocation(prog, 'uRadius'), color: gl.getUniformLocation(prog, 'uColor'),
    alpha: gl.getUniformLocation(prog, 'uAlpha'), gloss: gl.getUniformLocation(prog, 'uGloss')
  };
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  /* ------------------------------------------------------------ ink palette */
  function cssColor(name, fallback) {
    var v = getComputedStyle(root).getPropertyValue(name).trim();
    var m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
    m = /rgba?\(([^)]+)\)/i.exec(v);
    if (m) { var p = m[1].split(','); return [+p[0] / 255, +p[1] / 255, +p[2] / 255]; }
    return fallback;
  }
  var INK = [0.086, 0.098, 0.110], ACC = [1.0, 0.353, 0.122], MTL = [0.545, 0.576, 0.620];
  function readTheme() {
    INK = cssColor('--robot-ink', INK);
    ACC = cssColor('--robot-accent', ACC);
    MTL = cssColor('--robot-metal', MTL);
  }
  readTheme();
  window.addEventListener('resize', readTheme);

  /* ------------------------------------------------------------ draw helpers */
  var W = 0, H = 0, DPR = 1, drewThisFrame = false;

  function rr(x, y, w, h, radius, color, alpha, angle, pivot, gloss) {
    if (!(w > 0.2) || !(h > 0.2)) return;
    gl.uniform4f(U.rect, x, y, w, h);
    gl.uniform1f(U.radius, radius || 0);
    gl.uniform3fv(U.color, color);
    gl.uniform1f(U.alpha, alpha === undefined ? 1 : alpha);
    gl.uniform1f(U.gloss, gloss === undefined ? 0.16 : gloss);
    var pv = pivot || [x + w / 2, y + h / 2];
    gl.uniform2f(U.pivot, pv[0], pv[1]);
    gl.uniform1f(U.angle, angle || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    drewThisFrame = true;
  }
  function capsule(p0, p1, thick, color, alpha, gloss) {
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    var cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2;
    rr(cx - len / 2, cy - thick / 2, len, thick, thick / 2, color, alpha, ang, [cx, cy], gloss);
    return { ang: ang, nx: -dy / (len || 1), ny: dx / (len || 1), len: len };
  }
  function dot(p, r, color, alpha) { rr(p[0] - r, p[1] - r, r * 2, r * 2, r, color, alpha, 0, p); }
  function joint(p, r) {
    dot(p, r, [0.030, 0.034, 0.042], 1);
    dot(p, r * 0.82, INK, 1);
    dot(p, r * 0.54, MTL, 1);
    dot(p, r * 0.40, [0.82, 0.85, 0.89], 0.92);
    dot(p, r * 0.18, [0.17, 0.19, 0.23], 1);
    dot([p[0] - r * 0.14, p[1] - r * 0.20], r * 0.065, [1, 1, 1], 0.42);
  }
  // Draw an offset dark sidewall first, then the lit face and its lacquer stripe.
  // The small, constant offset gives the flat screen-space tube a readable 3D rim.
  function link(p0, p1, t, accentScale) {
    var dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    var depth = Math.max(2, Math.min(4.5, t * 0.18));
    capsule([p0[0] + depth, p0[1] + depth], [p1[0] + depth, p1[1] + depth],
            t * 1.02, [0.035, 0.040, 0.050], 0.82, 0.02);
    var g = capsule(p0, p1, t, INK, 1, 0.20);
    capsule([p0[0] + dx * 0.18, p0[1] + dy * 0.18],
            [p0[0] + dx * 0.82, p0[1] + dy * 0.82],
            t * accentScale, ACC, 0.98, 0.02);
    capsule([p0[0] + g.nx * t * 0.27, p0[1] + g.ny * t * 0.27],
            [p1[0] + g.nx * t * 0.27, p1[1] + g.ny * t * 0.27], t * 0.18, [1, 1, 1], 0.18, 0.05);
    return g;
  }

  /* -------------------------------------------------------- section tracking */
  var state = {
    active: -1, phase: 'off', clone: null, cloneEl: null, cloneIndex: -1,
    seams: [], frames: 0, grip: [0, 0], tilt: 0, grip01: 1, spacers: 0
  };

  /* self-tuning rhythm: the engine inserts spacers between sections so each one
     gets its own room to be built, whatever the theme's spacing is.            */
  function syncSpacers() {
    if (FORCE === 'debug') { /* still applied: the debug view should match production */ }
    var i, gaps = [];
    for (i = 0; i < sections.length - 1; i++) {
      var s = sections[i];
      var sp = s.__spacer;
      if (sp) sp.style.height = '0px';
      sp = s.nextElementSibling;
      if (!sp || !sp.classList || !sp.classList.contains('rb-spacer')) {
        sp = document.createElement('div');
        sp.className = 'rb-spacer';
        sp.setAttribute('aria-hidden', 'true');
        sp.setAttribute('data-robot-spacer', '');
        s.parentNode.insertBefore(sp, s.nextSibling);
      }
      s.__spacer = sp;
      gaps.push(0);
    }
    if (sections[sections.length - 1]) sections[sections.length - 1].__spacer = null;
    // measure with all spacers collapsed, then give each gap exactly what it needs
    var tops = sections.map(function (s) { return s.getBoundingClientRect().top; });
    var need = CFG.rhythm * window.innerHeight;
    for (i = 0; i < sections.length - 1; i++) {
      var gap = tops[i + 1] - tops[i];
      var extra = Math.max(0, need - gap);
      if (sections[i].__spacer) sections[i].__spacer.style.height = Math.round(extra) + 'px';
    }
    state.spacers = sections.filter(function (s) { return s.__spacer; }).length;
  }

  function measure() {
    var rects = [];
    var i;
    for (i = 0; i < sections.length; i++) rects.push(sections[i].getBoundingClientRect());
    var nextTop = rects.map(function (r) { return r.top; });
    for (i = 0; i < sections.length; i++) {
      var el = sections[i], top = nextTop[i], r = rects[i];
      el.__rect = { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      // band: travel this section needs, never longer than the room it has
      var spacing = (i < sections.length - 1) ? Math.max(1, nextTop[i + 1] - top) : H;
      var band = Math.min(CFG.band * H, Math.max(0.18 * H, spacing * 0.92));
      var travel = H - top - CFG.startInset * H;
      el.__band = band;
      el.__ti = travel <= 0 ? 0 : (travel >= band ? 1 : travel / band);
      el.__top = top;
    }
  }

  function ensureClone(i) {
    if (state.cloneIndex === i) return;
    clearClone();
    var el = sections[i];
    var slot = document.createElement('div');
    slot.className = 'rb-slot';
    var clone = el.cloneNode(true);
    clone.removeAttribute('data-robot-section');       // engine CSS must never hide the clone
    clone.setAttribute('aria-hidden', 'true');
    clone.removeAttribute('data-seated');
    clone.style.visibility = 'visible';
    slot.appendChild(clone);
    carry.appendChild(slot);
    state.clone = slot; state.cloneEl = clone; state.cloneIndex = i;
  }
  function clearClone() {
    if (state.clone) state.clone.remove();
    state.clone = null; state.cloneEl = null; state.cloneIndex = -1;
  }

  /* ------------------------------------------------------------------ the arm
     Screen-space planar crane. The plate's grip point is authoritative: the
     clone is placed FROM it, so seating is exact even if the arm is stretched. */
  function pose(grip) {
    var shoulder = [W * 0.70, H * 0.985];
    var foot = [shoulder[0], H];
    var L1 = 0.42 * H, L2 = 0.36 * H;
    var thick = Math.max(11, Math.min(0.026 * H, 24));
    var dx = grip[0] - shoulder[0], dy = grip[1] - shoulder[1];
    var dist = Math.hypot(dx, dy) || 1;
    var maxd = (L1 + L2) * 0.985, mind = Math.abs(L1 - L2) + 0.03 * H;
    var d = Math.max(mind, Math.min(dist, maxd));
    var ang = Math.atan2(dy, dx);
    var c2 = Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)));
    var t2 = -Math.acos(c2);
    var t1 = ang - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2));
    var elbow = [shoulder[0] + L1 * Math.cos(t1), shoulder[1] + L1 * Math.sin(t1)];
    var wrist = [shoulder[0] + L1 * Math.cos(t1) + L2 * Math.cos(t1 + t2),
                 shoulder[1] + L1 * Math.sin(t1) + L2 * Math.sin(t1 + t2)];
    return { shoulder: shoulder, foot: foot, elbow: elbow, wrist: wrist, thick: thick,
             over: dist > maxd, gripPoint: grip };
  }

  function drawArm(P, tilt, grip01, cups) {
    var t = P.thick, k = 0.55 + 0.45 * grip01;

    /* ground shadow */
    capsule([P.foot[0] - 0.05 * W, H - 1], P.shoulder, t * 1.6, [0.05, 0.06, 0.08], 0.055);

    /* pedestal: floor unit + column + shoulder housing + counterweight */
    rr(P.foot[0] - t * 2.1, H - t * 0.5, t * 4.2, t * 0.8, t * 0.16, INK, 1, 0, null, 0.04);
    rr(P.foot[0] - t * 1.5, H - t * 1.0, t * 3.0, t * 0.7, t * 0.14, INK, 1, 0, null, 0.10);
    capsule([P.foot[0], H - t * 0.9], [P.shoulder[0], P.shoulder[1] + t * 0.2], t * 1.05, INK, 1, 0.14);
    rr(P.shoulder[0] - t * 0.72, P.shoulder[1] - t * 0.12, t * 1.44, t * 1.8, t * 0.34, INK, 1, 0, null, 0.18);
    rr(P.shoulder[0] - t * 2.2, P.shoulder[1] + t * 0.3, t * 1.5, t * 0.9, t * 0.20, INK, 0.95, 0, null, 0.05);

    /* hydraulics: a thin metal ram from the shoulder to mid-upper-link */
    var mid1 = [(P.shoulder[0] + P.elbow[0]) / 2, (P.shoulder[1] + P.elbow[1]) / 2];
    capsule([P.shoulder[0] + t * 0.1, P.shoulder[1] + t * 0.75], mid1, t * 0.30, MTL, 0.95, 0.20);
    capsule([P.shoulder[0] + t * 0.1, P.shoulder[1] + t * 0.75], mid1, t * 0.14, [1, 1, 1], 0.18, 0);

    /* links */
    link(P.shoulder, P.elbow, t, 0.30);
    link(P.elbow, P.wrist, t * 0.84, 0.30);
    joint(P.shoulder, t * 0.60);
    joint(P.elbow, t * 0.52);
    joint(P.wrist, t * 0.44);

    /* gripper bar: a slim beam with two vacuum cups hanging under it */
    var plateW = Math.min(0.17 * W, 190), plateH = Math.max(9, t * 0.34);
    var gp = P.gripPoint;
    var py = gp[1] - plateH * 0.5;
    rr(gp[0] - plateW / 2, py - plateH / 2, plateW, plateH, plateH * 0.30, INK, 1, tilt, [gp[0], py], 0.12);
    rr(gp[0] - plateW / 2 + 3, py - plateH / 2 + 2, plateW - 6, 2, 1, [1, 1, 1], 0.16, tilt, [gp[0], py], 0);
    var padW = Math.max(11, plateW * 0.10);
    var cupH = Math.max(13, plateH * 1.5);
    var gap = plateW * 0.5 * k;
    [-1, 1].forEach(function (dir) {
      var cx = gp[0] + dir * gap * Math.cos(tilt), cy = py + dir * gap * Math.sin(tilt);
      rr(cx - padW * 0.30, cy + plateH * 0.4, padW * 0.60, cupH * 0.42, 1.5, MTL, 0.85, tilt, [cx, cy], 0);   // stem
      rr(cx - padW / 2, cy + plateH * 0.4 + cupH * 0.42, padW, cupH * 0.62, padW * 0.30, INK, 0.98, tilt, [cx, cy], 0.05); // cup
    });
    /* mast wrist -> plate */
    capsule(P.wrist, [gp[0], py - plateH * 0.5], t * 0.34, INK, 1, 0.10);
    dot(P.wrist, t * 0.30, MTL, 1);

    /* soft contact shadow of the plate on the carried section */
    rr(gp[0] - plateW * 0.42, py + plateH * 1.5, plateW * 0.84, 10, 5, [0.05, 0.06, 0.08], 0.055, tilt, [gp[0], py], 0);
  }

  /* ------------------------------------------------------------------- loop */
  var last = performance.now(), sm = { gx: 0, gy: 1.2, grip01: 1, tilt: 0 };
  var glError = 0;

  var SNAP_AT = 0.78;   // ti at which the carry is hard-locked onto its seat
  var lastScrollY = window.scrollY;
  var scrollDir = 1;
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function resize() {
    DPR = Math.max(1, Math.min(CFG.maxDpr, window.devicePixelRatio || 1));
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    syncSpacers();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('load', syncSpacers);
  if (window.ResizeObserver && document.querySelector('main')) {
    var deb = null;
    new ResizeObserver(function () { clearTimeout(deb); deb = setTimeout(syncSpacers, 120); })
      .observe(document.querySelector('main'));
  }

  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    state.frames++;
    var sy = window.scrollY;
    if (sy !== lastScrollY) { scrollDir = sy > lastScrollY ? 1 : -1; lastScrollY = sy; }

    measure();

    var active = -1, i;
    for (i = 0; i < sections.length; i++) { if (sections[i].__ti < 1) { active = i; break; } }
    state.active = active;

    for (i = 0; i < sections.length; i++) {
      var want = sections[i].__ti >= CFG.seatAt ? 'true' : 'false';
      if (sections[i].getAttribute('data-seated') !== want) {
        sections[i].setAttribute('data-seated', want);
        if (want === 'true' && state.frames > 4) {
          var r0 = sections[i].getBoundingClientRect();
          state.seams.push({ y: r0.top, x0: r0.left, x1: r0.right, t: now });
        }
      }
    }

    var grip = [W * 0.30, H * 1.14];       // parked, out of frame
    var phase = 'idle', ti = 0, tilt = 0, grip01 = 1;
    var place = null;                      // {topLeftX, topLeftY, tilt, w, h, opacity, visible}

    if (active >= 0) {
      var el = sections[active], R = el.__rect;
      ti = el.__ti;
      ensureClone(active);

      var base = [W * 0.70, H * 0.985];
      var gripInset = Math.min(96, R.width * 0.16);
      var gripLocal = [R.width - gripInset, -14];          // plate sits on the section's top-right
      var S = [R.left + gripLocal[0], R.top + gripLocal[1]];  // plate position at lock time
      var dS = [S[0] - base[0], S[1] - base[1]];
      var rS = Math.hypot(dS[0], dS[1]);
      var Rmax = (0.345 + 0.295) * H * 0.985;
      var rScl = Math.min(rS, Rmax * 0.97);
      var aS = Math.atan2(dS[1], dS[0]);

      var k = ti <= CFG.approach ? 0 : easeInOut(clamp01((ti - CFG.approach) / (SNAP_AT - CFG.approach)));
      var tg = ti <= CFG.releaseTilt ? 1 : 1 - easeInOut(clamp01((ti - CFG.releaseTilt) / (SNAP_AT - CFG.releaseTilt)));
      tilt = CFG.tiltMax * tg;

      // The ride, in two beats that both stay inside the right-hand lane:
      //   1) rise from below the fold up the lane (the section arrives from underneath)
      //   2) slide left into the column and settle on the seat
      // At k = 1 the plate is exactly on its seat, and every point of the path is
      // inside the arm's reach, so the machine never has to stretch.
      // The ride the visitor actually watches: the section travels across the free
      // right-hand lane and settles into the column.  The slide distance is whatever
      // room the layout leaves (never off-screen), so it stays legible at any width.
      var room = Math.max(120, W - R.width - R.left - 26);
      var slide0 = Math.min(CFG.slideMax * W, room);
      var lift0 = CFG.liftExtra * H;
      var from = [R.left + slide0, R.top + lift0];
      var rise = easeInOut(clamp01(k / 0.62)), across = easeInOut(clamp01((k - 0.45) / 0.55));
      var tl = [from[0] + (R.left - from[0]) * across, from[1] + (R.top - from[1]) * rise];
      var cT = Math.cos(tilt), sT = Math.sin(tilt);
      var plate = [tl[0] + cT * gripLocal[0] - sT * gripLocal[1],
                   tl[1] + sT * gripLocal[0] + cT * gripLocal[1]];
      grip = plate;
      void rS; void aS; void rScl; void Rmax; void dS;

      var c0 = Math.cos(tilt), s0 = Math.sin(tilt);
      var topLeftX = plate[0] - (c0 * gripLocal[0] - s0 * gripLocal[1]);
      var topLeftY = plate[1] - (s0 * gripLocal[0] + c0 * gripLocal[1]);

      if (ti < CFG.approach) phase = 'approach';
      else if (ti < CFG.releaseTilt) phase = 'grip';
      else if (ti < SNAP_AT) phase = 'transfer';
      else if (ti < CFG.seatAt) phase = 'seat';
      else phase = 'release';
      grip01 = ti < CFG.approach ? 1 : (ti < CFG.releaseTilt ? 1 - clamp01((ti - CFG.approach) / 0.14) * 0.76 : 0.24);

      place = { x: topLeftX, y: topLeftY, tilt: tilt, w: R.width, h: R.height, gl: gripLocal,
                opacity: ti <= 0.01 ? 0 : 1, visible: ti > 0.01 && ti < CFG.seatAt,
                near: clamp01((ti - 0.62) / (SNAP_AT - 0.62)) };
    } else {
      clearClone();
      phase = 'done';
    }
    state.phase = phase;
    state.tilt = tilt;

    /* damped follow — the machine chases its target, it does not teleport.
       Near the lock the gain rises and then the state SNAPS, so the carried
       clone is pixel-exact on its seat when the real section takes over.     */
    var near = (place && place.near) ? place.near : 0;
    var rate = 10 + 70 * near * near;
    var f = 1 - Math.exp(-dt * rate);
    var mx = (grip[0] - sm.gx) * f, my = (grip[1] - sm.gy) * f;
    var mlen = Math.hypot(mx, my), maxMove = 2200 * dt;
    if (mlen > maxMove && mlen > 0) { mx *= maxMove / mlen; my *= maxMove / mlen; }
    sm.gx += mx; sm.gy += my;
    var gripMove = (grip01 - sm.grip01) * f;
    var maxGripMove = 2.8 * dt;
    sm.grip01 += Math.max(-maxGripMove, Math.min(maxGripMove, gripMove));
    var tiltMove = (tilt - sm.tilt) * (1 - Math.exp(-dt * (7 + 40 * near)));
    var maxTiltMove = 5.0 * dt;
    sm.tilt += Math.max(-maxTiltMove, Math.min(maxTiltMove, tiltMove));
    // Exact seat snap only when delivering forward. Reverse scroll remains
    // time-smoothed and velocity-limited, so it cannot flick back to the gripper.
    if (near >= 0.999 && scrollDir > 0) { sm.gx = grip[0]; sm.gy = grip[1]; sm.tilt = tilt; sm.grip01 = grip01; }
    state.grip = [sm.gx, sm.gy]; state.tilt = sm.tilt; state.grip01 = sm.grip01;
    if (active >= 0 && place) {
      // the clone is driven by the same smoothed state, so the maths stays exact at lock time
      var sTilt = sm.tilt, c = Math.cos(sTilt), s2 = Math.sin(sTilt);
      var gL = place.gl;                     // NB: never name this "gl" — it shadows the context
      var tlX = sm.gx - (c * gL[0] - s2 * gL[1]);
      var tlY = sm.gy - (s2 * gL[0] + c * gL[1]);
      state.clone.style.width = place.w + 'px';
      state.clone.style.height = place.h + 'px';
      state.clone.style.transform = 'translate(' + tlX.toFixed(2) + 'px,' + tlY.toFixed(2) + 'px) rotate(' + sTilt.toFixed(4) + 'rad)';
      var lift = 1 - (place.near || 0);                 // 1 while flying, 0 at the lock
      state.clone.style.filter = lift > 0.03
        ? 'drop-shadow(0 ' + (5 + 16 * lift).toFixed(1) + 'px ' + (9 + 22 * lift).toFixed(1) +
          'px rgba(16,18,24,' + (0.05 + 0.15 * lift).toFixed(3) + '))'
        : 'none';
      state.clone.style.opacity = place.opacity.toFixed(3);
      state.clone.style.visibility = place.visible ? 'visible' : 'hidden';
    }

    /* ---- draw */
    gl.useProgram(prog);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.res, W, H);
    var P = pose([sm.gx, sm.gy]);
    drewThisFrame = false;
    drawArm(P, sm.tilt, sm.grip01, null);

    for (var q = state.seams.length - 1; q >= 0; q--) {
      var sm2 = state.seams[q], age = (now - sm2.t) / 640;
      if (age > 1) { state.seams.splice(q, 1); continue; }
      rr(sm2.x0, sm2.y + (age * -12), sm2.x1 - sm2.x0, 1.6, 0.8, ACC, (1 - age) * 0.85, 0, [0, 0]);
    }
    glError = gl.getError();

    if (hud) {
      hud.querySelector('.rb-phase').textContent = active < 0 ? 'all sections placed'
        : (sections[active].getAttribute('data-robot-label') || ('section ' + (active + 1))).toLowerCase() + ' · ' + phase;
      hud.querySelector('.rb-pct').textContent = (active < 0 ? sections.length : active + 1) + '/' + sections.length;
      hud.querySelector('.rb-hud u') && 0;
      hud.querySelector('i u').style.width = (active < 0 ? 100 : Math.round(100 * (active + ti) / sections.length)) + '%';
    }

    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- debug API */
  function rectOf(el) { return el.getBoundingClientRect(); }
  function cloneDelta(i) {
    if (!state.clone || state.active !== i) return null;
    var c = state.clone.getBoundingClientRect(), r = rectOf(sections[i]);
    return Math.max(Math.abs(c.left - r.left), Math.abs(c.top - r.top),
                    Math.abs(c.width - r.width), Math.abs(c.height - r.height));
  }

  window.__robot = {
    version: '1.3.0', ready: true, enabled: true,
    get frames() { return state.frames; },
    report: function () {
      measure();
      return {
        enabled: true, frames: state.frames, glError: glError, drew: drewThisFrame,
        active: state.active, phase: state.phase, spacers: state.spacers,
        robotGrip: state.grip.slice(), robotTilt: state.tilt, scrollDir: scrollDir,
        scrollHeight: document.documentElement.scrollHeight - window.innerHeight,
        sections: sections.map(function (s, i) {
          var r = rectOf(s), cs = getComputedStyle(s);
          return {
            i: i, label: s.getAttribute('data-robot-label') || ('section ' + (i + 1)),
            ti: +s.__ti.toFixed(3), band: Math.round(s.__band), seated: s.getAttribute('data-seated') === 'true',
            visible: cs.visibility !== 'hidden',
            transform: cs.transform === 'none' ? 'none' : cs.transform,
            top: Math.round(r.top), height: Math.round(r.height), cloneDelta: cloneDelta(i)
          };
        })
      };
    },
    pixelCheck: function () {
      var buf = new Uint8Array(canvas.width * canvas.height * 4);
      gl.clear(gl.COLOR_BUFFER_BIT);
      var P = pose([sm.gx, sm.gy]);
      drewThisFrame = false;
      drawArm(P, sm.tilt, sm.grip01, null);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var n = 0;
      for (var i = 3; i < buf.length; i += 4) if (buf[i] > 8) n++;
      return n;
    }
  };

  // first layout: spacers, then run
  resize();
  sm.gx = W * 0.74; sm.gy = H * 1.10;
  requestAnimationFrame(frame);
})();
