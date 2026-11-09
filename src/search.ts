import type { Client, estypes } from "@elastic/elasticsearch";
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

function facetAggregations(): Record<string, estypes.AggregationsAggregationContainer> {
  return {
    day: { terms: { field: "day", size: 10, order: { _key: "asc" } } },
    track: { terms: { field: "track", size: 50 } },
    level: { terms: { field: "level", size: 10 } },
    venue: { terms: { field: "venue", size: 10 } },
  };
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
    aggs: facetAggregations(),
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

function readFacets(aggregations: Record<string, estypes.AggregationsAggregate> | undefined): SearchFacets {
  const read = (name: (typeof FACET_FIELDS)[number]): FacetBucket[] => {
    const agg = aggregations?.[name] as estypes.AggregationsStringTermsAggregate | undefined;
    const buckets = agg?.buckets;
    if (!Array.isArray(buckets)) {
      return [];
    }
    return buckets.map((bucket) => ({ value: String(bucket.key), count: bucket.doc_count }));
  };
  return { day: read("day"), track: read("track"), level: read("level"), venue: read("venue") };
}

/** Wraps the Elasticsearch client behind the narrow SearchBackend interface. */
export function createSearchBackend(es: Client, index: string): SearchBackend {
  return {
    ping: () => es.ping(),
    async searchSessions(query) {
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
    },
  };
}
