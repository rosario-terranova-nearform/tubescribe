// Innertube client factory — the ONLY module in the app that imports
// youtubei.js. Everything else depends on the `InnertubeLike` boundary
// (./types.ts) so discovery, listing and transcripts stay mockable and
// the fallback chain can swap client types (bot-detection defense, see
// docs/DESIGN.md and youtubei.js issues #1102 / #1119).

import Innertube, { ClientType } from 'youtubei.js';
import type { InnertubeLike } from './types.js';

export { ClientType };

/**
 * Create an Innertube client for the given client type.
 *
 * `generate_session_locally` avoids a session round-trip at startup: the
 * session data is derived on-device (this app is keyless, no cookies), and
 * the player is only retrieved lazily if a call actually needs it.
 */
export async function createInnertubeClient(
  clientType: ClientType = ClientType.WEB,
): Promise<InnertubeLike> {
  // The Innertube instance structurally satisfies InnertubeLike; tsc enforces
  // that here so the boundary can't silently drift from the library.
  return Innertube.create({ client_type: clientType, generate_session_locally: true });
}

/** Default client (WEB). */
export function createDefaultClient(): Promise<InnertubeLike> {
  return createInnertubeClient(ClientType.WEB);
}

/** TV_EMBEDDED variant — the known workaround for LOGIN_REQUIRED (#1119). */
export function createTvEmbeddedClient(): Promise<InnertubeLike> {
  return createInnertubeClient(ClientType.TV_EMBEDDED);
}
