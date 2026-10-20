/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// In-memory Suwayomi-Server stand-in for browser tests of the production build: executes the WebUI's real GraphQL
// documents against docs/tsuji/schema.graphql (v2.3.2243). Unknown fields get schema-valid defaults, so every query
// the app sends resolves; the handlers below provide the data a test cares about.

import { readFileSync } from 'node:fs';
import { buildSchema, execute, isEnumType, isListType, isNonNullType, isScalarType, parse } from 'graphql';

const SCALAR_DEFAULTS = {
    String: '',
    Int: 0,
    Float: 0,
    Boolean: false,
    ID: '0',
    LongString: '0',
    Cursor: '',
    Duration: '0',
};

const defaultFor = (type) => {
    if (!isNonNullType(type)) {
        return isListType(type) ? [] : null;
    }
    const inner = type.ofType;
    if (isListType(inner)) {
        return [];
    }
    if (isScalarType(inner)) {
        return SCALAR_DEFAULTS[inner.name] ?? '';
    }
    if (isEnumType(inner)) {
        return inner.getValues()[0].value;
    }
    return {};
};

const pageUrl = (chapter, index) => `/api/v1/manga/${chapter.mangaId}/chapter/${chapter.sourceOrder}/page/${index}`;

const connection = (nodes) => ({
    nodes,
    totalCount: nodes.length,
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
});

/**
 * `manga` / `chapters` / `pageCount` is the manga a test is about; `extraMangas` (`[{ manga, chapters, pageCount }]`)
 * adds more (e.g. a raw and an MTL series), served by id with their own chapters and pages (manga meta as given).
 * `handlers` (`{ 'Query.categories': (args) => ... }`) answer root fields for one test; undefined = the built-in one.
 */
