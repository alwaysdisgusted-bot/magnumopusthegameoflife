# Magnum Opus local edition - source snapshot

This repository contains application source and non-personal artwork. It is not
a backup of a player's account. No saves, uploaded documents, personal photos,
databases, runtime state, backups, credentials or private work logs are included.
The existing repository README and GPL-3.0 license are preserved.

## Local development

Use Node.js 22.13 or newer and npm:

```powershell
npm ci
npm run check
npm run build
```

On Windows, `Spustit.cmd` prepares local migrations and the Grimoire build, then
starts the personal local edition at `http://127.0.0.1:4175`. It requires installed
dependencies and Node.js; the original machine's bundled runtime is not included.
Use `Zastavit.cmd` to stop that local instance. Do not expose personal local mode
to a network or weaken its loopback restrictions.

The original personal profile photograph is intentionally absent. Supply your own
local `public/assets/profile-picture.png` if desired; do not commit it.

## Graphics handoff

Original PNG graphics belong in `public/assets/magnum-opus/`. Its manifest records
only files actually present, their dimensions, transparency and intended use.
The library background is the only delivered original from the current graphics
series. The other twelve generated assets are not included because their original
files have not been received.

Graphics delivery does not automatically change game styles or behavior. Review
the manifest, download originals, validate them, and integrate deliberately.
No graphics scheduler is enabled by this source import.

## Scope

This is a source-only snapshot, not a merge of the personal machine's Git history.
Private operational documentation and personal monetization planning are
intentionally omitted. GitHub Pages,
hosting deployment, paid generation and automatic pull-request merging are not
configured by this import. The source-check workflow runs on pull requests or
manual dispatch, not on this push.
