# 📱 kalauiwribilangboss 😎

### Unlimited VTube Studio tracking from iOS/iPhone — for free. Iri? Bilang boss.

---

## 🤔 What is this?

You know that feeling when VTube Studio on iPhone works *perfectly*… until you
want to send the tracking to your PC and suddenly it's like **"that'll be Pro
version, boss"** 💸

Well guess what — the VTS iOS app has a **3rd Party PC Clients** feature that
sends the exact same tracking data over your WiFi **for free and unlimited**.
Apps like VSeeFace and VBridger already use it. So this project is just a tiny
bridge app that sits on your PC:

```
iPhone (VTS app)  📶  free UDP tracking  📶  this bridge  🔌  VTube Studio PC
```

No webcam needed. No monthly anything. Just vibes. ✨

> ⚠️ Honest disclaimer: this is **NOT** a replacement for the official paid
> VTube Studio iOS → PC streaming. That one is plug-and-play and smoother.
> This is an alternative open-source bridge — you need to run this app on
> your PC alongside VTS, and it's held together by UDP packets and hope. 🙏

---

## 📖 Where did that name come from lol

So there's this TikToker, **Norman Iskandar** aka **"Dennis Ipong"** 📱 — bro
loves showing off his iPhone like it's a personality trait. His legendary
catchphrase:

> **"Kalau iri bilang boss"**
> *(If you're jealous, just say so.)*

In Indonesia (and let's be real, most developing countries), an iPhone costs
like 5 months of salary, so owning one is basically a national achievement
unlocked 🏆 People want one SO bad. And Dennis knows it. Every video is him
flexing the iPhone while haters watch. Iri? Bilang boss. 😌

So yeah — a project that squeezes free PC tracking out of an iPhone deserved
that name. This one's for everyone running VTube Studio on a potato PC while
their iPhone does all the heavy lifting. 🥔➡️🍎

---

## 🚀 Setup (5 minutes, promise)

### 📱 iPhone side

1. Open **VTube Studio** on your iPhone
2. Go to settings (first tab) and scroll all the way down
3. Turn on **`3rd Party PC Clients`** ✅
4. The app will show an **IP address** — write it down 📝
5. Keep the app open. Done. That's it. Go flex somewhere. 💅

### 🖥️ PC side

1. Open **VTube Studio** on your PC
2. Settings → enable **`Allow Plugin API access`** 🔌
3. Clone this thing and set it up (needs **Node 20+**, zero dependencies btw):

```bash
git clone <your-remote> kalauiwribilangboss
cd kalauiwribilangboss
cp .env.example .env
```

4. Open `.env` and put your iPhone IP:

```bash
IPHONE_IP=192.168.x.x   # ← the one from step 4 above
```

5. Run it:

```bash
node src/cli.js
```

6. VTube Studio will pop up asking to allow the plugin → click **Allow** 👍
   (one time only, it remembers you)
7. Move your face. Your Live2D model moves. You're welcome. 🎉

> 🐧 Tested only on **Linux with VTS running through Proton** (because webcam
> doesn't work there lol). Windows/Mac should work too but you're on your own —
> report back, boss.

---

## 🎮 Daily use

```bash
node src/cli.js          # that's it. that's the whole manual.
```

Ctrl+C to stop. If something looks weird, check the stats line:

```
in=1795 (30/s,p95=41ms) vts=1358 vtsErr=0 ang=5,-11 pos=0.89,-0.46 face=yes
```

- `in (30/s)` — frames from iPhone. Less than ~25/s = your WiFi is dying 📶💀
- `vts` — frames delivered to VTS. Should climb together with `in`
- `vtsErr` — hiccups (reconnects etc). Occasional is fine, exploding is not
- `face=yes` — iPhone sees your face. `LOST` = go back in front of camera bro

---

## 🔧 It moves weird, now what?

Most common knobs (all in `.env`, flags override them):

| Setting | Default | When to touch |
|---|---|---|
| `SMOOTH` | `0.5` | Shaky → raise it, laggy → lower it |
| `MIRROR` | `1` | Left/right flipped → set `0` |
| `YAW/PITCH/ROLL/BROW_SIGN` | `1/-1/1/1` | One specific axis inverted → flip to `-1` |
| `ROLL_GAIN` | `0.15` | Head-lean too wild → lower, dead → raise |
| `VTS_POS_GAIN` | `0.3` | Body barely moves → raise (can't break, capped) |

And the classics:

- **Model frozen?** → VTS API toggle off? Allow popup ignored? Second bridge
  running? (`pkill -f "src/cli.js"` and start exactly one ☝️)
- **Connection drops?** → bridge reconnects in ~1s by itself, don't panic.
  Still dropping a lot? Blame Proton/WiFi, not us. Probably. 😅
- **Want to see raw iPhone data?** → `node src/cli.js --dump`
- **No iPhone around?** → `node src/cli.js --demo` (fake wiggling data)

Full nerd flag list: `node src/cli.js --help`

---

## 🙏 Credits & references

This project is basically glue between two awesome open-source things:

- 📷 **[OpenSeeFace](https://github.com/emilianavt/OpenSeeFace)** — free webcam
  face tracking (we speak its UDP protocol)
- 📱 **[VTubeStudioBlendshapeUDPReceiverTest](https://github.com/DenchiSoft/VTubeStudioBlendshapeUDPReceiverTest)**
  — official VTS docs + example for receiving the free iPhone tracking data

Go star those repos, they did the hard part. We just connected the cables. 🔌

---

## 📜 License

MIT. Do whatever, iri? bilang boss. 😎
