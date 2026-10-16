import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import { mapPose, mapScalars, parseBlendShapes } from "./mapper.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function wsAcceptKey(clientKey) {
  return crypto.createHash("sha1").update(clientKey + WS_GUID).digest("base64");
}

export function encodeWsFrame(text) {
  return encodeWsBinary(0x1, Buffer.from(text, "utf8"));
}

export function encodeWsBinary(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const mask = crypto.randomBytes(4);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | data.length;
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

export function parseWsUrl(url) {
  const m = String(url).match(/^ws:\/\/([^/:]+)(?::(\d+))?(\/.*)?$/);
  if (!m) throw new Error(`only ws:// URLs are supported: ${url}`);
  return { host: m[1], port: Number(m[2] || 8001), path: m[3] || "/" };
}

export function connectWs(url, { timeoutMs = 8000 } = {}) {
  const { host, port, path } = parseWsUrl(url);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const key = crypto.randomBytes(16).toString("base64");
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`websocket connect timed out: ${url}`));
      }
    }, timeoutMs);
    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    let head = Buffer.alloc(0);
    let rest = Buffer.alloc(0);
    let handshook = false;
    const listeners = { message: [], close: [] };
    let pendingClose = null;
    let frag = [];
    function pump(chunk) {
      let buf = chunk;
      while (buf.length >= 2) {
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return buf;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return buf;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return buf;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (op === 0x8) {
          let code = null;
          let reason = "";
          if (payload.length >= 2) {
            code = payload.readUInt16BE(0);
            reason = payload.subarray(2).toString("utf8");
          }
          if (listeners.close.length) {
            for (const fn of listeners.close) fn(code, reason);
          } else {
            pendingClose = { code, reason };
          }
          socket.end();
          return Buffer.alloc(0);
        }
        if (op === 0x9) {
          socket.write(encodeWsBinary(0xa, payload));
          continue;
        }
        if (op === 0x1 || op === 0x2 || (op === 0x0 && frag.length)) {
          frag.push(payload);
          if (fin) {
            const text = Buffer.concat(frag).toString("utf8");
            frag = [];
            for (const fn of listeners.message) fn(text);
          }
          continue;
        }
      }
      return buf;
    }
    let shook = null;
    socket.on("data", (chunk) => {
      if (!handshook) {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end < 0) {
          if (head.length > 16384 && !settled) {
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            reject(new Error("bad websocket handshake: headers too long"));
          }
          return;
        }
        const status = head.subarray(0, end).toString("ascii");
        const expect = wsAcceptKey(key);
        if (!status.includes(" 101 ") || !status.includes(expect)) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            reject(new Error("websocket handshake rejected"));
          }
          return;
        }
        handshook = true;
        const leftover = head.subarray(end + 4);
        if (leftover.length) rest = pump(leftover);
        if (shook) shook();
        return;
      }
      rest = pump(Buffer.concat([rest, chunk]));
    });
    socket.on("close", () => {
      for (const fn of listeners.close) fn(null, "");
    });
    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
    );
    shook = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          sendText(text) {
            return new Promise((res, rej) => {
              socket.write(encodeWsFrame(text), (err) => (err ? rej(err) : res()));
            });
          },
          onMessage(fn) {
            listeners.message.push(fn);
          },
          onClose(fn) {
            listeners.close.push(fn);
            if (pendingClose) {
              const p = pendingClose;
              pendingClose = null;
              fn(p.code, p.reason);
            }
          },
          sendBinary(opcode, payload) {
            socket.write(encodeWsBinary(opcode, payload));
          },
          close() {
            try {
              const body = Buffer.alloc(2);
              body.writeUInt16BE(1000, 0);
              socket.write(encodeWsBinary(0x8, body));
            } catch {}
            socket.end();
          },
        });
      }
    };
  });
}

let requestCounter = 0;

export function envelope(messageType, data, requestID = null) {
  return {
    apiName: "VTubeStudioPublicAPI",
    apiVersion: "1.0",
    requestID: requestID ?? `kb_${Date.now()}_${(requestCounter += 1)}`,
    messageType,
    data,
  };
}

