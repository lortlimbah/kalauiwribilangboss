export const FEATURE_ORDER = [
  "eye_l",
  "eye_r",
  "eyebrow_steepness_l",
  "eyebrow_updown_l",
  "eyebrow_quirk_l",
  "eyebrow_steepness_r",
  "eyebrow_updown_r",
  "eyebrow_quirk_r",
  "mouth_corner_updown_l",
  "mouth_corner_inout_l",
  "mouth_corner_updown_r",
  "mouth_corner_inout_r",
  "mouth_open",
  "mouth_wide",
];

export const AXIS_MAP = { pitch: "y", yaw: "x", roll: "z", yawSign: 1 };

export function clamp01(v) {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function clamp11(v) {
  if (Number.isNaN(v)) return 0;
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

export function parseBlendShapes(list) {
  const blend = {};
  if (!Array.isArray(list)) return blend;
  for (const entry of list) {
    if (entry && typeof entry.k === "string" && typeof entry.v === "number") {
      blend[entry.k] = entry.v;
    }
  }
  return blend;
}

function b(blend, key) {
  const v = blend[key];
  return typeof v === "number" && !Number.isNaN(v) ? clamp01(v) : 0;
}

export function mapScalars(blend) {
  const blinkL = b(blend, "EyeBlinkLeft");
  const blinkR = b(blend, "EyeBlinkRight");
  const wideL = b(blend, "EyeWideLeft");
  const wideR = b(blend, "EyeWideRight");
  const eyeOpenL = clamp01(1 - blinkL);
  const eyeOpenR = clamp01(1 - blinkR);
  const innerUp = b(blend, "BrowInnerUp");
  const outerUpL = b(blend, "BrowOuterUpLeft");
  const outerUpR = b(blend, "BrowOuterUpRight");
  const downL = b(blend, "BrowDownLeft");
  const downR = b(blend, "BrowDownRight");
  const smileL = b(blend, "MouthSmileLeft");
  const smileR = b(blend, "MouthSmileRight");
  const frownL = b(blend, "MouthFrownLeft");
  const frownR = b(blend, "MouthFrownRight");
  const dimpleL = b(blend, "MouthDimpleLeft");
  const dimpleR = b(blend, "MouthDimpleRight");
  const stretchL = b(blend, "MouthStretchLeft");
  const stretchR = b(blend, "MouthStretchRight");
  const pucker = b(blend, "MouthPucker");
  const funnel = b(blend, "MouthFunnel");
  const mouthClose = b(blend, "MouthClose");
  const jawOpen = b(blend, "JawOpen");
  const pressL = b(blend, "MouthPressLeft");
  const pressR = b(blend, "MouthPressRight");
  const smileAvg = (smileL + smileR) / 2;
  const stretchAvg = (stretchL + stretchR) / 2;
  const dimpleAvg = (dimpleL + dimpleR) / 2;
  const pressAvg = (pressL + pressR) / 2;
  const mouthOpen = clamp01(jawOpen * (1 - 0.85 * mouthClose) + 0.15 * funnel);
  const mouthWide = clamp11(
    0.55 * smileAvg + 0.65 * stretchAvg + 0.3 * dimpleAvg - 0.55 * pucker - 0.35 * funnel
  );
  const features = {
    eye_l: clamp11(wideL - blinkL),
    eye_r: clamp11(wideR - blinkR),
    eyebrow_steepness_l: clamp11((innerUp - outerUpL) * 0.8),
    eyebrow_updown_l: clamp11(0.5 * innerUp + 0.5 * outerUpL - downL),
    eyebrow_quirk_l: 0,
    eyebrow_steepness_r: clamp11((innerUp - outerUpR) * 0.8),
    eyebrow_updown_r: clamp11(0.5 * innerUp + 0.5 * outerUpR - downR),
    eyebrow_quirk_r: 0,
    mouth_corner_updown_l: clamp11(smileL - frownL),
    mouth_corner_inout_l: clamp11(0.5 * dimpleL + 0.5 * stretchL - 0.6 * pucker - 0.3 * funnel),
    mouth_corner_updown_r: clamp11(smileR - frownR),
    mouth_corner_inout_r: clamp11(0.5 * dimpleR + 0.5 * stretchR - 0.6 * pucker - 0.3 * funnel),
    mouth_open: clamp11(mouthOpen * (1 - 0.5 * pressAvg)),
    mouth_wide: mouthWide,
  };
  const gaze = mapGaze(blend);
  return {
    eyeOpenL,
    eyeOpenR,
    features,
    mouthOpen,
    mouthWide,
    geom: {
      browUpL: clamp01(0.5 * innerUp + 0.5 * outerUpL),
      browUpR: clamp01(0.5 * innerUp + 0.5 * outerUpR),
      smile: clamp01(smileAvg),
      frown: clamp01((frownL + frownR) / 2),
      pucker: clamp01(pucker),
    },
    gaze,
  };
}

export function mapGaze(blend) {
  const upL = b(blend, "EyeLookUpLeft");
  const downL = b(blend, "EyeLookDownLeft");
  const inL = b(blend, "EyeLookInLeft");
  const outL = b(blend, "EyeLookOutLeft");
  const upR = b(blend, "EyeLookUpRight");
  const downR = b(blend, "EyeLookDownRight");
  const inR = b(blend, "EyeLookInRight");
  const outR = b(blend, "EyeLookOutRight");
  return {
    left: { x: clamp11(inL - outL), y: clamp11(upL - downL) },
    right: { x: clamp11(inR - outR), y: clamp11(upR - downR) },
  };
}

export function eulerDegToQuaternion(euler) {
  const [dx, dy, dz] = euler.map((v) => (v * Math.PI) / 180);
  const cx = Math.cos(dx / 2);
  const sx = Math.sin(dx / 2);
  const cy = Math.cos(dy / 2);
  const sy = Math.sin(dy / 2);
  const cz = Math.cos(dz / 2);
  const sz = Math.sin(dz / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

export function mapPose(rotation, position, state, opts = {}) {
  const rotScale = opts.rotScale ?? 1;
  const posScale = opts.posScale ?? 4;
  const zero = opts.zero ?? true;
  const rotZero = opts.rotZero ?? true;
  const rot = rotation ?? {};
  const pos = position ?? {};
  const rawPitch = (Number(rot[AXIS_MAP.pitch]) || 0) * rotScale;
  const rawYaw = (Number(rot[AXIS_MAP.yaw]) || 0) * rotScale;
  const rawRoll = (Number(rot[AXIS_MAP.roll]) || 0) * rotScale;
  let rotBase = state && state.rotBase ? state.rotBase : null;
  if (rotZero && !rotBase) {
    rotBase = { x: rawPitch, y: rawYaw, z: rawRoll };
  }
  const rotLeak = opts.rotLeak ?? 0.001;
  if (rotZero && rotBase && rotLeak > 0) {
    rotBase = {
      x: rotBase.x + (rawPitch - rotBase.x) * rotLeak,
      y: rotBase.y + (rawYaw - rotBase.y) * rotLeak,
      z: rotBase.z + (rawRoll - rotBase.z) * rotLeak,
    };
  }
  const pitch = rawPitch - (rotZero && rotBase ? rotBase.x : 0);
  const yaw = rawYaw - (rotZero && rotBase ? rotBase.y : 0);
  const roll = rawRoll - (rotZero && rotBase ? rotBase.z : 0);
  const euler = [pitch, yaw * AXIS_MAP.yawSign, roll];
  const quaternion = eulerDegToQuaternion(euler);
  const px = Number(pos.x) || 0;
  const py = Number(pos.y) || 0;
  const pz = Number(pos.z) || 0;
  let base = state && state.base ? state.base : null;
  if (zero && !base) {
    base = { x: px, y: py, z: pz };
  }
  const leak = opts.posLeak ?? 0.005;
  if (zero && base && leak > 0) {
    base = {
      x: base.x + (px - base.x) * leak,
      y: base.y + (py - base.y) * leak,
      z: base.z + (pz - base.z) * leak,
    };
  }
  const nextState = { base, rotBase };
  const dx = (px - (zero && base ? base.x : 0)) * posScale;
  const dy = (py - (zero && base ? base.y : 0)) * posScale;
  const dz = (pz - (zero && base ? base.z : 0)) * posScale;
  return {
    euler,
    rpy: [pitch, yaw, roll],
    quaternion,
    vtsTranslation: [dx, dy, dz],
    translation: [dy, -dx, -dz],
    state: nextState,
  };
}

const SMOOTH_KEYS = [
  "eyeOpenL",
  "eyeOpenR",
  "mouthOpen",
  "mouthWide",
  ...FEATURE_ORDER,
  "eulerX",
  "eulerY",
  "eulerZ",
  "tx",
  "ty",
  "tz",
];

function flattenScalars(scalars, pose) {
  const flat = {
    eyeOpenL: scalars.eyeOpenL,
    eyeOpenR: scalars.eyeOpenR,
    mouthOpen: scalars.mouthOpen,
    mouthWide: scalars.mouthWide,
    eulerX: pose.euler[0],
    eulerY: pose.euler[1],
    eulerZ: pose.euler[2],
    tx: pose.translation[0],
    ty: pose.translation[1],
    tz: pose.translation[2],
  };
  for (const key of FEATURE_ORDER) flat[key] = scalars.features[key];
  return flat;
}

function unflattenScalars(scalars, pose, flat) {
  const features = {};
  for (const key of FEATURE_ORDER) features[key] = flat[key];
  return {
    scalars: {
      ...scalars,
      eyeOpenL: flat.eyeOpenL,
      eyeOpenR: flat.eyeOpenR,
      mouthOpen: flat.mouthOpen,
      mouthWide: flat.mouthWide,
      features,
    },
    pose: {
      ...pose,
      euler: [flat.eulerX, flat.eulerY, flat.eulerZ],
      quaternion: eulerDegToQuaternion([flat.eulerX, flat.eulerY, flat.eulerZ]),
      translation: [flat.tx, flat.ty, flat.tz],
    },
  };
}

export function smoothStep(prev, scalars, pose, alpha, posAlpha = null, rollAlpha = null) {
  if (!prev || !(alpha > 0)) {
    return { smoothed: flattenScalars(scalars, pose) };
  }
  const next = flattenScalars(scalars, pose);
  const smoothed = {};
  for (const key of SMOOTH_KEYS) {
    const p = typeof prev[key] === "number" ? prev[key] : next[key];
    let a = alpha;
    if (key === "tx" || key === "ty" || key === "tz") a = posAlpha ?? alpha;
    if (key === "eulerZ") a = rollAlpha ?? alpha;
    smoothed[key] = p * a + next[key] * (1 - a);
  }
  return { smoothed };
}

export function applySmoothed(scalars, pose, smoothed) {
  if (!smoothed) return { scalars, pose };
  return unflattenScalars(scalars, pose, smoothed);
}

function jawPoints(cx, cy, u) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push({
      x: cx + (t - 0.5) * 2 * 1.02 * u,
      y: cy - 0.35 * u + 1.85 * u * Math.pow(Math.sin(Math.PI * t), 1.2),
    });
  }
  return pts;
}

function browPoints(cx, cy, u, browUp, mirror) {
  const s = mirror ? 1 : -1;
  const baseY = cy - 0.78 * u - browUp * 0.14 * u;
  const ex = cx + s * 0.42 * u;
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    pts.push({
      x: ex + (t - 0.5) * 0.52 * u * s,
      y: baseY - Math.sin(Math.PI * t) * 0.1 * u,
    });
  }
  return pts;
}

function nosePoints(cx, cy, u) {
  return [
    { x: cx, y: cy - 0.55 * u },
    { x: cx, y: cy - 0.42 * u },
    { x: cx, y: cy - 0.28 * u },
    { x: cx, y: cy - 0.14 * u },
    { x: cx - 0.1 * u, y: cy + 0.14 * u },
    { x: cx, y: cy + 0.18 * u },
    { x: cx + 0.1 * u, y: cy + 0.14 * u },
    { x: cx - 0.16 * u, y: cy + 0.28 * u },
    { x: cx, y: cy + 0.3 * u },
  ];
}

function eyePoints(ecx, ecy, u, eyeOpen) {
  const w = 0.34 * u;
  const h = 0.02 * u + eyeOpen * 0.13 * u;
  return [
    { x: ecx - w / 2, y: ecy },
    { x: ecx - w / 4, y: ecy - h / 2 },
    { x: ecx + w / 4, y: ecy - h / 2 },
    { x: ecx + w / 2, y: ecy },
    { x: ecx + w / 4, y: ecy + h / 2 },
    { x: ecx - w / 4, y: ecy + h / 2 },
  ];
}

function mouthPoints(cx, cy, u, geom, mouthOpen, mouthWide) {
  const smileShift = (geom.smile - geom.frown) * 0.1 * u;
  const wide = 1 + mouthWide * 0.35 - geom.pucker * 0.3;
  const mw = 0.32 * u * Math.max(0.45, wide);
  const mh = Math.max(0.025 * u, 0.3 * u * mouthOpen + 0.02 * u);
  const my = cy + 0.62 * u;
  const outer = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const cornerPinch = Math.abs(Math.cos(a)) > 0.9 ? smileShift : 0;
    outer.push({
      x: cx + Math.cos(a) * mw,
      y: my + Math.sin(a) * mh - cornerPinch,
    });
  }
  const inner = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    inner.push({
      x: cx + Math.cos(a) * mw * 0.55,
      y: my + Math.sin(a) * mh * 0.55,
    });
  }
  return { outer, inner };
}

