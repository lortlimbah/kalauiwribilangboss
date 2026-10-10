# kalauiwribilangboss — Initial Plan

## Goal
Free iPhone face tracking for VTube Studio PC. The paid phone→PC stream is
bypassed by receiving the free iPhone UDP blendshape feed and re-emitting it
in a protocol VTube Studio PC accepts for free.

## Pipeline
```
iPhone VTS app --(ARKit JSON over UDP)--> ifong.js --(mapped fields)--> OSF sender --(binary UDP)--> VTS PC
```

## How each leg works
- **Leg 1 (free input):** Enable `3rd Party PC Clients` in the VTS iOS app.
  Send `{"messageType":"iOSTrackingDataRequest","time":5,"sentBy":"kalauiwribilangboss","ports":[LISTEN_PORT]}`
  to `iphone-ip:21412` every ~1s. iPhone streams JSON frames (~60fps) with
  `Timestamp`, `FaceFound`, 52 `BlendShapes[{k,v}]`, `Rotation`, `Position`,
  `EyeLeft`, `EyeRight`, `Hotkey` to our `LISTEN_PORT`.
- **Leg 2 (accepted output):** Reproduce `facetracker.py --ip VTS_IP --port 11573`
  binary UDP packet (little-endian): `double time`, `int id`, `float w/h`,
  `float eyeR/eyeL open`, `byte success`, `float pnpError`, `float quat[4]`,
  `float euler[3]`, `float trans[3]`, 68 confidences, 68 2D points, 70 3D
  points, 14 feature floats. VTS PC listens per `StreamingAssets/ip.txt`
  (`ip=0.0.0.0`, `port=11573`).

## Mapping (ARKit → OSF), hardest part
- Trivial: `eyeOpen = 1 - EyeBlink`, `MouthOpen ≈ JawOpen`, `FaceFound → success`.
- Needs live validation: head euler axis remap (Unity example uses
  `(-Rot.y, -Rot.x, Rot.z)`), translation units, which OSF fields VTS renders.
- Accepted loss: OSF carries 14 features, so smile/frown/pucker/cheek/tongue
  detail is degraded. Static neutral 68/70-point skeleton + live eyes/mouth
  is the MVP; refine against the live model.

## Node layout (zero deps, Node 20, built-in `dgram` only)
- `src/ifong.js` — request keepalive loop + UDP listener, emits parsed frames.
- `src/mapper.js` — pure `arkitFrame → osfFields`, no I/O, unit-testable.
- `src/osf_sender.js` — `Buffer` struct packing + `sendto(vts-ip:11573)`.
- `src/cli.js` — arg parsing, wiring, logging, graceful shutdown.
- Later, no rework: `src/vts_api_sender.js` — same mapper output over the
  VTS websocket API (`InjectParameterDataRequest`) for full-fidelity upgrade.

## CLI
```
node src/cli.js --iphone-ip <ip> [--iphone-port 21412] [--listen-port 11125] \
  [--vts-ip 127.0.0.1] [--vts-port 11573] [--face-id 0]
```

## Build order
1. `ifong.js` + log frames to console (prove iPhone leg).
2. `osf_sender.js` with static/animated test packet (prove VTS moves).
3. `mapper.js` wiring live data through.
4. CLI polish, smoothing, face-lost behavior, README usage.
5. Optional: VTS-API sender, VMC/OSC output, packet recorder/replayer.

## Validation
- Compare byte layout against `OpenSeeFace/facetracker.py:266-363` and
  `Unity/OpenSee.cs:packetFrameSize`.
- Crafted packets → watch VTS model (eyes, mouth, head) respond.
- Same-WiFi iPhone + PC test; Proton/network checks if VTS misses packets.
