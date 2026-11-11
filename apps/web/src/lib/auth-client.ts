import { createAuthClient } from "better-auth/react";
import { magicLinkClient, twoFactorClient } from "better-auth/client/plugins";

/**
 * Browser-side Better Auth client. It talks to this app's own
 * /api/auth/* route, so no baseURL is needed in the browser; the session
 * lives in an httpOnly cookie the server sets.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [magicLinkClient(), twoFactorClient()],
});