export const FALLBACK_RANGES = {
  FacePositionX: { min: -1, max: 1, def: 0 },
  FacePositionY: { min: -1, max: 1, def: 0 },
  FacePositionZ: { min: -1, max: 1, def: 0 },
  FaceAngleX: { min: -30, max: 30, def: 0 },
  FaceAngleY: { min: -30, max: 30, def: 0 },
  FaceAngleZ: { min: -30, max: 30, def: 0 },
  MouthSmile: { min: 0, max: 1, def: 0 },
  MouthOpen: { min: 0, max: 1, def: 0 },
  Brows: { min: 0, max: 1, def: 0.5 },
  EyeOpenLeft: { min: 0, max: 1, def: 1 },
  EyeOpenRight: { min: 0, max: 1, def: 1 },
  EyeLeftX: { min: -1, max: 1, def: 0 },
  EyeLeftY: { min: -1, max: 1, def: 0 },
  EyeRightX: { min: -1, max: 1, def: 0 },
  EyeRightY: { min: -1, max: 1, def: 0 },
  BrowInnerUp: { min: 0, max: 1, def: 0 },
  BrowLeftY: { min: -1, max: 1, def: 0 },
  BrowRightY: { min: -1, max: 1, def: 0 },
  CheekPuff: { min: 0, max: 1, def: 0 },
  TongueOut: { min: 0, max: 1, def: 0 },
  MouthX: { min: -1, max: 1, def: 0 },
};

export function paramTable(paramList) {
  const table = {};
  let live = 0;
  if (Array.isArray(paramList)) {
    for (const p of paramList) {
      if (!p || typeof p.name !== "string") continue;
      const min = Number(p.min);
      const max = Number(p.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) continue;
      const def = Number.isFinite(Number(p.defaultValue)) ? Number(p.defaultValue) : min < 0 ? 0 : min;
      table[p.name] = { min, max, def: Math.min(max, Math.max(min, def)) };
      live += 1;
    }
  }
  if (live === 0) {
    for (const [name, r] of Object.entries(FALLBACK_RANGES)) table[name] = { ...r };
  }
  return table;
}

export function scaleSignal(table, id, kind, raw) {
  const r = table[id];
  if (!r) return null;
  if (kind === "uni") {
    const s = Math.min(1, Math.max(0, raw));
    return r.def + s * (r.max - r.def);
  }
  if (kind === "mid") {
    const s = Math.min(1, Math.max(0, raw));
    const mid = (r.min + r.max) / 2;
    const half = (r.max - r.min) / 2;
    const v = mid + (s - 0.5) * 2 * half;
    return Math.min(r.max, Math.max(r.min, v));
  }
  const s = Math.min(1, Math.max(-1, raw));
  const span = s >= 0 ? r.max - r.def : r.def - r.min;
  return r.def + s * span;
}

export function scaleSignals(signals, table) {
  const values = [];
  for (const s of signals) {
    const v = scaleSignal(table, s.id, s.kind, s.value);
    if (v !== null && Number.isFinite(v)) values.push({ id: s.id, value: Math.round(v * 10000) / 10000 });
  }
  return values;
}

