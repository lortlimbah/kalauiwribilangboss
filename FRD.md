# FRD — kalauiwribilangboss (Free iPhone → VTube Studio PC Bridge)

## 1. Background
VTube Studio charges for phone→PC tracking streaming, but the iPhone app
sends the same ARKit tracking free over UDP to third-party clients
(VSeeFace, VBridger use this). The protocol is open source
(`VTubeStudioBlendshapeUDPReceiverTest`). VTube Studio PC accepts
OpenSeeFace binary UDP tracking for free (same as
`facetracker.py --ip 127.0.0.1 --port 11573`), which the author already uses
as a Linux→Proton webcam workaround. Bridging the two gives free iPhone
tracking in VTS PC.

## 2. Objective
A Node.js CLI that receives iPhone VTS tracking over UDP and drives VTube
Studio PC via its Plugin API. An OSF-protocol UDP output is maintained as
a fallback but is currently unverified (model doesn't move; Proton UDP
delivery suspect).

## 3. Scope
In scope: UDP request keepalive, frame reception/parsing, ARKit→OSF mapping,
OSF packet emit, CLI (`--iphone-ip`, `--vts-ip`), logging/stats, graceful
shutdown, sender abstraction for a future VTS-API output.
Out of scope: VTS-API sender v1, VMC/OSC output v1, GUI, auth flows.

## 4. Functional requirements
- FR1: Send `iOSTrackingDataRequest` (`time` 0.5–10s, `sentBy`,
  `ports:[listen-port]`) to `iphone-ip:iphone-port` on a ~1s keepalive.
- FR2: Listen for iPhone JSON frames; parse `Timestamp/FaceFound/BlendShapes/
  Rotation/Position/EyeLeft/EyeRight/Hotkey`; tolerate unknown future fields.
- FR3: Map frames to OSF fields: eye openness, 14 features, head
  pose/translation, confidences, 68 2D + 70 3D points.
- FR4: Emit exact OSF binary layout matching `facetracker.py:266-363`
  (little-endian, single-face frame size per `OpenSee.cs:packetFrameSize`);
  send to `vts-ip:vts-port` per frame (~60fps).
- FR5: `FaceFound=false` → emit `success=0` (or hold last) so the model idles
  instead of freezing.
- FR6: CLI with defaults: `iphone-port=21412`, `listen-port=11125`,
  `vts-ip=127.0.0.1`, `vts-port=11573`; exit cleanly on SIGINT (stop keepalive).
- FR7: Log packets/sec in/out and last-error for debugging.
- FR8: `.env` file supplies all defaults (`cp .env.example .env`); shell env
  also honored; CLI flags always win. `--env-file` selects another file.
- FR9: `--out osf|vts|both` selects outputs. `vts` speaks the VTS Plugin API
  over websocket: token auth (Allow click once, token kept in `TOKEN_FILE`
  with 0600 perms), `InputParameterList` scaling, `InjectParameterData`
  at `--vts-rate`/s with `faceFound`. Reconnects automatically; if VTS API
  is down at startup and OSF is also selected, continues OSF-only.

## 5. Non-functional requirements
- Node 20+, zero runtime dependencies (built-in `dgram`/`Buffer` only).
- Sub-frame added latency (no batching); packet loss tolerant (UDP).
- `mapper.js` pure and importable for unit tests.
- Works iPhone and PC on same LAN; VTS PC reachable at configured IP
  (Proton `ip.txt`: `ip=0.0.0.0`, `port=11573`).

## 6. Known limitations / risks
- OSF carries 14 features: cheek/pucker/funnel/tongue detail is degraded vs
  native. VTS-API sender is the planned fidelity upgrade.
- Landmark skeleton is synthesized; VTS rendering from OSF fields must be
  validated live (eyes/mouth/head response).
- Euler/translation axis conventions need live calibration.
- UDP has no delivery guarantee; WiFi quality affects smoothness.

## 7. Progress log — v1.0.0 PRODUCTION READY (VTS path)
- [x] Researched both protocols; decided OSF-first, VTS-API later.
- [x] `docs/initial_plan.md` written; file naming agreed (`src/ifong.js`).
- [x] `src/ifong.js` receiver + keepalive + loopback-tested parse.
- [x] `src/osf_sender.js` byte-exact 1785B packets (round-trip verified).
- [x] `src/mapper.js` live ARKit→OSF mapping (eyes/mouth/brows/gaze/pose).
- [x] CLI with `--demo`/`--dump`, smoothing, auto-zero, gains; 18/18 tests
  pass; demo→loopback decode verified end to end.
- [x] Dual output `--out osf|vts|both` via zero-dep WS `vts_api_sender.js`
  (auth + live param scaling + inject); `.env` defaults with flag-wins
  precedence; 29/29 tests pass incl. fake-VTS auth/inject round trip.
