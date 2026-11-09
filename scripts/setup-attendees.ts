import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createElasticsearchClient } from "../src/es.js";
import { ATTENDEE_MAPPINGS, type Attendee } from "../src/people.js";

/**
 * Creates the attendees index for the hallway track.
 *
 * Usage:
 *   npm run setup-attendees            # create the index if it doesn't exist
 *   npm run setup-attendees -- --seed  # also add the sample profiles below
 */

/**
 * Demo profiles so a fresh deployment has someone to match with. They describe
 * roles, not real people, carry no contact, and the UI labels them "Sample profile".
 * Fixed ids make reseeding overwrite them instead of adding duplicates.
 */
const SAMPLE_PROFILES: Array<Pick<Attendee, "name" | "interests">> = [
  {
    name: "Platform engineer, fintech",
    interests:
      "Building an internal developer platform on Backstage and Crossplane. Golden paths, multi-tenant clusters, cost allocation per team.",
  },
  {
    name: "SRE, streaming company",
    interests:
      "OpenTelemetry Collector at scale, tail sampling, reducing alert fatigue, SLOs with Prometheus and incident reviews.",
  },
  {
    name: "ML infrastructure lead",
    interests:
      "GPU scheduling on Kubernetes with Kueue and DRA, training jobs with Kubeflow, sharing expensive accelerators between teams.",
  },
  {
    name: "Security engineer, healthcare",
    interests:
      "eBPF runtime security with Tetragon and Falco, supply chain with Sigstore and SBOMs, Kyverno policies for compliance.",
  },
  {
    name: "Network engineer",
    interests:
      "Cilium and Gateway API migrations, service mesh without sidecars, Istio ambient mode, multi-cluster networking.",
  },
  {
    name: "Student and first-time KubeCon attendee",
    interests:
      "Learning Kubernetes basics, looking for beginner-friendly talks, contributing to CNCF projects, career advice.",
  },
  {
    name: "Edge computing architect",
    interests:
      "K3s and KubeEdge on retail stores, GitOps with Argo CD to thousands of small clusters, offline-first updates.",
  },
  {
    name: "Data platform engineer",
    interests:
      "Running Postgres on Kubernetes with CloudNativePG, Kafka with Strimzi, backups, storage performance and stateful workloads.",
  },
  {
    name: "Developer advocate, open source",
    interests:
      "WebAssembly on Kubernetes with SpinKube, developer experience, local dev loops with Tilt, writing docs that people read.",
  },
  {
    name: "FinOps practitioner",
    interests:
      "Kubernetes cost visibility with OpenCost, rightsizing requests and limits, Karpenter autoscaling, spot instances.",
  },
];

/** Deterministic UUID-shaped ids: 00000000-0000-4000-8000-0000000000NN. */
function sampleId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { seed: { type: "boolean", default: false } } });
  const config = loadConfig();
  const es = createElasticsearchClient(config);
  const index = config.attendeesIndex;

  if (await es.indices.exists({ index })) {
    console.log(`Index ${index} already exists`);
  } else {
    console.log(`Creating index ${index}`);
    await es.indices.create({ index, mappings: ATTENDEE_MAPPINGS });
  }

  if (!values.seed) {
    return;
  }
  const created = new Date().toISOString();
  const operations = SAMPLE_PROFILES.flatMap((profile, i) => {
    const attendee: Attendee = { ...profile, id: sampleId(i), contact: "", created, sample: true };
    return [{ index: { _index: index, _id: attendee.id } }, { ...attendee, profile: attendee.interests }];
  });
  const response = await es.bulk({ operations });
  if (response.errors) {
    const failed = response.items.filter((item) => item.index?.error);
    throw new Error(`${failed.length} sample profiles failed: ${JSON.stringify(failed[0]?.index?.error)}`);
  }
  console.log(`Indexed ${SAMPLE_PROFILES.length} sample profiles`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
