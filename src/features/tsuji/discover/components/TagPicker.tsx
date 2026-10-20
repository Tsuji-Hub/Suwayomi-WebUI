/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Collapse from '@mui/material/Collapse';
import LinearProgress from '@mui/material/LinearProgress';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneIcon from '@mui/icons-material/Tune';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import type { DiscoverSelection } from '@/features/tsuji/discover/discoverQuery.ts';
import { EMPTY_SELECTION } from '@/features/tsuji/discover/discoverQuery.ts';
import type { TagCatalog } from '@/features/tsuji/discover/DiscoverService.ts';
import { setTriState, TriStateChip } from '@/features/tsuji/recs/components/TriStateChip.tsx';
import type { CatalogTag } from '@/features/tsuji/recs/aniListQueries.ts';
import type { TriState } from '@/features/tsuji/recs/components/TriStateChip.tsx';
import type { BakaChip, BakaTagRef } from '@/features/tsuji/tags/baka.ts';
import { countBakaCombinations, getChipTags, MAX_BAKA_COMBINATIONS } from '@/features/tsuji/tags/baka.ts';
import type { TagSuggestion } from '@/features/tsuji/tags/tagKeys.ts';
import { describeChip } from '@/features/tsuji/tags/tagKeys.ts';
import { useTagSuggestions } from '@/features/tsuji/tags/useTagSuggestions.ts';

type SelectionKind = 'genres' | 'tags';

const MAX_SEARCH_RESULTS = 60;

type ChipBacking = Pick<TagSuggestion, 'key' | 'label' | 'genre' | 'tag' | 'bakaTags' | 'path'> & {
    alsoMatch?: number;
};

/** A suggestion goes where its backing is: MangaBaka-backed (or merged) chips in `baka`, AniList-only as before. */
const setSuggestionState = (selection: DiscoverSelection, chip: ChipBacking, state: TriState): DiscoverSelection => {
    const bakaTags = getChipTags(chip);
    if (!bakaTags.length) {
        const kind: SelectionKind = chip.genre ? 'genres' : 'tags';
        return { ...selection, [kind]: setTriState(selection[kind], (chip.genre ?? chip.tag)!, state) };
    }
    const { [chip.key]: _removed, ...rest } = selection.baka ?? {};
    const next: BakaChip = {
        state: state!,
        label: chip.label,
        bakaTags,
        path: chip.path ?? null,
        genre: chip.genre,
        tag: chip.tag,
        ...(chip.alsoMatch ? { alsoMatch: chip.alsoMatch } : {}),
    };
    return { ...selection, baka: state ? { ...rest, [chip.key]: next } : rest };
};

/** "+ also match": the suggestion's MangaBaka tags join a selected chip as alternatives (OR inside the chip). */
const addAlternatives = (selection: DiscoverSelection, targetKey: string, tags: BakaTagRef[]): DiscoverSelection => {
    const target = selection.baka?.[targetKey];
    if (!target) {
        return selection;
    }
    const current = getChipTags(target);
    const added = tags.filter(({ id }) => !current.some((tag) => tag.id === id));
    const next: BakaChip = {
        ...target,
        bakaTags: [...current, ...added],
        path: null,
        alsoMatch: (target.alsoMatch ?? 0) + added.length,
    };
    return { ...selection, baka: { ...selection.baka, [targetKey]: next } };
};

