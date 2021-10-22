import type { IDBPCursorWithValue, IDBPDatabase } from "idb";
import {
	gameAttributesArrayToObject,
	MAX_SUPPORTED_LEAGUE_VERSION,
} from "../../../common";
import { gameAttributesCache } from "../../../common/defaultGameAttributes";
import type { LeagueDB } from "../../db/connectLeague";

// Otherwise it often pulls just one record per transaction, as it's hitting up against the high water mark
const ONE_MEGABYTE_IN_BYTES = 1024 * 1024;

// If we just let the normal highWaterMark mechanism work, it might pull only one record at a time, which is not ideal given the cost of starting a transaction
const highWaterMark = ONE_MEGABYTE_IN_BYTES;
const minSizePerPull = ONE_MEGABYTE_IN_BYTES;

const stringSizeInBytes = (str: string | undefined) => {
	if (!str) {
		return 0;
	}

	// https://stackoverflow.com/a/23329386/786644
	let s = str.length;
	for (let i = str.length - 1; i >= 0; i--) {
		const code = str.charCodeAt(i);
		if (code > 0x7f && code <= 0x7ff) s++;
		else if (code > 0x7ff && code <= 0xffff) s += 2;
		if (code >= 0xdc00 && code <= 0xdfff) i--;
	}
	return s;
};

const NUM_SPACES_IN_TAB = 2;

type Filter = (a: any) => boolean;