export function buildLandmarks(scalars, opts = {}) {
  const W = opts.width ?? 640;
  const H = opts.height ?? 480;
  const cx = W / 2;
  const cy = H / 2 - 10;
  const u = Math.min(W, H) * 0.23;
  const eyeR = { x: cx - 0.42 * u, y: cy - 0.12 * u };
  const eyeL = { x: cx + 0.42 * u, y: cy - 0.12 * u };
  const points = [];
  for (const p of jawPoints(cx, cy, u)) points.push(p);
  for (const p of browPoints(cx, cy, u, scalars.geom.browUpR, false)) points.push(p);
  for (const p of browPoints(cx, cy, u, scalars.geom.browUpL, true)) points.push(p);
  for (const p of nosePoints(cx, cy, u)) points.push(p);
  for (const p of eyePoints(eyeR.x, eyeR.y, u, scalars.eyeOpenR)) points.push(p);
  for (const p of eyePoints(eyeL.x, eyeL.y, u, scalars.eyeOpenL)) points.push(p);
  const mouth = mouthPoints(cx, cy, u, scalars.geom, scalars.mouthOpen, scalars.mouthWide);
  for (const p of mouth.outer) points.push(p);
  for (const p of mouth.inner) points.push(p);
  const gazeScale = 0.09 * u;
  const pupilR = {
    x: eyeR.x + scalars.gaze.right.x * gazeScale,
    y: eyeR.y - scalars.gaze.right.y * gazeScale,
  };
  const pupilL = {
    x: eyeL.x + scalars.gaze.left.x * gazeScale,
    y: eyeL.y - scalars.gaze.left.y * gazeScale,
  };
  points.push(pupilR, pupilL);
  const confidence = [];
  for (let i = 0; i < 66; i++) confidence.push(0.9);
  confidence.push(0.2 + 0.7 * scalars.eyeOpenR, 0.2 + 0.7 * scalars.eyeOpenL);
  const depth = (i) => {
    if (i >= 27 && i <= 35) return 14;
    if (i === 30) return 18;
    if (i >= 36 && i <= 47) return -4;
    if (i >= 48 && i <= 67) return -2;
    if (i >= 8 && i <= 10) return -6;
    return 0;
  };
  const points3D = points.map((p, i) => ({
    x: ((p.x - cx) / u) * 50,
    y: ((cy - p.y) / u) * 50,
    z: depth(i),
  }));
  points3D.push(
    { x: ((eyeR.x - cx) / u) * 50, y: ((cy - eyeR.y) / u) * 50, z: -10 },
    { x: ((eyeL.x - cx) / u) * 50, y: ((cy - eyeL.y) / u) * 50, z: -10 }
  );
  return { points, points3D, confidence };
}

