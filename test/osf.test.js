import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeOsfPacket, decodeOsfPacket, PACKET_SIZE } from "../src/osf_sender.js";
import { createContext, frameToOsf } from "../src/mapper.js";

function sampleOsf() {
  const { osf } = frameToOsf(
    {
      Timestamp: 1700000000000,
      FaceFound: true,
      BlendShapes: [
        { k: "EyeBlinkLeft", v: 0 },
        { k: "EyeBlinkRight", v: 0 },
        { k: "JawOpen", v: 0.5 },
      ],
      Rotation: { x: 10, y: 5, z: 2 },
      Position: { x: 0.01, y: 0.02, z: 0.4 },
      EyeLeft: { x: 0, y: 0, z: 0 },
      EyeRight: { x: 0, y: 0, z: 0 },
      Hotkey: -1,
    },
    createContext(),
    { faceId: 3, width: 640, height: 480, smooth: 0 }
  );
  return osf;
}

describe("osf packet layout", () => {
  it("is exactly 1785 bytes (single-face frame)", () => {
    assert.equal(PACKET_SIZE, 1785);
    assert.equal(encodeOsfPacket(sampleOsf()).length, 1785);
  });

  it("round-trips header, eyes, pose, features", () => {
    const osf = sampleOsf();
    const back = decodeOsfPacket(encodeOsfPacket(osf));
    assert.equal(back.id, 3);
    assert.equal(back.success, true);
    assert.ok(Math.abs(back.time - 1700000000) < 0.001);
    assert.ok(Math.abs(back.eyeOpenR - 1) < 1e-6);
    assert.ok(Math.abs(back.eyeOpenL - 1) < 1e-6);
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(back.quaternion[i] - osf.quaternion[i]) < 1e-6);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back.euler[i] - osf.euler[i]) < 1e-5);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back.translation[i] - osf.translation[i]) < 1e-5);
    assert.ok(Math.abs(back.features.mouth_open - osf.features[12]) < 1e-6);
    assert.equal(back.points.length, 68);
    assert.equal(back.points3D.length, 70);
    assert.equal(back.confidence.length, 68);
  });

  it("swaps 2D points to y,x wire order like facetracker.py", () => {
    const osf = sampleOsf();
    const buf = encodeOsfPacket(osf);
    const base = 8 + 4 + 4 + 4 + 4 + 4 + 1 + 4 + 16 + 12 + 12 + 272;
    const y0 = buf.readFloatLE(base);
    const x0 = buf.readFloatLE(base + 4);
    assert.ok(Math.abs(y0 - osf.points[0].y) < 1e-5);
    assert.ok(Math.abs(x0 - osf.points[0].x) < 1e-5);
  });

  it("marks lost faces with success=0", () => {
    const { osf } = frameToOsf(
      { Timestamp: 1, FaceFound: false, BlendShapes: [], Rotation: {}, Position: {} },
      createContext(),
      { smooth: 0 }
    );
    const back = decodeOsfPacket(encodeOsfPacket(osf));
    assert.equal(back.success, false);
  });
});
