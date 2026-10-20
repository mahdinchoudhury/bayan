const { JSDOM } = require("jsdom");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const web = resolve(__dirname, "../../apps/bayan-macos/Web");
const clone = (x) => JSON.parse(JSON.stringify(x));
const verse = (ch, n) => ({
  id: ch * 100 + n,
  chapter_id: ch,
  verse_number: n,
  verse_key: `${ch}:${n}`,
  text_uthmani: "كلمة تجريبية",
  words: [
    {
      char_type_name: "word",
      text_uthmani: "كلمة",
      translation: { text: "synthetic word" },
    },
  ],
  translations: [
    { resource_id: 85, text: `Synthetic passage ${ch}:${n} alpha` },
    { resource_id: 20, text: `Alternate synthetic wording ${ch}:${n} beta` },
  ],
  tafsirs: [{ resource_id: 169, text: "Synthetic commentary" }],
  audio: { url: `https://verses.quran.com/fixture-${ch}-${n}.mp3` },
});
const bundle = (ch) => ({
  verses: Array.from({ length: ch === 1 ? 7 : 4 }, (_, i) => verse(ch, i + 1)),
  savedAt: Date.now(),
});
function fixture() {
  return {
    version: 1,
    settings: {
      service: "http://127.0.0.1:8787",
      english: true,
      words: false,
      translations: [85],
      tafsir: 169,
      reciter: 6,
      theme: "light",
      fontSize: 36,
    },
    study: {},
    chapters: [1, 2, 114].map((id) => ({
      id,
      name_simple: { 1: "Al-Fatihah", 2: "Al-Baqarah", 114: "An-Nas" }[id],
      name_arabic: "اسم",
      translated_name: { name: "Synthetic chapter" },
      verses_count: id === 1 ? 7 : 4,
    })),
    resources: {
      translations: [85, 20, 19, 22, 84, 203].map((id) => ({
        id,
        name: "Translation " + id,
      })),
      tafsirs: [
        { id: 169, name: "Commentary A" },
        { id: 168, name: "Commentary B" },
      ],
      reciters: [
        { id: 6, name: "Reciter A" },
        { id: 7, name: "Reciter B" },
      ],
    },
    cache: {
      "1:85:169:6": bundle(1),
      "2:85:169:6": bundle(2),
      "114:85:169:6": bundle(114),
    },
    position: { chapter: 1, verse: "1:2" },
  };
}
async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
}
async function harness(options = {}) {
  const dom = new JSDOM(readFileSync(resolve(web, "index.html"), "utf8"), {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "file:///Bayan/Web/index.html",
  });
  const w = dom.window;
  const calls = [],
    saved = [];
  const observers = [];
  w.requestAnimationFrame = (fn) => {
    queueMicrotask(() => fn(Date.now()));
    return 1;
  };
  w.setInterval = () => 0;
  w.HTMLElement.prototype.scrollIntoView = function () {
    if (this.id.startsWith("verse-")) w.__lastScroll = this.id;
  };
  w.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.nodes = new Set();
      observers.push(this);
    }
    observe(n) {
      this.nodes.add(n);
    }
    unobserve(n) {
      this.nodes.delete(n);
    }
    disconnect() {
      this.nodes.clear();
    }
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    if (this.open) throw Error("Already open");
    this.open = true;
    this.dataset.modal = "true";
  };
  w.HTMLDialogElement.prototype.show = function () {
    if (this.open) throw Error("Already open");
    this.open = true;
    this.dataset.modal = "false";
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new w.Event("close"));
  };
  let paused = true;
  const audio = w.document.getElementById("audio");
  Object.defineProperty(audio, "paused", { get: () => paused });
  audio.play = async () => {
    if (options.playFailure) throw Error("Playback rejected");
    paused = false;
    audio.dispatchEvent(new w.Event("play"));
  };
  audio.pause = () => {
    paused = true;
    audio.dispatchEvent(new w.Event("pause"));
  };
  audio.load = () => {};
  const initial = clone(options.state || fixture());
  const defaultRequest = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/v1/catalog")
      return {
        environment: "production",
        chapters: initial.chapters,
        resources: initial.resources,
      };
    const ch = +u.pathname.split("/").at(-1);
    if (u.pathname.includes("/juz/")) return { verse_key: "2:1" };
    const b = bundle(ch);
    for (const v of b.verses) {
      v.tafsirs = [
        {
          resource_id: +u.searchParams.get("tafsir"),
          text: "Synthetic commentary " + u.searchParams.get("tafsir"),
        },
      ];
      v.translations = v.translations.filter((t) =>
        (u.searchParams.get("translations") || "")
          .split(",")
          .includes(String(t.resource_id)),
      );
    }
    return b;
  };
  w.webkit = {
    messageHandlers: {
      bayan: {
        postMessage(message) {
          calls.push(clone(message));
          Promise.resolve()
            .then(async () => {
              if (message.op === "load") return initial;
              if (message.op === "save") {
                if (options.saveFailure) throw Error("Disk unavailable");
                saved.push(clone(message.value));
                return true;
              }
              if (message.op === "request")
                return (options.request || defaultRequest)(message.url);
              if (message.op === "import") return options.importData || null;
              if (message.op === "export" || message.op === "copy") return true;
              return true;
            })
            .then(
              (value) => w.nativeReply({ id: message.id, value }),
              (e) => w.nativeReply({ id: message.id, error: e.message }),
            );
        },
      },
    },
  };
  const context = dom.getInternalVMContext();
  vm.runInContext(readFileSync(resolve(web, "core.js"), "utf8"), context);
  vm.runInContext(readFileSync(resolve(web, "app.js"), "utf8"), context);
  await settle();
  return {
    w,
    dom,
    calls,
    saved,
    observers,
    options,
    $: (id) => w.document.getElementById(id),
    state: () => vm.runInContext("state", context),
    run: (code) => vm.runInContext(code, context),
    settle,
    close: () => dom.window.close(),
    async click(id) {
      w.document.getElementById(id).click();
      await settle();
    },
    async input(id, value) {
      const n = w.document.getElementById(id);
      n.value = value;
      n.dispatchEvent(new w.Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 170));
      await settle();
    },
    async change(id, value) {
      const n = w.document.getElementById(id);
      n.value = value;
      n.dispatchEvent(new w.Event("change", { bubbles: true }));
      await settle();
    },
    async key(key, extra = {}) {
      w.document.dispatchEvent(
        new w.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...extra,
        }),
      );
      await settle();
    },
  };
}
module.exports = { harness, fixture, bundle, verse, settle };
