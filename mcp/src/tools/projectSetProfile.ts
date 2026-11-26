// `project_set_profile`: sets chosen fields of the bound project's profile and keeps the others.
// The first call is a consent card (the fields with their current and new values, nothing
// written); the repeat with the card's token after the user's yes writes them. The previous values
// are kept in the log entry, so the change can be undone by the same tool.

import * as z from 'zod';

import { defineTool } from '../registry.js';
import { renderSetProfile } from '../render/views/projectProfile.js';
import { createResolver } from '../resolve/handles.js';
import { SETTABLE, setProfile } from './project/profile.js';
import { strictFields } from './project/environments.js';

const FIELDS_HINT =
  'send profile fields only: app_architecture, api_protocol, auth_method, auth_token_endpoint, ' +
  'graphql_endpoint, has_* flags, uses_csrf, self_check_enabled, idp_domains, ' +
  'known_third_party_domains, additional_notes';

const fields = strictFields(FIELDS_HINT, {
  app_architecture: SETTABLE.app_architecture.optional().describe('How the client is built.'),
  api_protocol: SETTABLE.api_protocol.optional(),
  auth_method: SETTABLE.auth_method.optional().describe('How users sign in.'),
  auth_token_endpoint: SETTABLE.auth_token_endpoint
    .optional()
    .describe('Path of the sign-in request that returns the token; null clears it.'),
  graphql_endpoint: SETTABLE.graphql_endpoint.optional(),
  has_async_operations: SETTABLE.has_async_operations.optional(),
  has_file_uploads: SETTABLE.has_file_uploads.optional(),
  has_mfa: SETTABLE.has_mfa.optional(),
  has_multi_tenant: SETTABLE.has_multi_tenant.optional(),
  has_pagination: SETTABLE.has_pagination.optional(),
  has_presigned_urls: SETTABLE.has_presigned_urls.optional(),
  has_sse: SETTABLE.has_sse.optional(),
  has_websockets: SETTABLE.has_websockets.optional(),
  uses_csrf: SETTABLE.uses_csrf.optional(),
  self_check_enabled: SETTABLE.self_check_enabled.optional(),
  idp_domains: SETTABLE.idp_domains.optional().describe('Domains of the identity providers.'),
  known_third_party_domains: SETTABLE.known_third_party_domains.optional(),
  additional_notes: SETTABLE.additional_notes.optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
  message: 'send at least one profile field',
});

const input = z.strictObject({
  fields: fields.describe('The profile fields to set, with their new values.'),
  confirm: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Leave it out in the first call: the answer is the consent card for the user. Only after ' +
        'the user said yes to that card, repeat the call with the same fields and the token the ' +
        'card printed.',
    ),
});

export const projectSetProfile = defineTool({
  name: 'project_set_profile',
  title: 'Set fields of the profile of a LoadCraft project',
  description:
    'Set fields of the project profile (architecture, auth, protocol, flags); other fields are ' +
    'kept. Changes how flows are generated. The first call writes nothing: it returns a card ' +
    'with the current and the new values for the user; after their yes repeat the call with ' +
    'confirm set to the token of that card. A token serves one write: a repeat with an old token, ' +
    'other fields or a profile changed since gets a new card and writes nothing. Use it to correct ' +
    'the fields the setup analysis was unsure of.',
  input,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async run(ctx, args) {
    const project = await createResolver(ctx).project();
    return setProfile(ctx, project, args.fields, args.confirm);
  },
  render: renderSetProfile,
});
