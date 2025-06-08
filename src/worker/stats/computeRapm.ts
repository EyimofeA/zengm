import type { IDBPDatabase } from "@dumbmatter/idb";
import type { LeagueDB } from "../db/connectLeague";


export type RapmByPid = Record<number, { rapm1: number; rapm3: number; rapm5: number }>; 

const solve = (A: number[][], b: number[]): number[] => {
  const n = A.length;
  // Augment matrix with b
  for (let i = 0; i < n; i++) {
    A[i] = [...A[i], b[i]];
  }
  for (let i = 0; i < n; i++) {
    // Pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }
    if (maxRow !== i) {
      const tmp = A[i];
      A[i] = A[maxRow];
      A[maxRow] = tmp;
    }
    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-12) {
      continue;
    }
    for (let j = i; j <= n; j++) {
      A[i][j] /= pivot;
    }
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = A[k][i];
      for (let j = i; j <= n; j++) {
        A[k][j] -= factor * A[i][j];
      }
    }
  }
  return A.map(row => row[n] ?? 0);
};

const gatherLineups = async (
  db: IDBPDatabase<LeagueDB>,
  start: number,
  end: number,
) => {
  const tx = db.transaction("lineupData");
  const store = tx.store;
  const results: any[] = [];
  let cursor = await store.openCursor();
  while (cursor) {
    const value = cursor.value as any;
    if (value.season >= start && value.season <= end) {
      results.push(value);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return results;
};

const runRegression = (
  stints: any[],
  pids: number[],
  pidToIndex: Map<number, number>,
  lambda: number,
): number[] => {
  const n = pids.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const stint of stints) {
    const weight = stint.homePossessions + stint.awayPossessions;
    const net = (stint.homePoints - stint.awayPoints) / weight;
    const players = [...stint.homePlayerIds, ...stint.awayPlayerIds];
    for (let i = 0; i < players.length; i++) {
      const idxI = pidToIndex.get(players[i])!;
      const signI = i < 5 ? 1 : -1;
      b[idxI] += weight * signI * net;
      for (let j = 0; j < players.length; j++) {
        const idxJ = pidToIndex.get(players[j])!;
        const signJ = j < 5 ? 1 : -1;
        A[idxI][idxJ] += weight * signI * signJ;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    A[i][i] += lambda;
  }
  return solve(A, b);
};

const computeError = (
  coeffs: number[],
  stints: any[],
  pidToIndex: Map<number, number>,
): number => {
  let error = 0;
  for (const stint of stints) {
    const weight = stint.homePossessions + stint.awayPossessions;
    const net = (stint.homePoints - stint.awayPoints) / weight;
    const players = [...stint.homePlayerIds, ...stint.awayPlayerIds];
    let pred = 0;
    for (let i = 0; i < players.length; i++) {
      const idx = pidToIndex.get(players[i])!;
      const sign = i < 5 ? 1 : -1;
      pred += coeffs[idx] * sign;
    }
    const diff = net - pred;
    error += diff * diff * weight;
  }
  return error;
};

const crossValidateLambda = (
  stints: any[],
  pids: number[],
  pidToIndex: Map<number, number>,
): number => {
  const lambdas = [100, 200, 400, 800, 1600];
  const k = Math.min(5, stints.length);
  const shuffled = [...stints];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const folds: any[][] = [];
  const foldSize = Math.ceil(shuffled.length / k);
  for (let i = 0; i < k; i++) {
    folds.push(shuffled.slice(i * foldSize, (i + 1) * foldSize));
  }

  let bestLambda = lambdas[0];
  let bestError = Infinity;
  for (const lambda of lambdas) {
    let error = 0;
    for (let i = 0; i < k; i++) {
      const test = folds[i];
      const train: any[] = [];
      for (let j = 0; j < k; j++) {
        if (j !== i) {
          train.push(...folds[j]);
        }
      }
      const coeffs = runRegression(train, pids, pidToIndex, lambda);
      error += computeError(coeffs, test, pidToIndex);
    }
    error /= k;
    if (error < bestError) {
      bestError = error;
      bestLambda = lambda;
    }
  }
  return bestLambda;
};

export const computeRapmForSeason = async (
  season: number,
  seasonsBack: number[],
  db: IDBPDatabase<LeagueDB>,
): Promise<RapmByPid> => {
  const maxBack = Math.max(...seasonsBack);
  const earliest = season - maxBack + 1;
  const stintsAll = await gatherLineups(db, earliest, season);
  const pidSet = new Set<number>();
  for (const stint of stintsAll) {
    for (const pid of [...stint.homePlayerIds, ...stint.awayPlayerIds]) {
      pidSet.add(pid);
    }
  }
  const pids = Array.from(pidSet);
  pids.sort((a, b) => a - b);
  const pidToIndex = new Map<number, number>();
  pids.forEach((pid, i) => pidToIndex.set(pid, i));

  const lambda = crossValidateLambda(stintsAll, pids, pidToIndex);

  const coeffByN: Record<number, number[]> = {};
  for (const n of seasonsBack) {
    const start = season - n + 1;
    const stints = stintsAll.filter(l => l.season >= start);
    coeffByN[n] = runRegression(stints, pids, pidToIndex, lambda);
  }

  const output: RapmByPid = {};
  for (let i = 0; i < pids.length; i++) {
    output[pids[i]] = {
      rapm1: coeffByN[1]?.[i] ?? 0,
      rapm3: coeffByN[3]?.[i] ?? coeffByN[1]?.[i] ?? 0,
      rapm5: coeffByN[5]?.[i] ?? coeffByN[3]?.[i] ?? coeffByN[1]?.[i] ?? 0,
    };
  }
  return output;
};

