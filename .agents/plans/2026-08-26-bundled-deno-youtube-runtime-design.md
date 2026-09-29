# Bundled Deno runtime for YouTube downloads

MediaGo will prioritize reliable YouTube downloads by shipping the full Deno
runtime that yt-dlp recommends for its external JavaScript challenge solver.
Deno is treated like the existing ffmpeg and yt-dlp executables: each release
build provisions only the binary matching the target operating system and CPU,
verifies the extracted executable against a pinned SHA-256 digest, and copies
the platform dependency directory into Electron resources. This preserves the
current packaging boundary and avoids relying on a user-managed system PATH.

Core owns the runtime selection because every entry point—Electron, HTTP API,
MCP, and CLI—ultimately creates downloads through Core. When Core builds a
YouTube yt-dlp command, it derives the adjacent `deno` or `deno.exe` path from
the configured yt-dlp executable and passes it through `--js-runtimes`. Other
download types remain unchanged. Startup diagnostics also check the bundled
Deno executable so a damaged or incomplete installation is visible before a
YouTube task fails.

The implementation pins Deno 2.9.5 for all six selectable platform keys and
updates runtime task contracts, dependency layout tests, and third-party
notices. Regression tests verify Unix/Windows executable names and the exact
yt-dlp argument pair. Verification consists of TypeScript runtime-dependency
tests, Go Core tests, local provisioning with hash validation, `deno --version`,
and a yt-dlp command smoke test using the explicit bundled runtime path.
