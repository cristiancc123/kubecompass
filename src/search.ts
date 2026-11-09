import type { Client, estypes } from "@elastic/elasticsearch";
import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Session } from "./sessions.js";

/** Exact-match filters, all optional. Values map to keyword fields in the index. */
export interface SearchFilters {
  day?: string;
  track?: string;
  level?: string;
  venue?: string;
}

export interface SearchQuery extends SearchFilters {
  /** Free text. Empty means "browse": filters only, sorted by start time. */
  q: string;
  size?: number;
}

export interface SessionHit extends Session {
  score: number | null;
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface SearchFacets {
  day: FacetBucket[];
  track: FacetBucket[];
  level: FacetBucket[];
  venue: FacetBucket[];
}

export interface SearchResult {
  /** `hybrid` combines BM25 and semantic retrieval with RRF; `browse` is filters only. */
  mode: "hybrid" | "browse";
  total: number;
  took: number;
  hits: SessionHit[];
  facets: SearchFacets;
}

/** The slice of Elasticsearch the HTTP layer depends on. */
export interface SearchBackend {
  /** Resolves to false (or throws) when Elasticsearch cannot be reached. */
  ping(): Promise<boolean>;
  searchSessions(query: SearchQuery): Promise<SearchResult>;
}

export const DEFAULT_SIZE = 20;
export const MAX_SIZE = 50;
export const MAX_QUERY_LENGTH = 300;

const FACET_FIELDS = ["day", "track", "level", "venue"] as const;

/** Everything except the semantic `content` field, which only exists for retrieval. */
const SOURCE_FIELDS = [
  "id",
  "title",
  "url",
  "room",
  "venue",
  "start",
  "end",
  "day",
  "track",
  "level",
  "tags",
  "speakers",
  "description",
  "links",
];

export function clampSize(size: number | undefined): number {
  if (size === undefined || Number.isNaN(size)) {
    return DEFAULT_SIZE;
  }
  return Math.min(MAX_SIZE, Math.max(1, Math.floor(size)));
}

export function buildFilters(filters: SearchFilters): estypes.QueryDslQueryContainer[] {
  const clauses: estypes.QueryDslQueryContainer[] = [];
  for (const field of FACET_FIELDS) {
    const value = filters[field]?.trim();
    if (value) {
      clauses.push({ term: { [field]: value } });
    }
  }
  return clauses;
}

const FACET_TERMS: Record<(typeof FACET_FIELDS)[number], estypes.AggregationsTermsAggregation> = {
  day: { field: "day", size: 10, order: { _key: "asc" } },
  track: { field: "track", size: 50 },
  level: { field: "level", size: 10 },
  venue: { field: "venue", size: 10 },
};

/**
 * Each facet is counted under every selected filter except its own, so choosing
 * a track still lists the other tracks. The global aggregation ignores the free
 * text: counts describe the schedule, not the ranked hits.
 */
export function facetAggregations(filters: SearchFilters): Record<string, estypes.AggregationsAggregationContainer> {
  const perFacet: Record<string, estypes.AggregationsAggregationContainer> = {};
  for (const field of FACET_FIELDS) {
    perFacet[field] = {
      filter: { bool: { filter: buildFilters({ ...filters, [field]: undefined }) } },
      aggs: { values: { terms: FACET_TERMS[field] } },
    };
  }
  return { facets: { global: {}, aggs: perFacet } };
}

/**
 * Builds the Elasticsearch request. With text, two retrievers are fused with
 * reciprocal rank fusion: a lexical multi_match (titles weigh most) and a
 * semantic query on the `content` field. Without text it is a filtered browse
 * sorted by start time. Facets are always requested for the filter controls.
 */
export function buildSearchRequest(index: string, query: SearchQuery): estypes.SearchRequest {
  const size = clampSize(query.size);
  const filter = buildFilters(query);
  const text = query.q.trim();
  const base: estypes.SearchRequest = {
    index,
    size,
    _source: SOURCE_FIELDS,
    aggs: facetAggregations(query),
  };

  if (!text) {
    return { ...base, query: { bool: { filter } }, sort: [{ start: "asc" }] };
  }

  const lexical: estypes.RetrieverContainer = {
    standard: {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: text,
                fields: ["title^3", "speakers^2", "track^2", "description"],
                type: "best_fields",
                fuzziness: "AUTO",
              },
            },
          ],
          filter,
        },
      },
    },
  };

  const semantic: estypes.RetrieverContainer = {
    standard: {
      query: {
        bool: {
          must: [{ semantic: { field: "content", query: text } }],
          filter,
        },
      },
    },
  };

  return {
    ...base,
    retriever: {
      rrf: { retrievers: [lexical, semantic], rank_window_size: 100, rank_constant: 60 },
    },
  };
}

