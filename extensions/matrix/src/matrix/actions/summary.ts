import type { MatrixClient } from "@vector-im/matrix-bot-sdk";
import {
  EventType,
  type MatrixMessageSummary,
  type MatrixRawEvent,
  type RoomMessageEventContent,
  type RoomPinnedEventsEventContent,
} from "./types.js";

export function summarizeMatrixRawEvent(
  event: MatrixRawEvent,
  opts?: {
    includeMedia?: boolean;
    client?: MatrixClient;
  }
): MatrixMessageSummary {
  const content = event.content as RoomMessageEventContent;
  const relates = content["m.relates_to"];
  let relType: string | undefined;
  let eventId: string | undefined;
  if (relates) {
    if ("rel_type" in relates) {
      relType = relates.rel_type;
      eventId = relates.event_id;
    } else if ("m.in_reply_to" in relates) {
      eventId = relates["m.in_reply_to"]?.event_id;
    }
  }
  const relatesTo =
    relType || eventId
      ? {
          relType,
          eventId,
        }
      : undefined;
  
  const summary: MatrixMessageSummary = {
    eventId: event.event_id,
    sender: event.sender,
    body: content.body,
    msgtype: content.msgtype,
    timestamp: event.origin_server_ts,
    relatesTo,
  };
  
  // 处理媒体信息
  if (opts?.includeMedia && content.msgtype?.startsWith("m.image")) {
    const info = content.info as Record<string, unknown> | undefined;
    const mxcUrl = content.url as string | undefined;
    const encryptedMxc = (content.file as Record<string, unknown> | undefined)?.url as string | undefined;
    const mxcUrlToUse = mxcUrl || encryptedMxc;
    
    if (mxcUrlToUse) {
      summary.media = {
        mxcUrl: mxcUrlToUse,
        downloadUrl: opts.client?.mxcToHttp?.(mxcUrlToUse) || buildMxcDownloadUrl(mxcUrlToUse),
        encrypted: mxcUrl === undefined && encryptedMxc !== undefined,
        contentType: typeof info?.mimetype === "string" ? info.mimetype : undefined,
        sizeBytes: typeof info?.size === "number" ? info.size : undefined,
      };
    }
  }
  
  return summary;
}

/**
 * Build HTTP download URL from MXC URL
 * mxc://server/mediaId -> https://server/_matrix/media/r0/download/server/mediaId
 */
function buildMxcDownloadUrl(mxcUrl: string): string | undefined {
  if (!mxcUrl.startsWith("mxc://")) return undefined;
  const parts = mxcUrl.slice(6).split("/");
  if (parts.length < 2) return undefined;
  const [server, ...mediaIdParts] = parts;
  const mediaId = mediaIdParts.join("/");
  return `https://${server}/_matrix/media/r0/download/${server}/${mediaId}`;
}

export async function readPinnedEvents(client: MatrixClient, roomId: string): Promise<string[]> {
  try {
    const content = (await client.getRoomStateEvent(
      roomId,
      EventType.RoomPinnedEvents,
      "",
    )) as RoomPinnedEventsEventContent;
    const pinned = content.pinned;
    return pinned.filter((id) => id.trim().length > 0);
  } catch (err: unknown) {
    const errObj = err as { statusCode?: number; body?: { errcode?: string } };
    const httpStatus = errObj.statusCode;
    const errcode = errObj.body?.errcode;
    if (httpStatus === 404 || errcode === "M_NOT_FOUND") {
      return [];
    }
    throw err;
  }
}

export async function fetchEventSummary(
  client: MatrixClient,
  roomId: string,
  eventId: string,
  opts?: {
    includeMedia?: boolean;
  }
): Promise<MatrixMessageSummary | null> {
  try {
    const raw = (await client.getEvent(roomId, eventId)) as unknown as MatrixRawEvent;
    if (raw.unsigned?.redacted_because) {
      return null;
    }
    return summarizeMatrixRawEvent(raw, {
      includeMedia: opts?.includeMedia,
      client,
    });
  } catch {
    // Event not found, redacted, or inaccessible - return null
    return null;
  }
}
