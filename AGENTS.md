# AGENTS.md

Project: kalauiwribilangboss — free iPhone tracking for VTube Studio PC,
primarily via the VTS Plugin API (`--out vts`); the OSF-protocol UDP output
is a maintained fallback, currently unverified on Proton.
See `FRD.md` (requirements + progress), `MEMORY.md` (decisions), and
`docs/initial_plan.md` (build plan).

## Layout
- `src/ifong.js` — iPhone receiver (keepalive + UDP listener). Name is
  intentional, keep it.
- `src/mapper.js` — pure ARKit→OSF mapping, no I/O.
- `src/osf_sender.js` — OSF binary UDP emit.
- `src/vts_api_sender.js` — zero-dep VTS websocket client + ARKit→VTS params.
- `src/config.js` — `.env`/shell/flag resolution; flags always win.
- `src/cli.js` — argument parsing and wiring (`--out osf|vts|both`).
- Copy `.env.example` to `.env` for persistent defaults.
- Reference only, never edit: `OpenSeeFace/`, `VTubeStudioBlendshapeUDPReceiverTest/`.

## Rules
- Node 20, zero runtime dependencies; use built-in `dgram`/`Buffer`.
- Match OSF packet bytes exactly to `OpenSeeFace/facetracker.py:266-363`
  (little-endian); single-face frame size per `Unity/OpenSee.cs`.
- Keep receiver, mapper, and sender decoupled so a future
  `src/vts_api_sender.js` plugs in without rework.
- Update `FRD.md §7` progress log when milestones land.
- Verify with live VTS runs where possible; never commit secrets or tokens.
