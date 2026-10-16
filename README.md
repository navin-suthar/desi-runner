# Desi Dash: Rail Runner

An original Indian-themed 3-lane endless runner. Everything is plain HTML/CSS/JS with no build step. Three.js r160 loads from jsDelivr, with unpkg as a fallback. All models and textures are built in code, and all sound is synthesized with the Web Audio API.

## Run
Serve the folder, e.g. `python3 -m http.server 8000`, then open http://localhost:8000.
Opening index.html directly from disk also works, but the manifest and "add to home screen" need http(s).

## Controls
| Action | Keyboard | Touch |
|---|---|---|
| Change lane | ← → / A D | swipe left / right |
| Jump | ↑ / W / Space | swipe up |
| Roll / slide (or fast-drop in the air) | ↓ / S | swipe down |
| Start / restart | Enter / Space | tap |
| Pause | P / Esc / ❚❚ button | ❚❚ button |
| Mute | M / 🔊 button | 🔊 button |

## Gameplay
- Dodge trains (parked or oncoming), auto-rickshaws, chai carts, cows, police jeeps and barriers. Roll under signal bars.
- Use the yellow ramps to run up onto train roofs.
- Brushing the side of an obstacle makes you stumble, and the TT Uncle and the Havaldar start chasing you. Stumble again during the chase, or hit anything head-on, and you're caught.
- Power-ups: 🪁 Kite Glide (fly above everything), 🧲 Coin Magnet, ✖2 Multiplier.
- Your best score is saved in localStorage.

## Test/demo URL flags
- `?autopilot`: the game plays itself (demo mode).
- `?capture`: fixed-timestep mode driven by `window.__game.step()`, used for recording videos.
