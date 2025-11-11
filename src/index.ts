import { serve } from "bun";
import { logger as baseLogger } from "./logger.js";
import { createScrapeRecipeHandler } from "./routes/scrape-recipe.js";

const scrapeRecipeHandler = createScrapeRecipeHandler();
const logger = baseLogger;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createServer = () => {
  const portEnv = process.env.PORT;
  const port = portEnv ? Number(portEnv) : undefined;

  const server = serve({
    port,
    fetch(request) {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok" });
      }

      if (request.method === "POST" && url.pathname === "/scrape-recipe") {
        return scrapeRecipeHandler(request);
      }

      return jsonResponse({ error: "Not Found" }, 404);
    },
    error(error) {
      logger.error({ err: error }, "Unhandled server error");
      return jsonResponse({ error: "Internal server error" }, 500);
    },
  });

  logger.info(`Server listening on ${server.url.toString()}`);
  return server;
};

let server: ReturnType<typeof createServer> | undefined;

if (process.env.NODE_ENV !== "test") {
  server = createServer();
}

export { createServer, server, logger };
