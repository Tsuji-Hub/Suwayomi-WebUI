/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import { useLingui } from '@lingui/react/macro';
import { makeToast } from '@/base/utils/Toast.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { setTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { clearCommentCache, getDefaultRelayUrl } from '@/features/tsuji/comments/commentsService.ts';
import { useCommentsSettings } from '@/features/tsuji/comments/useComments.ts';

/** Comments section of the Tsuji settings: master switch, Comick, relay URL, clear cache. */
export const CommentsSettings = () => {
    const { t } = useLingui();
    const settings = useCommentsSettings();
    const [relayDraft, setRelayDraft] = useState(settings.storedRelay);

    useEffect(() => setRelayDraft(settings.storedRelay), [settings.storedRelay]);

    const saveRelay = () => {
        // Empty = the default (this host, port 4568).
        const next = relayDraft.trim().replace(/\/+$/, '');
        setRelayDraft(next);
        if (next !== settings.storedRelay) {
            setTsujiGlobalMeta(TSUJI_META_KEYS.commentsRelay, next);
        }
    };

    return (
        <Stack sx={{ gap: 1 }}>
            <FormLabel>{t`Comments`}</FormLabel>
            <FormControlLabel
                control={
                    <Switch
                        checked={settings.isEnabled}
                        onChange={(event) => setTsujiGlobalMeta(TSUJI_META_KEYS.comments, String(event.target.checked))}
                    />
                }
                label={t`Show comments`}
            />
            <FormControlLabel
                control={
                    <Switch
                        checked={settings.isComickEnabled}
                        disabled={!settings.isEnabled}
                        onChange={(event) =>
                            setTsujiGlobalMeta(TSUJI_META_KEYS.commentsComick, String(event.target.checked))
                        }
                    />
                }
                label={t`Comick`}
            />
            <TextField
                size="small"
                label={t`Comments relay`}
                value={relayDraft}
                placeholder={getDefaultRelayUrl()}
                onChange={(event) => setRelayDraft(event.target.value)}
                onBlur={saveRelay}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        saveRelay();
                    }
                }}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText={t`Leave empty to use this server on port 4568.`}
            />
            <Button
                size="small"
                onClick={() => {
                    clearCommentCache();
                    makeToast(t`Comment cache cleared`, 'success');
                }}
                sx={{ alignSelf: 'flex-end' }}
            >
                {t`Clear comment cache`}
            </Button>
        </Stack>
    );
};