function bOf(blend, key) {
  const v = blend[key];
  return typeof v === "number" && !Number.isNaN(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export function mapVtsSignals(frame, vtsState = {}, opts = {}) {
  const found = !!(frame && frame.FaceFound);
  const blend = parseBlendShapes(frame ? frame.BlendShapes : []);
  const scalars = mapScalars(blend);
  const pose = mapPose(frame ? frame.Rotation : null, frame ? frame.Position : null, vtsState.base ?? {}, {
    rotScale: 1,
    posScale: 1,
    zero: opts.zero ?? true,
    rotZero: opts.rotZero ?? true,
    posLeak: opts.posLeak ?? 0.005,
    rotLeak: opts.rotLeak ?? 0.001,
  });
  const rotScale = opts.rotScale ?? 1;
  const yawMirror = opts.yawMirror ?? false;
  const rollMirror = opts.rollMirror ?? true;
  const posMirrorX = opts.posMirrorX ?? false;
  const yawSign = (opts.yawSign ?? 1) * (yawMirror ? -1 : 1);
  const pitchSign = opts.pitchSign ?? -1;
  const rollSign = (opts.rollSign ?? 1) * (rollMirror ? -1 : 1);
  const browSign = opts.browSign ?? 1;
  const posGain = opts.vtsPosGain ?? 0.3;
  const posZGain = opts.vtsPosZGain ?? 0.15;
  const rollGain = opts.rollGain ?? 0.15;
  const alpha = opts.smooth ?? 0.5;
  const posAlpha = opts.posSmooth ?? 0.85;
  const rollAlpha = opts.rollSmooth ?? 0.8;
  const eyeAlpha = opts.eyeSmooth ?? 0.5;
  const eyeGain = opts.eyeGain ?? 2;
  const jump = opts.vtsPosJump ?? 0.25;
  const rawYaw = pose.rpy[1] * rotScale * yawSign;
  const rawPitch = pose.rpy[0] * rotScale * pitchSign;
  const rawRoll = pose.rpy[2] * rotScale * rollSign;
  const [rdx, rdy, rdz] = pose.vtsTranslation;
  const rawGaze = {
    lx: bOf(blend, "EyeLookInRight") - bOf(blend, "EyeLookOutRight"),
    ly: bOf(blend, "EyeLookUpRight") - bOf(blend, "EyeLookDownRight"),
    rx: bOf(blend, "EyeLookInLeft") - bOf(blend, "EyeLookOutLeft"),
    ry: bOf(blend, "EyeLookUpLeft") - bOf(blend, "EyeLookDownLeft"),
  };
  const pg = vtsState.gaze ?? null;
  const gazeKeys = ["lx", "ly", "rx", "ry"];
  const smoothGaze = {};
  for (const k of gazeKeys) {
    const raw = Math.min(1, Math.max(-1, rawGaze[k]));
    smoothGaze[k] = pg && found ? pg[k] * eyeAlpha + raw * (1 - eyeAlpha) : raw;
  }
  const eye = {};
  for (const k of gazeKeys) eye[k] = smoothGaze[k] * eyeGain;
  const pe = vtsState.euler ?? null;
  const pp = vtsState.pos ?? null;
  const euler = pe && found
    ? [rawPitch, rawYaw, rawRoll].map((v, i) => pe[i] * [alpha, alpha, rollAlpha][i] + v * (1 - [alpha, alpha, rollAlpha][i]))
    : [rawPitch, rawYaw, rawRoll];
  let pos = pp && found
    ? [0, 1, 2].map((i) => pp[i] * posAlpha + [rdx, rdy, rdz][i] * (1 - posAlpha))
    : [rdx, rdy, rdz];
  let streak = vtsState.streak ?? 0;
  let grace = vtsState.grace ?? 0;
  if (found && pp && grace > 0) {
    grace -= 1;
    streak = 0;
  } else if (found && pp) {
    const dist = Math.sqrt(
      (pos[0] - pp[0]) ** 2 + (pos[1] - pp[1]) ** 2 + (pos[2] - pp[2]) ** 2
    );
    if (dist > jump) {
      if (streak + 1 >= 10) {
        streak = 0;
        grace = opts.posGrace ?? 15;
      } else {
        pos = [...pp];
        streak += 1;
      }
    } else {
      streak = 0;
    }
  }
  if (!found && pe && pp) {
    const frozen = {};
    for (const k of gazeKeys) frozen[k] = (pg ?? rawGaze)[k] * eyeGain;
    return {
      faceFound: false,
      signals: poseSignals(scalars, blend, pe[1], pe[0], pe[2], pp, posGain, posZGain, posMirrorX, rollGain, browSign, frozen),
      poseState: { ...vtsState, base: pose.state },
    };
  }
  let peak = typeof vtsState.peak === "number" ? vtsState.peak : 1;
  if (found) {
    const mag = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]);
    peak += (mag - peak) * (mag > peak ? 0.15 : 0.002);
  }
  const agc = Math.min(1, 0.7 / Math.max(peak, 1e-3));
  const next = { base: pose.state, euler, pos, streak, grace, peak, gaze: smoothGaze };
  return {
    faceFound: found,
    signals: poseSignals(scalars, blend, euler[1], euler[0], euler[2], pos, posGain * agc, posZGain * agc, posMirrorX, rollGain, browSign, eye),
    poseState: next,
  };
}

