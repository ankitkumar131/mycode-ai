# Brag Plan: MYCODE

## What is this app?
A multi-provider AI coding agent for the terminal — like Claude Code, but provider-agnostic with automatic failover across any OpenAI-compatible API. One agent, any AI, no lock-in.

## The angle
Every AI coding tool locks you in. MyCode doesn't. The video plays this as an epic unlock moment — the wall between you and your AI provider shattering. The failover chain (`OpenRouter → Ollama → OpenAI`) is the centerpiece: your AI never stops, even when a provider goes down. This isn't a feature list — it's a power statement.

## Hook (first 2-3 seconds)
A bold, cinematic statement that makes devs pause: the words **"Your AI provider went down."** slam onto a dark screen. Pause. Then: **"Your code didn't stop."** — the terminal glows to life with MyCode running.

## Key moments (the middle)
- The `mycode init` setup wizard appearing: provider → model → key → URL. Four clean prompts, one command.
- The failover chain lighting up: `OpenRouter → Ollama → OpenAI` — each provider box connects in sequence, showing the automatic routing.
- The provider grid from the project image: OpenRouter, NVIDIA NIM, Ollama, OpenAI, and "More" — all checked off with ✅ marks.

## Outro / punchline
**MYCODE** slams in full-screen, large and dramatic. Below it: *"One Agent. Any AI. Your Way."* — directly from the project's own tagline. Then the install command: `npm install -g @ankitkumar131/mycode-ai` fades in small beneath.

## User flow worth showing
`mycode init` (setup wizard with 4 prompts) → failover chain activating (request flows through provider priority) → `mycode chat` (AI responds in the terminal). Entry → config → resilient coding.

## Tone
- Preset: cinematic
- Creative direction: open-source developer power tool announcement — the kind of thing that makes devs stop scrolling
- Interpretation: Dramatic reveals, big type, confident holds. Each scene earns its space. The tool is real and powerful, and the video treats it that way. No humor needed — the product's capability is the punch.

## Format: landscape — 1920x1080
## Duration: 20 seconds (target)

## Visual identity (from the project)
- Background: #0a0a0a (near-black, from the project image dark theme)
- Accent: #00e5ff (cyan/teal neon, from the terminal UI and provider cards)
- Secondary accent: #4caf50 (green, from the success indicators and Ollama branding)
- Text: #ffffff (white, high contrast on dark)
- Display font: system monospace (the terminal aesthetic is the brand — JetBrains Mono or Fira Code feel)
- Body font: Inter or system sans-serif for clean labels
- Strongest visual element: the terminal window with the failover chain display and the provider grid with brand icons

## Share copy (draft)
One agent. Any AI provider. No lock-in. MyCode is the provider-agnostic coding agent your terminal deserves.

## Audio direction
- Role: cinematic support — dramatic but not overwrought
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean, best for cinematic)
- Music treatment: fade in from 0s at 0.35 volume, steady through the middle, subtle fade under the final logo, let the last SFX ring clean
- Music cue guidance: bundled preset available at `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`; use strong cues for the failover chain reveal and the logo slam; beat grid for the provider icons appearing in sequence
- Audio-reactive treatment: subtle; use music RMS/bass to make the terminal glow and accent colors breathe. No waveform/equalizer visuals.
- SFX posture: sparse but impactful — 2-3 big reveals, not a wall of sound
- Audio-coupled moments: failover chain boxes connecting (sequential card reveals), logo slam (impact bell), provider icons appearing (beat-grid snapped)
- Restraint rule: audio must not overshadow the product. No heavy bass drops. No dramatic trailer horns. The tool is the drama.

## Storyboard

### Scene 1 — The Problem — 3s
Dark screen. Bold white text slams in, centered:
**"Your AI provider went down."**
Hold 1.5s. Then below it, cyan accent text:
**"Your code didn't stop."**
Hold 1s. The background gets a faint cyan glow emanating from center.
Sequential/interaction: Two-line reveal — first line lands, pause, second line lands.
Audio intent: Tension, then confidence. The second line is the payoff.
Audio-coupled idea: impactSoft_medium on the first line landing; a warmer impact on the second line.
Music: Low, building.
Transition mood: dramatic → Scene 2

