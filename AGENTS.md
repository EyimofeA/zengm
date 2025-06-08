# Repo Usage Notes

## Development
- Install dependencies with `pnpm install`.
- Run the development server with `pnpm run start`.
- Build the worker and UI bundles with `pnpm run build`.

## Testing
- Lint the code with `pnpm run lint`.
- Run the type checker with `pnpm run lint-ts`.
- Execute the Jest test suite with `pnpm test`.

## RAPM
Regularized Adjusted Plus-Minus (RAPM) is computed at the end of each regular season. The worker aggregates lineup data and solves a ridge regression (λ ≈ 400) for single-, three-, and five-year windows. Results are stored on each player as `rapm1`, `rapm3`, and `rapm5` before awards are generated.
