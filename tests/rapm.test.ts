import assert from "node:assert/strict";
import { IDBPDatabase, openDB } from "@dumbmatter/idb";

import { computeRapmForSeason } from "../src/worker/stats/computeRapm";

interface Lineup {
  id?: number;
  homePlayerIds: number[];
  awayPlayerIds: number[];
  homePossessions: number;
  homePoints: number;
  awayPossessions: number;
  awayPoints: number;
  season: number;
}

interface LeagueDB extends DBSchema {
  lineupData: {
    key: number;
    value: Lineup;
  };
}

describe("computeRapmForSeason", () => {
  let db: IDBPDatabase<LeagueDB>;
  beforeAll(async () => {
    db = await openDB<LeagueDB>("rapm-test", 1, {
      upgrade(db) {
        db.createObjectStore("lineupData", { keyPath: "id", autoIncrement: true });
      },
    });
    const tx = db.transaction("lineupData", "readwrite");
    const store = tx.objectStore("lineupData");
    const add = (l: Lineup) => store.add(l);
    // Season 0
    await add({
      homePlayerIds: [1, 2, 3, 4, 5],
      awayPlayerIds: [6, 7, 8, 9, 10],
      homePossessions: 50,
      homePoints: 55,
      awayPossessions: 50,
      awayPoints: 45,
      season: 0,
    });
    // Season 1
    await add({
      homePlayerIds: [1, 2, 3, 4, 5],
      awayPlayerIds: [6, 7, 8, 9, 10],
      homePossessions: 60,
      homePoints: 66,
      awayPossessions: 60,
      awayPoints: 54,
      season: 1,
    });
    await tx.done;
  });

  afterAll(async () => {
    await db.close();
    await indexedDB.deleteDatabase("rapm-test");
  });

  test("numbers are finite and rapm3 is mean of rapm1s with weights", async () => {
    const rapm = await computeRapmForSeason(1, [1, 3], db);
    for (const vals of Object.values(rapm)) {
      expect(Number.isFinite(vals.rapm1)).toBe(true);
      expect(Number.isFinite(vals.rapm3)).toBe(true);
    }
    const r0 = await computeRapmForSeason(0, [1], db);
    const r1 = await computeRapmForSeason(1, [1], db);
    for (const pid of Object.keys(rapm)) {
      const v0 = r0[Number(pid)]?.rapm1 ?? 0;
      const v1 = r1[Number(pid)]?.rapm1 ?? 0;
      const expected = (v0 * 50 + v1 * 60) / (50 + 60);
      assert(Math.abs(expected - rapm[Number(pid)].rapm3) < 1e-6);
    }
  });
});
