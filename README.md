# Bayan

A free Quran reader for Mac. Arabic first, published English translations beneath each verse, personal notes, and recitation.

**Early preview.** The Mac app and local Quran Foundation service are working. Pre-live access is limited to surahs 1 and 2. Full Quran access needs production approval.

See [BAYAN.md](BAYAN.md) for build steps, connection setup, features, and preview limits.

```sh
bash scripts/build-bayan-macos.sh
node --env-file=work/qf.env service/bayan/server.mjs
open dist/Bayan.app
```

API secrets and downloaded Quran content are never bundled or committed.

Forked from [michaelshimeles/bible-rs](https://github.com/michaelshimeles/bible-rs). The original Rust source and MIT notices are retained; the new Mac target uses AppKit and WebKit for Arabic text. [Original README](docs/UPSTREAM-README.md).
