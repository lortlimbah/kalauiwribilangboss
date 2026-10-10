import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildInjectMessage,
  connectWs,
  createVtsApiSender,
  encodeWsFrame,
  mapVtsSignals,
  paramTable,
  scaleSignals,
  wsAcceptKey,
} from "../src/vts_api_sender.js";

function decodeClientFrames(buf) {
  const frames = [];
  let off = 0;
  while (off + 2 <= buf.length) {
    const masked = (buf[off + 1] & 0x80) !== 0;
    let len = buf[off + 1] & 0x7f;
    let h = 2;
    if (len === 126) {
      len = buf.readUInt16BE(off + 2);
      h = 4;
    }
    if (off + h + (masked ? 4 : 0) + len > buf.length) break;
    let payload = buf.subarray(off + h + (masked ? 4 : 0), off + h + (masked ? 4 : 0) + len);
    if (masked) {
      const mask = buf.subarray(off + h, off + h + 4);
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
      payload = out;
    }
    frames.push({ op: buf[off] & 0x0f, payload });
    off += h + (masked ? 4 : 0) + len;
  }
  return { frames, rest: buf.subarray(off) };
}

function serverFrame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf8");
  let head;
  if (payload.length < 126) {
    head = Buffer.alloc(2);
    head[0] = 0x81;
    head[1] = payload.length;
  } else {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([head, payload]);
}

function startFakeVts({ rejectParam = null } = {}) {
  const seen = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let shook = false;
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!shook) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buf.subarray(0, end).toString("ascii");
        const key = head.match(/Sec-WebSocket-Key: (\S+)/)[1];
        const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        buf = buf.subarray(end + 4);
        shook = true;
      }
      const { frames, rest } = decodeClientFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.op !== 0x1) continue;
        const msg = JSON.parse(f.payload.toString("utf8"));
        seen.push(msg);
        const reply = (messageType, data) =>
          socket.write(serverFrame({ ...msg, messageType, data }));
        if (msg.messageType === "AuthenticationTokenRequest") {
          reply("AuthenticationTokenResponse", { authenticationToken: "tok123" });
        } else if (msg.messageType === "AuthenticationRequest") {
          reply("AuthenticationResponse", { authenticated: true });
        } else if (msg.messageType === "InputParameterListRequest") {
          reply("InputParameterListResponse", {
            parameters: [
              { name: "MouthOpen", min: 0, max: 1, defaultValue: 0 },
              { name: "FaceAngleX", min: -30, max: 30, defaultValue: 0 },
              { name: "EyeLeftX", min: -1, max: 1, defaultValue: 0 },
            ],
          });
        } else if (msg.messageType === "InjectParameterDataRequest") {
          const bad = rejectParam && msg.data.parameterValues.some((v) => v.id === rejectParam);
          if (bad) {
            socket.write(
              serverFrame({
                ...msg,
                messageType: "APIError",
                data: {
                  errorID: 453,
                  message: `Parameter ${rejectParam} not found. Did you create it yet?`,
                },
              })
            );
          } else {
            reply("InjectParameterDataResponse", {});
          }
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        seen,
        sockets,
        port: server.address().port,
        destroy() {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
    });
  });
}

