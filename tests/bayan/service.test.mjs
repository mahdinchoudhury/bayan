import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QFClient,
  SnapshotStore,
  matchingTafsir,
  createService,
} from "../../service/bayan/server.mjs";
test("client retries a 401 once and does not send the secret to content endpoints", async () => {
  const calls = [];
  let contentCalls = 0;
  const client = new QFClient({
    clientId: "test-id",
    clientSecret: "test-secret",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("oauth2/token"))
        return Response.json({
          access_token: "token-" + calls.length,
          expires_in: 3600,
        });
      return ++contentCalls === 1
        ? new Response("", { status: 401 })
        : Response.json({ chapters: [] });
    },
  });
  await client.get("/chapters");
  assert.equal(calls.length, 4);
  assert.equal(calls[1].options.headers["x-client-id"], "test-id");
  assert.ok(!JSON.stringify(calls[1]).includes("test-secret"));
  assert.throws(() => client.url("https://evil.example/steal"));
});
test("grouped tafsir resolves by verse range", () => {
  assert.equal(
    matchingTafsir(
      [
        { text: "", verse_key: "2:2" },
        { text: "passage", start_verse_id: 8, end_verse_id: 12 },
      ],
      { id: 9, verse_key: "2:2" },
    ).text,
    "passage",
  );
});
test("snapshot is only cached after a complete successful sync", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bayan-test-"));
  let requests = 0;
  const client = {
    get: async (path) => {
      requests++;
      if (path.startsWith("/resources/sync"))
        return { sync: { has_more: false, next_sync_token: "checkpoint" } };
      return {
        records: [{ verse_key: "1:1", text: "Synthetic fixture" }],
        sync_sequence: 10,
      };
    },
  };
  try {
    const store = new SnapshotStore(client, dir);
    const rows = await store.resource("translations", 131);
    assert.equal(rows.length, 1);
    await store.resource("translations", 131);
    assert.equal(requests, 2);
  } finally {
    await rm(dir, { recursive: true });
  }
});
test("unconfigured service returns useful errors without credentials", async () => {
  const server = createService({
    client: new QFClient({ clientId: null, clientSecret: null }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    assert.equal(
      (await (await fetch(base + "/health")).json()).configured,
      false,
    );
    const response = await fetch(base + "/v1/catalog");
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/);
  } finally {
    server.close();
  }
});
