import type { IDBPDatabase } from "@dumbmatter/idb";
import type { LeagueDB } from "../db/connectLeague";

export type RapmByPid = Record<
	number,
	{ rapm1: number; rapm3: number; rapm5: number }
>;

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
	const size = n * 2;
	// Create matrix for BOTH offense and defense (2x the players)
	const A = Array.from({ length: size }, () => new Array(size).fill(0));
	const b = new Array(size).fill(0);

	for (const stint of stints) {
		// Skip stints with missing data
		if (
			stint.homePoints === undefined ||
			stint.awayPoints === undefined ||
			stint.homePossessions === undefined ||
			stint.awayPossessions === undefined ||
			stint.homePlayerIds?.length !== 5 ||
			stint.awayPlayerIds?.length !== 5
		) {
			continue;
		}

		// Home possession observation
		if (stint.homePossessions > 0) {
			const weight = stint.homePossessions;
			const y = stint.homePoints / weight;

			// Get indices directly (avoid intermediate array allocation)
			const homeOff0 = pidToIndex.get(stint.homePlayerIds[0])!;
			const homeOff1 = pidToIndex.get(stint.homePlayerIds[1])!;
			const homeOff2 = pidToIndex.get(stint.homePlayerIds[2])!;
			const homeOff3 = pidToIndex.get(stint.homePlayerIds[3])!;
			const homeOff4 = pidToIndex.get(stint.homePlayerIds[4])!;
			const awayDef0 = pidToIndex.get(stint.awayPlayerIds[0])! + n;
			const awayDef1 = pidToIndex.get(stint.awayPlayerIds[1])! + n;
			const awayDef2 = pidToIndex.get(stint.awayPlayerIds[2])! + n;
			const awayDef3 = pidToIndex.get(stint.awayPlayerIds[3])! + n;
			const awayDef4 = pidToIndex.get(stint.awayPlayerIds[4])! + n;

			const wy = weight * y;
			// Update b vector
			b[homeOff0] += wy; b[homeOff1] += wy; b[homeOff2] += wy; b[homeOff3] += wy; b[homeOff4] += wy;
			b[awayDef0] += wy; b[awayDef1] += wy; b[awayDef2] += wy; b[awayDef3] += wy; b[awayDef4] += wy;

			// Update A matrix (symmetric, so only need to update upper triangle)
			// Home offensive block
			A[homeOff0][homeOff0] += weight; A[homeOff0][homeOff1] += weight; A[homeOff0][homeOff2] += weight; A[homeOff0][homeOff3] += weight; A[homeOff0][homeOff4] += weight;
			A[homeOff1][homeOff0] += weight; A[homeOff1][homeOff1] += weight; A[homeOff1][homeOff2] += weight; A[homeOff1][homeOff3] += weight; A[homeOff1][homeOff4] += weight;
			A[homeOff2][homeOff0] += weight; A[homeOff2][homeOff1] += weight; A[homeOff2][homeOff2] += weight; A[homeOff2][homeOff3] += weight; A[homeOff2][homeOff4] += weight;
			A[homeOff3][homeOff0] += weight; A[homeOff3][homeOff1] += weight; A[homeOff3][homeOff2] += weight; A[homeOff3][homeOff3] += weight; A[homeOff3][homeOff4] += weight;
			A[homeOff4][homeOff0] += weight; A[homeOff4][homeOff1] += weight; A[homeOff4][homeOff2] += weight; A[homeOff4][homeOff3] += weight; A[homeOff4][homeOff4] += weight;

			// Away defensive block
			A[awayDef0][awayDef0] += weight; A[awayDef0][awayDef1] += weight; A[awayDef0][awayDef2] += weight; A[awayDef0][awayDef3] += weight; A[awayDef0][awayDef4] += weight;
			A[awayDef1][awayDef0] += weight; A[awayDef1][awayDef1] += weight; A[awayDef1][awayDef2] += weight; A[awayDef1][awayDef3] += weight; A[awayDef1][awayDef4] += weight;
			A[awayDef2][awayDef0] += weight; A[awayDef2][awayDef1] += weight; A[awayDef2][awayDef2] += weight; A[awayDef2][awayDef3] += weight; A[awayDef2][awayDef4] += weight;
			A[awayDef3][awayDef0] += weight; A[awayDef3][awayDef1] += weight; A[awayDef3][awayDef2] += weight; A[awayDef3][awayDef3] += weight; A[awayDef3][awayDef4] += weight;
			A[awayDef4][awayDef0] += weight; A[awayDef4][awayDef1] += weight; A[awayDef4][awayDef2] += weight; A[awayDef4][awayDef3] += weight; A[awayDef4][awayDef4] += weight;

			// Cross block (home off x away def)
			A[homeOff0][awayDef0] += weight; A[homeOff0][awayDef1] += weight; A[homeOff0][awayDef2] += weight; A[homeOff0][awayDef3] += weight; A[homeOff0][awayDef4] += weight;
			A[homeOff1][awayDef0] += weight; A[homeOff1][awayDef1] += weight; A[homeOff1][awayDef2] += weight; A[homeOff1][awayDef3] += weight; A[homeOff1][awayDef4] += weight;
			A[homeOff2][awayDef0] += weight; A[homeOff2][awayDef1] += weight; A[homeOff2][awayDef2] += weight; A[homeOff2][awayDef3] += weight; A[homeOff2][awayDef4] += weight;
			A[homeOff3][awayDef0] += weight; A[homeOff3][awayDef1] += weight; A[homeOff3][awayDef2] += weight; A[homeOff3][awayDef3] += weight; A[homeOff3][awayDef4] += weight;
			A[homeOff4][awayDef0] += weight; A[homeOff4][awayDef1] += weight; A[homeOff4][awayDef2] += weight; A[homeOff4][awayDef3] += weight; A[homeOff4][awayDef4] += weight;

			A[awayDef0][homeOff0] += weight; A[awayDef0][homeOff1] += weight; A[awayDef0][homeOff2] += weight; A[awayDef0][homeOff3] += weight; A[awayDef0][homeOff4] += weight;
			A[awayDef1][homeOff0] += weight; A[awayDef1][homeOff1] += weight; A[awayDef1][homeOff2] += weight; A[awayDef1][homeOff3] += weight; A[awayDef1][homeOff4] += weight;
			A[awayDef2][homeOff0] += weight; A[awayDef2][homeOff1] += weight; A[awayDef2][homeOff2] += weight; A[awayDef2][homeOff3] += weight; A[awayDef2][homeOff4] += weight;
			A[awayDef3][homeOff0] += weight; A[awayDef3][homeOff1] += weight; A[awayDef3][homeOff2] += weight; A[awayDef3][homeOff3] += weight; A[awayDef3][homeOff4] += weight;
			A[awayDef4][homeOff0] += weight; A[awayDef4][homeOff1] += weight; A[awayDef4][homeOff2] += weight; A[awayDef4][homeOff3] += weight; A[awayDef4][homeOff4] += weight;
		}

		// Away possession observation
		if (stint.awayPossessions > 0) {
			const weight = stint.awayPossessions;
			const y = stint.awayPoints / weight;

			const awayOff0 = pidToIndex.get(stint.awayPlayerIds[0])!;
			const awayOff1 = pidToIndex.get(stint.awayPlayerIds[1])!;
			const awayOff2 = pidToIndex.get(stint.awayPlayerIds[2])!;
			const awayOff3 = pidToIndex.get(stint.awayPlayerIds[3])!;
			const awayOff4 = pidToIndex.get(stint.awayPlayerIds[4])!;
			const homeDef0 = pidToIndex.get(stint.homePlayerIds[0])! + n;
			const homeDef1 = pidToIndex.get(stint.homePlayerIds[1])! + n;
			const homeDef2 = pidToIndex.get(stint.homePlayerIds[2])! + n;
			const homeDef3 = pidToIndex.get(stint.homePlayerIds[3])! + n;
			const homeDef4 = pidToIndex.get(stint.homePlayerIds[4])! + n;

			const wy = weight * y;
			b[awayOff0] += wy; b[awayOff1] += wy; b[awayOff2] += wy; b[awayOff3] += wy; b[awayOff4] += wy;
			b[homeDef0] += wy; b[homeDef1] += wy; b[homeDef2] += wy; b[homeDef3] += wy; b[homeDef4] += wy;

			// Away offensive block
			A[awayOff0][awayOff0] += weight; A[awayOff0][awayOff1] += weight; A[awayOff0][awayOff2] += weight; A[awayOff0][awayOff3] += weight; A[awayOff0][awayOff4] += weight;
			A[awayOff1][awayOff0] += weight; A[awayOff1][awayOff1] += weight; A[awayOff1][awayOff2] += weight; A[awayOff1][awayOff3] += weight; A[awayOff1][awayOff4] += weight;
			A[awayOff2][awayOff0] += weight; A[awayOff2][awayOff1] += weight; A[awayOff2][awayOff2] += weight; A[awayOff2][awayOff3] += weight; A[awayOff2][awayOff4] += weight;
			A[awayOff3][awayOff0] += weight; A[awayOff3][awayOff1] += weight; A[awayOff3][awayOff2] += weight; A[awayOff3][awayOff3] += weight; A[awayOff3][awayOff4] += weight;
			A[awayOff4][awayOff0] += weight; A[awayOff4][awayOff1] += weight; A[awayOff4][awayOff2] += weight; A[awayOff4][awayOff3] += weight; A[awayOff4][awayOff4] += weight;

			// Home defensive block
			A[homeDef0][homeDef0] += weight; A[homeDef0][homeDef1] += weight; A[homeDef0][homeDef2] += weight; A[homeDef0][homeDef3] += weight; A[homeDef0][homeDef4] += weight;
			A[homeDef1][homeDef0] += weight; A[homeDef1][homeDef1] += weight; A[homeDef1][homeDef2] += weight; A[homeDef1][homeDef3] += weight; A[homeDef1][homeDef4] += weight;
			A[homeDef2][homeDef0] += weight; A[homeDef2][homeDef1] += weight; A[homeDef2][homeDef2] += weight; A[homeDef2][homeDef3] += weight; A[homeDef2][homeDef4] += weight;
			A[homeDef3][homeDef0] += weight; A[homeDef3][homeDef1] += weight; A[homeDef3][homeDef2] += weight; A[homeDef3][homeDef3] += weight; A[homeDef3][homeDef4] += weight;
			A[homeDef4][homeDef0] += weight; A[homeDef4][homeDef1] += weight; A[homeDef4][homeDef2] += weight; A[homeDef4][homeDef3] += weight; A[homeDef4][homeDef4] += weight;

			// Cross block (away off x home def)
			A[awayOff0][homeDef0] += weight; A[awayOff0][homeDef1] += weight; A[awayOff0][homeDef2] += weight; A[awayOff0][homeDef3] += weight; A[awayOff0][homeDef4] += weight;
			A[awayOff1][homeDef0] += weight; A[awayOff1][homeDef1] += weight; A[awayOff1][homeDef2] += weight; A[awayOff1][homeDef3] += weight; A[awayOff1][homeDef4] += weight;
			A[awayOff2][homeDef0] += weight; A[awayOff2][homeDef1] += weight; A[awayOff2][homeDef2] += weight; A[awayOff2][homeDef3] += weight; A[awayOff2][homeDef4] += weight;
			A[awayOff3][homeDef0] += weight; A[awayOff3][homeDef1] += weight; A[awayOff3][homeDef2] += weight; A[awayOff3][homeDef3] += weight; A[awayOff3][homeDef4] += weight;
			A[awayOff4][homeDef0] += weight; A[awayOff4][homeDef1] += weight; A[awayOff4][homeDef2] += weight; A[awayOff4][homeDef3] += weight; A[awayOff4][homeDef4] += weight;

			A[homeDef0][awayOff0] += weight; A[homeDef0][awayOff1] += weight; A[homeDef0][awayOff2] += weight; A[homeDef0][awayOff3] += weight; A[homeDef0][awayOff4] += weight;
			A[homeDef1][awayOff0] += weight; A[homeDef1][awayOff1] += weight; A[homeDef1][awayOff2] += weight; A[homeDef1][awayOff3] += weight; A[homeDef1][awayOff4] += weight;
			A[homeDef2][awayOff0] += weight; A[homeDef2][awayOff1] += weight; A[homeDef2][awayOff2] += weight; A[homeDef2][awayOff3] += weight; A[homeDef2][awayOff4] += weight;
			A[homeDef3][awayOff0] += weight; A[homeDef3][awayOff1] += weight; A[homeDef3][awayOff2] += weight; A[homeDef3][awayOff3] += weight; A[homeDef3][awayOff4] += weight;
			A[homeDef4][awayOff0] += weight; A[homeDef4][awayOff1] += weight; A[homeDef4][awayOff2] += weight; A[homeDef4][awayOff3] += weight; A[homeDef4][awayOff4] += weight;
		}
	}

	// Add regularization
	for (let i = 0; i < size; i++) {
		A[i][i] += lambda;
	}

	const coeffs = solve(A, b);

	// Return net RAPM (offense - defense) for each player
	const netRapm = new Array(n);
	for (let i = 0; i < n; i++) {
		netRapm[i] = coeffs[i] - coeffs[i + n];
	}
	return netRapm;
};


