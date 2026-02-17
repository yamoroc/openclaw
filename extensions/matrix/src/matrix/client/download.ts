import { LogService } from "@vector-im/matrix-bot-sdk";
import { Agent, Pool, request as undiciRequest } from "undici";
import type { Dispatcher } from "undici";

// HTTP/2 optimized connection pool
// Undici automatically negotiates HTTP/2 when the server supports it
let sharedAgent: Pool | null = null;
let agentRefCount = 0;

interface DownloadResult {
  data: Buffer;
  contentType: string;
}

interface MXCComponents {
  domain: string;
  mediaId: string;
}

/**
 * Parse MXC URL into its components
 * MXC URL format: mxc://<server-name>/<media-id>
 */
function parseMXCUrl(mxcUrl: string): MXCComponents {
  if (!mxcUrl?.toLowerCase()?.startsWith("mxc://")) {
    throw new Error("Not a valid MXC URI");
  }

  const [domain, ...mediaIdParts] = mxcUrl.slice("mxc://".length).split("/");
  if (!domain) {
    throw new Error("Missing domain component in MXC URI");
  }

  const mediaId = mediaIdParts?.join("/") ?? "";
  if (!mediaId) {
    throw new Error("Missing mediaId component in MXC URI");
  }

  return { domain, mediaId };
}

/**
 * Get the media endpoint prefix based on server version support
 * v1.11+ uses /_matrix/client/v1/media
 * Older versions use /_matrix/media/v3
 */
async function getMediaEndpointPrefix(
  homeserverUrl: string,
  accessToken: string,
): Promise<string> {
  try {
    // Try to check server version
    const versionUrl = new URL("/_matrix/client/versions", homeserverUrl);
    const response = await fetch(versionUrl.toString(), {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });

    if (response.ok) {
      const versions = await response.json();
      const supportedVersions = versions?.versions || [];
      // Check for v1.11 or later
      if (
        supportedVersions.some((v: string) =>
          v.match(/^v1\.(1[1-9]|[2-9][0-9])$/),
        )
      ) {
        return "/_matrix/client/v1/media";
      }
    }
  } catch (err) {
    LogService.debug(
      "MatrixDownload",
      "Failed to detect server version, using legacy media endpoint:",
      err,
    );
  }

  return "/_matrix/media/v3";
}

/**
 * Get or create the shared HTTP/2 capable agent
 */
function getSharedAgent(homeserverUrl: string): Pool {
  if (sharedAgent) {
    agentRefCount++;
    return sharedAgent;
  }

  const url = new URL(homeserverUrl);

  // Create a pool with HTTP/2 support
  // Undici will automatically use HTTP/2 if the server supports it
  sharedAgent = new Pool(url.origin, {
    connect: {
      // Enable HTTP/2 ALPN negotiation
      rejectUnauthorized: true,
    },
    // Connection pooling settings
    connections: 64, // Maximum number of connections
    keepAliveTimeout: 30000, // 30 seconds keep-alive
    keepAliveMaxTimeout: 60000, // 60 seconds max keep-alive
    // HTTP/2 specific settings
    allowH2: true, // Explicitly allow HTTP/2
  });

  agentRefCount = 1;

  LogService.debug(
    "MatrixDownload",
    "Created HTTP/2 capable connection pool for",
    url.origin,
  );

  return sharedAgent;
}

/**
 * Release the shared agent reference
 */
