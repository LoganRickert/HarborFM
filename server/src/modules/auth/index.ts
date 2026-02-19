import type { FastifyInstance } from "fastify";
import { registerRegisterRoutes } from "./routes.register.js";
import { registerLoginRoutes } from "./routes.login.js";
import { registerTwoFactorLoginRoutes } from "./routes.twoFactorLogin.js";
import { registerPasswordResetRoutes } from "./routes.passwordReset.js";
import { registerSessionRoutes } from "./routes.session.js";
import { registerApiKeysRoutes } from "./routes.apiKeys.js";
import { registerInviteRoutes } from "./routes.invite.js";
import { registerTwoFactorProfileRoutes } from "./routes.twoFactorProfile.js";
import { registerSsoRoutes } from "./routes.sso.js";
import { registerCompleteAccountRoutes } from "./routes.completeAccount.js";
import { registerProfileUpdateRoutes } from "./routes.profileUpdate.js";

export async function authRoutes(app: FastifyInstance) {
  await app.register(registerRegisterRoutes);
  await app.register(registerLoginRoutes);
  await app.register(registerTwoFactorLoginRoutes);
  await app.register(registerPasswordResetRoutes);
  await app.register(registerSessionRoutes);
  await app.register(registerApiKeysRoutes);
  await app.register(registerInviteRoutes);
  await app.register(registerTwoFactorProfileRoutes);
  await app.register(registerSsoRoutes);
  await app.register(registerCompleteAccountRoutes);
  await app.register(registerProfileUpdateRoutes);
}