- [x] Live iPhone leg verified: real `FaceFound=true` ARKit frames received
  from `192.168.123.42:21412` at ~30fps and forwarded as OSF UDP packets.
- [x] Live VTS-API path reaches VTS through Proton (auth OK). VTS rejects
  unknown params with 453, so sender now trusts only the live
  `InputParameterList`, drops rejected params on 453 and retries, dedupes
  error spam, and logs the available parameter names at connect.
- [x] VTS pose filtered like OSF (smooth euler, heavy pos smooth, meter-space
  teleport guard, face-lost freeze) with tamer gains (`VTS_POS_GAIN=2`) and
  axis sign flags (`YAW/PITCH/ROLL_SIGN`). Live signals sane: angles track
  ±22°, mouth/smile vary, position centers when phone is still.
- [x] Rotation neutral baseline (captured on first found frame, slow leak
  back) shared by both paths; OSF yaw sign flipped to match the (correct)
  VTS mirror; VTS injects no longer block the send loop on timeouts.
- [x] VTS mapping corrected against SandoitchiBridge ground truth: mirrored
  PositionX and viewer-mirrored eye wiring, bipolar MouthSmile, neutral-0.5
  Brows, improved MouthOpen/MouthX/Brow formulas, new `mid` signal kind.
- [x] Mirror on by default, pitch sign flipped (user-verified), roll gain 0.5
  + `ROLL_GAIN`, gentler `VTS_POS_Z_GAIN=0.3`. Reconnect freeze fixed
  (close handler on every connect, pending rejected on drop, single retry
  timer) with a drop-and-recover regression test. VTS injects never block
  the send loop.
- [x] Fast-move stick-then-snap fixed: mapping (`prepare`, every tick) split
  from sending (`transmit`, latest-only, never overlapping), so a slow VTS
  response skips frames instead of going stale and snapping.
- [x] Lean impostor tamed: `ROLL_GAIN=0.3`, dedicated `ROLL_SMOOTH=0.8`,
  rotation leak slowed to 0.001 (noisy roll was dragging the neutral
  baseline around). Live: starts 0,0,0, Z stays Calm vs X/Y.
- [x] Brow group flipped (`BROW_SIGN=-1`: BrowLeftY/RightY negated, Brows
  reflected around neutral) per clean inverse correlation in user data.
  Lean quieted further (`ROLL_GAIN=0.15`).
- [x] Calibration take 1 inconclusive: rot.x/z correlate at exactly -1.00
  (same signal on both = phone moving in hand, not isolated head motion).
  Recorder now captures blendshapes; guards got post-rebase grace (15
  frames) to stop hold/accept staircase jumping.
- [x] Calibration take 3 (strict, propped phone): nod→y only (sd 19),
  shake→x only (sd 33, z quiet sd 2.7), lean→x+z locked (gaze-compensation
  compound, real motion). VERDICT: x=yaw, y=pitch, z=roll all correct as
  mapped; z is independent (not slaved) but mixes with yaw in natural
  leaning — keep it damped, user raises ROLL_GAIN when calm.
- [x] Reconnect freeze+snap: close-handler on every connect, 1s retry,
  0.8s weight fade-in on recovery; VTS injects never block the send loop
  (prepare/transmit split).
- [x] Defaults from user verification: MIRROR=1, PITCH_SIGN=-1,
  BROW_SIGN=1, damped roll (0.15) and position gains.
- [x] Position AGC: output capped at 70% of range, rails impossible.
- [x] Drops now log the server close code (`VTS closed the connection
  (code NNNN: reason)`); early-close race fixed with buffered delivery.
- [x] Drop cause found: VTS code 1002 "exception while receiving" = our
  unmasked pong replies breaking websocket protocol. All client frames
  now masked (`encodeWsBinary`), pings echoed with payload, graceful
  masked close on shutdown.
- [ ] Next drop: check whether 1002s stop; paste any new close code.
- [x] Production finalization: `.gitignore` (env/token/logs), dump/demo
  run without live outputs, full robustness pass, README rewrite,
  42/42 tests green. OSF/VMC deferred (see §8).
- [ ] OSF visual verification on a setup with working UDP delivery.

## 8. Deferred
- OSF/VMC output work: packets are byte-exact and loopback-verified, but
  the model doesn't move on the author's Proton setup. Revisit with a
  working UDP path (native VTS or fixed Wine networking).
- [x] Mirror bundle split: yaw/roll/posX flip independently
  (`YAW_MIRROR` off, `ROLL_MIRROR` on, `POSX_MIRROR` off by default).
  User confirmed head turn was the mirrored-wrong one; lean stays as-is.
