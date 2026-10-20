import http from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WEEK = 7 * 86400000;
export class QFClient {
  constructor({
    clientId = process.env.QF_CLIENT_ID,
    clientSecret = process.env.QF_CLIENT_SECRET,
    environment = process.env.QF_ENV || "prelive",
    fetcher = fetch,
  } = {}) {
    if (!["prelive", "production"].includes(environment))
      throw Error("QF_ENV must be prelive or production.");
    this.id = clientId;
    this.secret = clientSecret;
    this.environment = environment;
    this.fetch = fetcher;
    this.token = null;
    this.expires = 0;
    this.base =
      environment === "production"
        ? "https://apis.quran.foundation"
        : "https://apis-prelive.quran.foundation";
    this.auth =
      environment === "production"
        ? "https://oauth2.quran.foundation"
        : "https://prelive-oauth2.quran.foundation";
  }
  async access() {
    if (!this.id || !this.secret)
      throw Error(
        "Quran Foundation is not configured. Set QF_CLIENT_ID and QF_CLIENT_SECRET on the content service.",
      );
    if (this.token && Date.now() < this.expires) return this.token;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      const response = await this.fetch(this.auth + "/oauth2/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(this.id + ":" + this.secret).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials&scope=content",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw Error(
          "Quran Foundation authentication failed (" +
            response.status +
            "). Check the server credentials and environment.",
        );
      const data = await response.json();
      if (!data.access_token)
        throw Error("Quran Foundation did not return an access token.");
      this.token = data.access_token;
      this.expires =
        Date.now() + Math.max(0, (data.expires_in || 3600) - 60) * 1000;
      return this.token;
    })();
    try {
      return await this.tokenRequest;
    } finally {
      this.tokenRequest = null;
    }
  }
  url(path) {
    const raw = /^https:\/\//.test(path)
      ? path
      : path.startsWith("/api/v4/")
        ? "/content" + path
        : path.startsWith("/content/")
          ? path
          : "/content/api/v4" + path;
    const u = new URL(raw, this.base);
    if (u.origin !== this.base || !u.pathname.startsWith("/content/api/v4/"))
      throw Error("Unexpected content URL.");
    return u.href;
  }
  async get(path, retry = true) {
    const token = await this.access();
    const response = await this.fetch(this.url(path), {
      headers: { "x-auth-token": token, "x-client-id": this.id },
      signal: AbortSignal.timeout(45000),
      redirect: "error",
    });
    if (response.status === 401 && retry) {
      this.token = null;
      return this.get(path, false);
    }
    if (!response.ok) {
      const error = Error(
        response.status === 403
          ? "Quran Foundation has not approved this resource for this app."
          : response.status === 429
            ? "Quran Foundation rate limit reached. Please try again later."
            : "Quran Foundation request failed (" + response.status + ").",
      );
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
}
// A complete snapshot is published atomically only after the sync feed and all
// snapshots succeed. Rebuilding from a fresh bootstrap avoids partial row replay.
export class SnapshotStore {
  constructor(client, dir) {
    this.client = client;
    this.dir = dir;
    this.memory = new Map();
    this.inflight = new Map();
  }
  async resource(group, id) {
    const key = group + ":" + id;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = this.load(group, id, key);
    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }
  async load(group, id, key) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = resolve(this.dir, group + "-" + id + ".json");
    let cached = this.memory.get(key);
    if (!cached) {
      try {
        cached = JSON.parse(await readFile(file, "utf8"));
      } catch {}
    }
    if (cached && Date.now() - cached.syncedAt < WEEK) {
      this.memory.set(key, cached);
      return cached.records;
    }
    let next =
      "/resources/sync?" +
      new URLSearchParams({
        bootstrap: "true",
        resources: key,
        per_page: "100",
      });
    let token = null;
    let pages = 0;
    // Bootstrap establishes the sync checkpoint; snapshots include the full current
    // resource, including grouped tafsir passages and translation footnotes.
    while (next) {
      if (++pages > 1000) throw Error("Content sync exceeded its page limit.");
      const result = await this.client.get(next);
      const sync = result.sync;
      if (!sync) throw Error("Invalid Content Sync response.");
      next = sync.has_more ? sync.next_page_url : null;
      if (sync.has_more && !next) throw Error("Content Sync page is missing.");
      if (!next) token = sync.next_sync_token;
    }
    if (!token) throw Error("Content Sync checkpoint is missing.");
    const snapshot = await this.client.get(
      `/resources/snapshots/${group}/${id}`,
    );
    if (!Array.isArray(snapshot.records))
      throw Error("Invalid Content Sync snapshot.");
    const value = {
      syncedAt: Date.now(),
      token,
      records: snapshot.records,
      syncSequence: snapshot.sync_sequence,
    };
    await writeFile(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
    await rename(file + ".tmp", file);
    this.memory.set(key, value);
    return value.records;
  }
}
export function integer(value, min, max) {
  if (!/^\d+$/.test(String(value)) || +value < min || +value > max)
    throw Error("Invalid resource or reference.");
  return +value;
}
function ids(value) {
  if (!value) return [];
  const parts = value.split(",");
  if (parts.length > 5) throw Error("Choose at most five translations.");
  return [...new Set(parts.map((v) => integer(v, 1, 100000)))];
}
export function matchingTafsir(records, verse) {
  return (
    records.find((r) => r.text && r.verse_key === verse.verse_key) ||
    records.find(
      (r) =>
        r.text && r.start_verse_id <= verse.id && r.end_verse_id >= verse.id,
    )
  );
}
export function createService({
  client = new QFClient(),
  cacheDir = process.env.BAYAN_CACHE || resolve("work/bayan-content"),
} = {}) {
  const snapshots = new SnapshotStore(
    client,
    resolve(cacheDir, client.environment),
  );
  let catalog = null,
    catalogTime = 0,
    catalogRequest = null;
  async function getCatalog() {
    if (catalog && Date.now() - catalogTime < 3600000) return catalog;
    if (catalogRequest) return catalogRequest;
    catalogRequest = (async () => {
      const [chapters, translations, tafsirs, recitations] = await Promise.all(
        [
          "/chapters?language=en",
          "/resources/translations?language=en",
          "/resources/tafsirs?language=en",
          "/resources/recitations?language=en",
        ].map((p) => client.get(p)),
      );
      catalog = {
        environment: client.environment,
        chapters: chapters.chapters,
        resources: {
          translations: translations.translations.filter(
            (t) =>
              t.language_name === "english" &&
              t.id !== 57 &&
              !/transliteration/i.test(t.name),
          ),
          tafsirs: tafsirs.tafsirs.filter((t) => t.language_name === "english"),
          reciters: recitations.recitations.map((r) => ({
            ...r,
            name: r.reciter_name + (r.style ? " (" + r.style + ")" : ""),
          })),
        },
      };
      catalogTime = Date.now();
      return catalog;
    })();
    try {
      return await catalogRequest;
    } finally {
      catalogRequest = null;
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, data) => {
      res.writeHead(status);
      res.end(JSON.stringify(data));
    };
    // No browser CORS: only Bayan's native URLSession bridge calls this service.
    if (req.method !== "GET")
      return send(405, { error: "Only read requests are supported." });
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/health")
        return send(200, {
          ok: true,
          configured: !!(client.id && client.secret),
          environment: client.environment,
        });
      if (url.pathname === "/v1/catalog") return send(200, await getCatalog());
      const juz = /^\/v1\/juz\/(\d+)$/.exec(url.pathname);
      if (juz) {
        const n = integer(juz[1], 1, 30);
        const result = await client.get("/verses/by_juz/" + n + "?per_page=1");
        if (!result.verses?.[0])
          throw Error("This juz is unavailable in the current environment.");
        return send(200, { verse_key: result.verses[0].verse_key });
      }
      const match = /^\/v1\/chapter\/(\d+)$/.exec(url.pathname);
      if (!match) return send(404, { error: "Unknown content route." });
      const chapter = integer(match[1], 1, 114);
      const translations = ids(url.searchParams.get("translations"));
      const tafsir = url.searchParams.get("tafsir")
        ? integer(url.searchParams.get("tafsir"), 1, 100000)
        : null;
      const reciter = url.searchParams.get("reciter")
        ? integer(url.searchParams.get("reciter"), 1, 100000)
        : null;
      const catalog = await getCatalog();
      for (const [kind, requested] of [
        ["translations", translations],
        ["tafsirs", tafsir ? [tafsir] : []],
        ["reciters", reciter ? [reciter] : []],
      ])
        if (
          requested.some(
            (id) => !catalog.resources[kind].some((r) => r.id === id),
          )
        )
          throw Error("Choose a resource from the available catalog.");
      const translationRows = await Promise.all(
        translations.map((id) => snapshots.resource("translations", id)),
      );
      const tafsirRows = tafsir
        ? await snapshots.resource("tafsirs", tafsir)
        : [];
      const verses = [];
      let page = 1;
      while (page) {
        const query = new URLSearchParams({
          language: "en",
          words: "true",
          word_fields: "text_uthmani",
          fields: "text_uthmani",
          per_page: "50",
          page: String(page),
        });
        if (reciter) query.set("audio", reciter);
        const data = await client.get(`/verses/by_chapter/${chapter}?${query}`);
        if (!Array.isArray(data.verses)) throw Error("Invalid verse response.");
        verses.push(...data.verses);
        const next = data.pagination?.next_page;
        if (next && (+next <= page || +next > 20))
          throw Error("Invalid verse pagination.");
        page = next ? +next : 0;
      }
      for (const v of verses) {
        v.chapter_id = chapter;
        v.translations = translations.flatMap((id, index) => {
          const r = translationRows[index].find(
            (r) => r.verse_key === v.verse_key,
          );
          return r ? [{ ...r, resource_id: id }] : [];
        });
        const t = matchingTafsir(tafsirRows, v);
        v.tafsirs = t ? [{ ...t, resource_id: tafsir }] : [];
      }
      send(200, {
        verses,
        attribution: "Quran Foundation",
        environment: client.environment,
      });
    } catch (error) {
      send(error.status === 403 ? 403 : error.status === 429 ? 429 : 503, {
        error: error.message,
      });
    }
  });
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = createService();
  server.listen(Number(process.env.PORT || 8787), "127.0.0.1", () =>
    console.log(
      "Bayan content service: http://127.0.0.1:" + (process.env.PORT || 8787),
    ),
  );
}