describe("vts api", () => {
  it("computes the websocket accept key", () => {
    assert.equal(wsAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("encodes masked frames the server can read", () => {
    const { frames } = decodeClientFrames(encodeWsFrame('{"a":1}'));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].payload.toString("utf8"), '{"a":1}');
  });

  it("maps ARKit frames to VTS signals", () => {
    const neutral = {
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    const st0 = mapVtsSignals(neutral, {}, {}).poseState;
    const { faceFound, signals } = mapVtsSignals(
      {
        FaceFound: true,
        BlendShapes: [
          { k: "JawOpen", v: 1 },
          { k: "EyeBlinkLeft", v: 0 },
          { k: "MouthSmileLeft", v: 0.8 },
          { k: "MouthSmileRight", v: 0.8 },
        ],
        Rotation: { x: 15, y: 0, z: 0 },
        Position: { x: 0, y: 0, z: 0.4 },
      },
      st0,
      { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0, mirror: false }
    );
    assert.equal(faceFound, true);
    const byId = Object.fromEntries(signals.map((s) => [s.id, s]));
    assert.equal(byId.MouthOpen.value, 1);
    assert.equal(byId.EyeOpenLeft.value, 1);
    assert.ok(Math.abs(byId.FaceAngleX.value - 0.5) < 1e-9);
    assert.ok(byId.MouthSmile.value > 0.7);
  });

  it("mirrors yaw, roll and position X with the mirror flag", () => {
    const neutral = {
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    const mk = (mirror) => {
      const st0 = mapVtsSignals(neutral, {}, { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0, mirror }).poseState;
      return mapVtsSignals(
        { ...neutral, Rotation: { x: 10, y: 0, z: 6 }, Position: { x: 0.1, y: 0, z: 0.4 } },
        st0,
        { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0, mirror, vtsPosGain: 1 }
      ).signals;
    };
    const byId = (signals) => Object.fromEntries(signals.map((s) => [s.id, s.value]));
    const a = byId(mk(false));
    const b = byId(mk(true));
    assert.ok(Math.abs(a.FaceAngleX + b.FaceAngleX) < 1e-9);
    assert.ok(Math.abs(a.FaceAngleZ + b.FaceAngleZ) < 1e-9);
    assert.ok(Math.abs(a.FacePositionX + b.FacePositionX) < 1e-9);
    assert.ok(a.FaceAngleX > 0);
  });

  it("scales mid-neutral signals around the default", () => {
    const table = paramTable([{ name: "Brows", min: 0, max: 1, defaultValue: 0.5 }]);
    const values = scaleSignals(
      [
        { id: "Brows", kind: "mid", value: 0.5 },
        { id: "Brows", kind: "mid", value: 1 },
        { id: "Brows", kind: "mid", value: 0 },
      ],
      table
    ).map((v) => v.value);
    assert.deepEqual(values, [0.5, 1, 0]);
  });

  it("wires mirrored eye gaze and position like reference bridges", () => {
    const neutral = {
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    const st0 = mapVtsSignals(neutral, {}, { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0, mirror: false }).poseState;
    const { signals } = mapVtsSignals(
      {
        ...neutral,
        BlendShapes: [
          { k: "EyeLookOutRight", v: 1 },
          { k: "EyeLookInLeft", v: 1 },
          { k: "MouthSmileLeft", v: 0.6 },
          { k: "MouthFrownRight", v: 0.2 },
        ],
        Position: { x: 0.1, y: 0, z: 0.4 },
      },
      st0,
      { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0, vtsPosGain: 1, mirror: false }
    );
    const byId = Object.fromEntries(signals.map((s) => [s.id, s.value]));
    assert.equal(byId.EyeLeftX, -1);
    assert.equal(byId.EyeRightX, 1);
    assert.ok(byId.FacePositionX < 0);
    assert.ok(Math.abs(byId.MouthSmile - 0.2) < 1e-9);
  });

  it("scales signals against the live parameter table", () => {
    const table = paramTable([
      { name: "MouthOpen", min: 0, max: 1, defaultValue: 0 },
      { name: "FaceAngleX", min: -30, max: 30, defaultValue: 0 },
      { name: "EyeLeftX", min: -1, max: 1, defaultValue: 0 },
    ]);
    const values = scaleSignals(
      [
        { id: "MouthOpen", kind: "uni", value: 0.5 },
        { id: "FaceAngleX", kind: "bi", value: 0.5 },
        { id: "EyeLeftX", kind: "bi", value: -1 },
        { id: "Nope", kind: "uni", value: 1 },
      ],
      table
    );
    const byId = Object.fromEntries(values.map((v) => [v.id, v.value]));
    assert.equal(byId.MouthOpen, 0.5);
    assert.equal(byId.FaceAngleX, 15);
    assert.equal(byId.EyeLeftX, -1);
    assert.equal(byId.Nope, undefined);
  });

  it("caps hot position signals instead of railing", () => {
    const neutral = {
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    let st = mapVtsSignals(neutral, {}, { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0 }).poseState;
    const hot = { ...neutral, Position: { x: 5, y: 0, z: 0.4 } };
    let last = null;
    for (let i = 0; i < 60; i++) {
      last = mapVtsSignals(hot, st, { smooth: 0, posSmooth: 0, rotLeak: 0, posLeak: 0 });
      st = last.poseState;
    }
    const byId = Object.fromEntries(last.signals.map((s) => [s.id, s.value]));
    assert.ok(Math.abs(byId.FacePositionX) < 0.5);
  });

  it("smooths VTS pose and holds teleports", () => {
    let st = {};
    const base = {
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    const first = mapVtsSignals(base, st, { smooth: 0.5, posSmooth: 0.85 });
    st = first.poseState;
    const px = Object.fromEntries(first.signals.map((s) => [s.id, s.value]));
    assert.ok(Math.abs(px.FacePositionX) === 0);
    const spike = mapVtsSignals(
      { ...base, Position: { x: 5, y: 0, z: 0.4 } },
      st,
      { smooth: 0.5, posSmooth: 0.85 }
    );
    const qx = Object.fromEntries(spike.signals.map((s) => [s.id, s.value]));
    assert.ok(Math.abs(qx.FacePositionX) < 0.5);
  });

  it("builds the inject envelope", () => {
    const msg = buildInjectMessage([{ id: "MouthOpen", value: 0.5 }], { faceFound: true });
    assert.equal(msg.apiName, "VTubeStudioPublicAPI");
    assert.equal(msg.messageType, "InjectParameterDataRequest");
    assert.equal(msg.data.faceFound, true);
    assert.equal(msg.data.mode, "set");
    assert.deepEqual(msg.data.parameterValues, [{ id: "MouthOpen", value: 0.5 }]);
  });

  it("adds fade-in weights only while ramping", () => {
    const half = buildInjectMessage([{ id: "MouthOpen", value: 0.5 }], { faceFound: true, weight: 0.5 });
    assert.deepEqual(half.data.parameterValues, [{ id: "MouthOpen", value: 0.5, weight: 0.5 }]);
    const full = buildInjectMessage([{ id: "MouthOpen", value: 0.5 }], { faceFound: true, weight: 1 });
    assert.deepEqual(full.data.parameterValues, [{ id: "MouthOpen", value: 0.5 }]);
  });

  it("authenticates and injects against a fake VTS server", async () => {
    const fake = await startFakeVts();
    const { seen, port } = fake;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
    const tokenFile = path.join(dir, "tok");
    const sender = createVtsApiSender({
      url: `ws://127.0.0.1:${port}`,
      tokenFile,
      rate: 0,
      log: null,
    });
    try {
      await sender.connect();
      assert.equal(fs.readFileSync(tokenFile, "utf8").trim(), "tok123");
      await sender.injectMapped(
        {
          FaceFound: true,
          BlendShapes: [{ k: "JawOpen", v: 0.6 }],
          Rotation: { x: 0, y: 0, z: 0 },
          Position: { x: 0, y: 0, z: 0.4 },
        },
        {},
        {}
      );
      const injects = seen.filter((m) => m.messageType === "InjectParameterDataRequest");
      assert.equal(injects.length, 1);
      assert.equal(injects[0].data.faceFound, true);
      const ids = injects[0].data.parameterValues.map((v) => v.id);
      assert.ok(ids.includes("MouthOpen"));
      assert.ok(ids.includes("FaceAngleX"));
      assert.ok(!ids.includes("TongueOut"));
      const stats = sender.stats();
      assert.equal(stats.injected, 1);
      assert.equal(stats.errors, 0);
    } finally {
      await sender.close();
      fake.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reconnects after a drop and keeps injecting", async () => {
    const fake = await startFakeVts();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
    const logs = [];
    const sender = createVtsApiSender({
      url: `ws://127.0.0.1:${fake.port}`,
      tokenFile: path.join(dir, "tok"),
      rate: 0,
      log: (m) => logs.push(m),
    });
    const frame = {
      FaceFound: true,
      BlendShapes: [{ k: "JawOpen", v: 0.6 }],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    try {
      await sender.connect();
      await sender.injectMapped(frame, {}, {});
      for (const s of fake.sockets) s.destroy();
      await new Promise((r) => setTimeout(r, 2600));
      assert.ok(logs.some((m) => m.includes("reconnect")));
      const res = await sender.injectMapped(frame, {}, {});
      assert.equal(res.sent, true);
      assert.equal(sender.stats().injected, 2);
    } finally {
      await sender.close();
      fake.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops rejected parameters and retries the inject", async () => {
    const fake = await startFakeVts({ rejectParam: "EyeLeftX" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-"));
    const sender = createVtsApiSender({
      url: `ws://127.0.0.1:${fake.port}`,
      tokenFile: path.join(dir, "tok"),
      rate: 0,
      log: null,
    });
    try {
      await sender.connect();
      const first = await sender.injectMapped(
        {
          FaceFound: true,
          BlendShapes: [{ k: "JawOpen", v: 0.6 }],
          Rotation: { x: 0, y: 0, z: 0 },
          Position: { x: 0, y: 0, z: 0.4 },
        },
        {},
        {}
      );
      assert.equal(first.sent, false);
      assert.ok(!("EyeLeftX" in sender.paramTable()));
      const second = await sender.injectMapped(
        {
          FaceFound: true,
          BlendShapes: [{ k: "JawOpen", v: 0.6 }],
          Rotation: { x: 0, y: 0, z: 0 },
          Position: { x: 0, y: 0, z: 0.4 },
        },
        first.poseState,
        {}
      );
      assert.equal(second.sent, true);
      const stats = sender.stats();
      assert.equal(stats.injected, 1);
      assert.equal(stats.errors, 1);
    } finally {
      await sender.close();
      fake.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

  it("reports the server close code and reason", async () => {
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) return;
        const head = buf.subarray(0, end).toString("ascii");
        const key = head.match(/Sec-WebSocket-Key: (\S+)/)[1];
        const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
        );
        const reason = Buffer.from("going away", "utf8");
        const frame = Buffer.alloc(2 + 2 + reason.length);
        frame[0] = 0x88;
        frame[1] = 2 + reason.length;
        frame.writeUInt16BE(4001, 2);
        reason.copy(frame, 4);
        socket.write(frame);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const ws = await connectWs(`ws://127.0.0.1:${port}`);
      const got = await new Promise((resolve) => {
        ws.onClose((code, reason) => resolve({ code, reason }));
        setTimeout(() => resolve({ code: "timeout", reason: "" }), 3000);
      });
      ws.close();
      assert.equal(got.code, 4001);
      assert.equal(got.reason, "going away");
    } finally {
      server.close();
    }
  });

  it("answers pings with masked echo pongs", async () => {
    let clientBytes = Buffer.alloc(0);
    let opened = null;
    const server = net.createServer((socket) => {
      opened = socket;
      let buf = Buffer.alloc(0);
      let shook = false;
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!shook) {
          const end = buf.indexOf("\r\n\r\n");
          if (end < 0) return;
          const head = buf.subarray(0, end).toString("ascii");
          const key = head.match(/Sec-WebSocket-Key: (\S+)/)[1];
          const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
          );
          buf = buf.subarray(end + 4);
          shook = true;
          socket.write(Buffer.from([0x89, 0x04, 0x70, 0x69, 0x6e, 0x67]));
          return;
        }
        clientBytes = Buffer.concat([clientBytes, chunk]);
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    try {
      const ws = await connectWs(`ws://127.0.0.1:${port}`);
      const deadline = Date.now() + 3000;
      while (clientBytes.length < 10 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      ws.close();
      assert.ok(clientBytes.length >= 10, "expected a pong reply, got " + clientBytes.length + " bytes");
      assert.equal(clientBytes[0], 0x8a);
      assert.ok(clientBytes[1] & 0x80, "pong must be masked");
      assert.equal(clientBytes[1] & 0x7f, 4);
      const mask = clientBytes.subarray(2, 6);
      const raw = clientBytes.subarray(6, 10);
      const out = Buffer.alloc(4);
      for (let i = 0; i < 4; i++) out[i] = raw[i] ^ mask[i % 4];
      assert.equal(out.toString("utf8"), "ping");
      if (opened) opened.destroy();
    } finally {
      server.close();
    }
  });
