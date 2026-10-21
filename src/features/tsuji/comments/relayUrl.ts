/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export const RELAY_PORT = 4568;

/**
 * The relay's base URL: `tsuji_commentsRelay`, else the host serving this WebUI on port 4568 (the relay runs next
 * to Suwayomi on CT100), so no address is baked into the bundle.
 */
export const getDefaultRelayUrl = (location: Pick<Location, 'protocol' | 'hostname'> = window.location) =>
    `${location.protocol}//${location.hostname}:${RELAY_PORT}`;

export const resolveRelayUrl = (stored: string | undefined) => stored?.trim() || getDefaultRelayUrl();

let relayUrl = '';

export const setCommentsRelayUrl = (url: string) => {
    relayUrl = url;
};

/** The relay base URL in use (set from `tsuji_commentsRelay` by useCommentsSettings; the default until then). */
export const getCommentsRelayUrl = () => relayUrl || getDefaultRelayUrl();
