/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { Fragment, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { useLingui } from '@lingui/react/macro';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { GET_MANGA_META } from '@/lib/graphql/manga/MangaQuery.ts';
import { GET_CHAPTERS_MANGA } from '@/lib/graphql/chapter/ChapterQuery.ts';
import type {
    GetChaptersMangaQuery,
    GetChaptersMangaQueryVariables,
    GetMangaMetaQuery,
    GetMangaMetaQueryVariables,
} from '@/lib/graphql/generated/graphql.ts';
import { updateChapterListOptions, useChapterListOptions } from '@/features/chapter/utils/ChapterList.util.tsx';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import {
    readTsujiMangaMeta,
    useTsujiGlobalMetaQuery,
    writeTsujiRawGlobalMeta,
} from '@/features/tsuji/services/TsujiMetadata.ts';
import { getRelativeTime } from '@/features/tsuji/bell/chapterBell.ts';
import type { SimilarManga } from '@/features/tsuji/similar/useSimilarRecs.ts';
import type { TlCompare, TlVariant, TlWord } from '@/features/tsuji/tlCompare/tlCompare.ts';
import {
    formatRunRange,
    getActiveVariant,
    getGroupRuns,
    getPrimaryGroup,
    getScanlators,
    getTlRequestKey,
    getTlView,
    isRequestAnswered,
    isReuploadSite,
    parseTlCompare,
} from '@/features/tsuji/tlCompare/tlCompare.ts';

/** While a check runs, the manga meta is read again this often. */
const POLL_MS = 30_000;
const MAX_TERMS = 5;
const MAX_WORDS = 6;

const Grid = styled('div')(({ theme }) => ({
    display: 'grid',
    gridTemplateColumns: 'minmax(80px, max-content) minmax(0, 1fr) minmax(0, 1fr)',
    columnGap: theme.spacing(2),
    rowGap: theme.spacing(1),
    alignItems: 'start',
}));

const RowLabel = ({ children }: { children: string }) => (
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, pt: 0.25 }}>
        {children}
    </Typography>
);

const Cell = styled('div')({ minWidth: 0, overflowWrap: 'anywhere' });

/** "ch 1-200 Asura Scans · 251 Manhwa Freak · 301-351 UTOON (re-upload site)", re-upload sites muted. */
const GroupRuns = ({ variant }: { variant: TlVariant }) => {
    const runs = getGroupRuns(variant.groupByCh);
    if (!runs.length) {
        return null;
    }
    return (
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
            {'ch '}
            {runs.map((run, index) => (
                <Fragment key={`${run.from}-${run.name}`}>
                    {index > 0 && ' · '}
                    {formatRunRange(run)}{' '}
                    <Typography
                        component="span"
                        variant="caption"
                        sx={{ color: isReuploadSite(run.name) ? 'text.disabled' : 'text.primary' }}
                    >
                        {run.name}
                    </Typography>
                </Fragment>
            ))}
        </Typography>
    );
};

/** "unofficial · Asura Scans": the variant and who made most of it, when known. */
const getHeading = (variant: TlVariant) => {
    const group = getPrimaryGroup(variant.group);
    return group ? `${variant.name} · ${group}` : variant.name;
};

const WordChips = ({ words }: { words: TlWord[] }) => (
    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
        {words.slice(0, MAX_WORDS).map(({ w, n }) => (
            <Chip key={w} label={`${w} ×${n}`} size="small" variant="outlined" />
        ))}
    </Stack>
);

