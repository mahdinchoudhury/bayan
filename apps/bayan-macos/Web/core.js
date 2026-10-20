(function (root) {
  "use strict";
  const counts = [
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128,
    111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73,
    54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49,
    62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28,
    28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
    15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5,
    6,
  ];
  function validRef(key) {
    const m = /^(\d{1,3}):(\d{1,3})$/.exec(key);
    return (
      !!m &&
      +m[1] >= 1 &&
      +m[1] <= 114 &&
      +m[2] >= 1 &&
      +m[2] <= counts[+m[1] - 1]
    );
  }
  function normalize(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u06d6-\u06ed]/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .toLowerCase();
  }
  function search(verses, query) {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return verses.filter((v) => {
      const text = normalize(
        [
          v.text_uthmani,
          ...(v.translations || []).map((t) => t.plain_text ?? t.text),
          v.verse_key,
        ].join(" "),
      );
      return terms.every((t) => text.includes(t));
    });
  }
  function validateBackup(data) {
    if (
      !data ||
      data.app !== "Bayan" ||
      data.version !== 1 ||
      !data.study ||
      typeof data.study !== "object" ||
      Array.isArray(data.study)
    )
      throw Error("Choose a Bayan backup file.");
    const colors = ["yellow", "green", "blue", "pink", "purple", "orange"];
    for (const [key, s] of Object.entries(data.study)) {
      if (
        !validRef(key) ||
        !s ||
        typeof s !== "object" ||
        typeof s.note !== "string" ||
        s.note.length > 1000000 ||
        typeof s.bookmark !== "boolean" ||
        (s.color !== null && !colors.includes(s.color)) ||
        typeof s.updated !== "string" ||
        !Number.isFinite(Date.parse(s.updated))
      )
        throw Error("This backup has an invalid verse or study entry.");
    }
    return data.study;
  }
  function mergeStudy(existing, incoming) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      if (
        !merged[key] ||
        Date.parse(value.updated) > Date.parse(merged[key].updated)
      )
        merged[key] = value;
    }
    return merged;
  }
  const api = {
    counts,
    validRef,
    normalize,
    search,
    validateBackup,
    mergeStudy,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.BayanCore = api;
})(globalThis);
