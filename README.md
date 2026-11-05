<p align="center"><img src="docs/assets/connla-banner.png" alt="Connla — a teacher with a memory."></p>

<p align="center">
  <a href="#how-it-works">How it works</a> ·
  <a href="#what-this-fork-changes">What this fork changes</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="https://github.com/amosblomqvist/learnharness/issues">Issues</a> ·
  <a href="https://discord.gg/5tCHHQEB2e">Discord</a>
</p>

**Connla** is a skin fork of [LearnHarness](https://github.com/amosblomqvist/learnharness), an agent harness that plans and teaches lessons from your current understanding to your goal. The engine is LearnHarness, unmodified: same agents, same session and practice machinery, same knowledge graph, same desktop shell. What changed is how it looks.

LearnHarness builds a detailed picture of what you understand and how you reason, and updates that picture as you learn. Instead of giving you an explanation, it uses your answers and thinking to decide what you need next. Teaching builds understanding one reasoning step at a time. Practice makes it usable. A persistent knowledge graph carries it across sessions.

## What this fork changes

Warm paper and sage ink in place of the dark default; a serif for what you read and a monospace for furniture; hard offset shadows where upstream had blur; one startup plate of the Salmon of Knowledge. The brand reads Connla everywhere a learner can see it.

The package name and bundle id stay `learnharness`, so upstream merges and update identity keep working.

<table>
  <tr>
    <td width="50%"><img src="docs/assets/connla-session-dark.png" alt="A teaching session in the dark theme: lesson text, a TEACHING divider, and a prediction card"></td>
    <td width="50%"><img src="docs/assets/connla-session-light.png" alt="The same teaching session in the light theme"></td>
  </tr>
  <tr>
    <td align="center"><sub>Teaching session, dark</sub></td>
    <td align="center"><sub>Teaching session, light</sub></td>
  </tr>
</table>

## The startup plate

<p align="center"><img src="docs/assets/connla-intro.jpg" width="560" alt="The startup screen: the Salmon of Knowledge arriving as pixels"></p>

The plate is a 1904 public-domain illustration of Connla's Well, dithered to ink with the `plate` tool from `unwalled-garden` (`--ink bone --screen stipple --cell 2 --grain 0.60`). Files live in `public/intro/`. On each launch the print loads as 10px squares in a top-down sweep, sharpens into the etching, holds while `CONNLA` types itself out, then coarsens back into pixels and clears.

## How it works

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them. The aim is for the goal to feel obviously true, not merely familiar.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

**Think out loud.** The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words. This is how the agent gets a detailed picture rather than just a record of right and wrong answers. You can type or use dictation.

**Bring your files.** In the desktop app, attach PDFs, photos, or any other file with the paperclip, or drag them in. The file stays where it is: the message carries its path, and the agent reads it from there.

The agent can also research questions in the background, create visual explanations, show your own images in the lesson and mark them up with arrows and labels, and build interactive demonstrations.

## Knowledge that carries forward

What you are taught accumulates as propositions and reasoning chains: individual claims and the premises that lead to them. The graph shows this structure, with links back to the source sessions. You can also import notes.

Future teaching sessions can read the graph instead of starting from scratch. Practice sessions can draw their material from it. It stores the ideas and their connections, not ratings of your ability.

## Download and get started

This repository is a personal fork and does not publish its own builds. Get the app from upstream:

**[Download from learnharness.ai](https://learnharness.ai)** · [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases)

- **macOS (Apple Silicon):** signed and notarized DMG. Drag the app to Applications.
- **Windows (x64):** run the installer. It is currently unsigned; Windows may show an “unknown publisher” or SmartScreen warning.
- **Linux (x64):** make the AppImage executable and open it, or install the Debian/Ubuntu `.deb`.

Upstream builds ship the upstream skin. To run Connla, build this checkout with the steps under [Development](#development) and `npm run desktop:dist`.

Choose your models, then start a session with what you want to understand. You can use provider API keys, supported subscription connections in the desktop app, an installed [Claude Code CLI](docs/claude-code.md), or a [custom OpenAI-compatible endpoint](docs/custom-providers.md), including a local model server. Optional dictation and web search use separate service keys. Web research can use a Tavily, Brave, Exa, Firecrawl, or Ollama key in Settings → Providers → Search. Ollama search uses its hosted service, not a local model server.

See [Getting started](docs/getting-started.md) for model setup, dictation, files, and notes imports, and [context, caching, and costs](docs/compaction-accounting.md) for advanced cache preferences.

## Your keys, your data

- **Your keys and models.** No subscription or markup. Billing depends on your provider, CLI configuration, subscription, or local setup. The live cost meter estimates known API costs, not subscription, CLI, or custom-endpoint charges.
- **Local storage.** Your chats, graph, settings, and API keys live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research and dictation also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable. The app is open source under the AGPL-3.0 license.

## Development

```bash
npm ci
npm run dev        # http://localhost:3000
npm test           # fixtures and fake providers
npm run typecheck
npm run lint
```

The packaged app is built from the Next.js standalone output by `scripts/build-server.mjs`, then wrapped by `electron-builder`. `desktop:dist` also notarizes on macOS; on a machine without Xcode or a notary profile, pass `--config.mac.icon=build/icon.icns --config.mac.notarize=false` instead (the config's `build/icon.icon` needs `actool`).

See the [documentation index](docs/README.md) for all guides, [development](docs/development.md) for setup and checks, [architecture](docs/architecture.md) for the runtime, [keyboard shortcuts](docs/keyboard.md), and [desktop builds and releases](docs/desktop-release.md).

## License

[AGPL-3.0](LICENSE). Connla's changes carry the same licence as the upstream project they are built on.

The salmon plate is a public-domain 1904 illustration; the dither and the animation around it are part of this fork.
