// The images of a walk (`flows_export_walk_image`): a live snapshot of a step attempt and a still of the
// review timeline, both sent as bytes with their type. A test plants what a walk shows with
// `seedWalkSnapshot` and `seedWalkStill`; what was not planted is a 404. A snapshot is taken anew at every
// request in the backend: the fake sends the planted bytes each time.

import type { Fake, Store } from '../server.js';
import { FakeHttpError } from '../server.js';

const IMAGES = 'walk_images';

interface StoredImage {
  readonly id: string;
  readonly bytes: Buffer;
  readonly type: string;
}

const snapshotKey = (runId: string, pathIndex: number, attempt: number): string =>
  `snapshot|${runId}|${String(pathIndex)}|${String(attempt)}`;
const stillKey = (runId: string, stillId: string): string => `still|${runId}|${stillId}`;

/** Plants the image a live snapshot of a step attempt of a walk answers with. */
export function seedWalkSnapshot(
  store: Store,
  runId: string,
  pathIndex: number,
  attempt: number,
  bytes: Buffer,
  type = 'image/png',
): void {
  store
    .collection<StoredImage>(IMAGES)
    .insert({ id: snapshotKey(runId, pathIndex, attempt), bytes, type });
}

/** Plants the image a still of the timeline of a walk answers with. */
export function seedWalkStill(
  store: Store,
  runId: string,
  stillId: string,
  bytes: Buffer,
  type = 'image/jpeg',
): void {
  store.collection<StoredImage>(IMAGES).insert({ id: stillKey(runId, stillId), bytes, type });
}

const registered = new WeakSet<Fake>();

export function registerWalkImageRoutes(fake: Fake): void {
  if (registered.has(fake)) return;
  registered.add(fake);
  const answer = (store: Store, key: string) => {
    const image = store.collection<StoredImage>(IMAGES).get(key);
    if (image === undefined) throw new FakeHttpError(404, { detail: 'Image not found' });
    return { status: 200, body: image.bytes, headers: { 'content-type': image.type } };
  };
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/paths/{path_index}/attempts/{attempt}/snapshot',
    (req, store) =>
      answer(
        store,
        snapshotKey(req.params.run_id, Number(req.params.path_index), Number(req.params.attempt)),
      ),
  );
  fake.route(
    'GET',
    '/api/v1/projects/{project_id}/scenario-from-description/runs/{run_id}/stills/{still_id}',
    (req, store) => answer(store, stillKey(req.params.run_id, req.params.still_id)),
  );
}
