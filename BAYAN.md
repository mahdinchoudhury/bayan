# Bayan preview

Bayan is a free, Mac-only Quran reader, built in a public fork of
[bible-rs](https://github.com/michaelshimeles/bible-rs).

## Run

Requires macOS 13+, Apple's Command Line Tools (Swift), and Node.js 22+ for the
private content service. No Rust installation is needed for the Bayan target.

```sh
bash scripts/build-bayan-macos.sh
node --env-file=work/qf.env service/bayan/server.mjs
open dist/Bayan.app
```

Create `work/qf.env` privately; never commit it:

```dotenv
QF_ENV=prelive
QF_CLIENT_ID=your-client-id
QF_CLIENT_SECRET=your-client-secret
```

Create a **Server / API access only** app in the Quran Foundation Developer Console.
Connect Bayan to `http://127.0.0.1:8787` in Settings. Pre-live provides only surahs
1 and 2 and a limited resource catalog. Full Quran content requires production
approval, matching production credentials, and `QF_ENV=production`.

## Implemented

- Arabic-first reading; English translations below each verse.
- API-driven translation selection and comparison.
- Separate word meanings, linked to Arabic by hover or keyboard focus.
- Verse notes with 1.2-second autosave, Done, Delete, and six highlight colors.
- Bookmarks, notes/highlights lists, surah and juz navigation, verse references.
- Local search across downloaded text, including Arabic without vowel marks.
- Published tafsir side panel with grouped-passage lookup.
- Reciter choice, verse playback, repeat, speed, and verse/surah stopping.
- Offline downloaded text, translations, and tafsir.
- JSON backup/import preserving newer notes; Markdown export.
- Light, sepia, and dark appearances; adjustable Arabic size.

## Storage and content

Study data and downloaded bundles live in
`~/Library/Application Support/Bayan/library.json`. Writes are atomic. The preview
uses JSON rather than the upstream SQLite engine. Secrets live only in the
service's private environment, not the app or repository.

Translations and tafsir use Quran Foundation Content Sync snapshots. The service
bootstraps and replaces complete snapshots at least every seven days on access.
The app refreshes older downloaded bundles on opening when connected. Offline
reading continues during outages. No QF database is shipped in the app.

Quran Arabic is unchanged. Resource HTML is converted to inert text. Translation
footnotes are retained separately. Word meanings are separate API data, not a
claimed word alignment for a published translation.

Audio streams; permanent audio downloads need separate recording rights. Personal
notes stay on the Mac. Content requests include the requested surah and resources.

## Preview limits

- This is a local preview, not a public release. It is ad-hoc signed, not notarized.
- Only content approved for this QF app appears; catalogs can differ by environment.
- Search is local to downloaded surahs; no approved server search scope is needed.
- No accounts, cloud sync, AI, or permanent audio downloads.
- Arabic-only reading flows across verses. Original note behavior is adapted into a modal popup.
- Content/font fidelity review, performance testing, signing,
  public-service rate limits, monitoring, and deployment remain before public launch.
- The service binds to localhost. Do not expose it publicly in its current form.

## Architecture and provenance

`apps/bayan-macos` is an AppKit shell with a local WebKit reader, so Apple's text
engine shapes Arabic and handles right-to-left text. `service/bayan` holds the
server-side QF integration. The original Rust implementation is retained for
reference; the Bayan target does not yet call its core. This avoids fitting Quran
references into a 66-book Bible model. Design and study interactions follow the
original. Original documentation is preserved in `docs/UPSTREAM-README.md`.

Code remains MIT with upstream copyright and third-party notices intact. Quran
content and recordings retain their separate source terms.

## Verify

```sh
node --test tests/bayan/core.test.cjs tests/bayan/service.test.mjs
bash scripts/build-bayan-macos.sh
```

Tests use synthetic fixtures rather than modified Quran content.
