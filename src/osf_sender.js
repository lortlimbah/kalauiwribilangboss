import dgram from "node:dgram";
import { FEATURE_ORDER } from "./mapper.js";

export const PACKET_SIZE = 8 + 4 + 2 * 4 + 2 * 4 + 1 + 4 + 4 * 4 + 3 * 4 + 3 * 4 + 4 * 68 + 4 * 2 * 68 + 4 * 3 * 70 + 4 * 14;

export function encodeOsfPacket(f) {
  const buf = Buffer.alloc(PACKET_SIZE);
  let o = 0;
  buf.writeDoubleLE(f.time, o);
  o += 8;
  buf.writeInt32LE(f.id, o);
  o += 4;
  buf.writeFloatLE(f.width, o);
  o += 4;
  buf.writeFloatLE(f.height, o);
  o += 4;
  buf.writeFloatLE(f.eyeOpenR, o);
  o += 4;
  buf.writeFloatLE(f.eyeOpenL, o);
  o += 4;
  buf.writeUInt8(f.success ? 1 : 0, o);
  o += 1;
  buf.writeFloatLE(f.pnpError, o);
  o += 4;
  for (let i = 0; i < 4; i++) {
    buf.writeFloatLE(f.quaternion[i], o);
    o += 4;
  }
  for (let i = 0; i < 3; i++) {
    buf.writeFloatLE(f.euler[i], o);
    o += 4;
  }
  for (let i = 0; i < 3; i++) {
    buf.writeFloatLE(f.translation[i], o);
    o += 4;
  }
  for (let i = 0; i < 68; i++) {
    buf.writeFloatLE(f.confidence[i], o);
    o += 4;
  }
  for (let i = 0; i < 68; i++) {
    buf.writeFloatLE(f.points[i].y, o);
    o += 4;
    buf.writeFloatLE(f.points[i].x, o);
    o += 4;
  }
  for (let i = 0; i < 70; i++) {
    buf.writeFloatLE(f.points3D[i].x, o);
    o += 4;
    buf.writeFloatLE(-f.points3D[i].y, o);
    o += 4;
    buf.writeFloatLE(-f.points3D[i].z, o);
    o += 4;
  }
  for (let i = 0; i < 14; i++) {
    buf.writeFloatLE(f.features[i], o);
    o += 4;
  }
  return buf;
}

export function decodeOsfPacket(buf) {
  let o = 0;
  const time = buf.readDoubleLE(o);
  o += 8;
  const id = buf.readInt32LE(o);
  o += 4;
  const width = buf.readFloatLE(o);
  o += 4;
  const height = buf.readFloatLE(o);
  o += 4;
  const eyeOpenR = buf.readFloatLE(o);
  o += 4;
  const eyeOpenL = buf.readFloatLE(o);
  o += 4;
  const success = buf.readUInt8(o) !== 0;
  o += 1;
  const pnpError = buf.readFloatLE(o);
  o += 4;
  const quaternion = [];
  for (let i = 0; i < 4; i++) {
    quaternion.push(buf.readFloatLE(o));
    o += 4;
  }
  const euler = [];
  for (let i = 0; i < 3; i++) {
    euler.push(buf.readFloatLE(o));
    o += 4;
  }
  const translation = [];
  for (let i = 0; i < 3; i++) {
    translation.push(buf.readFloatLE(o));
    o += 4;
  }
  const vtsTranslation = [-translation[1], translation[0], -translation[2]];
  const confidence = [];
  for (let i = 0; i < 68; i++) {
    confidence.push(buf.readFloatLE(o));
    o += 4;
  }
  const points = [];
  for (let i = 0; i < 68; i++) {
    const a = buf.readFloatLE(o);
    o += 4;
    const b = buf.readFloatLE(o);
    o += 4;
    points.push({ x: b, y: a });
  }
  const points3D = [];
  for (let i = 0; i < 70; i++) {
    const x = buf.readFloatLE(o);
    o += 4;
    const ny = buf.readFloatLE(o);
    o += 4;
    const nz = buf.readFloatLE(o);
    o += 4;
    points3D.push({ x, y: -ny, z: -nz });
  }
  const features = {};
  for (let i = 0; i < 14; i++) {
    features[FEATURE_ORDER[i]] = buf.readFloatLE(o);
    o += 4;
  }
  return {
    time,
    id,
    width,
    height,
    eyeOpenR,
    eyeOpenL,
    success,
    pnpError,
    quaternion,
    euler,
    translation,
    vtsTranslation,
    confidence,
    points,
    points3D,
    features,
  };
}

export function createOsfSender({ ip = "127.0.0.1", port = 11573 } = {}) {
  const socket = dgram.createSocket("udp4");
  let sent = 0;
  let errors = 0;
  let lastError = null;
  socket.on("error", (err) => {
    errors += 1;
    lastError = err;
  });
  return {
    send(osf) {
      return this.sendBuffer(encodeOsfPacket(osf));
    },
    sendBuffer(buf) {
      return new Promise((resolve) => {
        socket.send(buf, port, ip, (err) => {
          if (err) {
            errors += 1;
            lastError = err;
          } else {
            sent += 1;
          }
          resolve(!err);
        });
      });
    },
    stats() {
      return { sent, errors, lastError: lastError ? String(lastError) : null };
    },
    close() {
      return new Promise((resolve) => socket.close(resolve));
    },
  };
}
