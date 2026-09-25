/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo, useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneIcon from '@mui/icons-material/Tune';
import { useLingui } from '@lingui/react/macro';
import type { DiscoverSelection } from '@/features/tsuji/discover/discoverQuery.ts';
import { EMPTY_SELECTION } from '@/features/tsuji/discover/discoverQuery.ts';
import type { TagCatalog } from '@/features/tsuji/discover/DiscoverService.ts';
import { setTriState, TriStateChip } from '@/features/tsuji/recs/components/TriStateChip.tsx';
import type { CatalogTag } from '@/features/tsuji/recs/aniListQueries.ts';

type SelectionKind = keyof DiscoverSelection;

const MAX_SEARCH_RESULTS = 60;

const formatCategory = (category: string | null) => (category ?? '').split('-').join(' · ');

const groupByCategory = (tags: CatalogTag[]): [string, CatalogTag[]][] => {
    const groups = new Map<string, CatalogTag[]>();
    tags.forEach((tag) => {
        const category = formatCategory(tag.category);
        groups.set(category, [...(groups.get(category) ?? []), tag]);
    });

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
};

/**
 * Renders immediately (the selected chips need no catalog); the AniList tag catalog is loaded by the parent once
 * the panel is first expanded, so opening Discover never waits on it.
 */
export const TagPicker = ({
    catalog,
    isCatalogError,
    onRetryCatalog,
    isExpanded,
    onExpandedChange,
    selection,
    onChange,
    showAdult,
}: {
    catalog: TagCatalog | null;
    isCatalogError: boolean;
    onRetryCatalog: () => void;
    isExpanded: boolean;
    onExpandedChange: (isExpanded: boolean) => void;
    selection: DiscoverSelection;
    onChange: (selection: DiscoverSelection) => void;
    showAdult: boolean;
}) => {
    const { t } = useLingui();
    const [query, setQuery] = useState('');

    const tags = useMemo(
        () => (catalog?.tags ?? []).filter((tag) => showAdult || !tag.isAdult),
        [catalog?.tags, showAdult],
    );
    const groups = useMemo(() => groupByCategory(tags), [tags]);
    const normalizedQuery = query.trim().toLowerCase();
    const matches = useMemo(
        () =>
            normalizedQuery
                ? tags.filter(({ name }) => name.toLowerCase().includes(normalizedQuery)).slice(0, MAX_SEARCH_RESULTS)
                : [],
        [tags, normalizedQuery],
    );

    const setState = (kind: SelectionKind, name: string, state: 'include' | 'exclude' | undefined) =>
        onChange({ ...selection, [kind]: setTriState(selection[kind], name, state) });

    const renderChip = (kind: SelectionKind, name: string) => (
        <TriStateChip
            key={`${kind}-${name}`}
            label={name}
            state={selection[kind][name]}
            onChange={(state) => setState(kind, name, state)}
        />
    );

    const selected = [
        ...Object.keys(selection.genres).map((name) => renderChip('genres', name)),
        ...Object.keys(selection.tags).map((name) => renderChip('tags', name)),
    ];

    return (
        <Stack sx={{ gap: 1 }}>
            <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                    variant={isExpanded ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={<TuneIcon />}
                    endIcon={isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() => onExpandedChange(!isExpanded)}
                    aria-expanded={isExpanded}
                >
                    {t`Tags & genres`}
                </Button>
                {selected}
                {!!selected.length && (
                    <Button size="small" onClick={() => onChange(EMPTY_SELECTION)}>
                        {t`Clear`}
                    </Button>
                )}
            </Stack>
            <Collapse in={isExpanded} unmountOnExit>
                <Stack sx={{ gap: 1.5, pt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {t`Tap once to include, twice to exclude, three times to clear. Included tags must all match.`}
                    </Typography>
                    {!catalog && !isCatalogError && <LinearProgress aria-label={t`Loading tags`} />}
                    {isCatalogError && (
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                {t`Couldn't load the tag list.`}
                            </Typography>
                            <Button size="small" onClick={onRetryCatalog}>
                                {t`Retry`}
                            </Button>
                        </Stack>
                    )}
                    <TextField
                        size="small"
                        disabled={!catalog}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t`Search tags`}
                        slotProps={{ htmlInput: { 'aria-label': t`Search tags` } }}
                    />
                    {normalizedQuery ? (
                        <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                            {matches.map(({ name }) => renderChip('tags', name))}
                            {!matches.length && (
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    {t`No matching tags.`}
                                </Typography>
                            )}
                        </Stack>
                    ) : (
                        <>
                            <FormLabel>{t`Genres`}</FormLabel>
                            <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                                {(catalog?.genres ?? [])
                                    .filter((genre) => showAdult || genre !== 'Hentai')
                                    .map((genre) => renderChip('genres', genre))}
                            </Stack>
                            <FormLabel>{t`Tags`}</FormLabel>
                            <div>
                                {groups.map(([category, categoryTags]) => (
                                    <Accordion
                                        key={category}
                                        disableGutters
                                        slotProps={{ transition: { unmountOnExit: true } }}
                                    >
                                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                            <Typography variant="body2">{`${category} (${categoryTags.length})`}</Typography>
                                        </AccordionSummary>
                                        <AccordionDetails>
                                            <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                                                {categoryTags.map(({ name }) => renderChip('tags', name))}
                                            </Stack>
                                        </AccordionDetails>
                                    </Accordion>
                                ))}
                            </div>
                        </>
                    )}
                </Stack>
            </Collapse>
        </Stack>
    );
};
