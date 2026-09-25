/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo } from 'react';
import Button from '@mui/material/Button';
import { closeSnackbar } from 'notistack';
import { useLingui } from '@lingui/react/macro';
import { makeToast } from '@/base/utils/Toast.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { useMyAniList } from '@/features/tsuji/seen/myListStore.ts';
import type { SeenMark, SeenState } from '@/features/tsuji/seen/seen.ts';
import { createUndoPatch, getSeenState } from '@/features/tsuji/seen/seen.ts';
import {
    createSeenUpdater,
    isSeenMetaKey,
    readSeenStore,
    SEEN_BUCKET_MAX_CHARS,
    SeenBucketFullError,
} from '@/features/tsuji/seen/seenShards.ts';
import {
    readFreshTsujiRawGlobalMeta,
    useTsujiGlobalMetaQuery,
    writeTsujiRawGlobalMeta,
} from '@/features/tsuji/services/TsujiMetadata.ts';

const UNDO_TOAST_MS = 8000;

// Long enough to read the numbers; nothing was saved, so the user has to act on it.
const FULL_TOAST_MS = 15000;

/** Merge-on-write against the server's current shards (one read, one write of the touched buckets per action). */
export const updateSeenMarks = createSeenUpdater({
    read: async () => readSeenStore(await readFreshTsujiRawGlobalMeta()),
    write: writeTsujiRawGlobalMeta,
});

/** Error toast for a failed marks update; a full bucket gets its own message (nothing was written). */
export const useReportSeenFailure = () => {
    const { t } = useLingui();

    return useCallback(
        (context: string, fallbackMessage: string) => (error: unknown) => {
            defaultPromiseErrorHandler(context)(error);

            if (error instanceof SeenBucketFullError) {
                const { bucket, length } = error;
                makeToast(
                    t`Too many marks to store: bucket ${bucket} would be ${length} characters (limit ${SEEN_BUCKET_MAX_CHARS}). Nothing was saved.`,
                    { variant: 'error', autoHideDuration: FULL_TOAST_MS },
                );
                return;
            }

            makeToast(fallbackMessage, 'error');
        },
        [t],
    );
};

let legacyMigration: Promise<unknown> | null = null;

/** Moves the legacy single `tsuji_seen` value into the shards once per session (a failed attempt may retry). */
const useLegacySeenMigration = (hasLegacy: boolean) => {
    const { t } = useLingui();
    const reportFailure = useReportSeenFailure();

    useEffect(() => {
        if (!hasLegacy || legacyMigration) {
            return;
        }

        legacyMigration = updateSeenMarks({}).catch((error) => {
            if (!(error instanceof SeenBucketFullError)) {
                legacyMigration = null;
            }
            reportFailure(
                'useLegacySeenMigration',
                t`Couldn't move the marks to the new format. Check the connection to the server.`,
            )(error);
        });
    }, [hasLegacy, reportFailure, t]);
};

export type GetSeenState = (mediaId: number) => SeenState | null;

/** "Already read" knowledge for cards: the user's AniList list plus manual marks (a mark wins). */
export const useSeen = () => {
    const myList = useMyAniList();
    const { rawMeta, isLoading: isMetaLoading } = useTsujiGlobalMetaQuery();
    // Keyed on the marks' own keys only, so unrelated global meta writes (filters) keep the same marks object.
    const seenMetaSignature = useMemo(
        () => JSON.stringify(Object.entries(rawMeta).filter(([key]) => isSeenMetaKey(key))),
        [rawMeta],
    );
    const store = useMemo(() => readSeenStore(Object.fromEntries(JSON.parse(seenMetaSignature))), [seenMetaSignature]);
    const { marks } = store;
    useLegacySeenMigration(store.legacyKeys.length > 0);

    // Same object per title until the list or marks change, so memoized cards don't re-render on every screen render.
    const getState = useMemo<GetSeenState>(() => {
        const states = new Map<number, SeenState | null>();
        return (mediaId) => {
            if (!states.has(mediaId)) {
                states.set(mediaId, getSeenState(mediaId, myList.list, marks));
            }
            return states.get(mediaId)!;
        };
    }, [myList.list, marks]);

    return { getSeenState: getState, marks, myList, isSettled: myList.isSettled && !isMetaLoading };
};

/**
 * Mark as read / not interested / unhide, with Undo in the toast. The previous value is read inside the serialized
 * server update, and Undo only restores it if the title still has this action's mark (a newer mark wins).
 */
export const useSeenActions = () => {
    const { t } = useLingui();
    const reportSeenFailure = useReportSeenFailure();

    return useCallback(
        (media: Pick<RecMedia, 'id'>, mark: SeenMark | null) => {
            const key = String(media.id);
            let previous: SeenMark | null = null;
            const reportFailure = reportSeenFailure(
                'useSeenActions',
                t`Couldn't save that. Check the connection to the server.`,
            );

            updateSeenMarks((current) => {
                previous = current[key] ?? null;
                return { [key]: mark };
            })
                .then(() => {
                    const messages: Record<SeenMark | 'unhide', string> = {
                        read: t`Marked as read`,
                        skip: t`Marked not interested`,
                        unhide: t`Unhidden`,
                    };

                    makeToast(messages[mark ?? 'unhide'], {
                        variant: 'success',
                        // Longer than the 5 s default: Undo has to be reachable after a mis-tap.
                        autoHideDuration: UNDO_TOAST_MS,
                        action: (snackbarKey) => (
                            <Button
                                color="inherit"
                                size="small"
                                onClick={() => {
                                    closeSnackbar(snackbarKey);
                                    updateSeenMarks(createUndoPatch(key, mark, previous)).catch(reportFailure);
                                }}
                            >
                                {t`Undo`}
                            </Button>
                        ),
                    });
                })
                .catch(reportFailure);
        },
        [t, reportSeenFailure],
    );
};
