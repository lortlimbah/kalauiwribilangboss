import fs from "node:fs";
import { createIfong } from "../src/ifong.js";

const outFile = process.argv[2] || "/tmp/kb_calib.jsonl";
const iphoneIp = process.env.IPHONE_IP || process.argv[3];
if (!iphoneIp) {
  console.error("Set IPHONE_IP env or pass the iPhone IP as 3rd arg.");
  process.exit(2);
}

const PLAN = [
  { phase: "neutral", say: "LOOK STRAIGHT, relax your face", secs: 6 },
  { pause: "Next: NOD. Rest...", secs: 5 },
  { phase: "nod", say: "NOD SLOWLY: chin down to chest and back up, keep going", secs: 8 },
  { pause: "Next: SHAKE. Rest...", secs: 5 },
  { phase: "shake", say: "SHAKE SLOWLY: look left and right, keep going", secs: 8 },
  { pause: "Next: LEAN. Rest...", secs: 5 },
  { phase: "lean", say: "LEAN SLOWLY: ear toward shoulder, left and right", secs: 8 },
  { pause: "Next: BROWS. Rest...", secs: 5 },
  { phase: "brows", say: "BROWS: raise high, then lower, repeat", secs: 8 },
];

let phase = "waiting";
const rows = [];
const rx = createIfong({
  iphoneIp,
  listenPort: 11135,
  keepaliveMs: 500,
  onFrame: (f) => {
    rows.push({ t: Date.now(), phase, rot: { ...f.Rotation }, pos: { ...f.Position }, found: f.FaceFound, blend: f.blend });
  },
});
await rx.start();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function countdown(secs, label) {
  for (let s = secs; s >= 1; s--) {
    process.stdout.write(`\r[${label}] ${s}s   `);
    await sleep(1000);
  }
  process.stdout.write("\n");
}

console.log("Recording to " + outFile + ". Get ready…");
await sleep(2000);
for (const step of PLAN) {
  if (step.pause) {
    phase = "pause";
    console.log("--- rest --- " + step.pause);
    await countdown(step.secs, "REST");
  } else {
    phase = step.phase;
    console.log(">>> " + step.say);
    await countdown(step.secs, step.phase.toUpperCase());
  }
}
await rx.stop();
fs.writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`done: ${rows.length} frames → ${outFile}`);
