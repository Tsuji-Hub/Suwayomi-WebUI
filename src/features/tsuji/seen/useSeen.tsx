/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useMemo } from 'react';
import Button from '@mui/material/Button';
import { closeSnackbar } from 'notistack';
import { useLingui } from '@lingui/react/macro';
import { makeToast } from '@/base/utils/Toast.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { useMyAniList } from '@/features/tsuji/seen/myListStore.ts';
import type { SeenMark, SeenMarks, SeenState } from '@/features/tsuji/seen/seen.ts';
import { createSeenUpdater, createUndoPatch, getSeenState, parseSeenMarks } from '@/features/tsuji/seen/seen.ts';
import {
    readFreshTsujiGlobalMeta,
    useTsujiGlobalMetaQuery,
    writeTsujiGlobalMeta,
} from '@/features/tsuji/services/TsujiMetadata.ts';

const UNDO_TOAST_MS = 8000;

/** Merge-on-write against the server's current `tsuji_seen` (one write per action). */
export const updateSeenMarks = createSeenUpdater({
    read: async () => parseSeenMarks(await readFreshTsujiGlobalMeta(TSUJI_META_KEYS.seen)),
    write: (marks: SeenMarks) => writeTsujiGlobalMeta(TSUJI_META_KEYS.seen, JSON.stringify(marks)),
});

export type GetSeenState = (mediaId: number) => SeenState | null;

/** "Already read" knowledge for cards: the user's AniList list plus manual marks (a mark wins). */
export const useSeen = () => {
    const myList = useMyAniList();
    const { meta, isLoading: isMetaLoading } = useTsujiGlobalMetaQuery();
    const rawMarks = meta[TSUJI_META_KEYS.seen];
    const marks = useMemo(() => parseSeenMarks(rawMarks), [rawMarks]);

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

    return useCallback(
        (media: Pick<RecMedia, 'id'>, mark: SeenMark | null) => {
            const key = String(media.id);
            let previous: SeenMark | null = null;
            const reportFailure = (error: unknown) => {
                defaultPromiseErrorHandler('useSeenActions')(error);
                makeToast(t`Couldn't save that. Check the connection to the server.`, 'error');
            };

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
        [t],
    );
};
