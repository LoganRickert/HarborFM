import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { registerInstancesRoutes } from "./routes/instances.js";
import { registerDeployRoutes } from "./routes/deploy.js";
import { registerConfigRoutes } from "./routes/config.js";
import { existsSync } from "fs";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  registerInstancesRoutes(app);
  registerDeployRoutes(app);
  registerConfigRoutes(app);

  if (!config.isDev && existsSync(config.paths.frontendDist)) {
    await app.register(fastifyStatic, {
      root: config.paths.frontendDist,
      prefix: "/",
    });
    app.get("*", (_request, reply) => {
      return reply.sendFile("index.html");
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
