/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { CodegenConfig } from '@graphql-codegen/cli';
// oxlint-disable-next-line no-relative-import-paths/no-relative-import-paths
import config from './gql_codegen.ts';

/**
 * tsuji: same codegen as `pnpm gql:codegen`, but from the committed schema snapshot instead of a running server,
 * so CI and cloud sessions can regenerate types. Refresh docs/tsuji/schema.graphql when the server is upgraded.
 */
const offlineConfig: CodegenConfig = { ...config, schema: 'docs/tsuji/schema.graphql' };

// eslint-disable-next-line import-x/no-default-export
export default offlineConfig;
