/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo } from 'react';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { convertFromGqlMeta } from '@/features/metadata/services/MetadataConverter.ts';
import { MetadataChunker } from '@/features/metadata/services/MetadataChunker.ts';
import {
    requestMangaMetadataUpdate,
    requestServerMetadataUpdate,
} from '@/features/metadata/services/MetadataUpdater.ts';
import type { AppMetadataKeys, GqlMetaHolder, Metadata } from '@/features/metadata/Metadata.types.ts';
import type { MangaIdInfo } from '@/features/manga/Manga.types.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { TsujiMetaKey } from '@/features/tsuji/Tsuji.constants.ts';

const toMetadata = (meta: GqlMetaHolder['meta']): Partial<Metadata> =>
    MetadataChunker.reassembleAllChunkedValues(convertFromGqlMeta(meta)) ?? {};

/**
 * Upstream types metadata keys as its own registered keys; `isMetadataKey: true` skips its "webUI_" prefixing,
 * so raw tsuji keys are stored as-is and never touched by upstream migrations.
 */
const asRawKey = (key: TsujiMetaKey) => key as unknown as AppMetadataKeys;

export const useTsujiGlobalMetaQuery = (): {
    meta: Partial<Metadata>;
    /** As stored: upstream's chunked values are not reassembled (the sharded tsuji keys need the raw keys). */
    rawMeta: Partial<Metadata>;
    isLoading: boolean;
} => {
    const { data, loading } = requestManager.useGetGlobalMeta();
    const meta = useMemo(() => toMetadata(data?.metas.nodes), [data]);
    const rawMeta = useMemo(() => convertFromGqlMeta(data?.metas.nodes) ?? {}, [data]);

    return { meta, rawMeta, isLoading: loading && !data };
};

export const useTsujiGlobalMeta = (): Partial<Metadata> => useTsujiGlobalMetaQuery().meta;

/**
 * All global meta on the server right now (network-only, one request), as stored (no chunk reassembly), for
 * read-patch-write updates that must not clobber other devices.
 */
export const readFreshTsujiRawGlobalMeta = async (): Promise<Partial<Metadata>> => {
    const { data } = await requestManager.getGlobalMeta({
        fetchPolicy: 'network-only',
        context: { queryDeduplication: false },
    }).response;
    return convertFromGqlMeta(data?.metas.nodes) ?? {};
};

/**
 * Sets and deletes raw keys in one request, bypassing upstream's metadata updater: its chunk cleanup treats
 * `<key>_0`, `<key>_1`, ... as chunks of `<key>` and would delete the tsuji_seen shards together with the legacy key.
 * Callers keep every value under the server's limit themselves. Rejects on failure.
 */
export const writeTsujiRawGlobalMeta = async ({
    set,
    delete: keys,
}: {
    set: [key: string, value: string][];
    delete: string[];
}): Promise<void> => {
    await requestManager.updateGlobalMeta({
        updateInput: { metas: set.map(([key, value]) => ({ key, value })) },
        postUpdateDeleteInput: { keys },
    }).response;
};

export const useTsujiFlag = (key: TsujiMetaKey, fallback: boolean = true): boolean => {
    const value = useTsujiGlobalMeta()[key];

    return value === undefined ? fallback : value === 'true';
};

export const readTsujiMangaMeta = (manga: GqlMetaHolder, key: TsujiMetaKey): string | undefined =>
    toMetadata(manga.meta)[key];

export const setTsujiGlobalMeta = (key: TsujiMetaKey, value: string): Promise<void> =>
    requestServerMetadataUpdate({ update: [[asRawKey(key), value]], isMetadataKey: true }).catch(
        defaultPromiseErrorHandler(`setTsujiGlobalMeta(${key})`),
    );

export const setTsujiMangaMeta = (manga: MangaIdInfo & GqlMetaHolder, key: TsujiMetaKey, value: string) =>
    requestMangaMetadataUpdate(manga, { update: [[asRawKey(key), value]], isMetadataKey: true }).catch(
        defaultPromiseErrorHandler(`setTsujiMangaMeta(${key})`),
    );
