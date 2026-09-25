/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { makeToast } from '@/base/utils/Toast.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { DEFAULT_ANILIST_USER, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { setTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { updateSeenMarks, useSeen } from '@/features/tsuji/seen/useSeen.tsx';

/** Tsuji settings for Discover/Similar: the AniList list that marks titles as read, and the manual marks. */
export const TsujiSettingsDialog = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const { t } = useLingui();
    const { myList, marks } = useSeen();
    const [userDraft, setUserDraft] = useState(myList.userName);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setUserDraft(myList.userName);
        }
    }, [isOpen, myList.userName]);

    const markCount = Object.keys(marks).length;

    const saveUser = () => {
        // An empty field means "back to the default user".
        const next = userDraft.trim() || DEFAULT_ANILIST_USER;
        setUserDraft(next);
        if (next !== myList.userName) {
            setTsujiGlobalMeta(TSUJI_META_KEYS.anilistUser, next === DEFAULT_ANILIST_USER ? '' : next);
        }
    };

    const syncText = (() => {
        if (myList.isError) {
            return t`Couldn't load this list. Check the username and that the list is public.`;
        }
        if (!myList.fetchedAt) {
            return t`Loading…`;
        }
        const time = new Date(myList.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const titles = plural(myList.count, { one: '# title', other: '# titles' });
        return t`${titles}, synced at ${time}`;
    })();

    const clearAll = () => {
        setIsConfirmOpen(false);
        updateSeenMarks((current) => Object.fromEntries(Object.keys(current).map((key) => [key, null])))
            .then(() => makeToast(t`Cleared all marks`, 'success'))
            .catch((error) => {
                defaultPromiseErrorHandler('TsujiSettingsDialog::clearAll')(error);
                makeToast(t`Couldn't clear the marks. Check the connection to the server.`, 'error');
            });
    };

    return (
        <>
            <Dialog open={isOpen} onClose={onClose} maxWidth="xs" fullWidth>
                <DialogTitle>{t`Discover settings`}</DialogTitle>
                <DialogContent>
                    <Stack sx={{ gap: 3, pt: 1 }}>
                        <Stack sx={{ gap: 1 }}>
                            <TextField
                                size="small"
                                label={t`AniList username`}
                                value={userDraft}
                                onChange={(event) => setUserDraft(event.target.value)}
                                onBlur={saveUser}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        saveUser();
                                    }
                                }}
                                helperText={t`Titles on this public list are badged, and hidden while "Hide what's on my AniList" is on.`}
                            />
                            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    {syncText}
                                </Typography>
                                <Button size="small" onClick={myList.refresh} sx={{ ml: 'auto' }}>
                                    {t`Refresh`}
                                </Button>
                            </Stack>
                        </Stack>
                        <Stack sx={{ gap: 1 }}>
                            <FormLabel>{t`Marked on cards`}</FormLabel>
                            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    {plural(markCount, {
                                        one: '# title marked read or not interested',
                                        other: '# titles marked read or not interested',
                                    })}
                                </Typography>
                                <Button
                                    size="small"
                                    color="error"
                                    disabled={!markCount}
                                    onClick={() => setIsConfirmOpen(true)}
                                    sx={{ ml: 'auto' }}
                                >
                                    {t`Clear all marks`}
                                </Button>
                            </Stack>
                        </Stack>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>{t`Close`}</Button>
                </DialogActions>
            </Dialog>
            <Dialog open={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
                <DialogTitle>{t`Clear all marks?`}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t`Every title you marked as read or not interested shows up again, on all devices. Your AniList list is not affected.`}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setIsConfirmOpen(false)}>{t`Cancel`}</Button>
                    <Button color="error" onClick={clearAll}>
                        {t`Clear all`}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};
