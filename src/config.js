import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = {
  iphoneIp: null,
  iphonePort: 21412,
  listenPort: 11125,
  out: "vts",
  vtsIp: "127.0.0.1",
  vtsPort: 11573,
  vtsWs: "ws://127.0.0.1:8001",
  pluginName: "kalauiwribilangboss",
  pluginDeveloper: "kalauiwribilangboss",
  tokenFile: ".vts_token",
  vtsRate: 30,
  vtsPosGain: 0.3,
  vtsPosZGain: 0.15,
  vtsPosJump: 0.25,
  rollGain: 0.15,
  rollSmooth: 0.8,
  yawSign: 1,
  pitchSign: -1,
  rollSign: 1,
  browSign: 1,
  yawMirror: false,
  rollMirror: true,
  posMirrorX: false,
  sentBy: "kalauiwribilangboss",
  requestTime: 5,
  keepaliveMs: 500,
  sendHz: 60,
  faceId: 0,
  width: 640,
  height: 480,
  smooth: 0.5,
  posSmooth: 0.85,
  posScale: 4,
  rotScale: 1,
  posMax: 6,
  posJump: 1.5,
  posDead: 0.02,
  posRebase: 10,
  posLeak: 0.005,
  rotLeak: 0.001,
  zero: true,
  rotZero: true,
  demo: false,
  dump: false,
};

const ENV_KEYS = {
  IPHONE_IP: "iphoneIp",
  IPHONE_PORT: "iphonePort",
  LISTEN_PORT: "listenPort",
  OUT: "out",
  VTS_IP: "vtsIp",
  VTS_PORT: "vtsPort",
  VTS_WS_URL: "vtsWs",
  PLUGIN_NAME: "pluginName",
  PLUGIN_DEVELOPER: "pluginDeveloper",
  TOKEN_FILE: "tokenFile",
  VTS_RATE: "vtsRate",
  VTS_POS_GAIN: "vtsPosGain",
  VTS_POS_Z_GAIN: "vtsPosZGain",
  VTS_POS_JUMP: "vtsPosJump",
  ROLL_GAIN: "rollGain",
  ROLL_SMOOTH: "rollSmooth",
  YAW_SIGN: "yawSign",
  PITCH_SIGN: "pitchSign",
  ROLL_SIGN: "rollSign",
  BROW_SIGN: "browSign",
  YAW_MIRROR: "yawMirror",
  ROLL_MIRROR: "rollMirror",
  POSX_MIRROR: "posMirrorX",
  SENT_BY: "sentBy",
  REQUEST_TIME: "requestTime",
  KEEPALIVE_MS: "keepaliveMs",
  SEND_HZ: "sendHz",
  FACE_ID: "faceId",
  WIDTH: "width",
  HEIGHT: "height",
  SMOOTH: "smooth",
  POS_SMOOTH: "posSmooth",
  POS_SCALE: "posScale",
  ROT_SCALE: "rotScale",
  POS_MAX: "posMax",
  POS_JUMP: "posJump",
  POS_DEAD: "posDead",
  POS_REBASE: "posRebase",
  POS_LEAK: "posLeak",
  ROT_LEAK: "rotLeak",
  NO_ROT_ZERO: "rotZero",
  NO_ZERO: "zero",
};

const NUM_KEYS = new Set([
  "iphonePort",
  "listenPort",
  "vtsPort",
  "vtsRate",
  "requestTime",
  "keepaliveMs",
  "sendHz",
  "vtsPosGain",
  "vtsPosZGain",
  "vtsPosJump",
  "rollGain",
  "rollSmooth",
  "yawSign",
  "pitchSign",
  "rollSign",
  "browSign",
  "faceId",
  "width",
  "height",
  "smooth",
  "posSmooth",
  "posScale",
  "rotScale",
  "posMax",
  "posJump",
  "posDead",
  "posRebase",
  "posLeak",
  "rotLeak",
]);

