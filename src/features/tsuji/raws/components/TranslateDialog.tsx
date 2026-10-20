/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogTitle from '@mui/material/DialogTitle';
import { styled } from '@mui/material/styles';
import { useLingui } from '@lingui/react/macro';

const Frame = styled('iframe')({ border: 0, width: '100%', height: '100%', display: 'block', colorScheme: 'dark' });

/**
 * Opens one of the feed's pre-signed links (translate, cancel) in a frame: the server answers with a small page, a
 * confirm page ("Translate them all?" with a relative Yes link) for batches over 10. Nothing is fetched or parsed here.
 */
export const TranslateDialog = ({
    url,
    title,
    onClose,
}: {
    url: string | null;
    title: string;
    onClose: () => void;
}) => {
    const { t } = useLingui();

    return (
        // Clicks inside must not reach the reader behind it (React events bubble through portals).
        <Dialog
            open={!!url}
            onClose={onClose}
            onClick={(event) => event.stopPropagation()}
            maxWidth="sm"
            fullWidth
            aria-label={title}
        >
            <DialogTitle>{title}</DialogTitle>
            <Box sx={{ height: 280, bgcolor: '#111' }}>
                {url && (
                    <Frame src={url} title={title} sandbox="allow-forms allow-scripts" referrerPolicy="no-referrer" />
                )}
            </Box>
            <DialogActions>
                <Button onClick={onClose}>{t`Close`}</Button>
            </DialogActions>
        </Dialog>
    );
};
