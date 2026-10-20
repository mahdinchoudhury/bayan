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
    sidebarHidden: false,
    playbackSpeed: 1,
    repeatCount: 1,
    stopAfter: "surah",
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
  b.onclick = (event) => {
    event.stopPropagation();
    try {
      Promise.resolve(action(event)).catch(showError);
    } catch (error) {
      showError(error);
    }
  };
  return b;
}
function notice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
function showError(error) {
  const message = error.message || String(error);
  const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
  if (!dialog) {
    notice(message);
    return;
  }
  let status = dialog.querySelector('[role="alert"]');
  if (!status) {
    status = el("p", undefined, "interaction-error");
    status.setAttribute("role", "alert");
    dialog.prepend(status);
  }
  status.textContent = message;
}
function clearDialogError(id) {
  $(id).querySelector('[role="alert"]')?.remove();
}
function setSidebarVisible(visible, persist = true) {
  $("sidebar").classList.toggle("hidden", !visible);
  $("sidebar-toggle").setAttribute("aria-expanded", String(visible));
  $("sidebar-toggle").setAttribute("aria-controls", "sidebar");
  state.settings.sidebarHidden = !visible;
  if (persist) save();
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
function cacheKey(chapter = state.position.chapter, settings = state.settings) {
  return `${chapter}:${[...settings.translations].sort((a, b) => a - b).join(",")}:${settings.tafsir || ""}:${settings.reciter || ""}`;
}
async function api(path, service = state.settings.service) {
  const base = service.replace(/\/$/, "");
  if (!base) throw Error("Set a content service address in Settings.");
  return native("request", { url: base + path });
}
function applySettings() {
  setSidebarVisible(!state.settings.sidebarHidden, false);
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
  $("speed").value = String(state.settings.playbackSpeed || 1);
  $("repeat").value = String(state.settings.repeatCount ?? 1);
  $("stop").value = state.settings.stopAfter || "surah";
  for (const button of document.querySelectorAll("[data-theme]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.theme === state.settings.theme),
    );
  $("english").disabled = !current || !state.resources.translations.length;
  $("words").disabled = !current?.verses?.some((v) => v.words?.length);
  $("play").disabled =
    !current?.verses?.some((v) => v.audio?.url) ||
    !state.resources.reciters.length;
  $("back").disabled = !state.chapters.length || state.position.chapter <= 1;
  $("forward").disabled =
    !state.chapters.length || state.position.chapter >= 114;
}
function renderTranslationChoices(host) {
  const focused = document.activeElement?.id;
  host.replaceChildren();
  if (!state.resources.translations.length) {
    host.append(el("p", "Connect to load available translations.", "muted"));
    return;
  }
  for (const resource of state.resources.translations) {
    const row = el("label", undefined, "source-choice"),
      input = el("input");
    input.type = "checkbox";
    input.id = `${host.id}-${resource.id}`;
    input.checked = state.settings.translations.includes(resource.id);
    input.disabled = input.checked
      ? state.settings.translations.length === 1
      : state.settings.translations.length >= 5;
    input.onchange = async () => {
      const anchor = state.position.verse || selected;
      state.settings.translations = input.checked
        ? [...new Set([...state.settings.translations, resource.id])].slice(
            0,
            5,
          )
        : state.settings.translations.filter((id) => id !== resource.id);
      await save();
      renderResources();
      await loadChapter(state.position.chapter, anchor);
    };
    const change = input.onchange;
    input.onchange = (event) => Promise.resolve(change(event)).catch(showError);
    row.append(
      input,
      el(
        "span",
        resource.name +
          (resource.author_name ? " — " + resource.author_name : ""),
      ),
    );
    host.append(row);
  }
  if (focused) document.getElementById(focused)?.focus();
}
function renderResources() {
  for (const [id, kind, value] of [
    ["reciter", "reciters", state.settings.reciter],
    ["tafsir-choice", "tafsirs", state.settings.tafsir],
  ]) {
    const select = $(id);
    select.replaceChildren();
    for (const resource of state.resources[kind] || []) {
      const option = el("option", resource.name);
      option.value = resource.id;
      select.append(option);
    }
    select.disabled = !select.options.length;
    if (select.disabled) select.append(el("option", "No sources available"));
    else select.value = value || select.options[0].value;
  }
  renderTranslationChoices($("translations-list"));
  if ($("translation-options"))
    renderTranslationChoices($("translation-options"));
}

function closeCompactPopups(except) {
  for (const id of ["appearance-menu", "translations-menu"])
    if (id !== except && $(id)?.open) $(id).close();
}
async function openCompactPopup(id, anchor) {
  await closeNote();
  if ($(id).open) {
    $(id).close();
    return;
  }
  closeCompactPopups(id);
  clearDialogError(id);
  renderResources();
  $(id).show();
  positionPopup($(id), anchor);
  (
    $(id).querySelector(
      'input:checked:not(:disabled), button[aria-pressed="true"]',
    ) || $(id).querySelector("button:not(:disabled), input:not(:disabled)")
  )?.focus();
}
function renderSidebar() {
  const host = $("side-content");
  host.replaceChildren();
  const query = $("search").value.trim();
  if (query) {
    const verses = new Map();
    for (const bundle of Object.values(state.cache)) {
      for (const verse of bundle.verses || []) {
        const previous = verses.get(verse.verse_key);
        const translations = new Map(
          (previous?.translations || []).map((t) => [t.resource_id, t]),
        );
        for (const t of verse.translations || [])
          translations.set(t.resource_id, { ...t, plain_text: plain(t.text) });
        verses.set(verse.verse_key, {
          ...verse,
          translations: [...translations.values()],
        });
      }
    }
    const results = C.search([...verses.values()], query);
    host.append(
      el(
        "p",
        `${results.length} matches in downloaded text${results.length > 150 ? " · showing the first 150" : ""}`,
        "side-label",
      ),
    );
    if (!results.length)
      host.append(
        el("p", "No matches. Search includes only downloaded surahs.", "muted"),
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
      el("small", c.translated_name?.name || ""),
    );
    b.append(
      el("span", String(c.id).padStart(2, "0"), "number"),
      name,
      el("span", c.name_arabic, "arabic-name"),
    );
    host.append(b);
    b.title = `${c.name_simple} — ${c.translated_name?.name || ""}, ${c.verses_count} verses`;
    if (c.id === state.position.chapter) b.setAttribute("aria-current", "page");
  }
  requestAnimationFrame(() =>
    host
      .querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" }),
  );
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
let verseObserver;
function renderReader() {
  verseObserver?.disconnect();
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
  if (!$("tafsir-panel").hidden)
    renderTafsir(
      current.verses.find(
        (v) => v.verse_key === (selected || state.position.verse),
      ) || current.verses[0],
    );
  $("toolbar-chapter").textContent =
    chapter?.name_simple || chapterName(state.position.chapter);
  $("toolbar-translation").textContent =
    state.settings.translations.length > 1
      ? state.settings.translations.length + " translations"
      : resourceName("translations", state.settings.translations[0]) ||
        "Translation";
  if (!state.settings.english && !state.settings.words) {
    renderFlow(reader);
    return;
  }
  // Mount nearby verses first, then fill the document as the reader scrolls.
  // Placeholder rows have no empty buttons or inaccessible hidden controls.
  const anchor = state.position.verse || selected;
  const anchorIndex = Math.max(
    0,
    current.verses.findIndex((v) => v.verse_key === anchor),
  );
  const versesByKey = new Map(current.verses.map((v) => [v.verse_key, v]));
  verseObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const placeholder = entry.target;
        const verse = versesByKey.get(placeholder.dataset.key);
        if (verse) placeholder.replaceWith(buildVerse(verse, reader));
        verseObserver.unobserve(placeholder);
      }
    },
    { root: $("main"), rootMargin: "700px 0px" },
  );
  const width = Math.max(320, reader.clientWidth - 116);
  for (let index = 0; index < current.verses.length; index++) {
    const v = current.verses[index];
    if (current.verses.length <= 30 || Math.abs(index - anchorIndex) <= 3) {
      reader.append(buildVerse(v, reader));
    } else {
      const placeholder = el("div", undefined, "verse-placeholder");
      placeholder.id = "verse-" + v.verse_key;
      placeholder.dataset.key = v.verse_key;
      const wordCount = (v.words || []).filter(
        (w) => w.char_type_name === "word",
      ).length;
      const arabicLines = state.settings.words
        ? Math.ceil(wordCount / Math.max(3, Math.floor(width / 78)))
        : Math.ceil((v.text_uthmani || "").length / Math.max(30, width / 12));
      const translationLines = state.settings.english
        ? (v.translations || []).reduce(
            (n, t) =>
              n + Math.ceil(plain(t.text).length / Math.max(35, width / 9)),
            0,
          )
        : 0;
      placeholder.style.height =
        Math.max(
          140,
          52 +
            arabicLines * (state.settings.words ? 110 : 68) +
            translationLines * 31,
        ) + "px";
      placeholder.setAttribute("aria-hidden", "true");
      reader.append(placeholder);
      verseObserver.observe(placeholder);
    }
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
function buildVerse(v, reader) {
  const s = entry(v.verse_key),
    row = el("article", undefined, "verse");
  row.id = "verse-" + v.verse_key;
  row.dataset.key = v.verse_key;
  row.tabIndex = 0;
  row.setAttribute("aria-label", "Verse " + v.verse_key);
  row.onkeydown = (event) => {
    if (event.target === row && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      row.click();
    }
  };
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
    button("Copy", () => copyVerse(v)),
  );
  const bookmarkButton = tools.querySelector("button");
  bookmarkButton.setAttribute(
    "aria-label",
    (s.bookmark ? "Remove bookmark for " : "Bookmark ") + v.verse_key,
  );
  bookmarkButton.setAttribute("aria-pressed", String(s.bookmark));
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
    for (const t of (v.translations || []).filter((t) =>
      state.settings.translations.includes(+t.resource_id),
    )) {
      // Some source records omit whitespace after a sentence. Add display-only
      // spacing; keep the source record and all Arabic text untouched.
      const prose = plain(t.text).replace(/([a-z][.!?])(?=[A-Z][a-z])/g, "$1 ");
      const p = el("div", prose, "translation");
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
  return row;
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
    const marker = el(
      "span",
      "﴿" + v.verse_number.toLocaleString("ar-EG") + "﴾",
      "end-mark",
    );
    span.append(marker);
    const choose = () => {
      const restoreFocus = document.activeElement === span;
      selected = v.verse_key;
      state.position.verse = selected;
      save();
      renderReader();
      if (restoreFocus)
        document
          .getElementById("verse-" + selected)
          ?.focus({ preventScroll: true });
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
function readingFallback(chapter) {
  const candidates = Object.entries(state.cache).filter(([, b]) =>
    b.verses?.some((v) => +v.chapter_id === +chapter),
  );
  if (!candidates.length) return null;
  const verses = new Map();
  for (const [key, bundle] of candidates.sort(
    (a, b) => a[1].savedAt - b[1].savedAt,
  ))
    for (const v of bundle.verses) {
      const previous = verses.get(v.verse_key);
      const translations = new Map(
        (previous?.translations || []).map((t) => [t.resource_id, t]),
      );
      const tafsirs = new Map(
        (previous?.tafsirs || []).map((t) => [t.resource_id, t]),
      );
      for (const t of v.translations || [])
        if (state.settings.translations.includes(+t.resource_id))
          translations.set(t.resource_id, t);
      for (const t of v.tafsirs || [])
        if (+t.resource_id === +state.settings.tafsir)
          tafsirs.set(t.resource_id, t);
      verses.set(v.verse_key, {
        ...v,
        translations: [...translations.values()],
        tafsirs: [...tafsirs.values()],
        audio:
          +key.split(":")[3] === +state.settings.reciter
            ? v.audio
            : previous?.audio || null,
      });
    }
  return {
    verses: [...verses.values()].sort(
      (a, b) => a.verse_number - b.verse_number,
    ),
    savedAt: Math.min(...candidates.map(([, b]) => b.savedAt)),
  };
}
async function loadChapter(id, verse = null, force = false) {
  id = Number(id);
  if (!Number.isInteger(id) || id < 1 || id > 114) return false;
  await closeNote();
  const generation = ++requestGeneration;
  const previous = { position: { ...state.position }, selected, current };
  state.position = { chapter: id, verse };
  selected = verse;
  const settings = JSON.parse(JSON.stringify(state.settings));
  const key = cacheKey(id, settings),
    exact = state.cache[key];
  current = exact || readingFallback(id);
  save();
  renderSidebar();
  renderReader();
  if (exact && !force && Date.now() - exact.savedAt < 7 * 86400000) {
    notice("");
    if (verse) scrollToVerse(verse);
    return true;
  }
  try {
    notice("Loading " + chapterName(id) + "…");
    const query = new URLSearchParams({
      translations: settings.translations.join(","),
      tafsir: settings.tafsir || "",
      reciter: settings.reciter || "",
    });
    const bundle = await api(`/v1/chapter/${id}?${query}`);
    if (!Array.isArray(bundle.verses) || !bundle.verses.length)
      throw Error("This surah returned no readable text.");
    bundle.savedAt = Date.now();
    state.cache[key] = bundle;
    await save();
    if (generation !== requestGeneration) return false;
    current = bundle;
    notice("");
    renderReader();
    renderSidebar();
    if (verse) scrollToVerse(verse);
    return true;
  } catch (error) {
    if (generation !== requestGeneration) return false;
    if (current) {
      notice(
        "Offline copy · selected resources may need downloading. " +
          error.message,
      );
      if (verse) scrollToVerse(verse);
      return true;
    }
    state.position = previous.position;
    selected = previous.selected;
    current = previous.current;
    renderReader();
    renderSidebar();
    save();
    showError(error);
    return false;
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
  value = String(value)
    .trim()
    .replace(/[٠-٩۰-۹]/g, (c) =>
      String(
        c.charCodeAt(0) >= 0x6f0
          ? c.charCodeAt(0) - 0x6f0
          : c.charCodeAt(0) - 0x660,
      ),
    );
  if (C.validRef(value)) {
    const [chapter, number] = value.split(":").map(Number);
    return loadChapter(chapter, `${chapter}:${number}`);
  }
  if (/^\d+$/.test(value) && +value >= 1 && +value <= 114)
    return loadChapter(+value);
  const name = (text) =>
    C.normalize(text || "")
      .replace(/[^a-z\u0621-\u064a]/g, "")
      .replace(/^al/, "");
  const query = name(value);
  const matches =
    query.length >= 3
      ? state.chapters.filter((c) =>
          [c.name_simple, c.name_arabic, c.translated_name?.name].some(
            (n) => name(n) === query,
          ),
        )
      : [];
  if (matches.length === 1) return loadChapter(matches[0].id);
  throw Error("Enter a valid reference, such as 2:255, or a surah name.");
}

async function openSettings() {
  await closeNote();
  closeCompactPopups();
  renderResources();
  clearDialogError("settings");
  if (!$("settings").open) $("settings").showModal();
}
async function connect() {
  $("connection-status").textContent = "Connecting…";
  const candidate = $("service-url").value.trim();
  $("connect").disabled = true;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
    )
      throw Error("Use HTTPS, or localhost for a private service.");
    const result = await api("/v1/catalog", candidate);
    state.settings.service = candidate;
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
    await loadChapter(state.position.chapter, state.position.verse, true);
  } catch (e) {
    $("connection-status").textContent = e.message;
  } finally {
    $("connect").disabled = false;
  }
}
let noteClosing = null;
async function openNote(v) {
  if (!v) throw Error("Select an available verse first.");
  await closeNote();
  noteKey = v.verse_key;
  selected = noteKey;
  state.position.verse = noteKey;
  $("note-title").textContent = chapterName(v.chapter_id) + " " + v.verse_key;
  $("note-quote").textContent = plain(v.translations?.[0]?.text || "");
  $("note-body").value = entry(noteKey).note;
  renderSwatches();
  clearDialogError("note-dialog");
  $("saved-status").textContent = entry(noteKey).note
    ? "Saved on this Mac"
    : "Personal note";
  $("note-dialog").show();
  positionPopup($("note-dialog"), document.getElementById("verse-" + noteKey));
  $("note-body").focus();
}
async function closeNote(restoreFocus = false) {
  if (noteClosing) return noteClosing;
  if (!noteKey) return;
  noteClosing = (async () => {
    await flushNote();
    $("note-dialog").close();
    noteKey = null;
    const anchor = state.position.verse;
    renderReader();
    if (anchor) {
      scrollToVerse(anchor);
      if (restoreFocus)
        document
          .getElementById("verse-" + anchor)
          ?.focus({ preventScroll: true });
    }
  })();
  try {
    await noteClosing;
  } finally {
    noteClosing = null;
  }
}
function positionPopup(dialog, anchor) {
  const rect = anchor?.getBoundingClientRect() || {
    left: innerWidth / 2,
    top: 90,
    bottom: 110,
  };
  const width = dialog.offsetWidth || 360,
    height = dialog.offsetHeight || 320;
  dialog.style.left =
    Math.max(16, Math.min(innerWidth - width - 16, rect.left + 20)) + "px";
  dialog.style.top =
    Math.max(58, Math.min(innerHeight - height - 16, rect.top + 25)) + "px";
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
  if (noteKey === key && $("note-body").value === body)
    $("saved-status").textContent =
      "Saved " +
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function renderTafsir(v) {
  const tafsir = (v.tafsirs || []).find(
    (t) => +t.resource_id === +state.settings.tafsir,
  );
  $("tafsir-content").textContent =
    `${chapterName(v.chapter_id)} ${v.verse_key}\n\n${tafsir ? plain(tafsir.text) : "This tafsir is not downloaded for this verse. Connect to download the selected source."}`;
}
function openTafsir(v) {
  selected = v.verse_key;
  state.position.verse = selected;
  save();
  $("tafsir-panel").hidden = false;
  renderReader();
  renderTafsir(v);
}

let audioGeneration = 0,
  activeAudioVerses = [],
  playingFinished = false;
function syncPlayback() {
  const playing = !$("audio").paused && !playingFinished;
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause recitation" : "Play recitation",
  );
}
function resetAudio() {
  audioGeneration++;
  $("audio").pause();
  $("audio").removeAttribute("src");
  $("audio").load();
  playingKey = null;
  activeAudioVerses = [];
  playingFinished = false;
  repeatCount = 0;
  $("playing-reference").textContent = "Recitation";
  $("playing-status").textContent = "Choose a verse to begin";
  syncPlayback();
}
async function startAudio(key, continuing = false) {
  const generation = ++audioGeneration;
  try {
    const verses = continuing
      ? activeAudioVerses
      : current?.verses?.some((v) => v.verse_key === key)
        ? current.verses
        : state.cache[cacheKey(+key.split(":")[0])]?.verses || [];
    const verse = verses.find((v) => v.verse_key === key);
    if (!verse?.audio?.url)
      throw Error(
        "This recitation is not downloaded or available. Connect and choose a reciter.",
      );
    const url = new URL(verse.audio.url, "https://verses.quran.com/");
    if (url.protocol !== "https:")
      throw Error("The audio source must use HTTPS.");
    activeAudioVerses = verses;
    playingKey = key;
    playingFinished = false;
    repeatCount = 0;
    $("audio").src = url.href;
    $("audio").playbackRate = +$("speed").value;
    await $("audio").play();
    if (generation !== audioGeneration) return;
    $("playing-reference").textContent =
      chapterName(verse.chapter_id) + " " + key;
    $("playing-status").textContent = resourceName(
      "reciters",
      state.settings.reciter,
    );
    syncPlayback();
    if (+key.split(":")[0] === state.position.chapter) {
      selected = key;
      renderReader();
      scrollToVerse(key);
    }
  } catch (error) {
    if (generation !== audioGeneration) return;
    $("audio").pause();
    syncPlayback();
    $("playing-status").textContent = error.message;
    showError(error);
  }
}
$("audio").onplay = syncPlayback;
$("audio").onpause = syncPlayback;
$("audio").onended = async () => {
  if (!playingKey) return;
  $("audio").pause();
  repeatCount++;
  const repeats = +$("repeat").value;
  if (repeats === 0 || repeatCount < repeats) {
    $("audio").currentTime = 0;
    await $("audio").play().catch(showError);
    return;
  }
  if ($("stop").value === "surah") {
    const index = activeAudioVerses.findIndex(
        (v) => v.verse_key === playingKey,
      ),
      next = activeAudioVerses[index + 1];
    if (next) {
      await startAudio(next.verse_key, true);
      return;
    }
  }
  playingFinished = true;
  syncPlayback();
};
$("audio").onerror = () => {
  if ($("audio").getAttribute("src")) {
    $("audio").pause();
    syncPlayback();
    $("playing-status").textContent =
      "Audio unavailable. Check your connection and try again.";
  }
};
async function copyVerse(v) {
  if (!v) throw Error("Select a verse first.");
  const text = [
    v.text_uthmani || "",
    ...(state.settings.english
      ? (v.translations || []).map((t) => plain(t.text))
      : []),
    v.verse_key,
  ].join("\n");
  await native("copy", { text });
  notice("Copied " + v.verse_key);
}
window.prepareToClose = async () => {
  await flushNote();
  await save();
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
      .filter(([, study]) => study.note || study.bookmark || study.color)
      .map(
        ([key, s]) =>
          `## ${chapterName(key.split(":")[0])} ${key}\n\n${s.bookmark ? "Bookmarked\n\n" : ""}${s.color ? "Highlight: " + s.color + "\n\n" : ""}${s.note || ""}\n`,
      )
      .join("\n")
  );
}
let downloadGeneration = 0,
  downloading = false;
function renderDownloads() {
  const host = $("download-list");
  host.replaceChildren();
  const groups = new Map();
  for (const [key, bundle] of Object.entries(state.cache)) {
    const chapter = +key.split(":")[0];
    if (!groups.has(chapter)) groups.set(chapter, []);
    groups.get(chapter).push({ key, bundle });
  }
  for (const [chapter, copies] of [...groups].sort((a, b) => a[0] - b[0])) {
    const row = el("div", undefined, "download-row");
    const label = el("span", chapterName(chapter));
    label.append(
      el(
        "small",
        ` · ${copies.length} saved resource selection${copies.length === 1 ? "" : "s"}`,
      ),
    );
    const remove = button("Remove", async () => {
      for (const copy of copies) delete state.cache[copy.key];
      await save();
      renderDownloads();
      notice("Offline copy removed. Your notes and current reading are kept.");
    });
    remove.disabled = downloading;
    remove.setAttribute(
      "aria-label",
      "Remove downloaded " + chapterName(chapter),
    );
    row.append(label, remove);
    host.append(row);
  }
  if (!groups.size) host.append(el("p", "No surahs downloaded yet.", "muted"));
  $("download-current").disabled = downloading || !state.chapters.length;
  $("download-all").disabled = downloading || !state.chapters.length;
  $("download-cancel").hidden = !downloading;
}
async function downloadChapter(
  id,
  settings = JSON.parse(JSON.stringify(state.settings)),
  generation = null,
) {
  const query = new URLSearchParams({
    translations: settings.translations.join(","),
    tafsir: settings.tafsir || "",
    reciter: settings.reciter || "",
  });
  const bundle = await api(`/v1/chapter/${id}?${query}`, settings.service);
  if (generation !== null && generation !== downloadGeneration) return false;
  if (!Array.isArray(bundle.verses) || !bundle.verses.length)
    throw Error("This surah returned no readable text.");
  bundle.savedAt = Date.now();
  state.cache[cacheKey(id, settings)] = bundle;
  await save();
  return true;
}
async function runDownload(all) {
  if (downloading) return;
  const generation = ++downloadGeneration,
    settings = JSON.parse(JSON.stringify(state.settings));
  const chapters = all
    ? state.chapters.map((c) => c.id)
    : [state.position.chapter];
  if (!state.chapters.length) {
    $("download-status").textContent =
      "Connect to load available surahs first.";
    return;
  }
  downloading = true;
  renderDownloads();
  try {
    let count = 0;
    for (const id of chapters) {
      if (generation !== downloadGeneration) return;
      $("download-status").textContent =
        `Downloading ${chapterName(id)} (${count + 1}/${chapters.length})…`;
      if (!(await downloadChapter(id, settings, generation))) return;
      count++;
      renderDownloads();
    }
    $("download-status").textContent =
      `${count} surah${count === 1 ? "" : "s"} ready offline.`;
    if (current && cacheKey() === cacheKey(state.position.chapter, settings)) {
      current = state.cache[cacheKey()] || current;
      const anchor = state.position.verse;
      renderReader();
      if (anchor) scrollToVerse(anchor);
    }
  } catch (error) {
    $("download-status").textContent = error.message;
  } finally {
    if (generation === downloadGeneration) {
      downloading = false;
      renderDownloads();
    }
  }
}

document
  .querySelectorAll("[data-close]")
  .forEach(
    (b) =>
      (b.onclick = () =>
        b.dataset.close === "note-dialog"
          ? closeNote(true)
          : $(b.dataset.close).close()),
  );
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      $("search").value = "";
      setSidebarVisible(true);
      document
        .querySelectorAll("[data-tab]")
        .forEach((n) => n.classList.toggle("active", n === b));
      renderSidebar();
    }),
);
$("sidebar-toggle").onclick = () =>
  setSidebarVisible($("sidebar").classList.contains("hidden"));