const FLAG_KEYS = {
  "iphone-ip": "iphoneIp",
  "iphone-port": "iphonePort",
  "listen-port": "listenPort",
  out: "out",
  "vts-ip": "vtsIp",
  "vts-port": "vtsPort",
  "vts-ws": "vtsWs",
  "plugin-name": "pluginName",
  "plugin-developer": "pluginDeveloper",
  "token-file": "tokenFile",
  "vts-rate": "vtsRate",
  "vts-pos-gain": "vtsPosGain",
  "vts-pos-z-gain": "vtsPosZGain",
  "vts-pos-jump": "vtsPosJump",
  "roll-gain": "rollGain",
  "roll-smooth": "rollSmooth",
  "yaw-sign": "yawSign",
  "pitch-sign": "pitchSign",
  "roll-sign": "rollSign",
  "brow-sign": "browSign",
  "yaw-mirror": "yawMirror",
  "roll-mirror": "rollMirror",
  "posx-mirror": "posMirrorX",
  "sent-by": "sentBy",
  "request-time": "requestTime",
  "keepalive-ms": "keepaliveMs",
  "send-hz": "sendHz",
  "face-id": "faceId",
  width: "width",
  height: "height",
  smooth: "smooth",
  "pos-smooth": "posSmooth",
  "pos-scale": "posScale",
  "rot-scale": "rotScale",
  "pos-max": "posMax",
  "pos-jump": "posJump",
  "pos-dead": "posDead",
  "pos-rebase": "posRebase",
  "pos-leak": "posLeak",
  "rot-leak": "rotLeak",
  "env-file": "envFile",
};

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--demo") out.demo = true;
    else if (arg === "--dump") out.dump = true;
    else if (arg === "--no-zero") out.zero = false;
    else if (arg === "--no-rot-zero") out.rotZero = false;
    else if (arg === "--yaw-mirror") out.yawMirror = true;
    else if (arg === "--no-yaw-mirror") out.yawMirror = false;
    else if (arg === "--roll-mirror") out.rollMirror = true;
    else if (arg === "--no-roll-mirror") out.rollMirror = false;
    else if (arg === "--posx-mirror") out.posMirrorX = true;
    else if (arg === "--no-posx-mirror") out.posMirrorX = false;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (!(key in FLAG_KEYS)) throw new Error(`unknown flag --${key}`);
      out[FLAG_KEYS[key]] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf("=");
    if (eq < 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let val = cleaned.slice(eq + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    } else if (val.length >= 2 && val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1);
    }
    if (key in ENV_KEYS) out[ENV_KEYS[key]] = val;
  }
  return out;
}

function coerce(key, val) {
  if (val === undefined || val === null || val === "") return undefined;
  if (key === "zero" || key === "rotZero") {
    if (typeof val === "boolean") return val;
    const s = String(val).toLowerCase();
    if (["1", "true", "yes"].includes(s)) return false;
    return true;
  }
  if (NUM_KEYS.has(key)) {
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
  }
  return String(val);
}

export function resolveEnvFilePath(cliEnvFile) {
  if (cliEnvFile) return cliEnvFile;
  if (process.env.ENV_FILE) return process.env.ENV_FILE;
  const local = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(local)) return local;
  return null;
}

export function loadEnvFile(filePath) {
  if (!filePath) return {};
  if (!fs.existsSync(filePath)) throw new Error(`env file not found: ${filePath}`);
  return parseEnvText(fs.readFileSync(filePath, "utf8"));
}

export function resolveConfig(argv, envSource = null) {
  const args = parseArgs(argv);
  const envFilePath = resolveEnvFilePath(args.envFile);
  const fileEnv = envSource ?? loadEnvFile(envFilePath);
  const shellEnv = {};
  for (const [envKey, cfgKey] of Object.entries(ENV_KEYS)) {
    if (process.env[envKey] !== undefined) shellEnv[cfgKey] = process.env[envKey];
  }
  const merged = { ...DEFAULTS };
  for (const src of [fileEnv, shellEnv]) {
    for (const [key, val] of Object.entries(src)) {
      const c = coerce(key, val);
      if (c !== undefined && key in merged) merged[key] = c;
    }
  }
  for (const [key, val] of Object.entries(args)) {
    if (key === "help" || key === "envFile") continue;
    const c = coerce(key, val);
    if (c !== undefined && key in merged) merged[key] = c;
    else if (key === "demo" || key === "dump" || key === "zero" || key === "rotZero") merged[key] = val;
  }
  if (args.demo !== undefined) merged.demo = true;
  if (args.dump !== undefined) merged.dump = true;
  if (args.zero === false) merged.zero = false;
  if (args.rotZero === false) merged.rotZero = false;
  for (const k of ["yawMirror", "rollMirror", "posMirrorX"]) {
    if (args[k] === true) merged[k] = true;
    else if (args[k] === false) merged[k] = false;
    else if (typeof merged[k] === "string") {
      merged[k] = ["1", "true", "yes"].includes(merged[k].toLowerCase());
    }
  }
  merged.smooth = Math.min(0.95, Math.max(0, Number(merged.smooth) || 0));
  const out = String(merged.out).toLowerCase();
  if (!["osf", "vts", "both"].includes(out)) throw new Error(`--out must be osf, vts, or both`);
  merged.out = out;
  merged.wantsOsf = out === "osf" || out === "both";
  merged.wantsVts = out === "vts" || out === "both";
  merged.envFilePath = envFilePath;
  merged.help = !!args.help;
  return merged;
}