const CompareGrid = ({
    result,
    activeVariant,
    onRead,
}: {
    result: TlCompare;
    activeVariant: string | null;
    onRead: (variant: TlVariant) => void;
}) => {
    const { t } = useLingui();
    const [first, second] = result.variants;
    const sampledCount = result.sampled.length;
    const columns = [first, second];
    const notes = (variant: TlVariant) => (variant.tn ? t`${variant.tn} in ${sampledCount} chapters` : t`none`);
    return (
        <Grid>
            <span />
            {columns.map((variant) => (
                <Stack key={variant.name} sx={{ gap: 0.5, alignItems: 'flex-start' }}>
                    <Typography variant="subtitle2">{getHeading(variant)}</Typography>
                    <Button
                        size="small"
                        variant={activeVariant === variant.name ? 'contained' : 'outlined'}
                        onClick={() => onRead(variant)}
                    >
                        {t`Read ${variant.name}`}
                    </Button>
                </Stack>
            ))}

            <RowLabel>{t`Made by`}</RowLabel>
            {columns.map((variant) => (
                <Cell key={variant.name}>
                    <Typography variant="body2">{variant.group || t`Unknown`}</Typography>
                    <GroupRuns variant={variant} />
                </Cell>
            ))}

            {!!result.terms.length && (
                <>
                    <RowLabel>{t`Same thing, different word`}</RowLabel>
                    {[
                        { variant: first, side: 'a' as const },
                        { variant: second, side: 'b' as const },
                    ].map(({ variant, side }) => (
                        <Stack key={variant.name} sx={{ gap: 0.5 }}>
                            {result.terms.slice(0, MAX_TERMS).map((term) => {
                                const word = side === 'a' ? term.a : term.b;
                                const otherWord = side === 'a' ? term.b : term.a;
                                const drift = side === 'a' ? term.driftA : term.driftB;
                                const chapters = drift.join(', ');
                                return (
                                    <Cell key={`${term.a}|${term.b}`}>
                                        <Typography variant="body2">“{word}”</Typography>
                                        {!!drift.length && (
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                {t`${variant.name} also uses "${otherWord}" in ch ${chapters}`}
                                            </Typography>
                                        )}
                                    </Cell>
                                );
                            })}
                        </Stack>
                    ))}
                </>
            )}

            {(!!result.onlyA.length || !!result.onlyB.length) && (
                <>
                    <RowLabel>{t`Words only one uses`}</RowLabel>
                    <WordChips words={result.onlyA} />
                    <WordChips words={result.onlyB} />
                </>
            )}

            <RowLabel>{t`Translator notes`}</RowLabel>
            {columns.map((variant) => (
                <Typography key={variant.name} variant="body2">
                    {notes(variant)}
                </Typography>
            ))}

            <RowLabel>{t`Pages`}</RowLabel>
            {columns.map((variant) => (
                <Typography key={variant.name} variant="body2">
                    {`${variant.widthMin}-${variant.widthMax} px`}
                </Typography>
            ))}

            <RowLabel>{t`Chapters`}</RowLabel>
            {columns.map((variant) => (
                <Typography key={variant.name} variant="body2">
                    {variant.chapters}
                </Typography>
            ))}
        </Grid>
    );
};

/**
 * "Compare translations" on the series page (brief #16), under the description: the tlcompare service's result for
 * a series with two English uploads, "Read <variant>" (the chapter list's existing scanlator filter, so the list,
 * Continue, next chapter and download-ahead follow it), and the request when there is no result yet. Works for any
 * manga id (also before adding to the library); only Suwayomi meta is read and written.
 */
