flow „zakupy” gotowy · 9 kroków (5 żądań · 4 pauzy)
  1  POST   /auth/login            → token
  2  PAUSE  3–8 s                  założona · formularz
  3  GET    /products?q=#{q}       używa: token · → productId
  4  PAUSE  10–30 s                założona · akcja w stronie
  5  POST   /cart/items            używa: token, productId · → cartId
  6  PAUSE  2–5 s                  założona · strona
  7  GET    /cart                  używa: token, cartId
  8  PAUSE  20–45 s                założona · formularz
  9  POST   /checkout              używa: token, cartId · ✓ 201 · 409
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/a7d2e914-3c5b-4e8f-b061-9f4c2d7e8a35
