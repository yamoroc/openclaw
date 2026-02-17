export type { MatrixAuth, MatrixResolvedConfig } from "./client/types.js";
export { isBunRuntime } from "./client/runtime.js";
export {
  resolveMatrixConfig,
  resolveMatrixConfigForAccount,
  resolveMatrixAuth,
} from "./client/config.js";
export {
  createMatrixClient,
  extendClientWithHttp2Download,
  hasHttp2Download,
  type MatrixClientWithHttp2Download,
} from "./client/create-client.js";
export {
  resolveSharedMatrixClient,
  waitForMatrixSync,
  stopSharedClient,
  stopSharedClientForAccount,
} from "./client/shared.js";
export {
  downloadContent_v2,
  releaseDownloadAgent,
  type DownloadResult,
  type MXCComponents,
} from "./client/download.js";
