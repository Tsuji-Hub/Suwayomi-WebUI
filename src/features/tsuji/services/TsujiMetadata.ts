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

export const useTsujiGlobalMetaQuery = (): { meta: Partial<Metadata>; isLoading: boolean } => {
    const { data, loading } = requestManager.useGetGlobalMeta();
    const meta = useMemo(() => toMetadata(data?.metas.nodes), [data]);

    return { meta, isLoading: loading && !data };
};

export const useTsujiGlobalMeta = (): Partial<Metadata> => useTsujiGlobalMetaQuery().meta;

/** Server value right now (network-only), for read-patch-write updates that must not clobber other devices. */
export const readFreshTsujiGlobalMeta = async (key: TsujiMetaKey): Promise<string | undefined> => {
    const { data } = await requestManager.getGlobalMeta({
        fetchPolicy: 'network-only',
        context: { queryDeduplication: false },
    }).response;
    return toMetadata(data?.metas.nodes)[key];
};

/** Like setTsujiGlobalMeta, but rejects on failure so the caller can report it. */
export const writeTsujiGlobalMeta = (key: TsujiMetaKey, value: string): Promise<void> =>
    requestServerMetadataUpdate({ update: [[asRawKey(key), value]], isMetadataKey: true });

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