$("settings-open").onclick = openSettings;
$("translation-open").onclick = () =>
  openCompactPopup("translations-menu", $("translation-open"));
function toggleReadingSetting(field) {
  const anchor = state.position.verse || selected;
  state.settings[field] = !state.settings[field];
  save();
  renderReader();
  if (anchor) scrollToVerse(anchor);
}
$("english").onclick = () => toggleReadingSetting("english");
$("words").onclick = () => toggleReadingSetting("words");
$("appearance").onclick = () =>
  openCompactPopup("appearance-menu", $("appearance"));
for (const button of document.querySelectorAll("[data-theme]"))
  button.onclick = () => {
    state.settings.theme = button.dataset.theme;
    save();
    applySettings();
    $("appearance-menu").close();
    $("appearance").focus();
  };
$("back").onclick = () => loadChapter(state.position.chapter - 1);
$("forward").onclick = () => loadChapter(state.position.chapter + 1);
$("jump-open").onclick = () => {
  clearDialogError("jump-dialog");
  if (!$("jump-dialog").open) $("jump-dialog").showModal();
  $("jump-input").focus();
};
$("jump-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    if (await navigate($("jump-input").value)) {
      $("jump-dialog").close();
      requestAnimationFrame(() =>
        document
          .getElementById(
            "verse-" + (state.position.verse || `${state.position.chapter}:1`),
          )
          ?.focus({ preventScroll: true }),
      );
    }
  } catch (e) {
    showError(e);
  }
};
$("search").oninput = () => {
  setSidebarVisible(true);
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
$("note-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeNote(true).catch(showError);
});
document.addEventListener("pointerdown", (event) => {
  if ($("note-dialog").open && !$("note-dialog").contains(event.target))
    closeNote(true).catch(showError);
  for (const id of ["appearance-menu", "translations-menu"]) {
    const opener =
      id === "appearance-menu" ? $("appearance") : $("translation-open");
    if (
      $(id)?.open &&
      !$(id).contains(event.target) &&
      !opener.contains(event.target)
    )
      $(id).close();
  }
});
$("delete-note").onclick = async () => {
  $("note-body").value = "";
  await closeNote();
};
$("tafsir-close").onclick = () => {
  const anchor = state.position.verse;
  $("tafsir-panel").hidden = true;
  renderReader();
  if (anchor) scrollToVerse(anchor);
};
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
  const anchor = state.position.verse || selected;
  resetAudio();
  state.settings.reciter = +$("reciter").value;
  await save();
  await loadChapter(state.position.chapter, anchor, true);
};
$("play").onclick = async () => {
  if (!$("audio").paused) {
    $("audio").pause();
    syncPlayback();
    return;
  }
  if (playingKey) {
    if (playingFinished) {
      $("audio").currentTime = 0;
      repeatCount = 0;
      playingFinished = false;
    }
    await $("audio").play();
    syncPlayback();
  } else if (selected || current?.verses[0])
    await startAudio(selected || current.verses[0].verse_key);
};
$("speed").onchange = () => {
  state.settings.playbackSpeed = +$("speed").value;
  $("audio").playbackRate = state.settings.playbackSpeed;
  save();
};
$("repeat").onchange = () => {
  state.settings.repeatCount = +$("repeat").value;
  save();
};
$("stop").onchange = () => {
  state.settings.stopAfter = $("stop").value;
  save();
};
$("export-json").onclick = async () => {
  clearDialogError("settings");
  await flushNote();
  const saved = await native("export", {
    name: "Bayan-backup.json",
    text: JSON.stringify(backup(), null, 2),
  });
  $("study-status").textContent = saved
    ? "Study backup saved."
    : "Export cancelled.";
};
$("export-md").onclick = async () => {
  clearDialogError("settings");
  await flushNote();
  const saved = await native("export", {
    name: "Bayan-notes.md",
    text: markdown(),
  });
  $("study-status").textContent = saved
    ? "Markdown saved."
    : "Export cancelled.";
};
$("import-json").onclick = async () => {
  try {
    clearDialogError("settings");
    const data = await native("import");
    if (!data) return;
    const incoming = C.validateBackup(data);
    state.study = C.mergeStudy(state.study, incoming);
    await save();
    renderSidebar();
    renderReader();
    $("study-status").textContent =
      "Study backup imported. Newer notes were kept.";
  } catch (e) {
    showError(e);
  }
};
$("downloads-open").onclick = () => {
  renderDownloads();
  $("downloads").showModal();
};
$("download-current").onclick = () => runDownload(false);
$("download-all").onclick = () => runDownload(true);
$("download-cancel").onclick = () => {
  downloadGeneration++;
  downloading = false;
  $("download-status").textContent =
    "Download stopped. Completed surahs are kept.";
  renderDownloads();
};
document.addEventListener("keydown", (event) => {
  const e = event,
    key = e.key.toLowerCase();
  const typing =
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
    document.activeElement?.isContentEditable;
  const dialog = document.querySelector("dialog[open]");
  if (e.key === "Escape" && $("note-dialog").open) {
    e.preventDefault();
    closeNote(true).catch(showError);
    return;
  }
  if (e.metaKey && e.key === "Enter" && $("note-dialog").open) {
    e.preventDefault();
    closeNote(true).catch(showError);
    return;
  }
  if (dialog) {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
      const opener = {
        "appearance-menu": "appearance",
        "translation-menu": "translation-open",
      }[dialog.id];
      if (opener) $(opener).focus();
    }
    return;
  }
  if (e.metaKey) {
    if (key === "k") {
      e.preventDefault();
      $("jump-open").click();
    } else if (key === "f") {
      e.preventDefault();
      setSidebarVisible(true);
      $("search").focus();
    } else if (key === "b" && !typing) {
      e.preventDefault();
      $("sidebar-toggle").click();
    } else if (key === ",") {
      e.preventDefault();
      openSettings();
    } else if (
      key === "c" &&
      !typing &&
      selected &&
      window.getSelection()?.isCollapsed
    ) {
      e.preventDefault();
      copyVerse(verseByKey(selected)).catch(showError);
    }
    return;
  }
  if (e.ctrlKey || e.altKey || typing) return;
  if (document.activeElement?.closest(".word, .meaning")) return;
  if (
    ["ArrowLeft", "ArrowRight"].includes(e.key) &&
    document.activeElement?.closest("button")
  )
    return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    $("back").click();
  }
  if (e.key === "ArrowRight") {
    e.preventDefault();
    $("forward").click();
  }
  if (selected) {
    if (key === "n") openNote(verseByKey(selected)).catch(showError);
    if (key === "b") {
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
for (const node of document.querySelectorAll("button, input, select, form")) {
  for (const property of ["onclick", "oninput", "onchange", "onsubmit"]) {
    const handler = node[property];
    if (handler)
      node[property] = function (event) {
        try {
          Promise.resolve(handler.call(this, event)).catch(showError);
        } catch (error) {
          showError(error);
        }
      };
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
