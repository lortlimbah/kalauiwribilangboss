import { createIfong } from "./ifong.js";
import { createContext, frameToOsf, makeDemoFrame } from "./mapper.js";
import { createOsfSender } from "./osf_sender.js";
import { createVtsApiSender } from "./vts_api_sender.js";
import { resolveConfig } from "./config.js";

function usage() {
  return `kalauiwribilangboss — free iPhone tracking for VTube Studio PC

Usage:
  node src/cli.js --iphone-ip <ip> [options]
  node src/cli.js --demo [options]

Defaults come from ./.env (see .env.example), then shell env, then flags.
Flags always win.

Required (live mode):
  --iphone-ip <ip>      IP of the iPhone running VTube Studio

Options:
  --out <mode>          vts (primary), osf, or both (default vts)
  --iphone-port <n>     iPhone request port (default 21412)
  --listen-port <n>     local UDP port for iPhone frames (default 11125)
  --vts-ip <ip>         VTube Studio PC host for OSF UDP (default 127.0.0.1)
  --vts-port <n>        VTube Studio OSF port (default 11573)
  --vts-ws <url>        VTS Plugin API websocket (default ws://127.0.0.1:8001)
  --plugin-name <s>     VTS plugin name, 3-32 chars
  --plugin-developer <s>VTS plugin developer, 3-32 chars
  --token-file <path>   where the VTS auth token is kept (default .vts_token)
  --vts-rate <n>        max VTS injects per second (default 30)
  --vts-pos-gain <n>    VTS head position gain (default 0.3)
  --vts-pos-z-gain <n>  VTS head distance gain (default 0.15)
  --vts-pos-jump <n>    VTS position teleport threshold (default 0.25)
  --roll-gain <n>       head lean gain (default 0.15)
  --brow-sign <n>       1 or -1 brow direction (default 1)
  --yaw-sign <n>        1 or -1 head yaw direction (default 1)
  --pitch-sign <n>      1 or -1 head pitch direction (default -1)
  --roll-sign <n>       1 or -1 head roll direction (default 1)
  --yaw-mirror / --no-yaw-mirror       mirror head turn (default off)
  --roll-mirror / --no-roll-mirror     mirror head lean (default on)
  --posx-mirror / --no-posx-mirror     mirror body shift (default off)
  --sent-by <name>      app name sent to the iPhone
  --request-time <s>    seconds of data per keepalive, 0.5-10 (default 5)
  --keepalive-ms <n>    keepalive interval in ms (default 500)
  --send-hz <n>         OSF emit rate per second (default 60)
  --face-id <n>         OSF face id (default 0)
  --width <n>           camera width field (default 640)
  --height <n>          camera height field (default 480)
  --smooth <0-0.95>     smoothing amount, 0 disables (default 0.5)
  --pos-smooth <0-0.95> extra smoothing for head position (default 0.85)
  --pos-scale <n>       OSF head position gain (default 4)
  --rot-scale <n>       head rotation gain (default 1)
  --pos-max <n>         clamp head position magnitude (default 6)
  --pos-jump <n>        hold last pose if jump exceeds this (default 1.5)
  --pos-dead <n>        ignore position moves smaller than this (default 0.02)
  --pos-rebase <n>      accept new pose after this many held frames (default 10)
  --pos-leak <n>        baseline drift toward current, 0 disables (default 0.005)
  --no-zero             disable auto-zero of head position baseline
  --no-rot-zero         disable auto-zero of head rotation neutral
  --rot-leak <n>        rotation neutral drift, 0 disables (default 0.001)
  --env-file <path>     use this env file instead of ./.env
  --demo                emit synthetic motion, no iPhone needed
  --dump                log one raw iPhone frame and exit
`;
}

