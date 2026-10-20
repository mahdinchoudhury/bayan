"use strict";
const $ = (id) => document.getElementById(id),
  C = BayanCore;
let serial = 0,
  pending = new Map();
function native(op, extra = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    window.webkit.messageHandlers.bayan.postMessage({ id, op, ...extra });
  });
}
window.nativeReply = (message) => {
  const p = pending.get(message.id);
  if (!p) return;
  pending.delete(message.id);
  message.error ? p.reject(Error(message.error)) : p.resolve(message.value);
};
let state = {
  version: 1,
  settings: {
    service: "http://127.0.0.1:8787",
    english: false,
    words: false,
    translations: [],
    tafsir: null,
    reciter: null,
    theme: "light",
    fontSize: 36,
  },
  study: {},
  chapters: [],
  resources: { translations: [], tafsirs: [], reciters: [] },
  cache: {},
  position: { chapter: 1, verse: null },
};
let selected = null,
  tab = "surahs",
  current = null,
  requestGeneration = 0,
  noteKey = null,
  noteTimer = null,
  saveChain = Promise.resolve(),
  repeatCount = 0,
  playingKey = null,
  searchTimer = null;
const colors = {
  yellow: "#f3e5a1",
  green: "#cae1b5",
  blue: "#c6dced",
  pink: "#edc9d6",
  purple: "#dbcfec",
  orange: "#efcfb0",
};
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, action, cls) {
  const b = el("button", text, cls);
  b.type = "button";
  b.onclick = action;
  return b;
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function showError(error) {
  notice(error.message || String(error));
}
function save() {
  const snapshot = JSON.parse(JSON.stringify(state));
  saveChain = saveChain
    .catch(() => {})
    .then(() => native("save", { value: snapshot }));
  saveChain.catch((e) =>
    notice("Your changes could not be saved: " + e.message),
  );
  return saveChain;
}
function entry(key) {
  return (
    state.study[key] || {
      note: "",
      bookmark: false,
      color: null,
      updated: new Date().toISOString(),
    }
  );
}
function updateEntry(key, patch) {
  state.study[key] = {
    ...entry(key),
    ...patch,
    updated: new Date().toISOString(),
  };
  save();
  renderSidebar();
}
function chapterName(id) {
  return state.chapters.find((c) => c.id === +id)?.name_simple || "Surah " + id;
}
function verseByKey(key) {
  return (
    current?.verses?.find((v) => v.verse_key === key) ||
    Object.values(state.cache)
      .flatMap((c) => c.verses || [])
      .find((v) => v.verse_key === key)
  );
}
function plain(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return doc.body.textContent || "";
}
function resourceName(kind, id) {
  return state.resources[kind]?.find((r) => r.id === +id)?.name || String(id);
}
function cacheKey(chapter = state.position.chapter) {
  return `${chapter}:${[...state.settings.translations].sort((a, b) => a - b).join(",")}:${state.settings.tafsir || ""}:${state.settings.reciter || ""}`;
}
async function api(path) {
  const base = state.settings.service.replace(/\/$/, "");
  if (!base) throw Error("Set a content service address in Settings.");
  return native("request", { url: base + path });
}
function applySettings() {
  document.body.className =
    state.settings.theme === "light" ? "" : state.settings.theme;
  document.documentElement.style.setProperty(
    "--arabic-size",
    state.settings.fontSize + "px",
  );
  $("english").setAttribute("aria-pressed", String(state.settings.english));
  $("words").setAttribute("aria-pressed", String(state.settings.words));
  $("service-url").value = state.settings.service;
  $("font-size").value = state.settings.fontSize;
}
function renderResources() {
  for (const [id, kind, value] of [
    ["reciter", "reciters", state.settings.reciter],
    ["tafsir-choice", "tafsirs", state.settings.tafsir],
  ]) {
    const select = $(id);
    select.replaceChildren();
    for (const r of state.resources[kind] || []) {
      const o = el("option", r.name);
      o.value = r.id;
      select.append(o);
    }
    if (!select.options.length)
      select.append(el("option", "Connect to load " + kind));
    else select.value = value || select.options[0].value;
  }
  const list = $("translations-list");
  list.replaceChildren();
  if (!state.resources.translations.length)
    list.append(
      el(
        "p",
        "Connect to Quran Foundation to choose published English translations.",
        "muted",
      ),
    );
  for (const r of state.resources.translations) {
    const row = el("label", undefined, "source-choice"),
      input = el("input");
    input.type = "checkbox";
    input.checked = state.settings.translations.includes(r.id);
    input.onchange = async () => {
      if (input.checked) state.settings.translations.push(r.id);
      else
        state.settings.translations = state.settings.translations.filter(
          (id) => id !== r.id,
        );
      save();
      await loadChapter(state.position.chapter);
    };
    row.append(
      input,
      el("span", r.name + (r.author_name ? " — " + r.author_name : "")),
    );
    list.append(row);
  }
}
function renderSidebar() {
  const host = $("side-content");
  host.replaceChildren();
  const query = $("search").value.trim();
  if (query) {
    const verses = new Map();
    for (const bundle of Object.values(state.cache))
      for (const v of bundle.verses || []) verses.set(v.verse_key, v);
    const results = C.search([...verses.values()], query);
    host.append(
      el("p", `${results.length} matches in downloaded text`, "side-label"),
    );
    for (const v of results.slice(0, 150)) {
      const b = button("", () => navigate(v.verse_key), "study-item");
      b.append(
        el("strong", `${chapterName(v.chapter_id)} ${v.verse_key}`),
        el(
          "p",
          plain(v.translations?.[0]?.text || v.text_uthmani).slice(0, 180),
        ),
      );
      host.append(b);
    }
    return;
  }
  if (tab === "study") {
    for (const [title, test] of [
      ["Notes", (s) => s.note],
      ["Bookmarks", (s) => s.bookmark],
      ["Highlights", (s) => s.color],
    ]) {
      host.append(el("p", title, "side-label"));
      const rows = Object.entries(state.study).filter(([, s]) => test(s));
      if (!rows.length)
        host.append(el("p", "No " + title.toLowerCase() + " yet.", "muted"));
      for (const [key, s] of rows) {
        const b = button("", () => navigate(key), "study-item");
        b.append(el("strong", `${chapterName(key.split(":")[0])} ${key}`));
        if (s.note) b.append(el("p", s.note.slice(0, 100)));
        host.append(b);
      }
    }
    return;
  }
  if (tab === "juz") {
    for (let n = 1; n <= 30; n++)
      host.append(
        button(
          "Juz " + n,
          async () => {
            try {
              const result = await api("/v1/juz/" + n);
              await navigate(result.verse_key);
            } catch (e) {
              showError(e);
            }
          },
          "surah",
        ),
      );
    return;
  }
  if (!state.chapters.length) {
    host.append(
      el("p", "Your Quran library will appear here when connected.", "muted"),
    );
    return;
  }
  for (const c of state.chapters) {
    const b = button(
      "",
      () => loadChapter(c.id),
      "surah" + (c.id === state.position.chapter ? " active" : ""),
    );
    const name = el("span", undefined, "name");
    name.append(
      el("span", c.name_simple),
      el(
        "small",
        (c.translated_name?.name || "") + " · " + c.verses_count + " verses",
      ),
    );
    b.append(
      el("span", String(c.id).padStart(2, "0"), "number"),
      name,
      el("span", c.name_arabic, "arabic-name"),
    );
    host.append(b);
  }
}
function emptyReader(title, body) {
  const empty = el("div", undefined, "empty");
  empty.append(
    el("div", "B", "emblem"),
    el("h1", title),
    el("p", body),
    button("Connect Quran Foundation", () => openSettings(), "primary"),
    el("p", "Your reading. Your reflections. On your Mac.", "caption"),
  );
  $("reader").replaceChildren(empty);
}
function renderReader() {
  applySettings();
  if (!current?.verses?.length) {
    emptyReader(
      "A quiet place for the Quran",
      "Read in Arabic. Explore the meaning. Keep your reflections close. Connect your Quran Foundation service to begin.",
    );
    return;
  }
  const reader = $("reader");
  reader.replaceChildren();
  const chapter = state.chapters.find((c) => c.id === state.position.chapter);
  const heading = el("header", undefined, "surah-heading");
  heading.append(
    el("div", chapter?.name_arabic || "", "arabic-title"),
    el("h1", chapter?.name_simple || chapterName(state.position.chapter)),
    el(
      "p",
      [
        chapter?.translated_name?.name,
        `${current.verses.length} verses`,
        chapter?.revelation_place,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  reader.append(heading);
  if (!state.settings.english && !state.settings.words) {
    renderFlow(reader);
    return;
  }
  for (const v of current.verses) {
    const s = entry(v.verse_key),
      row = el("article", undefined, "verse");
    row.id = "verse-" + v.verse_key;
    row.dataset.key = v.verse_key;
    row.classList.toggle("selected", selected === v.verse_key);
    row.classList.toggle("playing", playingKey === v.verse_key);
    if (s.color) row.style.backgroundColor = colors[s.color] + "55";
    const tools = el("div", undefined, "verse-tools");
    tools.append(
      el("span", v.verse_key, "ref"),
      button(s.bookmark ? "◆" : "◇", () => {
        updateEntry(v.verse_key, { bookmark: !entry(v.verse_key).bookmark });
        renderReader();
      }),
      button(s.note ? "Note •" : "Note", () => openNote(v)),
      button("Tafsir", () => openTafsir(v)),
      button("Listen", () => startAudio(v.verse_key)),
      button("Copy", () =>
        navigator.clipboard
          .writeText(
            (v.text_uthmani || "") +
              "\n" +
              (state.settings.english
                ? (v.translations || []).map((t) => plain(t.text)).join("\n") +
                  "\n"
                : "") +
              v.verse_key,
          )
          .catch(showError),
      ),
    );
    row.append(tools);
    row.onclick = () => {
      selected = v.verse_key;
      state.position.verse = selected;
      for (const node of reader.querySelectorAll(".verse"))
        node.classList.toggle("selected", node.dataset.key === selected);
      save();
    };
    const words = (v.words || []).filter((w) => w.char_type_name === "word");
    if (state.settings.words && words.length) {
      const grid = el("div", undefined, "word-grid");
      grid.setAttribute("translate", "no");
      for (const w of words) {
        const pair = el("div", undefined, "word-pair"),
          a = el("span", w.text_uthmani || w.text || "", "arabic word"),
          meaning = el("span", plain(w.translation?.text || ""), "meaning");
        a.lang = "ar";
        a.dir = "rtl";
        a.tabIndex = 0;
        meaning.tabIndex = 0;
        for (const n of [a, meaning]) {
          const highlight = (on) => {
            a.classList.toggle("linked", on);
            meaning.classList.toggle("linked", on);
          };
          n.onmouseenter = () => highlight(true);
          n.onmouseleave = () => highlight(false);
          n.onfocus = () => highlight(true);
          n.onblur = () => highlight(false);
        }
        pair.append(a, meaning);
        grid.append(pair);
      }
      row.append(grid);
    } else {
      const a = el("div", v.text_uthmani || "", "arabic flow");
      a.lang = "ar";
      a.dir = "rtl";
      a.setAttribute("translate", "no");
      row.append(a);
    }
    if (state.settings.english)
      for (const t of v.translations || []) {
        const p = el("div", plain(t.text), "translation");
        p.append(
          el("span", resourceName("translations", t.resource_id), "source"),
        );
        row.append(p);
        if (t.foot_notes?.length) {
          const details = el("details", undefined, "footnote");
          details.append(el("summary", "Translation footnotes"));
          for (const f of t.foot_notes) details.append(el("p", plain(f.text)));
          row.append(details);
        }
      }
    reader.append(row);
  }
  reader.append(
    el(
      "p",
      "Content: Quran Foundation. Translation and tafsir sources are named alongside their text.",
      "muted",
    ),
  );
  $("back").disabled = state.position.chapter <= 1;
  $("forward").disabled = state.position.chapter >= 114;
}
function renderFlow(reader) {
  const actions = el("div", undefined, "flow-actions");
  if (selected) {
    const v = current.verses.find((v) => v.verse_key === selected);
    if (v) {
      actions.append(
        el("span", v.verse_key),
        button("Note", () => openNote(v)),
        button(entry(selected).bookmark ? "Bookmarked" : "Bookmark", () => {
          updateEntry(selected, { bookmark: !entry(selected).bookmark });
          renderReader();
        }),
        button("Tafsir", () => openTafsir(v)),
        button("Listen", () => startAudio(v.verse_key)),
      );
    }
  } else
    actions.append(
      el("span", "Select a verse to add a note, bookmark, or listen."),
    );
  reader.append(actions);
  const flow = el("div", undefined, "arabic flowing-page");
  flow.lang = "ar";
  flow.dir = "rtl";
  flow.setAttribute("translate", "no");
  for (const v of current.verses) {
    const span = el("span", v.text_uthmani || "", "flow-verse");
    span.id = "verse-" + v.verse_key;
    span.tabIndex = 0;
    span.setAttribute("role", "button");
    span.setAttribute("aria-label", v.verse_key + " " + v.text_uthmani);
    const s = entry(v.verse_key);
    if (s.color) span.style.backgroundColor = colors[s.color] + "55";
    if (selected === v.verse_key) span.classList.add("selected");
    if (playingKey === v.verse_key) span.classList.add("playing");
    const marker = el("span", " ﴿" + v.verse_number + "﴾ ", "end-mark");
    span.append(marker);
    const choose = () => {
      selected = v.verse_key;
      state.position.verse = selected;
      save();
      renderReader();
    };
    span.onclick = choose;
    span.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    };
    flow.append(span, document.createTextNode(" "));
  }
  reader.append(flow, el("p", "Arabic text: Quran Foundation", "muted"));
  $("back").disabled = state.position.chapter <= 1;
  $("forward").disabled = state.position.chapter >= 114;
}
async function loadChapter(id, verse = null, force = false) {
  id = Number(id);
  if (!Number.isInteger(id) || id < 1 || id > 114) return;
  const generation = ++requestGeneration;
  state.position = { chapter: id, verse };
  selected = verse;
  save();
  renderSidebar();
  const key = cacheKey(id);
  current = state.cache[key] || null;
  renderReader();
  if (!force && current && Date.now() - current.savedAt < 7 * 86400000) {
    if (verse) scrollToVerse(verse);
    return;
  }
  try {
    notice("Loading " + chapterName(id) + "…");
    const query = new URLSearchParams({
      translations: state.settings.translations.join(","),
      tafsir: state.settings.tafsir || "",
      reciter: state.settings.reciter || "",
    });
    const bundle = await api(`/v1/chapter/${id}?${query}`);
    bundle.savedAt = Date.now();
    state.cache[key] = bundle;
    await save();
    if (generation !== requestGeneration) return;
    current = bundle;
    notice("");
    renderReader();
    renderSidebar();
    if (verse) scrollToVerse(verse);
  } catch (e) {
    if (generation !== requestGeneration) return;
    notice(current ? "Offline copy · " + e.message : e.message);
    if (!current) emptyReader("Your library is not connected", e.message);
  }
}
function scrollToVerse(key) {
  requestAnimationFrame(() =>
    document
      .getElementById("verse-" + key)
      ?.scrollIntoView({ block: "center" }),
  );
}
async function navigate(value) {
  value = String(value).trim();
  if (C.validRef(value)) {
    await loadChapter(+value.split(":")[0], value);
    return;
  }
  if (/^\d+$/.test(value) && +value >= 1 && +value <= 114) {
    await loadChapter(+value);
    return;
  }
  const c = state.chapters.find(
    (c) =>
      C.normalize(c.name_simple).replace(/[^a-z]/g, "") ===
      C.normalize(value).replace(/[^a-z]/g, ""),
  );
  if (c) {
    await loadChapter(c.id);
    return;
  }
  throw Error("Enter a valid reference, such as 2:255, or a surah name.");
}
function openSettings() {
  renderResources();
  $("settings").showModal();
}
async function connect() {
  $("connection-status").textContent = "Connecting…";
  state.settings.service = $("service-url").value.trim();
  await save();
  try {
    const result = await api("/v1/catalog");
    state.chapters = result.chapters;
    state.resources = result.resources;
    for (const [kind, field] of [
      ["tafsirs", "tafsir"],
      ["reciters", "reciter"],
    ])
      if (!state.resources[kind].some((r) => r.id === state.settings[field]))
        state.settings[field] = state.resources[kind][0]?.id || null;
    state.settings.translations = state.settings.translations.filter((id) =>
      state.resources.translations.some((r) => r.id === id),
    );
    if (
      !state.settings.translations.length &&
      state.resources.translations.length
    )
      state.settings.translations = [
        (
          state.resources.translations.find((r) => r.id === 131) ||
          state.resources.translations[0]
        ).id,
      ];
    await save();
    renderResources();
    renderSidebar();
    $("connection-status").textContent =
      "Connected · " +
      (result.environment === "production"
        ? "Full Quran access"
        : "Pre-live: surahs 1 and 2 only");
    await loadChapter(state.position.chapter, null, true);
  } catch (e) {
    $("connection-status").textContent = e.message;
  }
}
function openNote(v) {
  flushNote();
  noteKey = v.verse_key;
  $("note-title").textContent = chapterName(v.chapter_id) + " " + v.verse_key;
  $("note-quote").textContent = plain(v.translations?.[0]?.text || "");
  $("note-body").value = entry(noteKey).note;
  renderSwatches();
  $("saved-status").textContent = entry(noteKey).note
    ? "Saved on this Mac"
    : "Personal note";
  $("note-dialog").showModal();
  $("note-body").focus();
}
function renderSwatches() {
  const host = $("highlight-colors");
  host.replaceChildren();
  for (const [name, color] of Object.entries(colors)) {
    const b = button(
      "",
      () => {
        updateEntry(noteKey, {
          color: entry(noteKey).color === name ? null : name,
        });
        renderSwatches();
        renderReader();
      },
      "swatch",
    );
    b.style.backgroundColor = color;
    b.title = name;
    b.setAttribute("aria-label", name + " highlight");
    b.setAttribute("aria-pressed", String(entry(noteKey).color === name));
    host.append(b);
  }
}
async function flushNote() {
  clearTimeout(noteTimer);
  if (!noteKey) return;
  const key = noteKey,
    body = $("note-body").value;
  if (body !== entry(key).note) updateEntry(key, { note: body });
  await save();
  $("saved-status").textContent =
    "Saved " +
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function openTafsir(v) {
  selected = v.verse_key;
  $("tafsir-panel").hidden = false;
  const tafsirs = v.tafsirs || [];
  const t = tafsirs.find((t) => +t.resource_id === +state.settings.tafsir);
  $("tafsir-content").textContent =
    `${chapterName(v.chapter_id)} ${v.verse_key}\n\n${t ? plain(t.text) : "No tafsir is downloaded for this verse. Choose an available source and download the surah."}`;
}
async function startAudio(key) {
  try {
    const v = verseByKey(key);
    if (!v) throw Error("Download this surah before playing it.");
    if (!v.audio?.url)
      throw Error("This recitation is not available. Choose another reciter.");
    const url = new URL(v.audio.url, "https://verses.quran.com/");
    if (url.protocol !== "https:")
      throw Error("The audio source must use HTTPS.");
    playingKey = key;
    selected = key;
    repeatCount = 0;
    $("audio").src = url.href;
    $("audio").playbackRate = +$("speed").value;
    await $("audio").play();
    $("playing-reference").textContent = chapterName(v.chapter_id) + " " + key;
    $("playing-status").textContent = resourceName(
      "reciters",
      state.settings.reciter,
    );
    $("play").textContent = "Ⅱ";
    $("play").setAttribute("aria-label", "Pause recitation");
    renderReader();
    scrollToVerse(key);
  } catch (e) {
    showError(e);
  }
}
$("audio").onended = async () => {
  repeatCount++;
  const repeats = +$("repeat").value;
  if (repeats === 0 || repeatCount < repeats) {
    $("audio").currentTime = 0;
    $("audio").play().catch(showError);
    return;
  }
  if ($("stop").value === "surah" && playingKey) {
    const [ch, number] = playingKey.split(":").map(Number);
    if (number < C.counts[ch - 1]) {
      await startAudio(ch + ":" + (number + 1));
      return;
    }
  }
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Play recitation");
};
$("audio").onerror = () => {
  if ($("audio").getAttribute("src")) {
    $("playing-status").textContent =
      "Audio unavailable. Check your connection.";
    $("play").textContent = "▶";
  }
};
function backup() {
  return {
    app: "Bayan",
    version: 1,
    exportedAt: new Date().toISOString(),
    study: state.study,
  };
}
function markdown() {
  return (
    "# Bayan study notes\n\n" +
    Object.entries(state.study)
      .map(
        ([key, s]) =>
          `## ${chapterName(key.split(":")[0])} ${key}\n\n${s.bookmark ? "Bookmarked\n\n" : ""}${s.color ? "Highlight: " + s.color + "\n\n" : ""}${s.note || ""}\n`,
      )
      .join("\n")
  );
}
function renderDownloads() {
  const host = $("download-list");
  host.replaceChildren();
  for (const [key, b] of Object.entries(state.cache)) {
    const row = el("div", undefined, "download-row");
    row.append(
      el("span", chapterName(key.split(":")[0])),
      el("small", new Date(b.savedAt).toLocaleDateString()),
      button("Remove", () => {
        delete state.cache[key];
        if (cacheKey() === key) current = null;
        save();
        renderDownloads();
        renderReader();
      }),
    );
    host.append(row);
  }
  if (!host.children.length)
    host.append(el("p", "No surahs downloaded yet.", "muted"));
}
async function downloadChapter(id) {
  const query = new URLSearchParams({
    translations: state.settings.translations.join(","),
    tafsir: state.settings.tafsir || "",
    reciter: state.settings.reciter || "",
  });
  const bundle = await api(`/v1/chapter/${id}?${query}`);
  bundle.savedAt = Date.now();
  state.cache[cacheKey(id)] = bundle;
  await save();
}
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      document
        .querySelectorAll("[data-tab]")
        .forEach((n) => n.classList.toggle("active", n === b));
      renderSidebar();
    }),
);
$("sidebar-toggle").onclick = () => $("sidebar").classList.toggle("hidden");
$("settings-open").onclick = openSettings;
$("english").onclick = () => {
  state.settings.english = !state.settings.english;
  save();
  renderReader();
};
$("words").onclick = () => {
  state.settings.words = !state.settings.words;
  save();
  renderReader();
};
$("appearance").onclick = () => {
  const themes = ["light", "sepia", "dark"];
  state.settings.theme = themes[(themes.indexOf(state.settings.theme) + 1) % 3];
  save();
  applySettings();
};
$("back").onclick = () => loadChapter(state.position.chapter - 1);
$("forward").onclick = () => loadChapter(state.position.chapter + 1);
$("jump-open").onclick = () => {
  $("jump-dialog").showModal();
  $("jump-input").focus();
};
$("jump-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await navigate($("jump-input").value);
    $("jump-dialog").close();
  } catch (e) {
    showError(e);
  }
};
$("search").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderSidebar, 150);
};
$("font-size").oninput = () => {
  state.settings.fontSize = +$("font-size").value;
  applySettings();
  save();
};
$("connect").onclick = connect;
$("access").onclick = () => native("openAccess").catch(showError);
$("note-body").oninput = () => {
  clearTimeout(noteTimer);
  $("saved-status").textContent = "Saving…";
  noteTimer = setTimeout(() => flushNote().catch(showError), 1200);
};
$("note-dialog").addEventListener("close", () => {
  flushNote()
    .then(() => {
      noteKey = null;
      renderReader();
    })
    .catch(showError);
});
$("delete-note").onclick = async () => {
  $("note-body").value = "";
  await flushNote();
  $("note-dialog").close();
};
$("tafsir-close").onclick = () => ($("tafsir-panel").hidden = true);
$("tafsir-choice").onchange = async () => {
  state.settings.tafsir = +$("tafsir-choice").value;
  save();
  await loadChapter(state.position.chapter, selected, true);
  if (selected) {
    const v = verseByKey(selected);
    if (v) openTafsir(v);
  }
};
$("reciter").onchange = async () => {
  $("audio").pause();
  playingKey = null;
  $("play").textContent = "▶";
  state.settings.reciter = +$("reciter").value;
  save();
  await loadChapter(state.position.chapter, selected, true);
};
$("play").onclick = () => {
  if (!$("audio").paused) {
    $("audio").pause();
    $("play").textContent = "▶";
  } else if (playingKey) {
    $("audio")
      .play()
      .then(() => {
        $("play").textContent = "Ⅱ";
      })
      .catch(showError);
  } else if (selected || current?.verses[0])
    startAudio(selected || current.verses[0].verse_key);
  else notice("Connect and choose a verse to hear its recitation.");
};
$("speed").onchange = () => ($("audio").playbackRate = +$("speed").value);
$("export-json").onclick = () =>
  native("export", {
    name: "Bayan-backup.json",
    text: JSON.stringify(backup(), null, 2),
  }).catch(showError);
