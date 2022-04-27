import {
	memo,
	Fragment,
	MouseEvent,
	ReactNode,
	useState,
	useRef,
	useEffect,
} from "react";
import ResponsiveTableWrapper from "./ResponsiveTableWrapper";
import { getCols, helpers, processPlayerStats } from "../util";
import { filterPlayerStats, getPeriodName } from "../../common";
import { PLAYER_GAME_STATS } from "../../common/constants.baseball";
import { sortByStats, StatsHeader } from "./BoxScore.football";
import updateSortBys from "./DataTable/updateSortBys";
import type { SortBy } from "./DataTable";
import orderBy from "lodash-es/orderBy";
import {
	BoxScorePlayer,
	getText,
	playersByPid,
	SportState,
} from "../util/processLiveGameEvents.baseball";
import PlayerNameLabels from "./PlayerNameLabels";
import processStats from "../../common/processPlayerStats.baseball";
import type {
	PlayByPlayEvent,
	PlayByPlayEventScore,
} from "../../worker/core/GameSim.baseball/PlayByPlayLogger";

type Team = {
	abbrev: string;
	name: string;
	region: string;
	players: any[];
};

type BoxScore = {
	gid: number;
	scoringSummary: PlayByPlayEventScore[];
	teams: [Team, Team];
	numPeriods?: number;
};

const StatsTable = ({
	Row,
	forceRowUpdate,
	title,
	type,
	t,
}: {
	Row: any;
	forceRowUpdate: boolean;
	title: string;
	type: keyof typeof PLAYER_GAME_STATS;
	t: Team;
}) => {
	const stats = PLAYER_GAME_STATS[type].stats;
	const seasonStats = PLAYER_GAME_STATS[type].seasonStats;
	const cols = getCols([...stats, ...seasonStats].map(stat => `stat:${stat}`));

	const [sortBys, setSortBys] = useState<SortBy[]>([]);

	const onClick = (event: MouseEvent, i: number) => {
		setSortBys(prevSortBys => {
			const newSortBys =
				updateSortBys({
					cols,
					event,
					i,
					prevSortBys,
				}) ?? [];

			if (
				newSortBys.length === 1 &&
				prevSortBys.length === 1 &&
				newSortBys[0][0] === prevSortBys[0][0] &&
				newSortBys[0][1] === "desc"
			) {
				// User just clicked twice on the same column. Reset sort.
				return [];
			}

			return newSortBys;
		});
	};

	let players = t.players
		.map(p => {
			// p.seasonStats is stats from before the game. Add current game stats to get current value - works for live sim and post-game box score!
			const seasonStatsCurrent = {
				...p.seasonStats,
			};
			for (const key of Object.keys(seasonStatsCurrent)) {
				seasonStatsCurrent[key] += p[key];
			}

			return {
				...p,
				processed: processPlayerStats(p, stats),
				seasonStats: processPlayerStats(seasonStatsCurrent, seasonStats),
			};
		})
		.filter(p => filterPlayerStats(p, stats, type));

	if (sortBys.length === 0) {
		// Default sort order
		players = orderBy(
			players,
			type === "batting" ? ["battingOrder", "subIndex"] : ["subIndex"],
		);
	} else {
		players.sort(sortByStats(stats, seasonStats, sortBys));
	}

	const showFooter = players.length > 1;
	const sumsByStat: Record<string, number> = {};
	if (showFooter) {
		for (const stat of stats) {
			sumsByStat[stat] = 0;
			for (const p of players) {
				sumsByStat[stat] += p.processed[stat];
			}
		}
	}

	const sortable = players.length > 1;
	const highlightCols = sortable ? sortBys.map(sortBy => sortBy[0]) : undefined;

	return (
		<div className="mb-3">
			<ResponsiveTableWrapper>
				<table className="table table-striped table-borderless table-sm table-hover">
					<thead>
						<tr>
							<th colSpan={2}>{title}</th>
							<StatsHeader
								cols={cols}
								onClick={onClick}
								sortBys={sortBys}
								sortable={sortable}
							/>
						</tr>
					</thead>
					<tbody>
						{players.map((p, i) => (
							<Row
								key={p.pid}
								i={i}
								p={p}
								stats={stats}
								seasonStats={seasonStats}
								forceUpdate={forceRowUpdate}
								highlightCols={highlightCols}
							/>
						))}
					</tbody>
					{showFooter ? (
						<tfoot>
							<tr>
								<th colSpan={2}>Total</th>
								{stats.map(stat => (
									<th key={stat}>
										{stat === "pm"
											? null
											: helpers.roundStat(sumsByStat[stat], stat, true)}
									</th>
								))}
								{seasonStats.map(stat => (
									<th key={stat} />
								))}
							</tr>
						</tfoot>
					) : null}
				</table>
			</ResponsiveTableWrapper>
		</div>
	);
};

const processEvents = (events: PlayByPlayEventScore[]) => {
	const processedEvents: (PlayByPlayEventScore & {
		score: [number, number];
	})[] = [];
	const score = [0, 0] as [number, number];

	for (const event of events) {
		if (event.hide) {
			continue;
		}

		let numRuns = 0;
		if (event.type === "hitResult" && event.numBases === 4) {
			// Home run
			numRuns += 1;
		}
		const runners = (event as Extract<PlayByPlayEvent, { type: "hitResult" }>)
			.runners;
		if (runners) {
			for (const runner of runners) {
				if (runner.to === 4) {
					numRuns += 1;
				}
			}
		}

		score[event.t] += numRuns;

		processedEvents.push({
			...event,
			score: helpers.deepCopy(score),
		});
	}

	return processedEvents;
};

