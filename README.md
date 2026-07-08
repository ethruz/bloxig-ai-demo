# Bloxig — AI Interaction Layer

**Figma → Roblox UI, and the AI writes the code that makes it work.**

This repository showcases the **AI interaction layer** of [Bloxig](https://bloxig.onrender.com) — a live product that converts Figma designs into native Roblox UI. It is Bloxig's entry for the **AMD Developer Hackathon (ACT II, Unicorn Track)**.

> This is a focused demo repo. It contains the interaction-layer code that runs on AMD compute; the full export engine and product live in a private repository.

---

## The problem

Every design-to-game tool shares one hard limit: it can convert how a UI *looks*, but not how it *behaves* — a design file contains no click logic to convert. So converted UIs come out static: buttons that don't click, close buttons that do nothing. Roblox developers still write every interaction by hand.

## What this does

After Bloxig converts a Figma design to native Roblox UI, this layer **automatically detects the interactive elements and generates the Roblox `LocalScript` that wires them up** — close buttons, claim actions, and more. A static converted UI becomes a playable one, with the interaction code written for you.

```
Figma design → convert → detect interactivity → AI generates Luau → playable in Studio
```

---

## Powered by AMD

The interaction model runs on **AMD compute**, end to end:

- The interaction model (**Kimi K2**) is served through the **Fireworks AI API** — an OpenAI-compatible endpoint the Node backend calls (`routes/aiWire.js`).
- Fireworks runs that inference on **AMD Instinct™ GPUs**. Every generated `LocalScript` is written on AMD silicon.
- AMD is on the critical path: it powers the one feature that makes Bloxig more than a converter. No AMD, no interaction layer.

The Fireworks call lives in [`routes/aiWire.js`](routes/aiWire.js):

```js
const FIREWORKS_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const MODEL = 'accounts/fireworks/models/kimi-k2p6'; // served on AMD Instinct GPUs
```

---

## Detection is structure-based, not name-based

The hard part isn't generating the code — it's knowing **which** elements are interactive when users name their layers however they like (`Btn_Dismiss`, `collectReward`, `Group 47`, or another language entirely).

Bloxig detects interactivity by **structure, position, and text** — not by layer name:

- A text-bearing box with a fill or stroke at button scale is a **button**.
- A small square in the top-right corner is a **close button**.
- An evenly-spaced row of same-size siblings is a **tab bar**.

This works regardless of naming — even on elements that were auto-rasterized into images. Deterministic heuristics find the candidates and their position/text context; the AI infers each element's role and writes the Luau.

This split — **heuristics for structure, AI for semantics** — mirrors how commercial design-to-code systems (e.g. Locofy) operate, and is validated by UI-semantics research (e.g. Alibaba's view-hierarchy grouping). The difference: **Bloxig applies it to Roblox / Luau**, a platform of millions of creators that none of those tools serve.

---

## Files in this repo

| File | What it is |
|------|------------|
| `routes/aiWire.js` | The backend route. Detects nothing itself — takes the detected elements + context and calls **Kimi K2 on Fireworks (AMD)** to generate the interaction Luau. The API key stays server-side. |
| `roblox-plugin/src/Generator.lua` | The Roblox Studio plugin side. Reads the structure-based interactivity detected during conversion, overlays clickable buttons where needed, calls the backend, and inserts the generated `LocalScript`. |

The structural detection itself runs in the Figma plugin (`code.ts`, in the private repo) and stamps each node with an `interactive` flag, a `roleHint`, and position/text `context` that this layer consumes.

---

## Roadmap

Detection currently makes elements clickable and generates click behaviour (close, claim, generic actions). Next:

- **Tab & content switching** — the same structural detection, extended from "what is interactive" to "how it transitions"
- **Hover states & animations**, AI-generated
- **Multi-engine export** beyond Roblox (a neutral intermediate-representation core)

---

## Links

- **Live product:** https://bloxig.onrender.com
- Built for the **AMD Developer Hackathon · ACT II · Unicorn Track**

---

*Bloxig doesn't just convert your design into a Roblox UI — its AI writes the code that makes it playable.*