async function main() {
  let cfg;
  try {
    cfg = resolveConfig(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
  if (cfg.help) {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (!cfg.demo && !cfg.iphoneIp) {
    process.stderr.write("Missing --iphone-ip (or IPHONE_IP in .env, or use --demo).\n\n" + usage());
    process.exit(2);
  }
  const mapOpts = {
    faceId: cfg.faceId,
    width: cfg.width,
    height: cfg.height,
    smooth: cfg.smooth,
    posSmooth: cfg.posSmooth,
    rollSmooth: cfg.rollSmooth,
    rollGain: cfg.rollGain,
    posScale: cfg.posScale,
    rotScale: cfg.rotScale,
    posMax: cfg.posMax,
    posJump: cfg.posJump,
    posDead: cfg.posDead,
    posRebase: cfg.posRebase,
    posLeak: cfg.posLeak,
    rotLeak: cfg.rotLeak,
    rotZero: cfg.rotZero,
    zero: cfg.zero,
  };
  const vtsOpts = {
    zero: cfg.zero,
    rotZero: cfg.rotZero,
    rotScale: cfg.rotScale,
    smooth: cfg.smooth,
    posSmooth: cfg.posSmooth,
    rollSmooth: cfg.rollSmooth,
    posLeak: cfg.posLeak,
    rotLeak: cfg.rotLeak,
    yawSign: cfg.yawSign,
    pitchSign: cfg.pitchSign,
    rollSign: cfg.rollSign,
    browSign: cfg.browSign,
    rollGain: cfg.rollGain,
    yawMirror: cfg.yawMirror,
    rollMirror: cfg.rollMirror,
    posMirrorX: cfg.posMirrorX,
    vtsPosGain: cfg.vtsPosGain,
    vtsPosZGain: cfg.vtsPosZGain,
    vtsPosJump: cfg.vtsPosJump,
  };
  const say = (line) => process.stdout.write(`${line}\n`);
  if (cfg.envFilePath) say(`Config: ${cfg.envFilePath} + flags`);

  let osfSender = null;
  let vtsSender = null;
  if (cfg.dump) {
    say("Dump mode: no outputs, printing one raw frame");
  } else {
    if (cfg.wantsOsf) osfSender = createOsfSender({ ip: cfg.vtsIp, port: cfg.vtsPort });
  if (cfg.wantsVts) {
    vtsSender = createVtsApiSender({
      url: cfg.vtsWs,
      pluginName: cfg.pluginName,
      pluginDeveloper: cfg.pluginDeveloper,
      tokenFile: cfg.tokenFile,
      rate: cfg.vtsRate,
      log: say,
      onError: (err) => process.stderr.write(`vts: ${err}\n`),
    });
    say(`Connecting to VTS API at ${cfg.vtsWs}…`);
    try {
      await vtsSender.connect();
      say("VTS API authenticated");
    } catch (err) {
      process.stderr.write(`VTS API unavailable: ${err.message}\n`);
      if (!cfg.wantsOsf && !cfg.demo && !cfg.dump) process.exit(1);
      say("Continuing without VTS output");
      vtsSender = null;
    }
  }
  }

  const ctx = createContext();
  let vtsPoseState = {};
  let inCount = 0;
  let forwardedOsf = 0;
  let forwardedVts = 0;
  let lastFace = null;
  let lastTransMag = 0;
  let prevIn = 0;
  let prevOut = 0;
  let latest = null;
  let sending = false;
  let lastInputAt = 0;
  const inGaps = [];

  async function emit(frame) {
    if (osfSender) {
      const { osf } = frameToOsf(frame, ctx, mapOpts);
      lastFace = osf.success;
      lastTransMag = Math.sqrt(osf.translation.reduce((s, v) => s + v * v, 0));
      if (await osfSender.send(osf)) forwardedOsf += 1;
    }
    if (vtsSender) {
      const prepped = vtsSender.prepare(frame, vtsPoseState, vtsOpts);
      vtsPoseState = prepped.poseState;
      if (frame && frame.FaceFound !== undefined) lastFace = !!frame.FaceFound;
      vtsSender
        .transmit(prepped.values, prepped.faceFound)
        .then((ok) => {
          if (ok) forwardedVts += 1;
        })
        .catch(() => {});
    }
  }

  function onInput(frame) {
    const now = Date.now();
    if (lastInputAt > 0) {
      inGaps.push(now - lastInputAt);
      if (inGaps.length > 240) inGaps.shift();
    }
    lastInputAt = now;
    inCount += 1;
    latest = frame;
  }

  function gapP95() {
    if (inGaps.length < 5) return 0;
    const sorted = [...inGaps].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  let receiver = null;
  let sendTimer = null;
  function startSendLoop() {
    const gap = Math.max(5, Math.round(1000 / Math.max(1, cfg.sendHz)));
    sendTimer = setInterval(() => {
      if (sending || !latest) return;
      sending = true;
      const frame = latest;
      emit(frame).catch(() => {}).finally(() => {
        sending = false;
      });
    }, gap);
  }
  async function shutdown() {
    clearInterval(statsTimer);
    if (sendTimer) clearInterval(sendTimer);
    if (receiver) await receiver.stop().catch(() => {});
    if (osfSender) await osfSender.close().catch(() => {});
    if (vtsSender) await vtsSender.close().catch(() => {});
    process.exit(0);
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const statsTimer = setInterval(() => {
    const inFps = ((inCount - prevIn) / 2).toFixed(0);
    const outFps = ((forwardedOsf + forwardedVts - prevOut) / 2).toFixed(0);
    prevIn = inCount;
    prevOut = forwardedOsf + forwardedVts;
    const parts = [`in=${inCount} (${inFps}/s,p95=${gapP95()}ms)`];
    if (osfSender) {
      const s = osfSender.stats();
      parts.push(`osf=${forwardedOsf} (${outFps}/s) osfErr=${s.errors} |t|=${lastTransMag.toFixed(0)} guards=${ctx.clamps}`);
    }
    if (vtsSender) {
      const s = vtsSender.stats();
      let extra = `vts=${forwardedVts} vtsErr=${s.errors}`;
      if (s.lastPose && s.lastPose.ax !== null) {
        extra += ` ang=${s.lastPose.ax.toFixed(0)},${s.lastPose.ay.toFixed(0)} pos=${s.lastPose.px.toFixed(2)},${s.lastPose.py.toFixed(2)}`;
      }
      parts.push(extra);
    }
    if (lastFace === false) parts.push("face=LOST");
    else if (lastFace === true) parts.push("face=yes");
    say(parts.join(" "));
  }, 2000);
  if (statsTimer.unref) statsTimer.unref();

  if (cfg.demo) {
    say(`Demo mode → out=${cfg.out}` + (osfSender ? ` osf=${cfg.vtsIp}:${cfg.vtsPort}` : "") + (vtsSender ? ` vts=${cfg.vtsWs}` : ""));
    const t0 = Date.now();
    const demoTimer = setInterval(() => {
      onInput(makeDemoFrame((Date.now() - t0) / 1000));
    }, 33);
    startSendLoop();
    await new Promise(() => {
      if (demoTimer.unref) demoTimer.ref();
    });
    return;
  }

  if (cfg.dump) say(`Waiting for one frame from ${cfg.iphoneIp} on :${cfg.listenPort} …`);
  else
    say(
      `Requesting iPhone data from ${cfg.iphoneIp}:${cfg.iphonePort} → :${cfg.listenPort}` +
        (osfSender ? `, OSF → ${cfg.vtsIp}:${cfg.vtsPort}` : "") +
        (vtsSender ? `, VTS API → ${cfg.vtsWs}` : "")
    );

  receiver = createIfong({
    iphoneIp: cfg.iphoneIp,
    iphonePort: cfg.iphonePort,
    listenPort: cfg.listenPort,
    sentBy: cfg.sentBy,
    requestTime: cfg.requestTime,
    keepaliveMs: cfg.keepaliveMs,
    onFrame: (frame) => {
      if (cfg.dump) {
        say(JSON.stringify(frame, null, 2));
        shutdown();
        return;
      }
      onInput(frame);
    },
    onError: (err) => process.stderr.write(`ifong: ${err}\n`),
  });
  try {
    await receiver.start();
  } catch (err) {
    process.stderr.write(`Failed to bind :${cfg.listenPort}: ${err}\n`);
    process.exit(1);
  }
  startSendLoop();
  await new Promise(() => {});
}

main().catch((err) => {
  process.stderr.write(`${err}\n`);
  process.exit(1);
});
