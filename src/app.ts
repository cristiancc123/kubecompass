import { Hono } from "hono";

/** The slice of the search backend the HTTP layer depends on. */
export interface SearchBackend {
  ping(): Promise<boolean>;
}

export interface AppDependencies {
  es: SearchBackend;
}

/**
 * Creates the HTTP application. Dependencies are injected so tests can run
 * the app without a live Elasticsearch connection.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", async (c) => {
    try {
      await deps.es.ping();
      return c.json({ status: "ok", elasticsearch: "reachable" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ status: "degraded", elasticsearch: message }, 503);
    }
  });

  app.get("/", (c) =>
    c.html(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>kubecompass</title>
  </head>
  <body>
    <main>
      <h1>kubecompass</h1>
      <p>Find the right talk and the right people at KubeCon.</p>
    </main>
  </body>
</html>`,
    ),
  );

  return app;
}