const makeExportStream = (
	leagueDB: IDBPDatabase<LeagueDB>,
	storesInput: string[],
	{
		compressed = false,
		meta = true,
		filter,
		forEach,
		map,
	}: {
		compressed?: boolean;
		meta?: boolean;
		filter: {
			[key: string]: Filter;
		};
		forEach: {
			[key: string]: (a: any) => void;
		};
		map: {
			[key: string]: (a: any) => any;
		};
	},
) => {
	const space = compressed ? "" : " ";
	const tab = compressed ? "" : " ".repeat(NUM_SPACES_IN_TAB);
	const newline = compressed ? "" : "\n";

	const jsonStringify = (object: any, indentationLevels: number) => {
		if (compressed) {
			return JSON.stringify(object);
		}

		const json = JSON.stringify(object, null, NUM_SPACES_IN_TAB);

		return json.replace(/\n/g, `\n${tab.repeat(indentationLevels)}`);
	};

	const stores = storesInput.filter(
		store => store !== "teamSeasons" && store !== "teamStats",
	);
	const includeTeamSeasonsAndStats = stores.length !== storesInput.length;

	const writeRootObject = (
		controller: ReadableStreamController<string>,
		name: string,
		object: any,
	) =>
		controller.enqueue(
			`,${newline}${tab}"${name}":${space}${jsonStringify(object, 1)}`,
		);

	let storeIndex = 0;
	let prevKey: string | number | undefined;
	let cancelCallback: (() => void) | undefined;
	let seenFirstRecord = false;

	return new ReadableStream<string>(
		{
			async start(controller) {
				await controller.enqueue(
					`{${newline}${tab}"version":${space}${MAX_SUPPORTED_LEAGUE_VERSION}`,
				);

				// Row from leagueStore in meta db.
				// phaseText is needed if a phase is set in gameAttributes.
				// name is only used for the file name of the exported roster file.
				if (meta) {
					const leagueName = "LEAGUE NAME"; //await getName();
					await writeRootObject(controller, "meta", {
						// phaseText: local.phaseText,
						phaseText: "PHASE TEXT",
						name: leagueName,
					});
				}
			},

			async pull(controller) {
				// console.log("PULL", controller.desiredSize / 1024 / 1024);
				const done = () => {
					if (cancelCallback) {
						cancelCallback();
					}

					controller.close();
				};

				if (cancelCallback) {
					done();
					return;
				}

				// let count = 0;
				let size = 0;

				const enqueue = (string: string) => {
					size += stringSizeInBytes(string);
					controller.enqueue(string);
				};

				const store = stores[storeIndex];

				// Define this up here so it is undefined for gameAttributes, triggering the "go to next store" logic at the bottom
				let cursor:
					| IDBPCursorWithValue<LeagueDB, any, any, unknown, "readonly">
					| null
					| undefined;

				if (store === "gameAttributes") {
					// gameAttributes is special because we need to convert it into an object
					let rows = (await leagueDB.getAll(store)).filter(
						row => !gameAttributesCache.includes(row.key),
					);

					if (filter[store]) {
						rows = rows.filter(filter[store]);
					}

					if (forEach[store]) {
						for (const row of rows) {
							forEach[store](row);
						}
					}

					if (map[store]) {
						rows = rows.map(map[store]);
					}

					await writeRootObject(
						controller,
						"gameAttributes",
						gameAttributesArrayToObject(rows),
					);
				} else {
					const txStores =
						store === "teams" ? ["teams", "teamSeasons", "teamStats"] : [store];

					const transaction = leagueDB.transaction(txStores as any);

					const range =
						prevKey !== undefined
							? IDBKeyRange.lowerBound(prevKey, true)
							: undefined;
					cursor = await transaction.objectStore(store).openCursor(range);
					while (cursor) {
						let value = cursor.value;

						if (!filter[store] || filter[store](value)) {
							// count += 1;

							const comma = seenFirstRecord ? "," : "";

							if (!seenFirstRecord) {
								enqueue(`,${newline}${tab}"${store}": [`);
								seenFirstRecord = true;
							}

							if (forEach[store]) {
								forEach[store](value);
							}
							if (store === "players") {
								if (value.imgURL) {
									delete value.face;
								}
							}

							if (map[store]) {
								value = map[store](value);
							}

							if (store === "teams" && includeTeamSeasonsAndStats) {
								// This is a bit dangerous, since it will possibly read all teamStats/teamSeasons rows into memory, but that will very rarely exceed MIN_RECORDS_PER_PULL and we will just do one team per transaction, to be safe.

								const tid = cursor.value.tid;

								const infos: (
									| {
											key: string;
											store: "teamSeasons";
											index: "tid, season";
											keyRange: IDBKeyRange;
									  }
									| {
											key: string;
											store: "teamStats";
											index: "tid";
											keyRange: IDBKeyRange;
									  }
								)[] = [
									{
										key: "seasons",
										store: "teamSeasons",
										index: "tid, season",
										keyRange: IDBKeyRange.bound([tid], [tid, ""]),
									},
									{
										key: "stats",
										store: "teamStats",
										index: "tid",
										keyRange: IDBKeyRange.only(tid),
									},
								];

								const t: any = cursor.value;

								for (const info of infos) {
									t[info.key] = [];
									let cursor2 = await transaction
										.objectStore(info.store)
										.index(info.index as any)
										.openCursor(info.keyRange);
									while (cursor2) {
										t[info.key].push(cursor2.value);
										cursor2 = await cursor2.continue();
									}
								}
							}

							enqueue(
								`${comma}${newline}${tab.repeat(2)}${jsonStringify(
									cursor.value,
									2,
								)}`,
							);
						}

						prevKey = cursor.key as any;

						const desiredSize = (controller as any).desiredSize;
						if ((desiredSize > 0 || size < minSizePerPull) && !cancelCallback) {
							// Keep going if desiredSize or minSizePerPull want us to
							cursor = await cursor.continue();
						} else {
							break;
						}
					}
				}

				// console.log("PULLED", count, size / 1024 / 1024);
				if (!cursor) {
					// Actually done with this store - we didn't just stop due to desiredSize
					storeIndex += 1;
					if (seenFirstRecord) {
						enqueue(`${newline}${tab}]`);
					}
					if (storeIndex >= stores.length) {
						// Done whole export!

						if (!stores.includes("gameAttributes")) {
							// Set startingSeason if gameAttributes is not selected, otherwise it's going to fail loading unless startingSeason is coincidentally the same as the default
							await writeRootObject(
								controller,
								"startingSeason",
								(
									await leagueDB.get("gameAttributes", "startingSeason")
								)?.value,
							);
						}

						await controller.enqueue(`${newline}}${newline}`);

						done();
					}
				}
			},
			cancel() {
				return new Promise(resolve => {
					cancelCallback = resolve;
				});
			},
		},
		{
			highWaterMark,
			size: stringSizeInBytes,
		},
	);
};

export default makeExportStream;
