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

const connection = (nodes) => ({
    nodes,
    totalCount: nodes.length,
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
});

export const createMockSuwayomi = ({ manga, chapters, pageCount, globalMeta = {} }) => {
    const schema = buildSchema(readFileSync(new URL('../../../docs/tsuji/schema.graphql', import.meta.url), 'utf8'));
    const meta = new Map(Object.entries(globalMeta));
    const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    /** Every chapter progress write the app sends: `{ ids, lastPageRead, isRead }`. */
    const chapterWrites = [];

    const metaNodes = () => [...meta.entries()].map(([key, value]) => ({ key, value, __typename: 'GlobalMetaType' }));
    const chapterNode = (chapter) => ({ ...chapter, manga, meta: { nodes: [] } });
    const pageUrl = (chapter, index) => `/api/v1/manga/${manga.id}/chapter/${chapter.sourceOrder}/page/${index}`;

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
        'Query.manga': ({ id }) => (Number(id) === manga.id ? manga : null),
        'Query.mangas': () => connection([manga]),
        'Query.chapter': ({ id }) => chapterNode(chapterById.get(Number(id))),
        'Query.chapters': () => connection(chapters.map(chapterNode)),
        'Query.metas': () => connection(metaNodes()),
        'Query.meta': ({ key }) => (meta.has(key) ? { key, value: meta.get(key) } : null),
        'Mutation.fetchChapterPages': ({ input }) => {
            const chapter = chapterById.get(Number(input.chapterId));
            return {
                chapter: chapterNode(chapter),
                pages: Array.from({ length: pageCount }, (_, index) => pageUrl(chapter, index)),
            };
        },
        'Mutation.fetchChapters': () => ({ chapters: chapters.map(chapterNode) }),
        'Mutation.fetchManga': () => ({ manga }),
        'Mutation.updateChapter': ({ input }) => ({ chapter: applyChapterPatch([input.id], input.patch)[0] }),
        'Mutation.updateChapters': ({ input }) => ({ chapters: applyChapterPatch(input.ids, input.patch) }),
        'Mutation.setGlobalMeta': ({ input }) => ({ meta: setMetas([input.meta]).metas[0] }),
        'Mutation.setGlobalMetas': ({ input }) => setMetas(input.metas),
        'Mutation.deleteGlobalMeta': ({ input }) => deleteMetas({ keys: [input.key] }),
        'Mutation.deleteGlobalMetas': ({ input }) => deleteMetas(input),
    };

    const fieldResolver = (source, args, _context, info) => {
        const handler = handlers[`${info.parentType.name}.${info.fieldName}`];
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

    return { handle, meta, chapters: chapterById, chapterWrites };
};
