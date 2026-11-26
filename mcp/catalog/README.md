# Katalog narzędzi (dane wykonawcze)

Pliki w tym katalogu są generowane przez opiekunów poza repo i nie są edytowane ręcznie: repo zawiera wynik i test
zgodności. `katalog.json` to jedyne źródło nazw, opisów, poziomów zgód, szablonów kart i dziennika narzędzi;
`stan-procesu.ts` to schemat stanu procesu, a `stan-procesu.sha256` jego odcisk. Test zgodności porównuje
zarejestrowane narzędzia z katalogiem oraz odcisk z plikiem, więc rozjazd kończy się błędem testu.

`migration` w `katalog.json` to jedyny autorytet mapy dzisiejszych nazw narzędzi na nowe: wpis ma pola `current`
(sama nazwa dzisiejszego narzędzia albo pliku pomocniczego), `kind` (`tool` albo `helper`: plik pomocniczy), `change` (np. „zmienia nazwę”, „dzieli się”, „łączy się”) i `new`
(lista nowych narzędzi). Dla każdego wpisu „dzieli się” `new[0]` jest główną drogą, czyli narzędziem, które zastępuje
domyślne zachowanie dawnego narzędzia; pozostałe są jego wydzielonymi fazami albo wariantami.
