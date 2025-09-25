1# Repository Guidelines

## Project Structure & Module Organization
The application entry point lives in `index.js`, which loads a KMZ archive and converts the embedded KML into a JavaScript object. `new_zealand.kmz` provides a sample dataset; keep additional fixtures in a dedicated `data/` directory if you add more. TypeScript support is configured through `tsconfig.json`, while `biome.jsonc` governs linting and formatting. Runtime dependencies are declared in `package.json`, and generated output should stay out of version control.

## Build, Test, and Development Commands
Install dependencies with `pnpm install`. Use `pnpm start` to execute the parser via `node --experimental-strip-types index.js`, pointing `AdmZip` at the KMZ file you want to inspect. When experimenting, set the KMZ file path through an environment variable or temporary symlink rather than hard-coding new values. Run `pnpm biome check .` to ensure lint and format compliance, adding `--apply` when you want Biome to write fixes.

## Coding Style & Naming Conventions
Stick to ES module syntax with named imports. Use spaces for indentation and respect the 120 character line width defined in Biome. Strings should use single quotes, and semicolons only when Biome requires them. Keep exported utilities camelCase, reserve PascalCase for classes, and name KMZ fixtures with geographic hints, for example `region-country.kmz`.

## Testing Guidelines
Add automated coverage using Node’s built-in `node:test` runner or a lightweight framework such as Vitest. Store tests alongside the source as `index.test.ts` or group them under `tests/` when they span multiple modules. Target coverage of the KMZ loading pipeline—archive parsing, KML extraction, and XML conversion—and create regression fixtures for malformed archives. Execute tests with `node --test` once they exist, and document any large sample data under `data/README.md`.

## Commit & Pull Request Guidelines
Commits should follow the repository’s initial precedent: concise, imperative headlines under 60 characters (e.g., `Add streaming parser`). Squash cosmetic changes before review. Each pull request should describe the KMZ scenario it addresses, list new sample files, and outline verification steps (`pnpm start`, tests, manual validation). Link related issues and attach before/after logs or screenshots when parser output changes.

## KMZ Handling Notes
KMZ archives must expose `doc.kml`; update `index.js` if upstream files differ. Prefer referencing KMZ paths via configuration rather than editing the entry name. When sharing sensitive data, replace it with anonymized samples and document the source in the pull request.
