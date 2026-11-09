# Review instructions for kubecompass

kubecompass is a one-day hackathon project: a KubeCon talk finder and hallway-track matchmaker built on Elasticsearch Serverless, instrumented with OpenTelemetry and deployed on Kubernetes. Review for correctness and clarity first; speed of delivery matters more than exhaustive polish.

## Conventions

- TypeScript, strict mode, ES modules. Imports of local files use the `.js` extension.
- Runtime is Node 24. Configuration comes only from environment variables read in `src/config.ts`; never read `process.env` elsewhere.
- Secrets never land in the repository. `.env` is git-ignored and `.env.example` holds the key names only. Flag any literal that looks like an API key, token or password.
- The HTTP app in `src/app.ts` takes its dependencies as parameters so tests can run without a live Elasticsearch. Keep that boundary: no module-level clients inside `src/app.ts`.
- Elasticsearch is the data layer. Search features should use the query DSL (`semantic`, `match`, `knn`, `retriever` with RRF) rather than filtering in application code.
- Every endpoint that returns data to the browser escapes user-controlled strings in HTML.
- Tests live in `test/` and use Vitest. A new endpoint needs at least one request-level test.

## What to flag

- Unhandled promise rejections or missing `await` on Elasticsearch calls.
- Any query that could scan the whole index without a size limit.
- Hard-coded KubeCon dates, rooms or session ids outside the ingest script.
- Accessibility regressions in HTML: missing labels, headings out of order, contrast-only cues.

## What not to flag

- Missing JSDoc on small private helpers.
- Formatting nits already handled by the TypeScript compiler.
