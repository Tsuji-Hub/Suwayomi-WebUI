/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TranslateIcon from '@mui/icons-material/Translate';
import { useLingui } from '@lingui/react/macro';
import { AppRoutes } from '@/base/AppRoute.constants.ts';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { readTsujiMangaMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { getSeriesLinks, parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import { useRawFeedRow } from '@/features/tsuji/raws/rawFeed.ts';
import { TranslateDialog } from '@/features/tsuji/raws/components/TranslateDialog.tsx';

type Action = { url: string; title: string };

/**
 * Series page row: "Raw · <source>" (opens the raw series), "18+ raw", "MTL · <done> translated" (opens the MTL
 * series) and, when the raw is ahead, Translate <next> / Next 10 / All <n> (and Cancel while queued), opened in a
 * dialog. Only when the series has links in meta or a row in the feed. Raw and MTL series are never added to the
 * library from here.
 */
export const TsujiRawChips = ({ manga }: { manga: { id: number } & GqlMetaHolder }) => {
    const { t } = useLingui();
    const links = parseRawLinks(readTsujiMangaMeta(manga, TSUJI_META_KEYS.rawLinks));
    const { row, refresh } = useRawFeedRow(manga.id);
    const [action, setAction] = useState<Action | null>(null);
    const series = getSeriesLinks(links, row);

    if (!series.hasAny) {
        return null;
    }

    const open = (url: string, title: string) => url && setAction({ url, title });

    return (
        <Stack
            direction="row"
            component="section"
            aria-label={t`Raws`}
            sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}
        >
            {series.rawId && (
                <Chip
                    clickable
                    component={Link}
                    to={AppRoutes.manga.path(series.rawId)}
                    label={series.rawSource ? t`Raw · ${series.rawSource}` : t`Raw`}
                    variant="outlined"
                />
            )}
            {series.isUncensored && <Chip label={t`18+ raw`} color="error" variant="outlined" size="small" />}
            {series.mtlId && (
                <Chip
                    clickable
                    component={Link}
                    to={AppRoutes.manga.path(series.mtlId)}
                    label={row ? t`MTL · ${row.done} translated` : t`MTL`}
                    variant="outlined"
                />
            )}
            {row && row.ahead > 0 && (
                <>
                    {row.tNext && (
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<TranslateIcon fontSize="small" />}
                            onClick={() => open(row.tNext, t`Translate chapter ${row.next}`)}
                        >
                            {t`Translate ${row.next}`}
                        </Button>
                    )}
                    {row.t10 && (
                        <Button size="small" onClick={() => open(row.t10, t`Translate the next 10`)}>
                            {t`Next 10`}
                        </Button>
                    )}
                    {row.tAll && row.nAll > 0 && (
                        <Button size="small" onClick={() => open(row.tAll, t`Translate all ${row.nAll}`)}>
                            {t`All ${row.nAll}`}
                        </Button>
                    )}
                </>
            )}
            {row && row.queued > 0 && row.cancel && (
                <Button size="small" color="error" onClick={() => open(row.cancel, t`Cancel translation`)}>
                    {t`Cancel`}
                </Button>
            )}
            <TranslateDialog
                url={action?.url ?? null}
                title={action?.title ?? ''}
                onClose={() => {
                    setAction(null);
                    refresh();
                }}
            />
        </Stack>
    );
};
