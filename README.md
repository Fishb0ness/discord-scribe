# discord-scribe

A **self-hosted, private note-taker bot** for Discord. It records a voice channel **per speaker**, transcribes it
**locally** with [whisper.cpp](https://github.com/ggml-org/whisper.cpp), optionally summarizes it with the
[Claude Code CLI](https://docs.claude.com/en/docs/claude-code), and delivers a Markdown transcript and summary.

You run your own Discord application on your own machine. There is no hosted service and nobody else can invite
your bot (see [Privacy and access](#privacy-and-access)).

```
/grabar  ->  bot joins your voice channel, announces the recording, renames itself "[GRABANDO] ..."
/parar   ->  per-user WAV -> whisper-cli -> merged transcript -> claude -p summary
             recordings/<YYYY-MM-DD_HHmm>-<channel>/{transcript.md,summary.md}
             summary posted in the text channel where /grabar was used (+ transcript.md attached)
```

The bot's chat messages are in Spanish and Whisper defaults to Castilian Spanish (`WHISPER_LANGUAGE` and
`WHISPER_PROMPT` change that); code and docs are in English. Works on macOS, Linux and Windows.

## Privacy and access

- **Audio never leaves your machine.** Per-user audio is written to a temporary folder, transcribed locally by
  whisper.cpp and deleted once transcribed.
- **Transcript text (not audio) is sent to Anthropic** only to produce the summary, through the `claude` CLI and
  *your own* Claude login. Set `SUMMARY_ENABLED=false` to disable it: the bot then only produces the transcript and
  `claude` is never run.
- **Only your servers.** `ALLOWED_GUILD_IDS` is required. The bot registers its commands only in those servers,
  ignores interactions from anywhere else (including DMs) and **leaves any other server** it is added to.
- **Only people you allow can start a recording.** Restrict `/grabar` with Discord's own command permissions (below).
  `/parar` only works for someone who is in the voice channel being recorded.
- **Tell the people you record.** Recording voices has legal consequences (GDPR and similar laws). The bot announces
  the recording in the text channel and renames itself `[GRABANDO] ...` for the whole session, but getting consent
  is your responsibility.
- The bot token lives only in your local `.env`, which git ignores. A pre-commit hook and a CI scan refuse to
  publish secrets (see [Development](#development)).

## Prerequisites

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Node.js 22+ | `brew install node` or [nodejs.org](https://nodejs.org) | your package manager or [nodejs.org](https://nodejs.org) | [nodejs.org](https://nodejs.org) |
| git | Xcode tools or `brew install git` | your package manager | [Git for Windows](https://gitforwindows.org) |
| whisper.cpp (`whisper-cli`) | `brew install whisper-cpp` | build from source (below) | release zip or build from source (below) |
| Claude Code CLI (`claude`), logged in | see its docs | see its docs | see its docs |

The Claude CLI is only needed when `SUMMARY_ENABLED` is not `false`. Check it with `claude -p "hi"`.

**whisper.cpp on Linux** (needs `git`, `cmake`, a C++ compiler):

```sh
git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
cmake -B build && cmake --build build -j --config Release
# the binary is build/bin/whisper-cli: put it on PATH or set WHISPER_BIN to its full path
```

**whisper.cpp on Windows:** download a prebuilt zip from the
[whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) (look for `whisper-bin-x64.zip`) or build it
with the same CMake commands. Set `WHISPER_BIN` to the full path of `whisper-cli.exe` unless it is on `PATH`.
GPU builds (Metal on macOS, CUDA or Vulkan elsewhere) are much faster; see the whisper.cpp README.

Opus decoding uses `@discordjs/opus`, which ships prebuilt binaries for macOS (x64/arm64), Linux (x64/arm64, glibc
and musl) and Windows x64. On any other platform the bot automatically falls back to the bundled WebAssembly
`opusscript` decoder (slower, but no compiler needed).

## Setup

```sh
git clone <this repository> discord-scribe && cd discord-scribe
npm install
npm run download-models      # large-v3 (about 3 GB) + Silero VAD into models/
cp .env.example .env         # on Windows: copy .env.example .env
```

`npm install` reads `.npmrc`, which allows a git dependency (Dysnomia) and the install scripts of the native packages,
and enables the git hooks. If your global npm config is stricter, keep that file.

The Silero VAD model matters: without it Whisper invents text on silence ("Gracias.", "Subtitulos realizados por la
comunidad de Amara.org"). With one file per speaker, each track is mostly silence. The transcript merger also drops
well-known hallucinations as a second line of defence. `npm run download-models -- --turbo` also fetches the faster,
less accurate large-v3-turbo model.

### Create your Discord application

1. Open the [Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. Copy the **Application ID** into `DISCORD_APP_ID` in `.env`.
3. **Installation** tab: untick **User Install** (keep only **Guild Install**). Under Guild Install, add the scopes
   `bot` and `applications.commands` and the permissions listed in step 6.
4. **Bot** tab:
   - Turn **Public Bot** **off**, so only you can add the bot to a server.
   - Click **Reset Token** and copy it into `DISCORD_TOKEN`. Never share or commit it.
   - **Privileged Gateway Intents**: leave all three **off**. The bot only uses the non-privileged `guilds` and
     `guildVoiceStates` intents; it needs neither *Server Members* nor *Message Content*.
5. Enable Developer Mode in Discord (User Settings > Advanced), right-click your server and **Copy Server ID** into
   `ALLOWED_GUILD_IDS` (several servers: comma-separated).
6. Use the install link from the **Installation** tab (or build one under **OAuth2 > URL Generator** with scopes `bot`
   and `applications.commands`) with these permissions, and add the bot to your server:
   - View Channel
   - Send Messages
   - Attach Files
   - Connect
   - Change Nickname (to show `[GRABANDO]`; recording still works without it)

   Speak is **not** needed: the bot only listens.

If the bot lacks Send Messages or Attach Files in a text channel, the files are still saved to disk and the bot logs
the failure.

### Restrict who can run `/grabar`

By default everybody in an allowed server can use the commands. To limit it: **Server Settings > Integrations >
(your bot)**, select `/grabar`, then allow only a role or users (and deny `@everyone`). Discord enforces this, so the
bot needs no role configuration of its own.

## Configuration (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | Bot token |
| `DISCORD_APP_ID` | required | Application id |
| `ALLOWED_GUILD_IDS` | required | Comma-separated server ids the bot may serve (legacy alias: `DISCORD_GUILD_ID`) |
| `SUMMARY_ENABLED` | `true` | `false` disables the Claude summary: transcript text is then never sent anywhere |
| `WHISPER_BIN` | `whisper-cli` | whisper.cpp binary (name on `PATH` or full path) |
| `WHISPER_MODEL` | `models/ggml-large-v3.bin` | Whisper model (`ggml-large-v3-turbo.bin` is faster, less accurate) |
| `WHISPER_VAD_MODEL` | `models/ggml-silero-v5.1.2.bin` | VAD model (a missing file means no VAD, with a warning) |
| `WHISPER_LANGUAGE` | `es` | Spoken language (`auto` to detect) |
| `WHISPER_BEAM_SIZE` | `8` | Beam size and best-of (higher is slower and a bit more accurate) |
| `WHISPER_PROMPT` | built-in Castilian paragraph | Initial prompt for punctuation and vocabulary. Set it empty to disable |
| `CLAUDE_BIN` | `claude` | Claude Code CLI |
| `RECORDINGS_DIR` | `recordings` | Output folder |

Relative paths resolve against the working directory (the project folder when running as a service).

## Run

```sh
npm start
```

In a voice channel run `/grabar`; when you are done, `/parar`. The recording also stops by itself when the channel
empties (after 15 s), when the bot is moved or disconnected, when voice encryption keeps failing, or when nobody is
heard during the first 5 minutes.

### Run as a service

Each installer renders a service definition for the current user, starts it at login and restarts it on failure.
Run `npm install` and create `.env` first. Logs go to `logs/`.

| OS | Install | Remove |
| --- | --- | --- |
| macOS (launchd LaunchAgent, label `com.<user>.discord-scribe`) | `scripts/install-service-macos.sh` | `scripts/uninstall-service-macos.sh` |
| Linux (systemd **user** unit `discord-scribe.service`) | `scripts/install-service-linux.sh` | `scripts/uninstall-service-linux.sh` |
| Windows (Scheduled Task at logon) | `.\scripts\install-service-windows.ps1` | `.\scripts\uninstall-service-windows.ps1` |

The macOS and Linux installers accept `--dry-run` (Windows: `-DryRun`) to print what they would install without
changing anything. The installers pin the absolute `node` path found at install time, so run them again after
upgrading Node with a version manager. Notes:

- macOS: it is a LaunchAgent, so the user must be logged in (enable automatic login for unattended boots).
- Linux: run `sudo loginctl enable-linger $USER` to keep the user service running after you log out.
- Windows: the task restarts on failure every minute. Windows has no `SIGTERM`, so stopping the task kills the bot
  without its graceful shutdown (an unfinished recording stays in `recordings/.work/`).
- Make sure `whisper-cli` and `claude` are reachable from the service's `PATH`, or set `WHISPER_BIN` / `CLAUDE_BIN` to
  full paths in `.env`.

## Output

```
recordings/2026-10-04_1705-general/
  transcript.md   # [mm:ss] **Name**: text, time-ordered, consecutive turns of one speaker merged
  summary.md      # summary, decisions, action items with owners (Spanish)
```

Per-user WAV files are written to `recordings/.work/` while recording and **deleted once transcribed**. If a
speaker's transcription fails, that speaker's WAV is kept so you can retry by hand with `whisper-cli`. If the summary
fails, the transcript is still saved and posted, with a warning. Each whisper run has a timeout of
max(10 min, 3x the audio length); on timeout the process is killed and that speaker's WAV is kept. Error details go
to the log, never to the chat.

On `SIGTERM`/`SIGINT` (and `SIGBREAK` on Windows) the bot stops active recordings, waits up to 150 s for queued
transcriptions, then kills any whisper/claude child still running. Anything left unprocessed stays in
`recordings/.work/` (the log says where). Discord limits messages to 2000 characters; long summaries are split across
several messages and the transcript is attached to the last one.

## How it works

Hexagonal layout, run directly with `tsx` (no build step):

| Layer | Path | Contents |
| --- | --- | --- |
| Domain | `src/domain` | config, access control, per-user track assembler (reorder buffer, zero-packet filter, silence padding, 48 kHz to 16 kHz), WAV header, transcript merge, nickname and recovery helpers |
| Application | `src/app` | use case `processRecording`, `SessionRecorder`, ports (`Transcriber`, `Summarizer`, `OutputStore`, `ChatNotifier`) |
| Adapters | `src/adapters` | whisper-cli, claude-cli, filesystem, Opus decoder, Windows-safe process spawning, Discord (Dysnomia) |
| Composition root | `src/main.ts` | wires everything from `.env` |

Voice receive is unofficial in every Discord library. Since March 2026 Discord requires DAVE end-to-end encrypted
voice, so the bot uses the same stack as the production recorder [Craig](https://github.com/CraigChat/craig):
`@projectdysnomia/dysnomia` pinned to a commit, `@snazzah/davey` (DAVE), `sodium-native` and `@discordjs/opus`. It also
borrows Craig's lessons: dropping mostly-zero packets, reordering packets per user by RTP timestamp, stopping when DAVE
keeps invalidating transitions, and retrying voice reconnects.

## Development

```sh
npx vitest run      # tests (strict TDD: domain and use cases are tested first)
npx tsc --noEmit    # typecheck
```

`npm install` enables `.githooks/pre-commit` (`git config core.hooksPath .githooks`). It refuses to commit `.env` and
`.env.*` files (except `.env.example`) and runs `gitleaks` on the staged changes when it is installed
(`brew install gitleaks`, or see the [gitleaks](https://github.com/gitleaks/gitleaks#installing) docs); without it the
hook only warns. CI runs the tests on Ubuntu, macOS and Windows and scans the history with gitleaks.

## Troubleshooting

- **`Configuration problems`**: the message lists every missing or invalid `.env` value. `ALLOWED_GUILD_IDS` is required.
- **Slash commands do not appear**: they are registered per allowed server at startup. Check the log for
  `Registered slash commands`, that the bot was added with the `applications.commands` scope, and that the server id in
  `ALLOWED_GUILD_IDS` is right. If the bot answers that it is not authorized, the server is not in the list.
- **The bot left my server by itself**: the bot leaves every server whose id is not listed in `ALLOWED_GUILD_IDS` (the
  log says `Leaving guild`). The usual cause is a typo or a wrong id, for example when migrating from the old
  `DISCORD_GUILD_ID`. To find the right id, enable Developer Mode (Discord settings, Advanced), right-click the server
  and choose **Copy Server ID**. Put it in `ALLOWED_GUILD_IDS` in `.env`, restart the bot and invite it again.
- **`Could not start whisper-cli`**: install whisper.cpp or set `WHISPER_BIN` to its full path.
- **Transcript is empty or full of "Gracias."**: the VAD model is missing (see the startup warning); run
  `npm run download-models`.
- **No summary**: check that `claude -p "hi"` works for the user running the bot (services run as you but with a
  smaller `PATH`) and that `SUMMARY_ENABLED` is not `false`.
- **Opus warning at startup**: the native decoder could not load and the slower WebAssembly one is being used. It works.
- **Windows and `claude.cmd`**: npm-installed CLIs are `.cmd` shims; the bot resolves them and escapes the arguments for
  `cmd.exe` (line breaks in the summary prompt become spaces). A native `claude.exe` is spawned directly.

## Known limitations

- The service install scripts may break if the project path contains `&`, `|` or `%` (and `<` or `&` on macOS, where
  the path ends up in a plist). Workaround: move the project to a plain path before installing the service.
- Voice receive is unofficial and can break whenever Discord changes its voice protocol (DAVE); update
  Dysnomia and Davey if it does.
- One recording per server at a time; transcription jobs run one after another.
- If the bot is killed mid-recording, per-user WAVs stay in `recordings/.work/` and are not processed automatically.
- The Linux and Windows service scripts and the Windows spawn path follow the platforms' documented behaviour; CI
  covers tests and typechecking on all three systems, not a live Discord session. Report problems on your platform.

## License

[MIT](LICENSE)
