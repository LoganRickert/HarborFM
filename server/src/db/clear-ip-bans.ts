import { db } from "./index.js";

const banResult = db.prepare("DELETE FROM ip_bans").run();
const failResult = db.prepare("DELETE FROM login_attempts").run();
console.log("Cleared ip_bans (%d rows) and login_attempts (%d rows).", banResult.changes, failResult.changes);
