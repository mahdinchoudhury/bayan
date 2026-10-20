const { test } = require("node:test");
const assert = require("node:assert/strict");
const { harness, fixture } = require("./harness.cjs");
async function scenario(t, options = {}) {
  const h = await harness(options);
  t.after(h.close);
  return h;
}
test("search opens hidden results sidebar", async (t) => {
  const h = await scenario(t);
  await h.click("sidebar-toggle");
  await h.input("search", "alpha");
  assert.ok(!h.$("sidebar").classList.contains("hidden"));
  assert.match(h.$("side-content").textContent, /matches/);
});
test("choosing a library tab exits search", async (t) => {
  const h = await scenario(t);
  await h.input("search", "alpha");
  h.w.document.querySelector('[data-tab="study"]').click();
  await h.settle();
  assert.equal(h.$("search").value, "");
  assert.match(h.$("side-content").textContent, /Bookmarks/);
});
test("invalid jump is explained inside the dialog", async (t) => {
  const h = await scenario(t);
  await h.click("jump-open");
  h.$("jump-input").value = "1:999";
  h.$("jump-form").dispatchEvent(new h.w.Event("submit", { cancelable: true }));
  await h.settle();
  assert.ok(h.$("jump-dialog").open);
  assert.ok(h.$("jump-dialog").querySelector('[role="alert"]')?.textContent);
});
test("Cmd+B does not also bookmark the selected verse", async (t) => {
  const h = await scenario(t);
  await h.key("b", { metaKey: true });
  assert.equal(!!h.state().study["1:2"]?.bookmark, false);
});
test("Cmd+number does not change highlight color", async (t) => {
  const h = await scenario(t);
  await h.key("3", { metaKey: true });
  assert.equal(h.state().study["1:2"]?.color, undefined);
});
test("note uses a non-modal popup like the original", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  assert.equal(h.$("note-dialog").dataset.modal, "false");
});
test("translation changes preserve reading reference", async (t) => {
  const h = await scenario(t);
  h.run('state.position.verse="1:5"; selected="1:5"');
  await h.click("settings-open");
  const box = [...h.$("translations-list").querySelectorAll("input")][1];
  box.click();
  await h.settle();
  assert.equal(h.state().position.verse, "1:5");
});
test("copy verse uses the native clipboard bridge", async (t) => {
  const h = await scenario(t);
  const copy = [...h.w.document.querySelectorAll("#verse-1\\:2 button")].find(
    (b) => b.textContent === "Copy",
  );
  copy.click();
  await h.settle();
  assert.ok(h.calls.some((c) => c.op === "copy"));
});
test("search finds alternate downloaded translation instead of losing duplicate verse bundles", async (t) => {
  const s = fixture();
  s.cache["1:20:169:6"] = JSON.parse(JSON.stringify(s.cache["1:85:169:6"]));
  s.cache["1:20:169:6"].verses.forEach(
    (v) =>
      (v.translations = v.translations.filter((t) => t.resource_id === 20)),
  );
  s.cache["1:85:169:6"].verses.forEach(
    (v) =>
      (v.translations = v.translations.filter((t) => t.resource_id === 85)),
  );
  const h = await scenario(t, { state: s });
  await h.input("search", "alpha 1:");
  assert.equal(h.$("side-content").querySelectorAll(".study-item").length, 7);
});
test("translation chooser enforces service maximum of five", async (t) => {
  const s = fixture();
  s.settings.translations = [85, 20, 19, 22, 84];
  const h = await scenario(t, { state: s });
  await h.click("settings-open");
  const unchecked = [
    ...h.$("translations-list").querySelectorAll("input"),
  ].find((i) => !i.checked);
  assert.ok(unchecked.disabled);
});
test("media pause button exposes the correct accessible action", async (t) => {
  const h = await scenario(t);
  await h.run('startAudio("1:2")');
  await h.click("play");
  assert.equal(h.$("play").getAttribute("aria-label"), "Play recitation");
});
test("offline resource changes keep Arabic available", async (t) => {
  const h = await scenario(t, {
    request: async () => {
      throw Error("Offline");
    },
  });
  h.run("state.settings.translations=[20]");
  await h.run('loadChapter(1,"1:2")');
  assert.ok(h.$("reader").textContent.includes("كلمة"));
});
test("theme button offers named choices without changing theme on open", async (t) => {
  const h = await scenario(t);
  await h.click("appearance");
  assert.equal(h.state().settings.theme, "light");
  assert.ok(h.$("appearance-menu").open);
  h.w.document.querySelector('[data-theme="dark"]').click();
  await h.settle();
  assert.equal(h.state().settings.theme, "dark");
  assert.equal(h.$("appearance-menu").open, false);
});
test("translation toolbar opens a focused chooser instead of all settings", async (t) => {
  const h = await scenario(t);
  await h.click("translation-open");
  assert.ok(h.$("translations-menu").open);
  assert.equal(h.$("settings").open, false);
  assert.equal(h.$("translations-menu").dataset.modal, "false");
});
test("last selected translation cannot be accidentally removed", async (t) => {
  const h = await scenario(t);
  await h.click("translation-open");
  const checked = h.$("translation-options").querySelector("input:checked");
  assert.ok(checked.disabled);
});
test("Escape dismisses non-modal theme chooser", async (t) => {
  const h = await scenario(t);
  await h.click("appearance");
  await h.key("Escape");
  assert.equal(h.$("appearance-menu").open, false);
});
test("word meaning hover and keyboard focus highlight both sides", async (t) => {
  const h = await scenario(t);
  await h.click("words");
  const pair = h.w.document.querySelector(".word-pair");
  pair.querySelector(".word").dispatchEvent(new h.w.Event("mouseenter"));
  assert.equal(pair.querySelectorAll(".linked").length, 2);
  pair.querySelector(".word").dispatchEvent(new h.w.Event("mouseleave"));
  assert.equal(pair.querySelectorAll(".linked").length, 0);
  pair.querySelector(".meaning").focus();
  assert.equal(pair.querySelectorAll(".linked").length, 2);
});
test("reading toggles retain the same verse", async (t) => {
  const h = await scenario(t);
  h.run('state.position.verse="1:5";selected="1:5"');
  await h.click("words");
  assert.equal(h.w.__lastScroll, "verse-1:5");
  await h.click("english");
  assert.equal(h.w.__lastScroll, "verse-1:5");
});
test("zero-padded and Arabic-digit references are canonicalized", async (t) => {
  const h = await scenario(t);
  await h.run('navigate("٠١:٠٥")');
  assert.equal(h.state().position.verse, "1:5");
  await h.run('navigate("01:06")');
  assert.equal(h.state().position.verse, "1:6");
});
test("Arabic surah names navigate without turning into empty-name matches", async (t) => {
  const s = fixture();
  s.chapters[0].name_arabic = "الفاتحة";
  const h = await scenario(t, { state: s });
  await h.run('navigate("الفاتحة")');
  assert.equal(h.state().position.chapter, 1);
  await assert.rejects(h.run('navigate("!!!")'));
});
test("rapid navigation cannot show an older response over a newer chapter", async (t) => {
  const waiting = new Map();
  const h = await scenario(t, {
    request: (url) =>
      new Promise((resolve) =>
        waiting.set(+new URL(url).pathname.split("/").at(-1), resolve),
      ),
  });
  const first = h.run('loadChapter(1,"1:5",true)');
  await h.settle();
  const second = h.run('loadChapter(2,"2:2",true)');
  await h.settle();
  const { bundle } = require("./harness.cjs");
  waiting.get(2)(bundle(2));
  await second;
  waiting.get(1)(bundle(1));
  await first;
  assert.equal(h.state().position.chapter, 2);
  assert.match(h.$("reader").textContent, /Al-Baqarah/);
});
test("failed navigation stays in jump dialog with an explanation", async (t) => {
  const s = fixture();
  delete s.cache["114:85:169:6"];
  const h = await scenario(t, {
    state: s,
    request: async () => {
      throw Error("Offline");
    },
  });
  await h.click("jump-open");
  h.$("jump-input").value = "114:1";
  h.$("jump-form").dispatchEvent(new h.w.Event("submit", { cancelable: true }));
  await h.settle();
  assert.equal(h.state().position.chapter, 1);
  assert.ok(h.$("jump-dialog").open);
  assert.match(
    h.$("jump-dialog").querySelector('[role="alert"]').textContent,
    /Offline/,
  );
});
test("a failed connection preserves the previous working service address", async (t) => {
  const h = await scenario(t, {
    request: async () => {
      throw Error("Unreachable");
    },
  });
  await h.click("settings-open");
  h.$("service-url").value = "https://example.invalid";
  await h.click("connect");
  assert.equal(h.state().settings.service, "http://127.0.0.1:8787");
  assert.match(h.$("connection-status").textContent, /Unreachable/);
  assert.equal(h.$("connect").disabled, false);
});
test("notes save before opening a different verse note", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Draft A";
  await h.run("openNote(current.verses[2])");
  assert.equal(h.state().study["1:2"].note, "Draft A");
  assert.equal(h.$("note-body").value, "");
  assert.match(h.$("note-title").textContent, /1:3/);
});
test("notes save on Escape", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Escape draft";
  await h.key("Escape");
  assert.equal(h.$("note-dialog").open, false);
  assert.equal(h.saved.at(-1).study["1:2"].note, "Escape draft");
});
test("an immediate app quit flushes a draft before the debounce fires", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Immediate quit";
  await h.w.prepareToClose();
  assert.equal(h.saved.at(-1).study["1:2"].note, "Immediate quit");
});
test("failed note save keeps editor open and draft intact", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Keep this draft";
  h.options.saveFailure = true;
  const done = [...h.$("note-dialog").querySelectorAll("button")].find(
    (b) => b.textContent === "Done",
  );
  done.click();
  await h.settle();
  assert.ok(h.$("note-dialog").open);
  assert.equal(h.$("note-body").value, "Keep this draft");
  assert.match(
    h.$("note-dialog").querySelector('[role="alert"]').textContent,
    /Disk unavailable/,
  );
  h.options.saveFailure = false;
  done.click();
  await h.settle();
  assert.equal(h.$("note-dialog").open, false);
});
test("delete note preserves its bookmark and highlight", async (t) => {
  const s = fixture();
  s.study["1:2"] = {
    note: "Temporary note",
    bookmark: true,
    color: "blue",
    updated: new Date().toISOString(),
  };
  const h = await scenario(t, { state: s });
  await h.run("openNote(current.verses[1])");
  await h.click("delete-note");
  assert.equal(h.state().study["1:2"].note, "");
  assert.equal(h.state().study["1:2"].bookmark, true);
  assert.equal(h.state().study["1:2"].color, "blue");
});
test("typing and modified keys never run verse highlight shortcuts", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  await h.key("4");
  await h.key("b");
  assert.equal(h.state().study["1:2"], undefined);
});
test("study actions do not run when using a focused control", async (t) => {
  const h = await scenario(t);
  h.$("words").focus();
  await h.key("ArrowRight");
  assert.equal(h.state().position.chapter, 1);
});
test("failed audio playback reports error and leaves Play action", async (t) => {
  const h = await scenario(t, { playFailure: true });
  await h.run('startAudio("1:2")');
  assert.equal(h.$("play").getAttribute("aria-label"), "Play recitation");
  assert.match(h.$("notice").textContent, /Playback rejected/);
});
test("stop after verse stops rather than advancing", async (t) => {
  const h = await scenario(t);
  await h.change("stop", "verse");
  await h.run('startAudio("1:2")');
  await h.$("audio").onended();
  assert.equal(h.run("playingKey"), "1:2");
  assert.equal(h.$("play").getAttribute("aria-label"), "Play recitation");
});
test("repeat count repeats a verse before advancing", async (t) => {
  const h = await scenario(t);
  await h.change("repeat", "2");
  await h.run('startAudio("1:2")');
  await h.$("audio").onended();
  assert.equal(h.run("playingKey"), "1:2");
  await h.$("audio").onended();
  assert.equal(h.run("playingKey"), "1:3");
});
test("audio can continue while browsing without moving reader selection into another surah", async (t) => {
  const h = await scenario(t);
  await h.run('startAudio("1:2")');
  await h.run('loadChapter(2,"2:2")');
  await h.$("audio").onended();
  assert.equal(h.state().position.chapter, 2);
  assert.equal(h.run("selected"), "2:2");
  assert.equal(h.run("playingKey"), "1:3");
});
test("changing reciter cancels existing audio and preserves reader anchor", async (t) => {
  const h = await scenario(t);
  await h.run('startAudio("1:5")');
  h.run('state.position.verse="1:5"');
  h.$("reciter").value = "7";
  h.$("reciter").dispatchEvent(new h.w.Event("change"));
  await h.settle();
  assert.equal(h.run("playingKey"), null);
  assert.equal(h.state().position.verse, "1:5");
  assert.equal(h.$("play").getAttribute("aria-label"), "Play recitation");
});
test("tafsir updates when a new surah is opened", async (t) => {
  const h = await scenario(t);
  h.run("openTafsir(current.verses[1])");
  await h.run('loadChapter(2,"2:2")');
  assert.match(h.$("tafsir-content").textContent, /2:2/);
  assert.ok(!h.$("tafsir-content").textContent.includes("1:2"));
});
test("removing a download keeps notes and the currently visible reading", async (t) => {
  const s = fixture();
  s.study["1:2"] = {
    note: "Keep me",
    bookmark: false,
    color: null,
    updated: new Date().toISOString(),
  };
  const h = await scenario(t, { state: s });
  await h.click("downloads-open");
  h.$("download-list").querySelector("button").click();
  await h.settle();
  assert.equal(h.state().study["1:2"].note, "Keep me");
  assert.ok(h.$("reader").textContent.includes("كلمة"));
  assert.ok(!Object.keys(h.state().cache).some((k) => k.startsWith("1:")));
});
test("download cancellation keeps completed copies and prevents a late response from being saved", async (t) => {
  let finish;
  const h = await scenario(t, {
    request: () => new Promise((resolve) => (finish = resolve)),
  });
  await h.click("downloads-open");
  h.$("download-all").click();
  await h.settle();
  assert.ok(h.$("download-all").disabled);
  await h.click("download-cancel");
  const { bundle } = require("./harness.cjs");
  finish({ ...bundle(1), cancelledMarker: true });
  await h.settle();
  assert.equal(h.state().cache["1:85:169:6"].cancelledMarker, undefined);
  assert.match(h.$("download-status").textContent, /stopped/);
});
test("download records use options at start even if preferences change mid-request", async (t) => {
  let finish;
  const h = await scenario(t, {
    request: () => new Promise((resolve) => (finish = resolve)),
  });
  const promise = h.run("downloadChapter(1)");
  await h.settle();
  h.run("state.settings.reciter=7;state.settings.translations=[20]");
  const { bundle } = require("./harness.cjs");
  finish({ ...bundle(1), startedMarker: true });
  await promise;
  assert.equal(h.state().cache["1:85:169:6"].startedMarker, true);
  assert.equal(h.state().cache["1:20:169:7"], undefined);
});
test("invalid import is rejected without changing existing notes", async (t) => {
  const s = fixture();
  s.study["1:2"] = {
    note: "Existing",
    bookmark: false,
    color: null,
    updated: new Date().toISOString(),
  };
  const h = await scenario(t, { state: s, importData: { app: "Other" } });
  await h.click("settings-open");
  await h.click("import-json");
  assert.equal(h.state().study["1:2"].note, "Existing");
  assert.ok(h.$("settings").querySelector('[role="alert"]'));
});
test("JSON and Markdown exports contain personal study data, without empty deleted-note sections", async (t) => {
  const s = fixture();
  s.study["1:2"] = {
    note: "My note",
    bookmark: true,
    color: null,
    updated: new Date().toISOString(),
  };
  s.study["1:3"] = {
    note: "",
    bookmark: false,
    color: null,
    updated: new Date().toISOString(),
  };
  const h = await scenario(t, { state: s });
  await h.click("settings-open");
  await h.click("export-json");
  await h.click("export-md");
  const exports = h.calls.filter((c) => c.op === "export");
  assert.equal(JSON.parse(exports[0].text).study["1:2"].note, "My note");
  assert.ok(exports[1].text.includes("My note"));
  assert.ok(!exports[1].text.includes("1:3"));
});
test("disconnected controls explain setup rather than pretending content is available", async (t) => {
  const s = fixture();
  s.chapters = [];
  s.resources = { translations: [], tafsirs: [], reciters: [] };
  s.cache = {};
  const h = await scenario(t, { state: s });
  assert.ok(h.$("english").disabled);
  assert.ok(h.$("words").disabled);
  assert.ok(h.$("play").disabled);
  assert.ok(h.$("back").disabled);
  await h.click("downloads-open");
  assert.ok(h.$("download-all").disabled);
});
test("surah arrows change chapter and stop at Quran boundaries", async (t) => {
  const h = await scenario(t);
  assert.ok(h.$("back").disabled);
  await h.click("forward");
  assert.equal(h.state().position.chapter, 2);
  await h.run("loadChapter(114)");
  assert.ok(h.$("forward").disabled);
});
test("sidebar control exposes its expanded state", async (t) => {
  const h = await scenario(t);
  await h.click("sidebar-toggle");
  assert.equal(h.$("sidebar-toggle").getAttribute("aria-expanded"), "false");
  await h.click("sidebar-toggle");
  assert.equal(h.$("sidebar-toggle").getAttribute("aria-expanded"), "true");
});
test("font slider changes and saves the reading size", async (t) => {
  const h = await scenario(t);
  await h.click("settings-open");
  await h.input("font-size", "44");
  assert.equal(h.state().settings.fontSize, 44);
  assert.equal(
    h.w.document.documentElement.style.getPropertyValue("--arabic-size"),
    "44px",
  );
  assert.equal(h.saved.at(-1).settings.fontSize, 44);
});
test("a note autosaves after typing stops", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Autosaved draft";
  h.$("note-body").dispatchEvent(new h.w.Event("input"));
  await new Promise((r) => setTimeout(r, 1250));
  await h.settle();
  assert.equal(h.saved.at(-1).study["1:2"].note, "Autosaved draft");
  assert.match(h.$("saved-status").textContent, /Saved/);
});
test("outside click saves and dismisses the note popup", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Outside click";
  h.$("reader").dispatchEvent(new h.w.Event("pointerdown", { bubbles: true }));
  await h.settle();
  assert.equal(h.$("note-dialog").open, false);
  assert.equal(h.saved.at(-1).study["1:2"].note, "Outside click");
});
test("note highlights can be toggled without discarding a draft", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Draft beside highlight";
  h.$("highlight-colors").querySelector("button").click();
  await h.settle();
  assert.equal(h.state().study["1:2"].color, "yellow");
  assert.equal(h.$("note-body").value, "Draft beside highlight");
  h.$("highlight-colors").querySelector("button").click();
  await h.settle();
  assert.equal(h.state().study["1:2"].color, null);
});
test("bookmark and highlight shortcuts apply only once and clear correctly", async (t) => {
  const h = await scenario(t);
  await h.key("b");
  assert.equal(h.state().study["1:2"].bookmark, true);
  await h.key("b");
  assert.equal(h.state().study["1:2"].bookmark, false);
  await h.key("6");
  assert.equal(h.state().study["1:2"].color, "orange");
  await h.key("0");
  assert.equal(h.state().study["1:2"].color, null);
});
test("comparison renders each selected translation under the Arabic", async (t) => {
  const h = await scenario(t);
  await h.click("translation-open");
  const box = [...h.$("translation-options").querySelectorAll("input")].find(
    (i) => !i.checked,
  );
  box.click();
  await h.settle();
  assert.equal(
    h.w.document.getElementById("verse-1:2").querySelectorAll(".translation")
      .length,
    2,
  );
  assert.ok(h.w.document.getElementById("verse-1:2").querySelector(".arabic"));
});
test("tafsir source changes do not keep the previous commentary", async (t) => {
  const h = await scenario(t);
  h.run("openTafsir(current.verses[1])");
  await h.change("tafsir-choice", "168");
  assert.match(h.$("tafsir-content").textContent, /Synthetic commentary 168/);
});
test("speed, repeat and stopping preferences survive reader rerenders", async (t) => {
  const h = await scenario(t);
  await h.change("speed", "1.5");
  await h.change("repeat", "3");
  await h.change("stop", "verse");
  await h.click("words");
  assert.equal(h.$("speed").value, "1.5");
  assert.equal(h.$("repeat").value, "3");
  assert.equal(h.$("stop").value, "verse");
  assert.equal(h.saved.at(-1).settings.playbackSpeed, 1.5);
});
test("continuous repeat does not advance verses", async (t) => {
  const h = await scenario(t);
  await h.change("repeat", "0");
  await h.run('startAudio("1:2")');
  for (let i = 0; i < 4; i++) await h.$("audio").onended();
  assert.equal(h.run("playingKey"), "1:2");
});
test("surah playback ends after its final verse", async (t) => {
  const h = await scenario(t);
  await h.run('startAudio("1:7")');
  await h.$("audio").onended();
  assert.equal(h.run("playingKey"), "1:7");
  assert.equal(h.$("play").getAttribute("aria-label"), "Play recitation");
});
test("a late playback promise cannot overwrite a newer verse", async (t) => {
  const h = await scenario(t);
  const waiting = [];
  h.$("audio").play = () => new Promise((r) => waiting.push(r));
  const first = h.run('startAudio("1:2")');
  const second = h.run('startAudio("1:3")');
  waiting[1]();
  await second;
  waiting[0]();
  await first;
  assert.match(h.$("playing-reference").textContent, /1:3/);
});
test("a failed download re-enables controls and keeps previous copies", async (t) => {
  const h = await scenario(t, {
    request: async () => {
      throw Error("Rate limited");
    },
  });
  await h.click("downloads-open");
  await h.click("download-current");
  assert.match(h.$("download-status").textContent, /Rate limited/);
  assert.equal(h.$("download-current").disabled, false);
  assert.ok(h.state().cache["1:85:169:6"]);
});
test("copying does not silently select a different verse", async (t) => {
  const h = await scenario(t);
  const row = h.w.document.getElementById("verse-1:5");
  [...row.querySelectorAll("button")]
    .find((b) => b.textContent === "Copy")
    .click();
  await h.settle();
  assert.equal(h.run("selected"), "1:2");
  assert.ok(h.calls.some((c) => c.op === "copy" && c.text.endsWith("1:5")));
});
test("the quit handshake rejects when the final save fails", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("note-body").value = "Do not lose me";
  h.options.saveFailure = true;
  await assert.rejects(h.w.prepareToClose(), /Disk unavailable/);
  assert.ok(h.$("note-dialog").open);
  assert.equal(h.$("note-body").value, "Do not lose me");
});
test("sidebar preference survives rerender and restart", async (t) => {
  const h = await scenario(t);
  await h.click("sidebar-toggle");
  await h.click("words");
  assert.equal(h.$("sidebar").classList.contains("hidden"), true);
  assert.equal(h.saved.at(-1).settings.sidebarHidden, true);
  const next = await harness({ state: h.saved.at(-1) });
  t.after(next.close);
  assert.equal(next.$("sidebar").classList.contains("hidden"), true);
});
test("appearance chooser focuses the current theme", async (t) => {
  const s = fixture();
  s.settings.theme = "sepia";
  const h = await scenario(t, { state: s });
  await h.click("appearance");
  assert.equal(h.w.document.activeElement.dataset.theme, "sepia");
});
test("backup success is visible inside Settings", async (t) => {
  const h = await scenario(t);
  await h.click("settings-open");
  await h.click("export-json");
  assert.match(h.$("study-status").textContent, /saved/);
});

test("outside note dismissal preserves search focus", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  h.$("search").focus();
  await h.run("closeNote()");
  assert.equal(h.w.document.activeElement.id, "search");
});
test("Escape from notes returns focus to the verse", async (t) => {
  const h = await scenario(t);
  await h.run("openNote(current.verses[1])");
  await h.key("Escape");
  assert.equal(h.w.document.activeElement.id, "verse-1:2");
});
test("Escape from appearance returns focus to its opener", async (t) => {
  const h = await scenario(t);
  await h.click("appearance");
  await h.key("Escape");
  assert.equal(h.w.document.activeElement.id, "appearance");
});
