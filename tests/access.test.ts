import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  DEFAULT_MODES,
  OPEN_SNAPSHOT,
  getSnapshot,
  modesFor,
  pagesForPath,
  resetSnapshotCache,
  verdictFor,
  verdictForPath,
  visiblePages,
  type AccessSnapshot,
} from "../lib/access.ts";

function snapshot(partial: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    modes: { ...DEFAULT_MODES, ...partial.modes },
    allowed: { market: [], karman: [], ticker: [], ...partial.allowed },
  };
}

describe("pagesForPath", () => {
  it("сопоставляет страницы и маршруты разделам", () => {
    assert.deepEqual(pagesForPath("/market"), ["market"]);
    assert.deepEqual(pagesForPath("/market/info"), ["market"]);
    assert.deepEqual(pagesForPath("/api/karman/contracts"), ["karman"]);
    assert.deepEqual(pagesForPath("/ticker"), ["ticker"]);
  });

  it("котировки нужны двум разделам", () => {
    assert.deepEqual(pagesForPath("/api/ticker/quotes"), ["ticker", "karman"]);
  });

  it("не путает похожие префиксы", () => {
    assert.deepEqual(pagesForPath("/marketing"), []);
    assert.deepEqual(pagesForPath("/tickers"), []);
  });

  it("путь вне механизма не относится ни к одному разделу", () => {
    assert.deepEqual(pagesForPath("/protected"), []);
    assert.deepEqual(pagesForPath("/"), []);
  });
});

describe("verdictFor", () => {
  it("публичный режим пускает анонима", () => {
    assert.equal(verdictFor(snapshot(), "market", null), "allow");
  });

  it("аноним в закрытом разделе получает needLogin", () => {
    assert.equal(verdictFor(snapshot(), "karman", null), "needLogin");
  });

  it("режим authenticated пускает любого вошедшего", () => {
    assert.equal(verdictFor(snapshot(), "karman", "a@b.ru"), "allow");
  });

  it("режим list пускает только допущенных, регистр почты не важен", () => {
    const s = snapshot({
      modes: { ...DEFAULT_MODES, karman: "list" },
      allowed: { market: [], karman: ["a@b.ru"], ticker: [] },
    });
    assert.equal(verdictFor(s, "karman", "A@B.RU"), "allow");
    assert.equal(verdictFor(s, "karman", "x@y.ru"), "denied");
    assert.equal(verdictFor(s, "karman", null), "needLogin");
  });
});

describe("verdictForPath", () => {
  it("путь вне механизма всегда разрешён этим слоем", () => {
    assert.deepEqual(verdictForPath(snapshot(), "/protected", null), {
      verdict: "allow",
      page: null,
    });
  });

  it("путь двух разделов открыт, если открыт хотя бы один", () => {
    const s = snapshot({
      modes: { ...DEFAULT_MODES, ticker: "list", karman: "authenticated" },
    });
    assert.equal(verdictForPath(s, "/api/ticker/quotes", "x@y.ru").verdict, "allow");
  });

  it("из двух отказов выбирается needLogin", () => {
    const s = snapshot({
      modes: { ...DEFAULT_MODES, ticker: "list", karman: "list" },
    });
    assert.equal(verdictForPath(s, "/api/ticker/quotes", null).verdict, "needLogin");
    assert.equal(verdictForPath(s, "/api/ticker/quotes", "x@y.ru").verdict, "denied");
  });
});

describe("публичный режим и видимость", () => {
  it("публичный режим допустим только для market", () => {
    assert.ok(modesFor("market").includes("public"));
    assert.ok(!modesFor("karman").includes("public"));
    assert.ok(!modesFor("ticker").includes("public"));
  });

  it("visiblePages скрывает недоступное", () => {
    assert.deepEqual(visiblePages(snapshot(), null), ["market"]);
    assert.deepEqual(visiblePages(snapshot(), "a@b.ru"), ["market", "karman", "ticker"]);
  });
});

describe("getSnapshot (кэш)", () => {
  beforeEach(() => resetSnapshotCache());

  it("повторный вызов в пределах TTL не ходит в загрузчик", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return snapshot();
    };
    await getSnapshot(load);
    await getSnapshot(load);
    assert.equal(calls, 1);
  });

  it("параллельные вызовы делят одну загрузку", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return snapshot();
    };
    await Promise.all([getSnapshot(load), getSnapshot(load), getSnapshot(load)]);
    assert.equal(calls, 1);
  });

  it("ошибка загрузки отдаёт режимы по умолчанию и не кэшируется", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("db down");
    };
    assert.deepEqual(await getSnapshot(failing), OPEN_SNAPSHOT);
    await getSnapshot(failing);
    assert.equal(calls, 2);
  });
});