export const TlCompareCard = ({ manga }: { manga: SimilarManga }) => {
    const { t, i18n } = useLingui();
    const result = useMemo(() => parseTlCompare(readTsujiMangaMeta(manga, TSUJI_META_KEYS.tlCompare)), [manga]);
    const view = getTlView(result);

    // A check in progress: asked here, or the server still holds the request key (asked on another device).
    const requestKey = getTlRequestKey(manga.id);
    const storedRequest = Number((useTsujiGlobalMetaQuery().rawMeta as Record<string, string | undefined>)[requestKey]);
    const [askedAt, setAskedAt] = useState<number | null>(null);
    const requestedAt = askedAt ?? (Number.isFinite(storedRequest) && storedRequest > 0 ? storedRequest : null);
    const isChecking = !isRequestAnswered(requestedAt, result);
    requestManager.useGetManga<GetMangaMetaQuery, GetMangaMetaQueryVariables>(GET_MANGA_META, manga.id, {
        skip: !isChecking,
        pollInterval: POLL_MS,
        fetchPolicy: 'network-only',
    });

    const { data: chapterData } = requestManager.useGetMangaChapters<
        GetChaptersMangaQuery,
        GetChaptersMangaQueryVariables
    >(GET_CHAPTERS_MANGA, manga.id, { fetchPolicy: 'cache-first' });
    const scanlators = useMemo(() => getScanlators(chapterData?.chapters.nodes ?? []), [chapterData]);

    const { excludedScanlators } = useChapterListOptions(manga);
    const names = result?.variants.map(({ name }) => name) ?? [];
    const activeVariant = getActiveVariant(excludedScanlators, names);
    const setExcluded = (excluded: string[]) => updateChapterListOptions(manga)('excludedScanlators', excluded);

    const requestCheck = () => {
        const now = Math.floor(Date.now() / 1000);
        setAskedAt(now);
        writeTsujiRawGlobalMeta({ set: [[requestKey, String(now)]], delete: [] }).catch(
            defaultPromiseErrorHandler('TlCompareCard::request'),
        );
    };

    const checking = (
        <Typography variant="caption" sx={{ color: 'text.secondary' }} role="status">
            {t`Checking… up to 30 min. You can keep browsing.`}
        </Typography>
    );

    if (view === 'stale') {
        return isChecking ? (
            checking
        ) : (
            <Link component="button" variant="caption" onClick={requestCheck} sx={{ alignSelf: 'flex-start' }}>
                {t`Re-check translations`}
            </Link>
        );
    }

    if (view === 'error') {
        return isChecking ? (
            checking
        ) : (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`Couldn't compare: ${result?.error ?? t`unknown error`}`}
                </Typography>
                <Button size="small" onClick={requestCheck}>
                    {t`Retry`}
                </Button>
            </Stack>
        );
    }

    if (view === 'none') {
        // A single upload (or nothing known and one scanlator): nothing to compare.
        if (result?.status === 'single-upload' || scanlators.length < 2) {
            return null;
        }
        return isChecking ? (
            checking
        ) : (
            <Button size="small" variant="outlined" onClick={requestCheck} sx={{ alignSelf: 'flex-start' }}>
                {t`Compare translations`}
            </Button>
        );
    }

    const compared = result!;
    const relative = getRelativeTime(compared.at, Date.now());
    const checkedAt = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' }).format(
        relative.value,
        relative.unit,
    );
    const sampled = compared.sampled.join(', ');
    const onRead = (variant: TlVariant) =>
        setExcluded(compared.variants.filter(({ name }) => name !== variant.name).map(({ name }) => name));

    return (
        <Paper variant="outlined" component="section" aria-label={t`Compare translations`} sx={{ p: 1.5 }}>
            <Stack sx={{ gap: 1.5 }}>
                <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
                    {t`Two English versions on ${compared.source}`}
                </Typography>
                <CompareGrid result={compared} activeVariant={activeVariant} onRead={onRead} />
                {activeVariant && (
                    <Typography variant="caption">
                        {t`Showing only ${activeVariant} chapters`}
                        {' · '}
                        <Link component="button" variant="caption" onClick={() => setExcluded([])}>
                            {t`Show all`}
                        </Link>
                    </Typography>
                )}
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t`Sampled ch ${sampled} · checked ${checkedAt} · one-off wording slips in other chapters won't show here`}
                    {' · '}
                    {isChecking ? (
                        t`Checking…`
                    ) : (
                        <Link component="button" variant="caption" onClick={requestCheck}>
                            {t`Re-check`}
                        </Link>
                    )}
                </Typography>
            </Stack>
        </Paper>
    );
};