export const createMockSuwayomi = ({
    manga,
    chapters,
    pageCount,
    globalMeta = {},
    extraMangas = [],
    handlers: testHandlers = {},
}) => {
    const schema = buildSchema(readFileSync(new URL('../../../docs/tsuji/schema.graphql', import.meta.url), 'utf8'));
    const meta = new Map(Object.entries(globalMeta));
    /** Manga meta of the (single) manga, e.g. tsuji_readScanlator. */
    const mangaMeta = new Map();
    Object.defineProperty(manga, 'meta', {
        enumerable: true,
        get: () =>
            [...mangaMeta.entries()].map(([key, value]) => ({
                key,
                value,
                mangaId: manga.id,
                __typename: 'MangaMetaType',
            })),
    });
    const mangas = [{ manga, chapters, pageCount }, ...extraMangas];
    extraMangas.forEach((extra) => {
        // oxlint-disable-next-line no-param-reassign
        extra.manga.meta = extra.manga.meta ?? [];
    });
    const entryByMangaId = new Map(mangas.map((entry) => [entry.manga.id, entry]));
    const chapterById = new Map(mangas.flatMap((entry) => entry.chapters.map((chapter) => [chapter.id, chapter])));
    const entryOf = (chapter) => entryByMangaId.get(chapter.mangaId) ?? mangas[0];
    /** Every chapter progress write the app sends: `{ ids, lastPageRead, isRead }`. */
    const chapterWrites = [];

    const metaNodes = () => [...meta.entries()].map(([key, value]) => ({ key, value, __typename: 'GlobalMetaType' }));
    // The manga as seen from a chapter lists every chapter (plain objects: no manga inside, so no cycle).
    const chapterNode = (chapter) => {
        const entry = entryOf(chapter);
        return {
            ...chapter,
            manga: { ...entry.manga, chapters: connection(entry.chapters.map((each) => ({ ...each }))) },
            meta: [],
        };
    };

    const applyChapterPatch = (ids, patch) => {
        chapterWrites.push({ ids, ...patch });
        ids.forEach((id) => {
            const chapter = chapterById.get(Number(id));
            if (chapter) {
                Object.entries(patch).forEach(([key, value]) => {
                    if (value !== undefined && value !== null) {
                        chapter[key] = value;
                    }
                });
            }
        });
        return ids.map((id) => chapterNode(chapterById.get(Number(id))));
    };

    const setMetas = (metas) => {
        metas.forEach(({ key, value }) => meta.set(key, value));
        return { metas: metas.map(({ key, value }) => ({ key, value })) };
    };
    const deleteMetas = ({ keys = [], prefixes = [] }) => {
        const deleted = [...meta.keys()].filter((key) => keys.includes(key) || prefixes.some((p) => key.startsWith(p)));
        deleted.forEach((key) => meta.delete(key));
        return { metas: deleted.map((key) => ({ key, value: '' })) };
    };

    const handlers = {
        'Query.aboutServer': () => ({
            name: 'Suwayomi-Server',
            version: 'v2.3.2243',
            buildType: 'Stable',
            buildTime: '0',
            discord: '',
            github: '',
        }),
        'Query.manga': ({ id }) => entryByMangaId.get(Number(id))?.manga ?? null,
        'Query.mangas': () => connection([manga]),
        'Query.chapter': ({ id }) => chapterNode(chapterById.get(Number(id))),
        'Query.chapters': ({ filter, condition }) =>
            connection(
                (condition?.mangaId ? (entryByMangaId.get(Number(condition.mangaId))?.chapters ?? []) : chapters)
                    .filter((chapter) => !filter?.id?.in || filter.id.in.includes(chapter.id))
                    .map(chapterNode),
            ),
        'Query.metas': () => connection(metaNodes()),
        'Query.meta': ({ key }) => (meta.has(key) ? { key, value: meta.get(key) } : null),
        'Mutation.fetchChapterPages': ({ input }) => {
            const chapter = chapterById.get(Number(input.chapterId));
            return {
                chapter: chapterNode(chapter),
                pages: Array.from({ length: entryOf(chapter).pageCount }, (_, index) => pageUrl(chapter, index)),
            };
        },
        'Mutation.fetchChapters': ({ input }) => ({
            chapters: (entryByMangaId.get(Number(input?.mangaId))?.chapters ?? chapters).map(chapterNode),
        }),
        'Mutation.fetchManga': ({ input }) => ({ manga: entryByMangaId.get(Number(input?.id))?.manga ?? manga }),
        'Mutation.updateChapter': ({ input }) => ({ chapter: applyChapterPatch([input.id], input.patch)[0] }),
        'Mutation.updateChapters': ({ input }) => ({ chapters: applyChapterPatch(input.ids, input.patch) }),
        'Mutation.setMangaMeta': ({ input }) => {
            mangaMeta.set(input.meta.key, input.meta.value);
            return { meta: { ...input.meta, manga } };
        },
        'Mutation.setMangaMetas': ({ input }) => {
            const metas = input.items.flatMap(({ metas: itemMetas }) => itemMetas);
            metas.forEach(({ key, value }) => mangaMeta.set(key, value));
            return { mangas: [manga], metas: metas.map((item) => ({ ...item, mangaId: manga.id, manga })) };
        },
        'Mutation.deleteMangaMetas': ({ input }) => {
            const keys = input.items.flatMap(({ keys: itemKeys = [] }) => itemKeys);
            keys.forEach((key) => mangaMeta.delete(key));
            return { mangas: [manga], metas: keys.map((key) => ({ key, value: '', mangaId: manga.id, manga })) };
        },
        'Mutation.setGlobalMeta': ({ input }) => ({ meta: setMetas([input.meta]).metas[0] }),
        'Mutation.setGlobalMetas': ({ input }) => setMetas(input.metas),
        'Mutation.deleteGlobalMeta': ({ input }) => deleteMetas({ keys: [input.key] }),
        'Mutation.deleteGlobalMetas': ({ input }) => deleteMetas(input),
    };

    /** Every mutation the app sends: `{ name, args }` (e.g. to assert nothing touched the library). */
    const mutationLog = [];

    const fieldResolver = (source, args, _context, info) => {
        if (info.parentType.name === 'Mutation') {
            mutationLog.push({ name: info.fieldName, args });
        }
        const key = `${info.parentType.name}.${info.fieldName}`;
        const handler = handlers[key];
        if (testHandlers[key] && (info.parentType.name === 'Query' || info.parentType.name === 'Mutation')) {
            // A test's own handler; returning undefined falls back to the built-in one.
            const answer = testHandlers[key](args);
            if (answer !== undefined) {
                return answer;
            }
        }
        if (handler && (info.parentType.name === 'Query' || info.parentType.name === 'Mutation')) {
            return handler(args);
        }
        if (source && Object.prototype.hasOwnProperty.call(source, info.fieldName)) {
            return source[info.fieldName];
        }
        return defaultFor(info.returnType);
    };

    const typeResolver = (value, _context, info, abstractType) =>
        value?.__typename ?? schema.getPossibleTypes(abstractType)[0].name;

    /** Handles one GraphQL POST body (single or batched). */
    const handle = (body) => {
        const run = ({ query, variables, operationName }) =>
            execute({
                schema,
                document: parse(query),
                variableValues: variables,
                operationName,
                fieldResolver,
                typeResolver,
            });
        return Array.isArray(body) ? Promise.all(body.map(run)) : run(body);
    };

    return { handle, meta, mangaMeta, chapters: chapterById, chapterWrites, mutationLog };
};
