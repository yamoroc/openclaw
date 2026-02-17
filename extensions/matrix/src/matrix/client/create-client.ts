import type { IStorageProvider, ICryptoStorageProvider } from "@vector-im/matrix-bot-sdk";
import {
  LogService,
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
} from "@vector-im/matrix-bot-sdk";
import fs from "node:fs";
import { ensureMatrixSdkLoggingConfigured } from "./logging.js";
import {
  maybeMigrateLegacyStorage,
  resolveMatrixStoragePaths,
  writeStorageMeta,
} from "./storage.js";
import { downloadContent_v2 } from "./download.js";
import type { DownloadResult } from "./download.js";

function sanitizeUserIdList(input: unknown, label: string): string[] {
  if (input == null) {
    return [];
  }
  if (!Array.isArray(input)) {
    LogService.warn(
      "MatrixClientLite",
      `Expected ${label} list to be an array, got ${typeof input}`,
    );
    return [];
  }
  const filtered = input.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
  if (filtered.length !== input.length) {
    LogService.warn(
      "MatrixClientLite",
      `Dropping ${input.length - filtered.length} invalid ${label} entries from sync payload`,
    );
  }
  return filtered;
}

export async function createMatrixClient(params: {
  homeserver: string;
  userId: string;
  accessToken: string;
  encryption?: boolean;
  localTimeoutMs?: number;
  accountId?: string | null;
}): Promise<MatrixClient> {
  ensureMatrixSdkLoggingConfigured();
  const env = process.env;

  // Create storage provider
  const storagePaths = resolveMatrixStoragePaths({
    homeserver: params.homeserver,
    userId: params.userId,
    accessToken: params.accessToken,
    accountId: params.accountId,
    env,
  });
  maybeMigrateLegacyStorage({ storagePaths, env });
  fs.mkdirSync(storagePaths.rootDir, { recursive: true });
  const storage: IStorageProvider = new SimpleFsStorageProvider(storagePaths.storagePath);

  // Create crypto storage if encryption is enabled
  let cryptoStorage: ICryptoStorageProvider | undefined;
  if (params.encryption) {
    fs.mkdirSync(storagePaths.cryptoPath, { recursive: true });

    try {
      const { StoreType } = await import("@matrix-org/matrix-sdk-crypto-nodejs");
      cryptoStorage = new RustSdkCryptoStorageProvider(storagePaths.cryptoPath, StoreType.Sqlite);
    } catch (err) {
      LogService.warn(
        "MatrixClientLite",
        "Failed to initialize crypto storage, E2EE disabled:",
        err,
      );
    }
  }

  writeStorageMeta({
    storagePaths,
    homeserver: params.homeserver,
    userId: params.userId,
    accountId: params.accountId,
  });

  const client = new MatrixClient(params.homeserver, params.accessToken, storage, cryptoStorage);

  if (client.crypto) {
    const originalUpdateSyncData = client.crypto.updateSyncData.bind(client.crypto);
    client.crypto.updateSyncData = async (
      toDeviceMessages,
      otkCounts,
      unusedFallbackKeyAlgs,
      changedDeviceLists,
      leftDeviceLists,
    ) => {
      const safeChanged = sanitizeUserIdList(changedDeviceLists, "changed device list");
      const safeLeft = sanitizeUserIdList(leftDeviceLists, "left device list");
      try {
        return await originalUpdateSyncData(
          toDeviceMessages,
          otkCounts,
          unusedFallbackKeyAlgs,
          safeChanged,
          safeLeft,
        );
      } catch (err) {
        const message = typeof err === "string" ? err : err instanceof Error ? err.message : "";
        if (message.includes("Expect value to be String")) {
          LogService.warn(
            "MatrixClientLite",
            "Ignoring malformed device list entries during crypto sync",
            message,
          );
          return;
        }
        throw err;
      }
    };
  }

  return client;
}

/**
 * Extended MatrixClient interface with HTTP/2 download support
 */
export interface MatrixClientWithHttp2Download extends MatrixClient {
  /**
   * Download content using HTTP/2 for improved performance.
   * Falls back to HTTP/1.1 if HTTP/2 is not supported by the server.
   *
   * @param mxcUrl - The MXC URL (mxc://domain/mediaId)
   * @param allowRemote - Whether to allow the server to fetch remote media (default: true)
   * @param timeoutMs - Request timeout in milliseconds (default: 30000)
   * @param maxRetries - Maximum number of retry attempts (default: 3)
   * @returns Promise resolving to the downloaded content
   */
  downloadContent_v2(
    mxcUrl: string,
    allowRemote?: boolean,
    timeoutMs?: number,
    maxRetries?: number,
  ): Promise<DownloadResult>;
}

/**
 * Check if a client has been extended with HTTP/2 download support
 */
export function hasHttp2Download(client: MatrixClient): client is MatrixClientWithHttp2Download {
  return "downloadContent_v2" in client;
}

/**
 * Extend a MatrixClient with HTTP/2 download capabilities.
 * This patches the client instance to add the downloadContent_v2 method.
 *
 * @param client - The MatrixClient to extend
 * @returns The extended client with downloadContent_v2 method
 *
 * @example
 * ```typescript
 * const client = await createMatrixClient({...});
 * const clientWithHttp2 = extendClientWithHttp2Download(client);
 *
 * // Now you can use HTTP/2 downloads
 * const { data, contentType } = await clientWithHttp2.downloadContent_v2("mxc://example.com/abc123");
 * ```
 */
export function extendClientWithHttp2Download(
  client: MatrixClient,
): MatrixClientWithHttp2Download {
  if (hasHttp2Download(client)) {
    return client;
  }

  const extendedClient = client as MatrixClientWithHttp2Download;

  extendedClient.downloadContent_v2 = async (
    mxcUrl: string,
    allowRemote = true,
    timeoutMs = 30000,
    maxRetries = 3,
  ): Promise<DownloadResult> => {
    return downloadContent_v2(
      mxcUrl,
      client.homeserverUrl,
      client.accessToken,
      allowRemote,
      timeoutMs,
      maxRetries,
    );
  };

  return extendedClient;
}
