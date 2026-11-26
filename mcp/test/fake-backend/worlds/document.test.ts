import { describe, expect, it } from 'vitest';

import { saveSpecification } from '../routes/setup.js';
import { createIdSource, createStore, type Store } from '../store.js';
import {
  areaOf,
  documentJourneys,
  isForeignDocument,
  isLoginRequest,
  registerCandidatesOf,
  registerOperationOf,
  simulationClassName,
} from './document.js';
import { SKLEP_COLLECTIONS, seedSklep, type SklepEndpoint } from './sklep.js';

type Operation = readonly [method: string, path: string, summary: string, tag?: string];

/** Operations as the fake stores them, ids `METHOD path`. */
function operations(rows: readonly Operation[]): SklepEndpoint[] {
  return rows.map(([method, path, summary, tag]) => ({
    id: `${method} ${path}`,
    spec_id: 'spec',
    method,
    path,
    operation_id: null,
    summary,
    tags: tag === undefined ? [] : [tag],
    async_pattern: 'none',
    crud_operation: null,
    has_request_body: false,
    is_crud: false,
    is_paginated: false,
    parameters_count: 0,
  }));
}

const LIBRARY = operations([
  ['POST', '/api/v1/auth/login', 'Log in', 'auth'],
  ['POST', '/api/v1/auth/logout', 'Log out', 'auth'],
  ['POST', '/api/v1/auth/register', 'Register', 'auth'],
  ['POST', '/api/v1/auth/refresh', 'Refresh the token', 'auth'],
  ['POST', '/api/v1/auth/password/reset', 'Reset the password', 'auth'],
  ['GET', '/api/v1/books', 'List books', 'books'],
  ['GET', '/api/v1/books/{bookId}', 'Get a book', 'books'],
  ['GET', '/api/v1/books/{bookId}/reviews', 'List reviews', 'reviews'],
  ['POST', '/api/v1/books/{bookId}/reviews', 'Review a book', 'reviews'],
  ['GET', '/api/v1/authors', 'List authors', 'authors'],
  ['GET', '/api/v1/authors/{authorId}', 'Get an author', 'authors'],
  ['GET', '/api/v1/loans', 'List my loans', 'loans'],
  ['POST', '/api/v1/loans', 'Borrow a book', 'loans'],
  ['PUT', '/api/v1/loans/{loanId}', 'Extend a loan', 'loans'],
  ['DELETE', '/api/v1/loans/{loanId}', 'Return a book', 'loans'],
  ['GET', '/api/v1/account', 'My account', 'account'],
  ['PUT', '/api/v1/account', 'Update my account', 'account'],
  ['GET', '/api/v1/health', 'Health check'],
]);

/** No tags at all: the areas come from the paths (the shape of the evals fixture). */
const UNTAGGED = operations([
  ['POST', '/api/auth/register', 'Register'],
  ['POST', '/api/auth/login', 'Log in'],
  ['GET', '/api/products', 'List products'],
  ['GET', '/api/products/{id}', 'Get a product'],
  ['POST', '/api/cart/items', 'Add to cart'],
  ['GET', '/api/cart', 'Get the cart'],
  ['POST', '/api/checkout', 'Check out'],
  ['GET', '/api/orders', 'List orders'],
]);

const steps = (ids: readonly string[]): string[] => [...ids];