export function releaseDownloadAgent(): void {
  agentRefCount--;
  if (agentRefCount <= 0 && sharedAgent) {
    sharedAgent.close().catch((err) => {
      LogService.warn("MatrixDownload", "Error closing agent:", err);
    });
    sharedAgent = null;
    agentRefCount = 0;
    LogService.debug("MatrixDownload", "Closed HTTP/2 connection pool");
  }
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download content from Matrix media repository using HTTP/2
 *
 * @param mxcUrl - The MXC URL (mxc://domain/mediaId)
 * @param homeserverUrl - The homeserver base URL
 * @param accessToken - The Matrix access token for authentication
 * @param allowRemote - Whether to allow the server to fetch remote media (default: true)
 * @param timeoutMs - Request timeout in milliseconds (default: 30000)
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns Promise resolving to the downloaded content
 */
export async function downloadContent_v2(
  mxcUrl: string,
  homeserverUrl: string,
  accessToken: string,
  allowRemote = true,
  timeoutMs = 30000,
  maxRetries = 3,
): Promise<DownloadResult> {
  const requestId = Math.random().toString(36).substring(2, 10);
  const startTime = Date.now();

  LogService.debug(
    "MatrixDownload",
    `[${requestId}] Starting download for ${mxcUrl}`,
  );

  // Parse MXC URL
  let mxcComponents: MXCComponents;
  try {
    mxcComponents = parseMXCUrl(mxcUrl);
  } catch (err) {
    LogService.error(
      "MatrixDownload",
      `[${requestId}] Invalid MXC URL:`,
      err,
    );
    throw err;
  }

  // Get media endpoint
  const endpoint = await getMediaEndpointPrefix(homeserverUrl, accessToken);

  // Build download URL
  const downloadPath = `${endpoint}/download/${encodeURIComponent(mxcComponents.domain)}/${encodeURIComponent(mxcComponents.mediaId)}`;
  const url = new URL(downloadPath, homeserverUrl);

  // Add query parameters
  if (allowRemote !== true) {
    url.searchParams.set("allow_remote", "false");
  }

  // Get shared agent for connection reuse
  const agent = getSharedAgent(homeserverUrl);

  // Retry logic with exponential backoff
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // Exponential backoff, max 8s
      LogService.debug(
        "MatrixDownload",
        `[${requestId}] Retry ${attempt}/${maxRetries} after ${delay}ms`,
      );
      await sleep(delay);
    }

    try {
      const requestOptions: Dispatcher.RequestOptions = {
        method: "GET",
        path: url.pathname + url.search,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
        // HTTP/2 specific: allow server push (though Matrix doesn't use it)
      };

      LogService.debug(
        "MatrixDownload",
        `[${requestId}] Attempt ${attempt + 1}/${maxRetries} GET ${url.toString()}`,
      );

      const response = await agent.request(requestOptions);

      // Check for HTTP errors
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const body = await response.body.text();
        throw new Error(
          `HTTP ${response.statusCode}: ${body || "Unknown error"}`,
        );
      }

      // Get content type
      const contentType =
        (response.headers["content-type"] as string) ||
        "application/octet-stream";

      // Read response body as buffer
      const chunks: Buffer[] = [];
      for await (const chunk of response.body) {
        chunks.push(Buffer.from(chunk));
      }
      const data = Buffer.concat(chunks);

      const duration = Date.now() - startTime;
      const speed = (data.length / 1024 / (duration / 1000)).toFixed(1);

      // Check if HTTP/2 was used
      const protocol = (response.headers[":protocol"] as string) || "HTTP/1.1";

      LogService.debug(
        "MatrixDownload",
        `[${requestId}] Download complete: ${data.length} bytes in ${duration}ms (${speed} KB/s) via ${protocol}`,
      );

      return { data, contentType };
    } catch (err) {
      lastError =
        err instanceof Error ? err : new Error(String(err));

      LogService.warn(
        "MatrixDownload",
        `[${requestId}] Attempt ${attempt + 1} failed:`,
        lastError.message,
      );

      // Don't retry on certain errors
      if (lastError.message.includes("Not a valid MXC URI")) {
        throw lastError;
      }

      // On last attempt, throw the error
      if (attempt === maxRetries - 1) {
        throw new Error(
          `Failed to download after ${maxRetries} attempts: ${lastError.message}`,
        );
      }
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error("Download failed for unknown reason");
}

/**
 * Extension method for MatrixClient to use HTTP/2 download
 *
 * Usage:
 * ```typescript
 * import { downloadContent_v2 } from "./download.js";
 *
 * // Use directly
 * const result = await downloadContent_v2(
 *   "mxc://example.com/abc123",
 *   "https://matrix.example.com",
 *   "your_access_token"
 * );
 * ```
 */

// Export types for consumers
export type { DownloadResult, MXCComponents };
