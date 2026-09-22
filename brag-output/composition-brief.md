# Hyperframes Composition Brief: MYCODE

## Objective
Create a short cinematic launch-style brag video for MYCODE — a multi-provider AI coding agent for the terminal.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `D:\drive 1 1Local disk\Projects\mycode`
- Primary files read: `package.json`, `README.md`, `project-image.jpg`, `src/` directory, `packages/` monorepo
- Product name: MYCODE
- Tagline / strongest claim: "Like Claude Code, but works with _any_ AI provider — just bring your API key."
- Key UI or visual moment to recreate: Terminal window with the failover chain (`OpenRouter → Ollama → OpenAI`), the provider grid, and the setup wizard
- Copy that must appear verbatim:
  - "Your AI provider went down."
  - "Your code didn't stop."
  - "⚡ MyCode Setup Wizard"
  - "OpenRouter → Ollama → OpenAI"
  - "Automatic failover. Zero downtime."
  - "If it has an API, MyCode can use it."
  - "MYCODE"
  - "One Agent. Any AI. Your Way."
  - "npm install -g @ankitkumar131/mycode-ai"

## Creative Direction
- Tone preset: cinematic
- Creative direction: open-source developer power tool announcement — the kind of thing that makes devs stop scrolling
- Interpretation: Dramatic reveals, big type, confident holds. Each scene earns its space. No humor — the product's capability is the punch. Heavy weight text, sweeping transitions, big scale. The terminal aesthetic (dark, neon cyan/green) is the visual identity.
- Angle: Every AI coding tool locks you in. MyCode doesn't. The video plays this as an epic unlock — the failover chain is the hero moment, the provider grid is the proof, and the logo is the landing.
- Hook: "Your AI provider went down." (pause) "Your code didn't stop." — dark screen, dramatic text slam
- Outro / punchline: MYCODE logo slam with "One Agent. Any AI. Your Way." and the npm install command beneath
- Avoid:
  - Generic SaaS language ("streamline your workflow", "next-gen", "revolutionary")
  - Abstract filler visuals (color gradients, floating shapes)
  - Redesigning the product's visual identity — use its dark + cyan/green terminal aesthetic

## Visual Identity
- Background: #0a0a0a (near-black)
- Text: #ffffff (white)
- Accent: #00e5ff (cyan/teal neon — the primary brand color)
- Secondary accent: #4caf50 (green — success states)
- Error accent: #ff4444 (red — failure indicator for the failover demo)
- Display font: monospace system font (JetBrains Mono / Fira Code aesthetic — the terminal IS the brand)
- Body font: system sans-serif (Inter / -apple-system feel for clean labels)
- Visual references from the project: project-image.jpg (terminal UI with provider grid), the failover chain diagram from README, the setup wizard ASCII art

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The Problem — 3s — "Your AI provider went down." / "Your code didn't stop." Bold cinematic text slam on dark background with cyan glow
2. The Setup — 4s — Terminal window with `mycode init` setup wizard typing in 4 config lines, ✓ confirmation
3. The Failover Chain — 5s — Three provider boxes (OpenRouter → Ollama → OpenAI) appearing with arrows, failure/success states, "Automatic failover. Zero downtime."
4. The Provider Grid — 4s — Five provider cards (OpenRouter, NVIDIA NIM, Ollama, OpenAI, More) fanning in, "If it has an API, MyCode can use it."
5. Logo & Outro — 4s — MYCODE logo slam, "One Agent. Any AI. Your Way.", npm install command

## Audio
- Audio role: cinematic support — dramatic but not overwrought
- Audio arc: Low and building through scenes 1-2, swelling through scene 3 (the hero), full energy for scene 4, fading under logo in scene 5
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: fade in at 0s, volume 0.35, steady through middle, subtle fade-out starting at ~17s, let final SFX ring clean over faded music
- Music cue guidance: bundled preset at `<skill-dir>/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`. Tempo: 109.96 BPM. Key strong cues at 2.73s (hook payoff), 8.74s (failover reveal), 17.47s (logo slam). Beat grid for sequential reveals: every ~0.55s.
- Audio-reactive treatment: subtle; use music RMS/bass to make the terminal glow and accent color backgrounds breathe. No waveform/equalizer visuals.
- Audio-coupled moments:
  - Scene 1 (hook lines) — impactSoft_medium on each line landing
  - Scene 2 (typing) — subtle keyboard ticks for typing animation, clean click on ✓
  - Scene 3 (provider boxes) — card-place sounds for each box, impactBell for success
  - Scene 4 (provider grid) — beat-grid card reveals for 5 providers
  - Scene 5 (logo) — impactBell_heavy for logo slam
- SFX selection guidance: use warm, low-HF-risk sounds for repeated moments (typing, card reveals). Reserve medium-HF impactBell for the 2-3 big reveals (failover success, logo). Match motion to sound — the card arrivals and logo slam are the anchor moments.
- SFX analysis guidance: `<skill-dir>/assets/sfx/sfx-analysis.md` and `sfx-analysis.json`. Prefer low-risk picks for the polished cinematic tone.
- Exact SFX choice: Hyperframes should choose filenames, timestamps, density, and volume based on the implemented animation.
- Audio files: copy the chosen music and any Hyperframes-selected SFX into `brag-output/composition/assets/`

## Hyperframes Instructions
Load the composition-building Hyperframes domain skills — `hyperframes-core` (composition contract + `data-*` timing), `hyperframes-animation` (motion), `hyperframes-creative` (design spec, beats, audio-reactive), `hyperframes-keyframes` (seek-safe keyframes), and `hyperframes-cli` (lint/check/render). /brag is its own workflow: do not enter the `hyperframes` entry-point intent interview and do not route into its generic promo / launch-video workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI, copy, or visual element from the source project.
- Keep all text readable in the final render.
- Keep the video within 15-25 seconds.
- Include the planned music/SFX layer unless audio was explicitly disabled or documented as intentionally silent.
- Treat `/brag` audio notes as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints. Hyperframes decides exact animation timing and should ignore cues that hurt readability, scene pacing, or the product story.
- Major reveals may move toward nearby strong cues within about 0.15s. Smaller entrances may align to nearby beat points within about 0.10s. Use only 1-3 strong cue locks in a 15-25s video unless the edit clearly benefits from more.
- Use SFX to support motion and interaction: card sounds for card-like reveals, short announcement cues for major payoffs, key/click sounds for text or user actions, and restraint when the edit is already busy.
- Honor planned music treatment such as fade-outs, ducking, beat-aligned reveals, or letting a final SFX ring over the music, using the best Hyperframes-supported implementation.
- When music is present and the treatment is not `none`, consider Hyperframes audio-reactive workflow: extract audio data and use RMS/frequency bands for subtle, brand-specific motion. Good targets are glow, depth, background warmth, card presence, title emphasis, or other existing visual elements. Avoid waveform/equalizer visuals, musical-note graphics, generic particle systems, strobing, or heavy pulsing.
- Use local assets for audio and any required runtime/media dependencies when possible.
- Run `hyperframes check` before render — it is brag's single gate.