const getCount = (events: PlayByPlayEventScore[]) => {
	let count = 0;
	for (const event of events) {
		if (!event.hide) {
			count += 1;
		}
	}
	return count;
};

const goalTypeTitle = (goalType: "ev" | "sh" | "pp" | "en") => {
	switch (goalType) {
		case "ev":
			return "Even strength";
		case "sh":
			return "Short handed";
		case "pp":
			return "Power play";
		case "en":
			return "Empty net";
	}
};

const ScoringSummary = memo(
	({
		events,
		teams,
	}: {
		count: number;
		events: PlayByPlayEventScore[];
		teams: [Team, Team];
	}) => {
		let prevInning: number;
		let prevT: number;
		const processedEvents = processEvents(events);

		const [playersByPid, setPlayersByPid] = useState<
			Record<number, BoxScorePlayer>
		>({});

		const someEvents = processedEvents.length > 0;

		useEffect(() => {
			if (!someEvents) {
				return;
			}

			const updated: typeof playersByPid = {};
			for (const t of teams) {
				for (const p of t.players) {
					updated[p.pid] = p;
				}
			}
			setPlayersByPid(updated);
		}, [someEvents, teams]);

		if (!someEvents) {
			return <p>None</p>;
		}

		const getName = (pid: number) => playersByPid[pid]?.name ?? "???";

		return (
			<table className="table table-sm border-bottom">
				<tbody>
					{processedEvents.map((event, i) => {
						let quarterHeader: ReactNode = null;
						if (event.inning !== prevInning || event.t !== prevT) {
							prevInning = event.inning;
							prevT = event.t;
							quarterHeader = (
								<tr>
									<td className="text-muted" colSpan={4}>
										{event.t === 0 ? "Top" : "Bottom"}{" "}
										{helpers.ordinal(event.inning)}
									</td>
								</tr>
							);
						}

						return (
							<Fragment key={i}>
								{quarterHeader}
								<tr>
									<td>{teams[event.t].abbrev}</td>
									<td>
										{event.t === 0 ? (
											<>
												<b>{event.score[0]}</b>-
												<span className="text-muted">{event.score[1]}</span>
											</>
										) : (
											<>
												<span className="text-muted">{event.score[0]}</span>-
												<b>{event.score[1]}</b>
											</>
										)}
									</td>
									<td>{getName(event.pid)}</td>
									<td style={{ whiteSpace: "normal" }}>
										{getText(event, getName).text}
									</td>
								</tr>
							</Fragment>
						);
					})}
				</tbody>
			</table>
		);
	},
	(prevProps, nextProps) => {
		return prevProps.count === nextProps.count;
	},
);

const pitcherStats = (p: any) => {
	if (!p) {
		return "";
	}

	const ip = processStats(p, ["ip"]).ip;

	return `${ip.toFixed(1)} IP, ${p.er} ER, ${p.soPit} K, ${p.bbPit} BB`;
};

const batterStats = (p: any) => {
	if (!p) {
		return "";
	}

	const ab = processStats(p, ["ab"]).ab;

	return `${p.h}-${ab}, ${p.r} R, ${p.rbi} RBI`;
};

const BatterAndPitcher = ({
	batterPid,
	pitcherPid,
}: {
	batterPid: number;
	pitcherPid: number;
}) => {
	const batter: any = playersByPid[batterPid];
	const pitcher: any = playersByPid[pitcherPid];

	return (
		<div className="row mb-3">
			<div className="col-6 d-flex justify-content-end border-end">
				<div className="text-end">
					<b>Pitcher</b>
					<br />
					{pitcher ? (
						<PlayerNameLabels
							injury={pitcher.injury}
							jerseyNumber={pitcher.jerseyNumber}
							pid={pitcher.pid}
							skills={pitcher.skills}
							legacyName={pitcher.name}
						/>
					) : null}
					<br />
					<span className="text-muted">{pitcherStats(pitcher)}</span>
				</div>
			</div>
			<div className="col-6">
				<div>
					<b>Batter</b>
					<br />
					{batter ? (
						<PlayerNameLabels
							injury={batter.injury}
							jerseyNumber={batter.jerseyNumber}
							pid={batter.pid}
							skills={batter.skills}
							legacyName={batter.name}
						/>
					) : null}
					<br />
					<span className="text-muted">{batterStats(batter)}</span>
				</div>
			</div>
		</div>
	);
};

const BoxScore = ({
	boxScore,
	forceRowUpdate,
	sportState,
	Row,
}: {
	boxScore: BoxScore;
	forceRowUpdate: boolean;
	sportState: SportState;
	Row: any;
}) => {
	const liveGameSim = (boxScore as any).won?.name === undefined;

	return (
		<div className="mb-3">
			{liveGameSim ? (
				<BatterAndPitcher
					batterPid={sportState.batterPid}
					pitcherPid={sportState.pitcherPid}
				/>
			) : undefined}

			<h2>Scoring Summary</h2>
			<ScoringSummary
				key={boxScore.gid}
				count={getCount(boxScore.scoringSummary)}
				events={boxScore.scoringSummary}
				teams={boxScore.teams}
			/>

			{boxScore.teams.map(t => (
				<Fragment key={t.abbrev}>
					<h2>
						{t.region} {t.name}
					</h2>
					{["Batting", "Pitching"].map(title => (
						<StatsTable
							key={title}
							Row={Row}
							forceRowUpdate={forceRowUpdate}
							title={title}
							type={title.toLowerCase() as any}
							t={t}
						/>
					))}
				</Fragment>
			))}
		</div>
	);
};

export default BoxScore;
