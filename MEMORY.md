# MEMORY.md

- Goal: free iPhone VTS tracking → VTube Studio PC, no paid streamer.
- Trick: iPhone UDP feed is free for 3rd-party clients; VTS PC takes free
  OSF UDP on `11573`. Bridge them.
- Author's setup: OpenSeeFace natively on Linux → `--ip 127.0.0.1 --port 11573`
  → VTS PC on Proton (webcam unusable under Proton). New bridge must fit the
  same path.
- Decision: OSF binary UDP first (proven, zero-deps); VTS websocket API
  (`InjectParameterData`) later as full-fidelity upgrade (needs auth popup,
  unproven under Proton).
- Update: VTS-API sender is now built (`src/vts_api_sender.js`, zero-dep WS
  over `net`+`crypto`). Verified against a fake VTS server; live Allow-click
  + Proton path still to be confirmed on real hardware.
- VTS mapping: 21 standard input params; signals scaled at runtime against
  VTS `InputParameterList` min/max/default (neutral-centered), with a
  compiled fallback table. FaceAngleX=yaw=Rot.x, Y=pitch=Rot.y, Z=roll=Rot.z.
- VTS lesson: some installs lack params like `BrowInnerUp` and answer 453,
  which fails the whole inject. Sender now injects only listed params and
  drops 453-rejected ones mid-stream, then retries. Repeat errors are
  logged once.
- Config: `.env` (+ shell env) holds defaults, CLI flags win. `OUT=osf|vts
  |both`. Token kept in `TOKEN_FILE` (default `.vts_token`, 0600).
- Scope v1: VTS PC only. No VMC/OSC output.
- Network: same WiFi/LAN. Defaults `iphone-port=21412`, `listen-port=11125`,
  `vts=127.0.0.1:11573`.
- Live setup saved in `.env`: iPhone `192.168.123.42:21412`, VTS PC
  `127.0.0.1:11573`, `OUT=osf`. Run the bridge on the PC itself so
  localhost reaches VTS.
- Joke-naming: iPhone receiver module is `src/ifong.js` ("ifong" = iPhone).
- Stack: Node 20, no deps, `dgram` + `Buffer` LE packing.
- Reference impls (do not modify): `VTubeStudioBlendshapeUDPReceiverTest/`
  (receiver), `OpenSeeFace/facetracker.py:266-363` + `Unity/OpenSee.cs`
  (packet layout ground truth).
- Mapping notes: `eyeOpen = 1 - EyeBlink`; `MouthOpen ≈ JawOpen`;
  `success = FaceFound`; euler axes need live check (Unity example negates/
  swaps: `(-Rot.y, -Rot.x, Rot.z)`).
- Send loop: fixed-rate emitter (`SEND_HZ=60`) decoupled from iPhone input;
  keepalive every 500ms. Output pacing verified even (p50 17ms, max 19ms).
- Position pipeline: heavy `POS_SMOOTH=0.85` on translation (iPhone pos is
  noisy, sd ~1.4), teleport guard with rebase after `POS_REBASE=10` holds
  (a latched guard froze the head permanently before), leaky baseline
  (`POS_LEAK=0.002`) so handheld drift recenters. Stats show in-fps,
  in-gap p95, out-fps, `|t|`, `guards`.
- Rotation also needs a neutral baseline (constant phone tilt = permanent
  head turn otherwise). Captured on first found frame, leaks back slowly
  (`ROT_LEAK=0.005`, `NO_ROT_ZERO=1` disables). OSF yaw sign flipped to 1 —
  user confirms VTS mirror direction is correct.
- Stick-then-snap on fast moves: a slow VTS response held the whole loop
  behind stale filter state. Now `prepare` runs every tick (filter always
  fresh) and `transmit` sends latest-only with no overlap — slow VTS just
  lowers effective rate, never snaps.
- AXES CLOSED by take 3 (strict propped-phone take): x=yaw, y=pitch,
  z=roll — all as originally mapped. Key proof: pure shake swings x ±54
  with z quiet (sd 2.7), so z is INDEPENDENT, not slaved. Lean couples
  x+z (corr -0.99) because leaning while watching the screen needs yaw
  compensation — real compound motion, not a bug. Keep roll damped.
- Brow direction settled by user visual check: unmirrored is correct
  (`BROW_SIGN=1` default). The earlier table looked inverted only because
  lag/sampling comparisons mislead — live direction check wins.
- Hold/accept staircase (the "2 positions" jump): fixed with 15-frame
  post-rebase grace in both guards.
- WS protocol: every client frame MUST be masked (RFC 6455) — unmasked
  pongs got us killed with 1002. `encodeWsBinary(opcode, payload)` for
  text/pong/close; ping payload echoed; masked close frame on shutdown.
- Position runs too hot to fix with a constant gain (live excursion ~4
  units, units unknown), so VTS position uses AGC: running peak (fast
  attack 0.15, slow release 0.002) caps output at 70% of bipolar range,
  user gain stays a trim. Rails impossible by construction.
- OSF path carries the same lessons: gaze wired mirror-consistent
  (in-minus-out, contralateral shapes), euler roll × `ROLL_GAIN` with
  quaternion rebuilt, translation AGC capped at 2.5u (`osfAgcTarget`).
  Awaiting user visual check; Proton UDP delivery still the prime suspect
  if the model doesn't move.
  FaceAngleX≈RotX yaw, Y≈RotY pitch, Z≈RotZ roll; FacePositionX sign and
  yaw/roll mirror settled by user test to `MIRROR=1` (flip with
  `MIRROR=0`/`--no-mirror`). VTS eye params are viewer-mirrored: EyeLeft
  uses anatomical-RIGHT shapes (inR-outR) and vice versa. MouthSmile
  bipolar (smile-frown), Brows neutral-0.5,
  MouthOpen=jaw-close-0.2rolls+0.2funnel, MouthX=(left-right). Same mirror
  lessons queued for the OSF path fix.
- OSF path now carries the same lessons: gaze wired mirror-consistent
  (in-minus-out, contralateral shapes), euler roll x ROLL_GAIN with
  quaternion rebuilt, translation AGC capped at 2.5u. Awaiting user
  visual check; Proton UDP delivery still prime suspect if silent.
- Direction settled: VTS Plugin API is the primary output (works, stable
  after the masking fix). OSF UDP is a maintained fallback, currently dead
  on this setup (byte-exact packets verified locally, model doesn't move
  — Proton UDP delivery suspected, mapping already ported).
- v1.0.0 production: VTS path finalized and stable in daily use. OSF/VMC
  deferred to FRD §8. Repo has no remote yet; everything lives in the
  working tree. Never commit `.env` / `.vts_token`.
