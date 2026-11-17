/** The `--help` text. A command missing from here is a command nobody can find, so `commands.test.ts` checks both lists agree. */
export const USAGE = `crust — a Bun-native desktop app framework. No Rust. Just crust.

usage:
  crust init <dir> [--react | --next]
                           scaffold an app in an empty directory
                             (no flag: plain HTML and CSS, no bundler
                              --react: React + Vite
                              --next:  Next.js, static export only)
  crust dev [file] [options]
                           watch the backend, restart it on change, follow the
                           frontend URL; with a .tsx/.jsx/.ts/.js/.html file,
                           run that one file as the app (no config needed)
  crust build [file] [options]
                           compile the binary and assemble X.app (ad-hoc
                           signed); with a file, build the single-file app
  crust sign [options]     Developer ID signing (needs a certificate)
  crust dmg [options]      build a drag-to-Applications disk image
  crust package [options]  build release artefacts; --format is repeatable and
                           defaults to dmg
                             (dmg:      drag-to-Applications disk image
                              appimage: Linux AppImage, needs appimagetool
                              nsis:     Windows installer, needs makensis)
  crust notarize [options]
                           submit the signed bundle to notarytool, then staple
                           the ticket; needs a Developer ID signature
  crust doctor [options]   report why the app did not open

options:
  --dir <path>       project directory (default: current directory)
  --config <path>    config file, relative to --dir
  --entry <path>     backend entry, relative to --dir
                     (default: src/main.ts, then main.ts)
  --format <fmt>     package only: dmg, appimage or nsis; repeat for several
  --react            init only: copy the React + Vite template
  --next             init only: copy the Next.js template (static export);
                     --react and --next are different scaffolds, pass one
  --help, -h         this text
  --version, -v      the crust version

notarize credentials come from the environment, never from argv:
  CRUST_SIGNING_IDENTITY      "Developer ID Application: Name (TEAMID)"
  CRUST_NOTARY_PROFILE        a notarytool store-credentials profile, or
  CRUST_NOTARY_APPLE_ID       an Apple ID with CRUST_NOTARY_PASSWORD and
  CRUST_NOTARY_TEAM_ID        the team id it belongs to

The published limits: ~85 MiB per app (Bun ships its runtime), macOS arm64 only,
and no Developer ID signature yet, so Gatekeeper refuses builds on other machines.`;
