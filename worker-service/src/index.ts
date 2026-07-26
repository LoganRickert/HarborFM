import { mkdirSync } from "fs";
import { WORK_DIR } from "./config.js";
import { startWorkerClient } from "./client.js";

mkdirSync(WORK_DIR, { recursive: true });
console.log(`[worker] work dir ${WORK_DIR}`);
startWorkerClient();
