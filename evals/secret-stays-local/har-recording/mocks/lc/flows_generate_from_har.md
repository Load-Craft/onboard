3 flowy gotowe
zakupy · 7 kroków (4 żądania · 3 pauzy)
  1  POST   /auth/login            → token
  2  PAUSE  4,2 s                  nagrana · formularz
  3  GET    /products?q=#{q}       używa: token · → productId
  4  PAUSE  10 s                   nagrana · akcja w stronie
  5  POST   /cart/items            używa: token, productId · → cartId
  6  PAUSE  10 s                   nagrana · formularz
  7  POST   /checkout              używa: token, cartId · ✓ 201 · 409
przeglądanie · 3 kroki     konto · 3 kroki
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/a7d2e914-3c5b-4e8f-b061-9f4c2d7e8a35
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/d3a6f0b8-9e41-4725-8c1d-5b7e2a9f4c06
↗ https://app.loadcraft.io/projects/5b1c7e20-8d4a-4f6b-9c3e-2a7f0d9e4b61/flows/1f8c4e72-6a0d-4b39-a5e8-9c2d7b3f0a15
