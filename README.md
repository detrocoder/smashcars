# SmashCars 🏎️💥 — Multiplayer Battle Game

## How to deploy (FREE, takes ~5 minutes)

### Step 1 — Upload your code to GitHub
1. Go to https://github.com and create a free account (if you don't have one)
2. Click **New repository** → name it `smashcars` → click **Create repository**
3. Upload all these files (drag and drop): `server.js`, `package.json`, `railway.json`, and the `public/` folder

### Step 2 — Deploy on Railway (free hosting)
1. Go to https://railway.app and sign in with GitHub
2. Click **New Project** → **Deploy from GitHub repo** → select `smashcars`
3. Railway auto-detects everything. Click **Deploy**
4. Wait ~1 minute. Then click **Settings → Domains → Generate Domain**
5. You get a free URL like: `https://smashcars-production-xxxx.up.railway.app`

### Step 3 — Play with your friend!
- Both of you open the URL in your browser
- Type the **same room code** (e.g. `battle42`) and click Join
- Game starts automatically when both players join!

## Controls
| Player | Drive | Shoot |
|--------|-------|-------|
| P1 | WASD | Space |
| P2 | Arrow Keys | Enter |

## Weapons (pick up on the field)
| Symbol | Weapon | Damage |
|--------|--------|--------|
| R | Rocket | 22 HP |
| L | Laser | 12 HP (fast) |
| B | Bomb | 35 HP (big explosion!) |
| S | Shield | Blocks hits + heals 20 HP |

## Project structure
```
smashcars/
├── server.js          ← Node.js game server (Socket.io)
├── package.json       ← Dependencies
├── railway.json       ← Hosting config
└── public/
    └── index.html     ← Game frontend
```