describe('documentJourneys', () => {
  it('builds browsing, changing and the account from the tags, the same each time', () => {
    const first = documentJourneys(LIBRARY);
    expect(first.refined.map((journey) => [journey.name, steps(journey.endpointIds)])).toEqual([
      ['browse books', ['GET /api/v1/books', 'GET /api/v1/books/{bookId}']],
      [
        'create loans',
        [
          'POST /api/v1/auth/login',
          'GET /api/v1/loans',
          'POST /api/v1/loans',
          'PUT /api/v1/loans/{loanId}',
        ],
      ],
      ['account', ['POST /api/v1/auth/login', 'GET /api/v1/account', 'PUT /api/v1/account']],
      ['browse authors', ['GET /api/v1/authors', 'GET /api/v1/authors/{authorId}']],
    ]);
    expect(first.refined.map((journey) => journey.area)).toEqual([
      'books',
      'loans',
      'account',
      'authors',
    ]);
    expect(documentJourneys(LIBRARY)).toEqual(first);
  });

  it('proposes the largest areas as the free heuristic, without the login area', () => {
    const { heuristic } = documentJourneys(LIBRARY);
    expect(heuristic.map((journey) => [journey.name, journey.pattern])).toEqual([
      ['loans operations', 'tag_group'],
      ['books operations', 'tag_group'],
    ]);
  });

  it('reads the areas from the paths when the document has no tags; an order write follows the cart', () => {
    const { refined } = documentJourneys(UNTAGGED);
    expect(refined.map((journey) => [journey.name, steps(journey.endpointIds)])).toEqual([
      ['browse products', ['GET /api/products', 'GET /api/products/{id}']],
      [
        'create cart',
        ['POST /api/auth/login', 'GET /api/cart', 'POST /api/cart/items', 'POST /api/checkout'],
      ],
    ]);
  });

  it('logs in with the login nearest to the journey and prefers the public side', () => {
    const { refined } = documentJourneys(
      operations([
        ['POST', '/api/v2/admin/staff/token', 'Staff token', 'Staff'],
        ['GET', '/api/v2/admin/products', 'Products (admin)', 'Product'],
        ['GET', '/api/v2/admin/products/{id}', 'Product (admin)', 'Product'],
        ['POST', '/api/v2/admin/products', 'Create a product', 'Product'],
        ['PUT', '/api/v2/admin/products/{id}', 'Replace a product', 'Product'],
        ['PATCH', '/api/v2/admin/products/{id}', 'Change a product', 'Product'],
        ['POST', '/api/v2/admin/products/{id}/images', 'Add an image', 'Product'],
        ['GET', '/api/v1/shop/products', 'Products', 'Product'],
        ['GET', '/api/v1/shop/products/{id}/reviews', 'Reviews', 'Product'],
        ['GET', '/api/v1/shop/products/{id}/variants/{variant}', 'Variant', 'Product'],
        ['GET', '/api/v1/shop/products/{id}', 'Product', 'Product'],
        ['POST', '/api/v1/shop/members/token', 'Member token', 'Member'],
        ['GET', '/api/v1/shop/members/{id}', 'Member', 'Member'],
        ['PATCH', '/api/v1/shop/members/password-reset/{token}', 'Reset', 'Member'],
        ['PUT', '/api/v1/shop/members/{id}', 'Update member', 'Member'],
        ['POST', '/api/v2/admin/orders/{id}/cancel', 'Cancel (admin)', 'Order'],
        ['POST', '/api/v1/shop/orders', 'Create a cart', 'Order'],
        ['PATCH', '/api/v1/shop/orders/{orderId}/complete', 'Complete', 'Order'],
      ]),
    );
    const byName = new Map(refined.map((journey) => [journey.name, steps(journey.endpointIds)]));
    expect([...byName.keys()]).toEqual(['browse Product', 'create Order', 'account Member']);
    expect(byName.get('browse Product')).toEqual([
      'GET /api/v1/shop/products',
      'GET /api/v1/shop/products/{id}',
    ]);
    expect(byName.get('create Order')).toEqual([
      'POST /api/v1/shop/members/token',
      'POST /api/v1/shop/orders',
      'PATCH /api/v1/shop/orders/{orderId}/complete',
    ]);
    expect(byName.get('account Member')).toEqual([
      'POST /api/v1/shop/members/token',
      'GET /api/v1/shop/members/{id}',
      'PUT /api/v1/shop/members/{id}',
    ]);
  });

  it('gives one journey of the first operations when nothing else fits, none without operations', () => {
    const odd = operations([['DELETE', '/api/things/{id}', 'Delete a thing']]);
    expect(documentJourneys(odd).refined.map((journey) => journey.name)).toEqual(['things']);
    expect(documentJourneys([]).refined).toEqual([]);
  });
});

