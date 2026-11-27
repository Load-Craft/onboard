Playwright · Chromium · perf.example.com
↗ podgląd na żywo: https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/scenario-from-description/runs/2481a3f0-9e6c-4d5b-b7a2-1f8e3c0d6a94
  tam przejmiesz sterowanie, gdyby agent utknął
zakupy         flow gotowy ✓ · 9 kroków
przeglądanie   flow gotowy ✓ · 3 kroki
konto          flow gotowy ✓ · 3 kroki
3 flowy zapisane
zakupy · 9 kroków (5 żądań · 4 pauzy)
  1  POST   /auth/login            → token
  2  PAUSE  3–8 s                  założona · formularz
  3  GET    /products?q=#{q}       używa: token · → productId
  4  PAUSE  10–30 s                założona · akcja w stronie
  5  POST   /cart/items            używa: token, productId · → cartId
  6  PAUSE  5–15 s                 założona · formularz
  7  POST   /cart/coupon           używa: token, cartId
  8  PAUSE  20–45 s                założona · formularz
  9  POST   /checkout              używa: token, cartId · ✓ 201 · 409
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/a7d2e914-3c5b-4e8f-b061-9f4c2d7e8a35
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/d3a6f0b8-9e41-4725-8c1d-5b7e2a9f4c06
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/1f8c4e72-6a0d-4b39-a5e8-9c2d7b3f0a15
