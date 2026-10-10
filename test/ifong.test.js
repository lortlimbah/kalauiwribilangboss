import { describe, it } from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { buildRequest, createIfong, parseFrame } from "../src/ifong.js";
import { createOsfSender, PACKET_SIZE } from "../src/osf_sender.js";
import { createContext, frameToOsf } from "../src/mapper.js";

function samplePayload() {
  return JSON.stringify({
    Timestamp: 1700000000000,
    Hotkey: -1,
    FaceFound: true,
    Rotation: { x: 1, y: 2, z: 3 },
    Position: { x: 0.1, y: 0.2, z: 0.3 },
    BlendShapes: [{ k: "JawOpen", v: 0.5 }],
    EyeLeft: { x: 0, y: 0, z: 0 },
    EyeRight: { x: 0, y: 0, z: 0 },
    FutureField: [1, 2, 3],
  });
}

describe("ifong", () => {
  it("builds the keepalive request payload", () => {
    const req = JSON.parse(buildRequest({ sentBy: "Test", time: 5, ports: [11125] }));
    assert.equal(req.messageType, "iOSTrackingDataRequest");
    assert.equal(req.sentBy, "Test");
    assert.deepEqual(req.ports, [11125]);
  });

  it("clamps request time and validates ports", () => {
    assert.equal(JSON.parse(buildRequest({ sentBy: "T", time: 99, ports: [1] })).time, 10);
    assert.throws(() => buildRequest({ sentBy: "T", time: 5, ports: [] }));
    assert.throws(() => buildRequest({ sentBy: "", time: 5, ports: [1] }));
  });

  it("parses frames and tolerates unknown fields", () => {
    const f = parseFrame(Buffer.from(samplePayload(), "ascii"));
    assert.equal(f.FaceFound, true);
    assert.equal(f.blend.JawOpen, 0.5);
    assert.equal(f.Hotkey, -1);
    assert.deepEqual(f.Rotation, { x: 1, y: 2, z: 3 });
  });

  it("receives frames over loopback UDP", async () => {
    const port = 14125;
    const received = [];
    const rx = createIfong({
      iphoneIp: "127.0.0.1",
      listenPort: port,
      keepaliveMs: 60000,
      onFrame: (f) => received.push(f),
    });
    await rx.start();
    const tx = dgram.createSocket("udp4");
    await new Promise((resolve) => tx.send(samplePayload(), port, "127.0.0.1", resolve));
    const deadline = Date.now() + 2000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    tx.close();
    await rx.stop();
    assert.equal(received.length, 1);
    assert.equal(received[0].blend.JawOpen, 0.5);
  });

  it("delivers OSF packets over loopback UDP at full size", async () => {
    const port = 15173;
    const server = dgram.createSocket("udp4");
    const got = [];
    server.on("message", (msg) => got.push(msg));
    await new Promise((resolve) => server.bind(port, resolve));
    const sender = createOsfSender({ ip: "127.0.0.1", port });
    const { osf } = frameToOsf(
      {
        Timestamp: 1700000000000,
        FaceFound: true,
        BlendShapes: [{ k: "JawOpen", v: 0.8 }],
        Rotation: { x: 5, y: 0, z: 0 },
        Position: { x: 0, y: 0, z: 0.4 },
      },
      createContext(),
      { smooth: 0 }
    );
    await sender.send(osf);
    const deadline = Date.now() + 2000;
    while (got.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await sender.close();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(got.length, 1);
    assert.equal(got[0].length, PACKET_SIZE);
  });
});
