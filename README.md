# kubecompass

Find the right talk and the right people at KubeCon.

Built solo by Cristian Cano at the [WeMakeDevs Cloud Native Hackathon](https://www.wemakedevs.org/hackathons/cnh), Salt Lake City, November 9, 2026.

## What it does

- **Talk finder**: hybrid search (keyword + semantic) over the KubeCon schedule, so "something on eBPF and security after lunch" returns the right sessions.
- **Hallway track**: matches attendees with similar interests so they can actually meet.
- **Fully observable**: traces, logs and metrics via OpenTelemetry, runs on Kubernetes.

## Stack

| Concern | Tool |
|---|---|
| Search and data layer | Elasticsearch Serverless (`semantic_text`, hybrid search) |
| Observability | OpenTelemetry → Dash0 (Agent0 for investigations) |
| Runtime | Kubernetes (kind locally, Radar Cloud for the UI and AI SRE) |
| Code review | Gitar on every pull request |

## Setup

1. Copy `.env.example` to `.env` and fill in the values. `.env` is git-ignored.
2. `npm install`, then `npm run dev` for the local server, or `npm test` for the test suite.

## Deploy

Deploys are GitOps, following the [cnh-starter](https://github.com/skyhook-io/cnh-starter) layout:

1. A push to `main` runs `.github/workflows/deploy.yaml`, which builds the `Dockerfile` into `ghcr.io/cristiancc123/kubecompass:<short-sha>` and commits that tag to `deploy/kustomization.yaml`.
2. Argo CD, inside the team's Radar cluster, syncs `deploy/` into namespace `team-kubecompass`. The Argo CD Application in `argocd/application.yaml` is applied once through Radar's MCP server.
3. The app is served at https://kubecompass.cnh.radarhq.io.

The image must be public, because the cluster has no registry credentials. GHCR creates a new package as private, so after the first build open the package on GitHub, then Package settings > Change visibility > Public, and re-run the workflow. The workflow checks anonymous pulls and refuses to point the manifests at an image the cluster can't fetch.

Credentials never go in git. Create the Secret `app-credentials` in namespace `team-kubecompass` by hand (for example in Radar's resource editor) with the keys `elasticsearch-url`, `elasticsearch-api-key` and, for telemetry, `dash0-auth-token`. The Deployment reads them through `secretKeyRef`.

To try the image locally: `docker build -t kubecompass . && docker run --rm -p 8080:8080 --env-file .env kubecompass`.

## Observability

With `DASH0_OTLP_ENDPOINT` and `DASH0_AUTH_TOKEN` set, the app exports traces, metrics and logs to Dash0 over OTLP/HTTP (`src/telemetry.ts`). Without them telemetry is off and nothing else changes.

- Every request is a span from the Hono middleware. A search adds a `search sessions` span with the mode, filters and totals, and the Elasticsearch client nests its own span under it.
- `kubecompass.search.duration` is a histogram split by mode and outcome.
- Errors are OpenTelemetry log records that carry the trace id, so Dash0 links a log line to its request.
- In Kubernetes, `OTEL_RESOURCE_ATTRIBUTES` adds the pod, namespace, node and cluster to everything the app sends.
- What people type stays out: spans keep the URL path without the query string, and record query lengths and counts, never the text.

## AI disclosure

This project was built with the help of AI coding assistants, mainly Claude Code (Anthropic). Every change was reviewed and understood by the author before merging. Gitar reviewed the pull requests.

## License

MIT
