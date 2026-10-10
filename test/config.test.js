import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, parseEnvText, resolveConfig } from "../src/config.js";

describe("config", () => {
  it("parses .env text with quotes, export, and comments", () => {
    const env = parseEnvText(`
# comment
IPHONE_IP=192.168.1.50
OUT=both
export VTS_WS_URL="ws://pc:8001"
SMOOTH=0.5
UNKNOWN_KEY=nope
`);
    assert.equal(env.iphoneIp, "192.168.1.50");
    assert.equal(env.out, "both");
    assert.equal(env.vtsWs, "ws://pc:8001");
    assert.equal(env.smooth, "0.5");
    assert.equal(env.UNKNOWN_KEY, undefined);
  });

  it("rejects unknown flags", () => {
    assert.throws(() => parseArgs(["--nope", "1"]));
  });

  it("applies flag > env precedence and out modes", () => {
    const cfg = resolveConfig(["--smooth", "0.1", "--out", "both"], {
      iphoneIp: "10.0.0.5",
      smooth: "0.9",
      vtsIp: "10.0.0.9",
    });
    assert.equal(cfg.iphoneIp, "10.0.0.5");
    assert.equal(cfg.smooth, 0.1);
    assert.equal(cfg.vtsIp, "10.0.0.9");
    assert.equal(cfg.out, "both");
    assert.equal(cfg.wantsOsf, true);
    assert.equal(cfg.wantsVts, true);
  });

  it("defaults to vts output", () => {
    const cfg = resolveConfig([], {});
    assert.equal(cfg.out, "vts");
    assert.equal(cfg.wantsOsf, false);
    assert.equal(cfg.wantsVts, true);
  });

  it("rejects bad out modes", () => {
    assert.throws(() => resolveConfig(["--out", "vmc"], {}));
  });

  it("parses independent mirror flags", () => {
    const def = resolveConfig([], {});
    assert.equal(def.yawMirror, false);
    assert.equal(def.rollMirror, true);
    assert.equal(def.posMirrorX, false);
    const cfg = resolveConfig(["--yaw-mirror", "--no-roll-mirror"], {});
    assert.equal(cfg.yawMirror, true);
    assert.equal(cfg.rollMirror, false);
    assert.throws(() => resolveConfig(["--mirror"], {}));
  });
});
