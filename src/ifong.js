import dgram from "node:dgram";

export const IPHONE_PORT = 21412;

export function buildRequest({ sentBy, time = 5, ports }) {
  const name = String(sentBy ?? "kalauiwribilangboss").slice(0, 64);
  if (name.length < 1) throw new Error("sentBy must be 1-64 characters");
  const clampedTime = Math.min(10, Math.max(0.5, Number(time) || 5));
  const list = [...new Set(ports)].map((p) => Number(p)).filter((p) => p >= 1 && p <= 65535);
  if (list.length < 1) throw new Error("at least one listen port is required");
  if (list.length > 32) throw new Error("at most 32 ports can be requested");
  return JSON.stringify({
    messageType: "iOSTrackingDataRequest",
    time: clampedTime,
    sentBy: name,
    ports: list,
  });
}

function toVector3(v) {
  if (!v) return { x: 0, y: 0, z: 0 };
  if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") return v;
  if (typeof v.X === "number") return { x: v.X, y: v.Y, z: v.Z };
  return { x: 0, y: 0, z: 0 };
}

export function parseFrame(msg) {
  const text = Buffer.isBuffer(msg) ? msg.toString("ascii") : String(msg);
  const data = JSON.parse(text);
  const blendList = Array.isArray(data.BlendShapes) ? data.BlendShapes : [];
  const blend = {};
  for (const entry of blendList) {
    if (entry && typeof entry.k === "string" && typeof entry.v === "number") {
      blend[entry.k] = entry.v;
    }
  }
  return {
    Timestamp: typeof data.Timestamp === "number" ? data.Timestamp : Date.now(),
    FaceFound: data.FaceFound === true,
    BlendShapes: blendList,
    blend,
    Rotation: toVector3(data.Rotation),
    Position: toVector3(data.Position),
    EyeLeft: toVector3(data.EyeLeft),
    EyeRight: toVector3(data.EyeRight),
    Hotkey: typeof data.Hotkey === "number" ? data.Hotkey : -1,
  };
}

export function createIfong({
  iphoneIp,
  iphonePort = IPHONE_PORT,
  listenPort = 11125,
  sentBy = "kalauiwribilangboss",
  requestTime = 5,
  keepaliveMs = 1000,
  onFrame = null,
  onError = null,
} = {}) {
  if (!iphoneIp) throw new Error("iphoneIp is required");
  const listener = dgram.createSocket("udp4");
  const sender = dgram.createSocket("udp4");
  let timer = null;
  let running = false;
  let received = 0;
  let malformed = 0;
  let requests = 0;
  let lastError = null;
  let lastHotkey = -1;

  function fail(err) {
    lastError = err;
    if (onError) onError(err);
  }

  function sendRequest() {
    let payload;
    try {
      payload = buildRequest({ sentBy, time: requestTime, ports: [listenPort] });
    } catch (err) {
      fail(err);
      return;
    }
    sender.send(payload, iphonePort, iphoneIp, (err) => {
      if (err) fail(err);
      else requests += 1;
    });
  }

  listener.on("message", (msg) => {
    try {
      const frame = parseFrame(msg);
      received += 1;
      if (frame.Hotkey !== -1) lastHotkey = frame.Hotkey;
      if (onFrame) onFrame(frame);
    } catch (err) {
      malformed += 1;
      fail(err);
    }
  });
  listener.on("error", fail);
  sender.on("error", fail);

  return {
    start() {
      return new Promise((resolve, reject) => {
        if (running) return resolve(false);
        listener.once("error", reject);
        listener.bind(listenPort, () => {
          listener.removeListener("error", reject);
          running = true;
          sendRequest();
          timer = setInterval(sendRequest, keepaliveMs);
          if (timer.unref) timer.unref();
          resolve(true);
        });
      });
    },
    stop() {
      return new Promise((resolve) => {
        running = false;
        if (timer) clearInterval(timer);
        timer = null;
        listener.close(() => {
          sender.close(() => resolve(true));
        });
      });
    },
    stats() {
      return { received, malformed, requests, lastHotkey, lastError: lastError ? String(lastError) : null };
    },
  };
}
