import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { registerInstancesRoutes } from "./routes/instances.js";
import { registerDeployRoutes } from "./routes/deploy.js";
import { registerConfigRoutes } from "./routes/config.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  registerInstancesRoutes(app);
  registerDeployRoutes(app);
  registerConfigRoutes(app);

  if (!config.isDev && existsSync(config.paths.frontendDist)) {
    const assetsDir = join(config.paths.frontendDist, "assets");
    if (existsSync(assetsDir)) {
      await app.register(fastifyStatic, { root: assetsDir, prefix: "/assets/" });
    }
    const indexPath = join(config.paths.frontendDist, "index.html");
    app.get("*", (_request, reply) => {
      return reply.type("text/html").send(readFileSync(indexPath, "utf-8"));
    });
  }

  app.get("/api/health", async (_request, reply) => {
    return reply.send({ ok: true });
  });

  const port = config.port;
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Instance Manager API on http://localhost:${port}`);
  if (config.isDev) {
    console.log("Dev: open the Vite app at http://localhost:3998 (Vite proxies /api here)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
