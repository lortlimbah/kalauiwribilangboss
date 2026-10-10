import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURE_ORDER,
  createContext,
  eulerDegToQuaternion,
  frameToOsf,
  makeDemoFrame,
  mapGaze,
  mapPose,
  mapScalars,
  parseBlendShapes,
} from "../src/mapper.js";

describe("mapper", () => {
  it("parses k/v blendshape lists and ignores junk", () => {
    const blend = parseBlendShapes([
      { k: "JawOpen", v: 0.5 },
      { k: "Nope", v: "x" },
      null,
    ]);
    assert.equal(blend.JawOpen, 0.5);
    assert.equal(blend.Nope, undefined);
  });

  it("maps closed eyes to zero openness and -1 feature", () => {
    const s = mapScalars({ EyeBlinkLeft: 1, EyeBlinkRight: 1 });
    assert.equal(s.eyeOpenL, 0);
    assert.equal(s.eyeOpenR, 0);
    assert.equal(s.features.eye_l, -1);
    assert.equal(s.features.eye_r, -1);
  });

  it("maps open eyes and jaw to full values", () => {
    const s = mapScalars({ EyeBlinkLeft: 0, EyeBlinkRight: 0, JawOpen: 1 });
    assert.equal(s.eyeOpenL, 1);
    assert.ok(s.features.mouth_open > 0.9);
  });

  it("keeps every feature in -1..1", () => {
    const s = mapScalars({
      BrowInnerUp: 1,
      BrowOuterUpLeft: 1,
      MouthSmileLeft: 1,
      MouthSmileRight: 1,
      MouthStretchLeft: 1,
      MouthPucker: 1,
    });
    for (const k of FEATURE_ORDER) {
      assert.ok(s.features[k] >= -1 && s.features[k] <= 1, k);
    }
  });

  it("wires gaze mirror-consistently (screen-left uses right-eye shapes)", () => {
    const g = mapGaze({ EyeLookOutLeft: 1, EyeLookInRight: 1, EyeLookUpLeft: 1, EyeLookDownRight: 1 });
    assert.equal(g.left.x, -1);
    assert.equal(g.right.x, 1);
    assert.equal(g.left.y, 1);
    assert.equal(g.right.y, -1);
  });

  it("zeroes position baseline on first frame", () => {
    const ctx = createContext();
    const a = mapPose({ x: 0, y: 0, z: 0 }, { x: 0.05, y: 0.02, z: 0.4 }, ctx.poseState, { posScale: 100, posLeak: 0 });
    const b = mapPose({ x: 0, y: 0, z: 0 }, { x: 0.06, y: 0.02, z: 0.4 }, a.state, { posScale: 100, posLeak: 0 });
    assert.deepEqual(a.vtsTranslation, [0, 0, 0]);
    assert.ok(Math.abs(b.vtsTranslation[0] - 1) < 1e-6);
  });

  it("builds unit quaternions", () => {
    const q = eulerDegToQuaternion([10, -20, 5]);
    const len = Math.sqrt(q.reduce((a, v) => a + v * v, 0));
    assert.ok(Math.abs(len - 1) < 1e-6);
  });

  it("emits 68 landmarks and 70 3D points", () => {
    const { osf } = frameToOsf(
      {
        Timestamp: 1700000000000,
        FaceFound: true,
        BlendShapes: [{ k: "JawOpen", v: 0.7 }],
        Rotation: { x: 0, y: 0, z: 0 },
        Position: { x: 0, y: 0, z: 0.4 },
      },
      createContext(),
      { smooth: 0 }
    );
    assert.equal(osf.points.length, 68);
    assert.equal(osf.points3D.length, 70);
    assert.equal(osf.features.length, 14);
    const mouthY = osf.points[62].y;
    assert.ok(mouthY > osf.points[60].y);
  });

  it("demo frames animate over time", () => {
    const a = frameToOsf(makeDemoFrame(0), createContext(), { smooth: 0 }).osf;
    const b = frameToOsf(makeDemoFrame(1.7), createContext(), { smooth: 0 }).osf;
    assert.notDeepEqual(a.features, b.features);
  });

  it("holds last translation on teleports and clamps magnitude", () => {
    const ctx = createContext();
    const base = {
      Timestamp: 1700000000000,
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    const first = frameToOsf(base, ctx, { smooth: 0, posScale: 300 }).osf;
    assert.ok(first.translation.every((v) => Math.abs(v) === 0));
    const spike = frameToOsf(
      { ...base, Position: { x: 5, y: 0, z: 0.4 } },
      ctx,
      { smooth: 0, posScale: 300 }
    ).osf;
    assert.ok(spike.translation.every((v) => Math.abs(v) === 0));
    assert.ok(ctx.clamps > 0);
    const spiked = { ...base, Position: { x: 5, y: 0, z: 0.4 } };
    for (let i = 0; i < 12; i++) frameToOsf(spiked, ctx, { smooth: 0, posScale: 300 });
    assert.equal(ctx.holdStreak, 0);
    const after = frameToOsf(spiked, ctx, { smooth: 0, posScale: 300 }).osf;
    assert.ok(after.translation.some((v) => Math.abs(v) > 0));
  });

  it("damps OSF roll and caps translation via AGC", () => {
    const ctx = createContext();
    const base = {
      Timestamp: 1700000000000,
      FaceFound: true,
      BlendShapes: [],
      Rotation: { x: 0, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    frameToOsf(base, ctx, { smooth: 0, rotZero: false });
    const tilted = frameToOsf(
      { ...base, Rotation: { x: 0, y: 0, z: 20 } },
      ctx,
      { smooth: 0, rotZero: false, rollGain: 0.15 }
    ).osf;
    assert.ok(Math.abs(tilted.euler[2] - 3) < 1e-6);
    let far = null;
    for (let i = 0; i < 80; i++) {
      far = frameToOsf(
        { ...base, Position: { x: 5, y: 0, z: 0.4 } },
        ctx,
        { smooth: 0, posScale: 4, rotZero: false }
      ).osf;
    }
    const mag = Math.sqrt(far.translation.reduce((s, v) => s + v * v, 0));
    assert.ok(mag <= 2.6);
  });

  it("freezes pose when the face is lost", () => {
    const ctx = createContext();
    const live = {
      Timestamp: 1700000000000,
      FaceFound: true,
      BlendShapes: [{ k: "JawOpen", v: 0.5 }],
      Rotation: { x: 10, y: 0, z: 0 },
      Position: { x: 0, y: 0, z: 0.4 },
    };
    const good = frameToOsf(live, ctx, { smooth: 0 }).osf;
    const lost = frameToOsf(
      { ...live, FaceFound: false, Rotation: { x: 90, y: 90, z: 90 }, Position: { x: 9, y: 9, z: 9 } },
      ctx,
      { smooth: 0 }
    ).osf;
    assert.equal(lost.success, false);
    assert.deepEqual(lost.euler, good.euler);
    assert.deepEqual(lost.translation, good.translation);
  });
});