export function createContext() {
  return { poseState: {}, smoothed: null, lastGood: null, clamps: 0, holds: 0, holdStreak: 0, grace: 0 };
}

export function guardTranslation(next, last, holdStreak, opts = {}) {
  const max = opts.posMax ?? 6;
  const jump = opts.posJump ?? 1.5;
  const dead = opts.posDead ?? 0.02;
  const rebase = opts.posRebase ?? 10;
  const clamped = next.map((v) => Math.min(max, Math.max(-max, v)));
  if (!last) return { translation: clamped, held: false, streak: 0 };
  const dist = Math.sqrt(
    (clamped[0] - last[0]) ** 2 + (clamped[1] - last[1]) ** 2 + (clamped[2] - last[2]) ** 2
  );
  if (dist > jump) {
    if (holdStreak + 1 >= rebase) return { translation: clamped, held: false, streak: 0, rebased: true };
    return { translation: [...last], held: true, streak: holdStreak + 1 };
  }
  if (dist < dead) return { translation: [...last], held: false, streak: 0 };
  return { translation: clamped, held: false, streak: 0 };
}

export function frameToOsf(frame, ctx = createContext(), opts = {}) {
  const found = !!(frame && frame.FaceFound);
  if (!found && ctx.lastGood) {
    ctx.holds += 1;
    const blend = parseBlendShapes(frame ? frame.BlendShapes : []);
    const scalars = mapScalars(blend);
    const geo = buildLandmarks(scalars, opts);
    const timeSec =
      frame && typeof frame.Timestamp === "number" ? frame.Timestamp / 1000 : Date.now() / 1000;
    return {
      osf: {
        time: timeSec,
        id: opts.faceId ?? 0,
        width: opts.width ?? 640,
        height: opts.height ?? 480,
        eyeOpenR: scalars.eyeOpenR,
        eyeOpenL: scalars.eyeOpenL,
        success: false,
        pnpError: 500,
        quaternion: ctx.lastGood.quaternion,
        euler: ctx.lastGood.euler,
        translation: ctx.lastGood.translation,
        confidence: geo.confidence,
        points: geo.points,
        points3D: geo.points3D,
        features: FEATURE_ORDER.map((k) => scalars.features[k]),
      },
      ctx,
    };
  }
  const blend = parseBlendShapes(frame ? frame.BlendShapes : []);
  const scalars = mapScalars(blend);
  const pose = mapPose(frame ? frame.Rotation : null, frame ? frame.Position : null, ctx.poseState, opts);
  ctx.poseState = pose.state;
  let mapped = { scalars, pose };
  if (opts.smooth > 0) {
    const step = smoothStep(ctx.smoothed, scalars, pose, opts.smooth, opts.posSmooth ?? 0.85, opts.rollSmooth ?? 0.8);
    ctx.smoothed = step.smoothed;
    mapped = applySmoothed(scalars, pose, step.smoothed);
  }
  const max = opts.posMax ?? 6;
  const clampedNow = mapped.pose.translation.map((v) => Math.min(max, Math.max(-max, v)));
  let guarded;
  if ((ctx.grace || 0) > 0) {
    ctx.grace -= 1;
    guarded = { translation: clampedNow, streak: 0 };
  } else {
    guarded = guardTranslation(mapped.pose.translation, ctx.lastGood?.translation, ctx.holdStreak, opts);
    if (guarded.rebased) ctx.grace = opts.posGrace ?? 15;
  }
  ctx.holdStreak = guarded.streak;
  if (guarded.held) ctx.clamps += 1;
  const rollGain = opts.rollGain ?? 0.15;
  if (rollGain !== 1) {
    mapped.pose.euler = [mapped.pose.euler[0], mapped.pose.euler[1], mapped.pose.euler[2] * rollGain];
    mapped.pose.quaternion = eulerDegToQuaternion(mapped.pose.euler);
  }
  mapped.pose.translation = guarded.translation;
  let posPeak = typeof ctx.posPeak === "number" ? ctx.posPeak : 1;
  const mag = Math.sqrt(mapped.pose.translation.reduce((s, v) => s + v * v, 0));
  posPeak += (mag - posPeak) * (mag > posPeak ? 0.15 : 0.002);
  ctx.posPeak = posPeak;
  const agc = Math.min(1, (opts.osfAgcTarget ?? 2.5) / Math.max(posPeak, 1e-3));
  mapped.pose.translation = mapped.pose.translation.map((v) => v * agc);
  ctx.lastGood = {
    euler: mapped.pose.euler,
    quaternion: mapped.pose.quaternion,
    translation: guarded.translation,
  };
  const geo = buildLandmarks(mapped.scalars, opts);
  const timeSec =
    frame && typeof frame.Timestamp === "number" ? frame.Timestamp / 1000 : Date.now() / 1000;
  return {
    osf: {
      time: timeSec,
      id: opts.faceId ?? 0,
      width: opts.width ?? 640,
      height: opts.height ?? 480,
      eyeOpenR: mapped.scalars.eyeOpenR,
      eyeOpenL: mapped.scalars.eyeOpenL,
      success: found,
      pnpError: found ? 8 : 500,
      quaternion: mapped.pose.quaternion,
      euler: mapped.pose.euler,
      translation: mapped.pose.translation,
      confidence: geo.confidence,
      points: geo.points,
      points3D: geo.points3D,
      features: FEATURE_ORDER.map((k) => mapped.scalars.features[k]),
    },
    ctx,
  };
}

export function makeDemoFrame(t) {
  const jaw = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(t * Math.PI));
  const blink = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 24);
  const yaw = 18 * Math.sin(t * Math.PI * 0.4);
  const list = [
    ["EyeBlinkLeft", blink],
    ["EyeBlinkRight", blink],
    ["JawOpen", jaw],
    ["MouthSmileLeft", 0.5 + 0.4 * Math.sin(t * Math.PI * 0.5)],
    ["MouthSmileRight", 0.5 + 0.4 * Math.sin(t * Math.PI * 0.5)],
  ].map(([k, v]) => ({ k, v }));
  return {
    Timestamp: Date.now(),
    FaceFound: true,
    BlendShapes: list,
    Rotation: { x: yaw, y: 0, z: 0 },
    Position: { x: 0, y: 0, z: 0.4 },
    EyeLeft: { x: 0, y: 0, z: 0 },
    EyeRight: { x: 0, y: 0, z: 0 },
    Hotkey: -1,
  };
}
