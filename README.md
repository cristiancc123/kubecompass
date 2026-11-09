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
2. Further steps land here as the project grows during the day.

## AI disclosure

This project was built with the help of AI coding assistants, mainly Claude Code (Anthropic). Every change was reviewed and understood by the author before merging. Gitar reviewed the pull requests.

## License

MIT
