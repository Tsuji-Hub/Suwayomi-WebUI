/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';

const JIKAN_URL = 'https://api.jikan.moe/v4';
const JIKAN_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [2000, 4000];

/** Jikan allows ~1 req/s per client. */
const jikanQueue = new SpacedQueue(1100);

export const jikanGet = async <T>(path: string, signal: AbortSignal, attempt: number = 0): Promise<T> => {
    signal.throwIfAborted();

    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Jikan request timed out')), JIKAN_TIMEOUT_MS);

    try {
        const response = await jikanQueue.run(
            () => fetch(`${JIKAN_URL}${path}`, { signal: controller.signal }),
            controller.signal,
        );

        if (response.status === 429 && attempt < RETRY_DELAYS_MS.length) {
            jikanQueue.pauseUntil(Date.now() + RETRY_DELAYS_MS[attempt]);
            return await jikanGet<T>(path, signal, attempt + 1);
        }

        if (!response.ok) {
            throw new Error(`Jikan request failed (${response.status})`);
        }

        return (await response.json()) as T;
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
    }
};
