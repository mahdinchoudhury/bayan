const { test } = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../apps/bayan-macos/Web/core.js");
test("Quran references respect the actual surah verse counts", () => {
  assert.equal(core.counts.length, 114);
  assert.equal(
    core.counts.reduce((a, b) => a + b),
    6236,
  );
  for (const key of ["1:7", "2:286", "114:6"]) assert.ok(core.validRef(key));
  for (const key of ["1:8", "2:287", "0:1", "115:1", "2:0", "2:1x"])
    assert.ok(!core.validRef(key));
});
test("Arabic search ignores vowel marks and alef variants", () => {
  assert.equal(core.normalize("إِنَّ"), core.normalize("ان"));
  assert.equal(
    core.search(
      [{ text_uthmani: "أَبْجَد", verse_key: "1:1", translations: [] }],
      "ابجد",
    ).length,
    1,
  );
});
test("backup rejects foreign content and invalid verse references", () => {
  assert.throws(() => core.validateBackup({ app: "Other" }));
  assert.throws(() =>
    core.validateBackup({
      app: "Bayan",
      version: 1,
      study: {
        "1:8": {
          note: "x",
          bookmark: false,
          color: null,
          updated: "2026-10-20",
        },
      },
    }),
  );
});
test("import preserves newer local notes", () => {
  const a = { note: "new", updated: "2026-10-20" },
    b = { note: "old", updated: "2026-09-01" };
  assert.equal(core.mergeStudy({ "1:1": a }, { "1:1": b })["1:1"].note, "new");
});