type FacetsAggregate = Record<string, { values?: estypes.AggregationsStringTermsAggregate }>;

function readFacets(aggregations: Record<string, estypes.AggregationsAggregate> | undefined): SearchFacets {
  const facets = aggregations?.facets as unknown as FacetsAggregate | undefined;
  const read = (name: (typeof FACET_FIELDS)[number]): FacetBucket[] => {
    const buckets = facets?.[name]?.values?.buckets;
    if (!Array.isArray(buckets)) {
      return [];
    }
    return buckets.map((bucket) => ({ value: String(bucket.key), count: bucket.doc_count }));
  };
  return { day: read("day"), track: read("track"), level: read("level"), venue: read("venue") };
}

/**
 * Wraps the Elasticsearch client behind the narrow SearchBackend interface.
 * Each search runs in a span that the client's own Elasticsearch span nests
 * under, and feeds a duration histogram split by mode and outcome. Call this
 * after the telemetry SDK starts: meters taken earlier stay no-ops.
 */
export function createSearchBackend(es: Client, index: string): SearchBackend {
  const tracer = trace.getTracer("kubecompass.search");
  const duration = metrics.getMeter("kubecompass.search").createHistogram("kubecompass.search.duration", {
    description: "Time to answer a session search, including Elasticsearch",
    unit: "ms",
  });

  async function search(query: SearchQuery): Promise<SearchResult> {
    const response = await es.search<Session>(buildSearchRequest(index, query));
    const total =
      typeof response.hits.total === "number" ? response.hits.total : (response.hits.total?.value ?? 0);
    const hits: SessionHit[] = response.hits.hits.flatMap((hit) =>
      hit._source ? [{ ...hit._source, score: hit._score ?? null }] : [],
    );
    return {
      mode: query.q.trim() ? "hybrid" : "browse",
      total,
      took: response.took,
      hits,
      facets: readFacets(response.aggregations),
    };
  }

  return {
    ping: () => es.ping(),
    searchSessions(query) {
      const mode = query.q.trim() ? "hybrid" : "browse";
      return tracer.startActiveSpan("search sessions", async (span) => {
        const started = performance.now();
        // Filters and lengths only: the free text stays out of telemetry.
        span.setAttributes({
          "kubecompass.search.mode": mode,
          "kubecompass.search.query_length": query.q.trim().length,
          "kubecompass.search.filters": FACET_FIELDS.filter((field) => query[field]).join(","),
        });
        let outcome = "ok";
        try {
          const result = await search(query);
          span.setAttributes({
            "kubecompass.search.total": result.total,
            "kubecompass.search.returned": result.hits.length,
            "kubecompass.search.es_took_ms": result.took,
          });
          return result;
        } catch (error) {
          outcome = "error";
          span.recordException(error instanceof Error ? error : String(error));
          span.setStatus({ code: SpanStatusCode.ERROR, message: "search failed" });
          throw error;
        } finally {
          duration.record(performance.now() - started, { "kubecompass.search.mode": mode, outcome });
          span.end();
        }
      });
    },
  };
}
