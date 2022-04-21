export const fatigueFactor = (pFatigue: number, endu: number): number => {
	// 30 pitches before any fatigue starts to show
	const adjustedFatigue = Math.max(0, pFatigue - 30);

	// How fast a player's fatigue factor drops is based on endu
	const pitchesToDropTenPercent = 10 + 50 * endu;

	const ratio = adjustedFatigue / pitchesToDropTenPercent;

	const fatigueFactor = Math.max(0, 1 - 0.1 * ratio);

	return fatigueFactor;
};