function poseSignals(scalars, blend, yaw, pitch, roll, pos, posGain, posZGain, posMirrorX = false, rollGain = 0.15, browSign = 1, eye = null) {
  const smileL = bOf(blend, "MouthSmileLeft");
  const smileR = bOf(blend, "MouthSmileRight");
  const frownL = bOf(blend, "MouthFrownLeft");
  const frownR = bOf(blend, "MouthFrownRight");
  const jawOpen = bOf(blend, "JawOpen");
  const mouthClose = bOf(blend, "MouthClose");
  const rollU = bOf(blend, "MouthRollUpper");
  const rollL = bOf(blend, "MouthRollLower");
  const funnel = bOf(blend, "MouthFunnel");
  const tongue = bOf(blend, "TongueOut");
  const mouthOpen = Math.min(1, Math.max(0, jawOpen - mouthClose - (rollU + rollL) * 0.2 + funnel * 0.2));
  const gaze = eye ?? {
    lx: bOf(blend, "EyeLookInRight") - bOf(blend, "EyeLookOutRight"),
    ly: bOf(blend, "EyeLookUpRight") - bOf(blend, "EyeLookDownRight"),
    rx: bOf(blend, "EyeLookInLeft") - bOf(blend, "EyeLookOutLeft"),
    ry: bOf(blend, "EyeLookUpLeft") - bOf(blend, "EyeLookDownLeft"),
  };
  const mouthSmile = ((smileL + smileR) / 2 - (frownL + frownR) / 2);
  const brows = 0.5 + (bOf(blend, "BrowOuterUpLeft") + bOf(blend, "BrowOuterUpRight") - bOf(blend, "BrowDownLeft") - bOf(blend, "BrowDownRight")) / 4;
  const browUpL = 0.5 + (bOf(blend, "BrowOuterUpLeft") - bOf(blend, "BrowDownLeft")) / 2;
  const browUpR = 0.5 + (bOf(blend, "BrowOuterUpRight") - bOf(blend, "BrowDownRight")) / 2;
  const browsOut = browSign < 0 ? 1 - brows : brows;
  const browLOut = browSign < 0 ? 1 - browUpL : browUpL;
  const browROut = browSign < 0 ? 1 - browUpR : browUpR;
  const mouthX = ((bOf(blend, "MouthLeft") - bOf(blend, "MouthRight")) + (smileL - smileR)) * (1 - tongue);
  return [
    { id: "FacePositionX", kind: "bi", value: (posMirrorX ? -pos[0] : pos[0]) * posGain },
    { id: "FacePositionY", kind: "bi", value: pos[1] * posGain },
    { id: "FacePositionZ", kind: "bi", value: pos[2] * posZGain },
    { id: "FaceAngleX", kind: "bi", value: yaw / 30 },
    { id: "FaceAngleY", kind: "bi", value: pitch / 30 },
    { id: "FaceAngleZ", kind: "bi", value: (roll * rollGain) / 30 },
    { id: "MouthSmile", kind: "bi", value: mouthSmile },
    { id: "MouthOpen", kind: "uni", value: mouthOpen },
    { id: "Brows", kind: "mid", value: browsOut },
    { id: "EyeOpenLeft", kind: "uni", value: scalars.eyeOpenL },
    { id: "EyeOpenRight", kind: "uni", value: scalars.eyeOpenR },
    { id: "EyeLeftX", kind: "bi", value: gaze.lx },
    { id: "EyeLeftY", kind: "bi", value: gaze.ly },
    { id: "EyeRightX", kind: "bi", value: gaze.rx },
    { id: "EyeRightY", kind: "bi", value: gaze.ry },
    { id: "BrowInnerUp", kind: "uni", value: bOf(blend, "BrowInnerUp") },
    { id: "BrowLeftY", kind: "mid", value: browLOut },
    { id: "BrowRightY", kind: "mid", value: browROut },
    { id: "CheekPuff", kind: "uni", value: bOf(blend, "CheekPuff") },
    { id: "TongueOut", kind: "uni", value: tongue },
    { id: "MouthX", kind: "bi", value: mouthX },
  ];
}

