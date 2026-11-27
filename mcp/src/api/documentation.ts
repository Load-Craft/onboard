// The project's OpenAPI documentation as `project_import_docs` changes it: sending a new document and the
// specification the project's test types were made from (the flows left on an older version are
// `flowsOnOldDocs` of `flows.ts`). Reads of the stored document and of the API map are `setup.ts` and `apiMap.ts`.

import * as z from 'zod';

import { uploadFile } from '../http/upload.js';
import type { AllowedFile } from '../workspace/uploads.js';
import { reads, type ResponseOf } from '../contract/reads.js';
import { callOperation } from '../http/operation.js';
import type { ApiContext, SecretApiContext } from './context.js';

const uploaded = reads<ResponseOf<'/api/v1/projects/{project_id}/openapi/upload', 'post'>>()(
  z.object({ openapi_spec_id: z.string().nullish() }),
);

/**
 * `POST …/openapi/upload`: the file becomes the project's current documentation as a new version;
 * the previous one stays in the history. `bytes` is the content read once from the allowed file. Returns the id of the new version (null when the answer names none).
 */
export async function uploadOpenapi(
  api: ApiContext,
  projectId: string,
  file: AllowedFile,
  bytes: Uint8Array,
): Promise<string | null> {
  const answer = await uploadFile(api.services.http, {
    url: `/api/v1/projects/${encodeURIComponent(projectId)}/openapi/upload`,
    field: 'file',
    file,
    bytes,
    signal: api.signal,
  });
  return uploaded.parse(answer).openapi_spec_id ?? null;
}

const projectRow = reads<ResponseOf<'/api/v1/projects/{project_id}', 'get'>>()(
  z.object({ test_types_generated_from_spec_id: z.string().nullish() }),
);

/** `GET …/projects/{id}`: the version of the documentation the project's test types were made from. */
export async function getTestTypesSource(
  api: SecretApiContext,
  projectId: string,
): Promise<string | null> {
  const data = await callOperation(
    api.services.http,
    'get_project_api_v1_projects__project_id__get',
    {
      path: { project_id: projectId },
    },
    { signal: api.signal, secrets: api.secrets },
  );
  return projectRow.parse(data).test_types_generated_from_spec_id ?? null;
}