const getSuggestionState = (selection: DiscoverSelection, chip: TagSuggestion): TriState => {
    if (chip.bakaTags?.length) {
        return selection.baka?.[chip.key]?.state;
    }
    return chip.genre ? selection.genres[chip.genre] : selection.tags[chip.tag!];
};

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
    const { suggestions, isPending } = useTagSuggestions(query, catalog, showAdult);
    const matches = suggestions.slice(0, MAX_SEARCH_RESULTS);

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

    // One chip per name: the size hint in the label, MangaBaka's parent path and the sources on hover.
    // Selected included MangaBaka chips a suggestion's tags can join ("+ also match").
    const alsoMatchTargets = Object.entries(selection.baka ?? {}).filter(([, chip]) => chip.state === 'include');
    const [alsoMatchMenu, setAlsoMatchMenu] = useState<{ anchor: HTMLElement; chip: TagSuggestion } | null>(null);
    const alsoMatch = (targetKey: string, chip: TagSuggestion) =>
        onChange(addAlternatives(selection, targetKey, chip.bakaTags ?? []));
    /** Sub-searches the selection would need after adding the suggestion's tags to a chip. */
    const combinationsAfter = (targetKey: string, chip: TagSuggestion) =>
        countBakaCombinations(
            alsoMatchTargets.map(([key, target]) => [
                ...new Set([
                    ...getChipTags(target).map(({ id }) => id),
                    ...(key === targetKey ? (chip.bakaTags ?? []).map(({ id }) => id) : []),
                ]),
            ]),
        );

    const getAlsoMatchHint = (chip: TagSuggestion, label: string, targets: typeof alsoMatchTargets) => {
        const smallest = Math.min(...targets.map(([key]) => combinationsAfter(key, chip)));
        if (smallest > MAX_BAKA_COMBINATIONS) {
            return t`That would need ${smallest} tag combinations (${MAX_BAKA_COMBINATIONS} at most). Remove a family or a chip first.`;
        }
        return targets.length === 1
            ? t`Also match ${label} in ${targets[0][1].label} (either counts)`
            : t`Also match ${label} in a selected chip (either counts)`;
    };

    const renderSuggestion = (chip: TagSuggestion) => {
        const label = chip.isTagOnly ? t`${chip.label} only` : chip.label;
        const targets = alsoMatchTargets.filter(
            ([key, target]) =>
                key !== chip.key &&
                (chip.bakaTags ?? []).some(({ id }) => !getChipTags(target).some((tag) => tag.id === id)),
        );
        return (
            <Stack key={chip.key} direction="row" sx={{ alignItems: 'center' }}>
                <CustomTooltip title={describeChip(chip)}>
                    <span>
                        <TriStateChip
                            label={chip.count ? `${label} · ${chip.count}` : label}
                            state={getSuggestionState(selection, chip)}
                            onChange={(state) => onChange(setSuggestionState(selection, chip, state))}
                        />
                    </span>
                </CustomTooltip>
                {!!chip.bakaTags?.length && !!targets.length && (
                    <CustomTooltip title={getAlsoMatchHint(chip, label, targets)}>
                        <span>
                            <IconButton
                                size="small"
                                aria-label={t`Also match ${label}`}
                                disabled={targets.every(
                                    ([key]) => combinationsAfter(key, chip) > MAX_BAKA_COMBINATIONS,
                                )}
                                onClick={(event: MouseEvent<HTMLElement>) => {
                                    if (targets.length === 1) {
                                        alsoMatch(targets[0][0], chip);
                                    } else {
                                        setAlsoMatchMenu({ anchor: event.currentTarget, chip });
                                    }
                                }}
                            >
                                <AddCircleOutlineIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </CustomTooltip>
                )}
            </Stack>
        );
    };

    const renderBakaChip = (key: string, chip: BakaChip) => (
        <CustomTooltip key={`baka-${key}`} title={describeChip({ ...chip, bakaTags: getChipTags(chip) })}>
            <span>
                <TriStateChip
                    label={chip.alsoMatch ? `${chip.label} +${chip.alsoMatch}` : chip.label}
                    state={chip.state}
                    onChange={(state) => onChange(setSuggestionState(selection, { key, ...chip }, state))}
                />
            </span>
        </CustomTooltip>
    );

    const selected = [
        ...Object.keys(selection.genres).map((name) => renderChip('genres', name)),
        ...Object.keys(selection.tags).map((name) => renderChip('tags', name)),
        ...Object.entries(selection.baka ?? {}).map(([key, chip]) => renderBakaChip(key, chip)),
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
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t`Search tags`}
                        slotProps={{ htmlInput: { 'aria-label': t`Search tags` } }}
                    />
                    {normalizedQuery ? (
                        <Stack
                            role="group"
                            aria-label={t`Tag suggestions`}
                            direction="row"
                            sx={{ gap: 0.5, flexWrap: 'wrap' }}
                        >
                            {matches.map(renderSuggestion)}
                            <Menu
                                anchorEl={alsoMatchMenu?.anchor}
                                open={!!alsoMatchMenu}
                                onClose={() => setAlsoMatchMenu(null)}
                            >
                                {alsoMatchTargets.map(([key, target]) => (
                                    <MenuItem
                                        key={key}
                                        disabled={
                                            !!alsoMatchMenu &&
                                            combinationsAfter(key, alsoMatchMenu.chip) > MAX_BAKA_COMBINATIONS
                                        }
                                        onClick={() => {
                                            if (alsoMatchMenu) {
                                                alsoMatch(key, alsoMatchMenu.chip);
                                            }
                                            setAlsoMatchMenu(null);
                                        }}
                                    >
                                        {t`Add to ${target.label}`}
                                    </MenuItem>
                                ))}
                            </Menu>
                            {!matches.length && !isPending && (
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