describe('reading operations', () => {
  it.each([
    ['POST', '/auth/login', true],
    ['POST', '/api/members/token', true],
    ['POST', '/api/sessions/', true],
    ['POST', '/auth/token/refresh', false],
    ['POST', '/auth/logout', false],
    ['GET', '/auth/login', false],
    ['POST', '/api/tokens/revoke', false],
  ])('%s %s is a login: %s', (method, path, login) => {
    expect(isLoginRequest(method, path)).toBe(login);
  });

  it.each([
    [['loans'], '/api/v1/loans', 'loans'],
    [[], '/api/v1/books/{id}', 'books'],
    [[], '/rest/v2.1/orders', 'orders'],
    [[], '/{tenant}/public/items', 'items'],
    [[], '/', 'api'],
  ])('the area of %j %s is %s', (tags, path, area) => {
    expect(areaOf({ tags, path })).toBe(area);
  });

  it.each([
    ['create loans', 'CreateLoansSimulation'],
    ['przeglądanie', 'PrzegladanieSimulation'],
    ['2 step', 'S2StepSimulation'],
  ])('class name of %s is %s', (name, className) => {
    expect(simulationClassName(name)).toBe(className);
  });
});

describe('registerOperationOf', () => {
  it.each([
    [[['POST', '/api/v1/auth/register', 'Register']], 'POST:/api/v1/auth/register'],
    [[['POST', '/api/v1/sign-up', 'Sign up']], 'POST:/api/v1/sign-up'],
    [
      [
        ['POST', '/api/v2/admin/members', 'Add a member (admin)'],
        ['POST', '/api/v1/shop/members', 'Join'],
      ],
      'POST:/api/v1/shop/members',
    ],
    [[['POST', '/api/v1/members/{id}/notes', 'Note']], undefined],
    [[['GET', '/api/v1/register', 'Form']], undefined],
  ] as const)('%j creates accounts with %s', (rows, expected) => {
    expect(registerOperationOf(operations(rows))).toBe(expected);
  });

  it('offers the POST operations other than the login when none creates accounts', () => {
    expect(registerCandidatesOf(LIBRARY)).toEqual([
      'POST:/api/v1/auth/logout',
      'POST:/api/v1/auth/register',
      'POST:/api/v1/auth/refresh',
      'POST:/api/v1/auth/password/reset',
      'POST:/api/v1/books/{bookId}/reviews',
    ]);
  });
});

describe('isForeignDocument', () => {
  const NAMED = ['login', 'checkout'];

  function withDocument(paths: Record<string, Record<string, { operationId: string }>>): Store {
    const store = createStore(createIdSource(1));
    seedSklep(store, { stage: 'empty' });
    store
      .collection<{ id: string; openapi_spec_id: string | null }>(SKLEP_COLLECTIONS.projects)
      .insert({ id: 'p', openapi_spec_id: null });
    saveSpecification(store, 'p', { openapi: '3.0.3', paths });
    return store;
  }

  it('is foreign when an operation the world names is missing, not when all are there', () => {
    expect(
      isForeignDocument(withDocument({ '/login': { post: { operationId: 'login' } } }), NAMED),
    ).toBe(true);
    expect(
      isForeignDocument(
        withDocument({
          '/login': { post: { operationId: 'login' } },
          '/checkout': { post: { operationId: 'checkout' } },
        }),
        NAMED,
      ),
    ).toBe(false);
  });

  it('is not foreign without a document or with the world seeded', () => {
    const empty = createStore(createIdSource(1));
    seedSklep(empty, { stage: 'empty' });
    expect(isForeignDocument(empty, NAMED)).toBe(false);
    const world = createStore(createIdSource(1));
    seedSklep(world, { stage: 'project' });
    expect(isForeignDocument(world, ['login', 'checkout', 'get_cart'])).toBe(false);
  });
});