export function buildInjectMessage(values, { faceFound = true, mode = "set", weight = null } = {}) {
  const parameterValues =
    weight === null || weight >= 1 ? values : values.map((v) => ({ ...v, weight }));
  return envelope("InjectParameterDataRequest", {
    mode,
    faceFound,
    parameterValues,
  });
}

export function readToken(tokenFile) {
  try {
    const t = fs.readFileSync(tokenFile, "utf8").trim();
    return t.length >= 1 ? t : null;
  } catch {
    return null;
  }
}

export function saveToken(tokenFile, token) {
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
}

export function createVtsApiSender({
  url = "ws://127.0.0.1:8001",
  pluginName = "kalauiwribilangboss",
  pluginDeveloper = "kalauiwribilangboss",
  tokenFile = ".vts_token",
  rate = 30,
  tokenTimeoutMs = 180000,
  log = null,
  onError = null,
  connectFn = connectWs,
} = {}) {
  let ws = null;
  let table = paramTable(null);
  let pending = new Map();
  let injected = 0;
  let errors = 0;
  let lastError = null;
  let lastValues = 0;
  let lastPose = null;
  let lastSend = 0;
  let transmitting = false;
  let readyAt = 0;
  let closed = false;
  let reconnectTimer = null;

  const say = (msg) => {
    if (log) log(msg);
  };
  let lastErrorText = null;
  const fail = (err) => {
    errors += 1;
    lastError = err;
    const text = String((err && err.message) || err);
    if (text === lastErrorText) return;
    lastErrorText = text;
    if (onError) onError(err);
  };
  const dropMatch = (err) => {
    const m = String((err && err.message) || err).match(/Parameter (\w+) not found/);
    return m ? m[1] : null;
  };

  function request(messageType, data, timeoutMs = 10000) {
    const msg = envelope(messageType, data);
    return new Promise((resolve, reject) => {
      if (!ws) {
        reject(new Error("VTS not connected"));
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(msg.requestID);
        reject(new Error(`${messageType} timed out`));
      }, timeoutMs);
      pending.set(msg.requestID, { resolve, reject, timer });
      ws.sendText(JSON.stringify(msg)).catch((err) => {
        clearTimeout(timer);
        pending.delete(msg.requestID);
        reject(err);
      });
    });
  }

  function onText(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.requestID && pending.has(msg.requestID)) {
      const { resolve, reject, timer } = pending.get(msg.requestID);
      pending.delete(msg.requestID);
      clearTimeout(timer);
      if (msg.messageType === "APIError") {
        reject(new Error(`${msg.data?.errorID}: ${msg.data?.message}`));
      } else {
        resolve(msg);
      }
    }
  }

  async function authenticate() {
    let token = readToken(tokenFile);
    if (!token) {
      say(`Requesting VTS plugin token as "${pluginName}" — click Allow in VTube Studio…`);
      const res = await request(
        "AuthenticationTokenRequest",
        { pluginName, pluginDeveloper },
        tokenTimeoutMs
      );
      token = res.data?.authenticationToken;
      if (!token) throw new Error("VTS did not return an authentication token");
      saveToken(tokenFile, token);
      say(`Saved VTS token to ${tokenFile}`);
    }
    const auth = await request("AuthenticationRequest", {
      pluginName,
      pluginDeveloper,
      authenticationToken: token,
    });
    if (!auth.data?.authenticated) {
      try {
        fs.unlinkSync(tokenFile);
      } catch {}
      throw new Error(`VTS authentication refused: ${auth.data?.reason ?? "unknown"}`);
    }
  }

  async function loadParams() {
    try {
      const res = await request("InputParameterListRequest", {});
      const list = res.data?.parameters ?? res.data?.defaultParameters ?? [];
      table = paramTable(list);
      say(`Loaded ${Object.keys(table).length} VTS input parameters: ${Object.keys(table).join(",")}`);
    } catch (err) {
      table = paramTable(null);
      say(`Using fallback VTS parameter ranges (${err.message})`);
    }
  }

  async function connectOnce() {
    ws = await connectFn(url);
    ws.onMessage(onText);
    ws.onClose(handleClose);
    await authenticate();
    await loadParams();
    readyAt = Date.now();
  }

  function handleClose(code, reason) {
    ws = null;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error("VTS connection closed"));
    }
    pending.clear();
    if (code !== null && code !== undefined) {
      say(`VTS closed the connection (code ${code}${reason ? `: ${reason}` : ""})`);
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (closed) return;
    if (reconnectTimer) return;
    say("VTS connection lost — reconnecting…");
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (closed) return;
      try {
        await connectOnce();
        say("VTS reconnected");
      } catch (err) {
        fail(err);
        scheduleReconnect();
      }
    }, 1000);
    if (reconnectTimer.unref) reconnectTimer.unref();
  }

  function fadeWeight() {
    if (!readyAt) return null;
    const w = (Date.now() - readyAt) / 800;
    if (w >= 1) return null;
    return Math.round(Math.max(0, w) * 100) / 100;
  }

  return {
    async connect() {
      closed = false;
      reconnectTimer = null;
      await connectOnce();
    },
    prepare(frame, poseState = {}, opts = {}) {
      const mapped = mapVtsSignals(frame, poseState, opts);
      const values = scaleSignals(mapped.signals, table);
      lastValues = values.length;
      const byId = Object.fromEntries(values.map((v) => [v.id, v.value]));
      lastPose = {
        ax: byId.FaceAngleX ?? null,
        ay: byId.FaceAngleY ?? null,
        px: byId.FacePositionX ?? null,
        py: byId.FacePositionY ?? null,
      };
      return { values, faceFound: mapped.faceFound, poseState: mapped.poseState };
    },
    async transmit(values, faceFound = true) {
      const now = Date.now();
      const minGap = rate > 0 ? 1000 / rate : 0;
      if (transmitting || now - lastSend < minGap) return false;
      transmitting = true;
      lastSend = now;
      try {
        await this.sendNow(values, faceFound);
        return true;
      } finally {
        transmitting = false;
      }
    },
    async sendNow(values, faceFound = true) {
      const msg = buildInjectMessage(values, { faceFound, weight: fadeWeight() });
      try {
        await request(msg.messageType, msg.data, 5000);
        injected += 1;
      } catch (err) {
        const dropped = dropMatch(err);
        if (dropped && table[dropped]) {
          delete table[dropped];
          say(`VTS has no parameter ${dropped} — dropped, continuing`);
        }
        fail(err);
        throw err;
      }
    },
    async injectMapped(frame, poseState = {}, opts = {}) {
      const now = Date.now();
      const minGap = rate > 0 ? 1000 / rate : 0;
      if (now - lastSend < minGap) return { sent: false, poseState: poseState };
      const prepped = this.prepare(frame, poseState, opts);
      try {
        await this.transmit(prepped.values, prepped.faceFound);
        return { sent: true, poseState: prepped.poseState };
      } catch (err) {
        return { sent: false, poseState: prepped.poseState };
      }
    },
    paramTable() {
      return table;
    },
    stats() {
      return { injected, errors, lastValues, lastPose, lastError: lastError ? String(lastError) : null };
    },
    async close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error("sender closed"));
      }
      pending.clear();
      if (ws) ws.close();
      ws = null;
    },
  };
}
