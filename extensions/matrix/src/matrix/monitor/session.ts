import type { ResolvedAgentRoute } from "openclaw/plugin-sdk";
import type { MatrixSessionScope } from "../../types.js";

export function resolveMatrixSessionKey(params: {
  route: ResolvedAgentRoute;
  sessionScope: MatrixSessionScope;
  isDirectMessage: boolean;
  threadRootId?: string | null;
}): { sessionKey: string; parentSessionKey?: string; isThreadSession: boolean } {
  const { route, sessionScope, isDirectMessage } = params;
  const threadRootId = (params.threadRootId ?? "").trim();

  const baseSessionKey =
    !isDirectMessage && sessionScope === "agent" ? route.mainSessionKey : route.sessionKey;

  if (!threadRootId || isDirectMessage) {
    return {
      sessionKey: baseSessionKey,
      parentSessionKey: undefined,
      isThreadSession: false,
    };
  }

  return {
    sessionKey: `${baseSessionKey}:thread:${threadRootId}`,
    parentSessionKey: baseSessionKey,
    isThreadSession: true,
  };
}