export const computeRapmForSeason = async (
	season: number,
	seasonsBack: number[],
	db: IDBPDatabase<LeagueDB>,
): Promise<RapmByPid> => {
	const maxBack = Math.max(...seasonsBack);
	const earliest = season - maxBack + 1;
	const stintsAll = await gatherLineups(db, earliest, season);

	// If no lineup data, return empty results
	if (stintsAll.length === 0) {
		return {};
	}

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

	const lambda = 500;

	const coeffByN: Record<number, number[]> = {};
	for (const n of seasonsBack) {
		const start = season - n + 1;
		const stints = stintsAll.filter(l => l.season >= start);
		coeffByN[n] = runRegression(stints, pids, pidToIndex, lambda);
	}

	const output: RapmByPid = {};
	for (let i = 0; i < pids.length; i++) {
		// Multiply by 100 to match standard RAPM scale (points per 100 possessions)
		output[pids[i]] = {
			rapm1: (coeffByN[1]?.[i] ?? 0) * 100,
			rapm3: (coeffByN[3]?.[i] ?? coeffByN[1]?.[i] ?? 0) * 100,
			rapm5:
				(coeffByN[5]?.[i] ?? coeffByN[3]?.[i] ?? coeffByN[1]?.[i] ?? 0) * 100,
		};
	}
	return output;
};