$("export-md").onclick = () =>
  native("export", { name: "Bayan-notes.md", text: markdown() }).catch(
    showError,
  );
$("import-json").onclick = async () => {
  try {
    const data = await native("import");
    if (!data) return;
    const incoming = C.validateBackup(data);
    state.study = C.mergeStudy(state.study, incoming);
    await save();
    renderSidebar();
    renderReader();
    notice("Study backup imported. Newer notes were kept.");
  } catch (e) {
    showError(e);
  }
};
$("downloads-open").onclick = () => {
  renderDownloads();
  $("downloads").showModal();
};
$("download-current").onclick = async () => {
  try {
    $("download-status").textContent = "Downloading…";
    await downloadChapter(state.position.chapter);
    $("download-status").textContent = "Ready to read offline.";
    renderDownloads();
    current = state.cache[cacheKey()];
    renderReader();
  } catch (e) {
    $("download-status").textContent = e.message;
  }
};
$("download-all").onclick = async () => {
  const b = $("download-all");
  b.disabled = true;
  try {
    for (const c of state.chapters) {
      $("download-status").textContent = "Downloading " + c.name_simple + "…";
      await downloadChapter(c.id);
      renderDownloads();
    }
    $("download-status").textContent =
      "All available surahs are ready offline.";
  } catch (e) {
    $("download-status").textContent = e.message;
  } finally {
    b.disabled = false;
  }
};
document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(
    document.activeElement?.tagName,
  );
  if (e.metaKey && e.key === "k") {
    e.preventDefault();
    $("jump-open").click();
  }
  if (e.metaKey && e.key === "f") {
    e.preventDefault();
    $("search").focus();
  }
  if (e.metaKey && e.key.toLowerCase() === "b") {
    e.preventDefault();
    $("sidebar-toggle").click();
  }
  if (e.metaKey && e.key === "Enter" && $("note-dialog").open) {
    e.preventDefault();
    $("note-dialog").close();
  }
  if (typing || document.querySelector("dialog[open]")) return;
  if (e.key === "ArrowLeft") $("back").click();
  if (e.key === "ArrowRight") $("forward").click();
  if (selected) {
    if (e.key === "n") openNote(verseByKey(selected));
    if (e.key === "b") {
      updateEntry(selected, { bookmark: !entry(selected).bookmark });
      renderReader();
    }
    if (/^[0-6]$/.test(e.key)) {
      updateEntry(selected, {
        color: +e.key ? Object.keys(colors)[+e.key - 1] : null,
      });
      renderReader();
    }
  }
});
async function boot() {
  try {
    const saved = await native("load");
    if (saved.version === 1) {
      state = {
        ...state,
        ...saved,
        settings: { ...state.settings, ...saved.settings },
      };
    }
    applySettings();
    renderResources();
    renderSidebar();
    current = state.cache[cacheKey()] || null;
    renderReader();
    if (current && state.position.verse) scrollToVerse(state.position.verse);
    if (state.chapters.length) {
      loadChapter(state.position.chapter, state.position.verse);
      refreshDownloaded();
    }
  } catch (e) {
    emptyReader("Bayan could not open your library", e.message);
  }
}
async function refreshDownloaded() {
  for (const [key, bundle] of Object.entries(state.cache)) {
    if (Date.now() - bundle.savedAt < 7 * 86400000) continue;
    const [ch, translations, tafsir, reciter] = key.split(":");
    try {
      const query = new URLSearchParams({ translations, tafsir, reciter });
      const updated = await api(`/v1/chapter/${ch}?${query}`);
      state.cache[key] = { ...updated, savedAt: Date.now() };
      await save();
    } catch {
      return;
    }
  }
}
boot();
setInterval(() => refreshDownloaded().catch(showError), 3600000);
let positionTimer;
$("main").addEventListener("scroll", () => {
  clearTimeout(positionTimer);
  positionTimer = setTimeout(() => {
    const top = $("main").getBoundingClientRect().top + 70;
    const verse = [...$("reader").querySelectorAll('[id^="verse-"]')].find(
      (node) => node.getBoundingClientRect().bottom > top,
    );
    const key = verse?.id.slice(6);
    if (key && key !== state.position.verse) {
      state.position.verse = key;
      save();
    }
  }, 750);
});