### Scene 2 — The Setup — 4s
A terminal window fades up, matching the project's dark theme. Inside it, the `mycode init` setup wizard appears:
```
⚡ MyCode Setup Wizard

? Provider:    openrouter
? Model:       google/gemini-2.5-flash
? API Key:     sk-or-••••••
? Base URL:    https://openrouter.ai/api/v1

✓ Added provider: openrouter
```
The four prompts type in one by one (simulated interaction), then the checkmark confirms.
Sequential/interaction: yes — each of the 4 config lines types in sequentially, then the ✓ confirmation appears.
Audio intent: Precision. Each typed line feels deliberate. The checkmark is satisfying.
Audio-coupled idea: subtle key ticks for typing, a clean click on the ✓ confirmation.
Music: Building momentum.
Transition mood: clean → Scene 3

### Scene 3 — The Failover Chain — 5s
The centerpiece. Three provider boxes appear left-to-right:
**[OpenRouter]** → **[Ollama]** → **[OpenAI]**
Each box lights up cyan as a request flows through them. An arrow connects them. The first box blinks (failure), the request flows to the second, which glows green (success). Below: **"Automatic failover. Zero downtime."**
Sequential/interaction: yes — three boxes appear one by one, arrows animate between them, then the failure/success states activate.
Audio intent: The big moment. Each box landing has weight. The "failure → success" transition is the hero beat.
Audio-coupled idea: card-place sound for each box appearing, impactBell for the success moment.
Music: Swelling. This is the emotional peak.
Transition mood: dramatic → Scene 4

### Scene 4 — The Provider Grid — 4s
Five provider cards fan in from the bottom, matching the project image layout:
**OpenRouter** (Free) | **NVIDIA NIM** (GPU) | **Ollama** (Local) | **OpenAI** (Direct) | **More** (Coming)
Each gets its brand color tint. Below: **"If it has an API, MyCode can use it."**
Sequential/interaction: yes — 5 provider cards arrive one by one, beat-aligned.
Audio intent: Confident spread. Each card arrival is a small beat. The tagline holds.
Audio-coupled idea: beat-grid card reveals for the 5 providers, then a quiet hold for the tagline.
Music: Full energy.
Transition mood: clean → Scene 5

### Scene 5 — Logo & Outro — 4s
**MYCODE** slams in huge, centered, monospace, white on black. Cyan glow behind it.
Below: *"One Agent. Any AI. Your Way."*
Underneath, small: `npm install -g @ankitkumar131/mycode-ai`
Hold. The glow breathes subtly with the music.
Sequential/interaction: Logo slam, then tagline fades in 0.3s later, then install command fades in 0.3s after.
Audio intent: The final beat. One big impact, then quiet confidence.
Audio-coupled idea: impactBell_heavy for the logo slam. Music fades under.
Music: Fading out under the logo hold.
Transition mood: end

**Music mood for this video:** cinematic — steady, clean energy building to a confident peak at the failover reveal, then fading into the logo.
**Audio summary:** A building cinematic bed with 3 key impact moments — the hook line, the failover success, and the logo slam — with subtle beat-aligned card reveals in the middle.

## Music cue guidance

Track: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady, clean).
Read bundled preset from `<skill-dir>/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json` for tempo and cue data.

Strong cue targets (from preset or to be detected):
1. ~3.0s — Scene 1→2 transition (hook payoff)
2. ~10.0s — Failover success moment (the hero beat)
3. ~16.0s — Logo slam

Beat-grid windows:
- Scene 2 (4-7s): 4 config lines typing in, snapped to every other beat
- Scene 4 (12-16s): 5 provider cards, snapped to beat grid

Restraint: Let the big moments land on strong cues. Don't beat-lock every element.
