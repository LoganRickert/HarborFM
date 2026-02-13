import { db } from "./index.js";

db.prepare("DELETE FROM ip_bans").run();
console.log("Cleared ip_bans table.");
