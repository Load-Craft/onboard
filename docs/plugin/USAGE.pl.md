[English](USAGE.md) | **Polski**

# Używanie pluginu LoadCraft

Plugin jest zainstalowany, a `/loadcraft:doctor` nie zgłasza problemów ([INSTALL.pl.md](INSTALL.pl.md)). Ta strona
pokazuje, jak test przechodzi od jednego zdania do wyniku.

## Zacznij od jednego zdania

Otwórz Claude Code w swoim projekcie i poproś własnymi słowami:

> Zrób test obciążeniowy tej aplikacji w LoadCrafcie.

albo konkretniej:

> Czy zamówienia wytrzymają 500 użytkowników naraz?

Claude sięga po skill `loadcraft-test` i prowadzi Cię przez całą drogę.

## Co się dzieje: osiem kroków

Claude najpierw zapisuje osiem kroków jako listę zadań i odhacza je w miarę postępu.

1. **Sprawdzenie opisu API.** Claude szuka w repozytorium pliku `loadcraft/openapi.json` i sprawdza, czy opisuje
   kod, który testujesz. Gdy go brakuje albo jest nieaktualny, Claude przygotowuje go skillem `loadcraft-openapi`.
   Do LoadCrafta nic jeszcze nie jest wysyłane.
2. **Założenie projektu.** Claude znajduje w repozytorium adresy Twoich środowisk, pyta, które jest domyślne, a
   które współdzielone (i wymagają limitów), po czym zakłada projekt w LoadCrafcie. Środowiska do testu nigdy nie
   wybiera za Ciebie.
3. **Budowa flowów.** Flow to ścieżka, którą użytkownik przechodzi przez Twoją aplikację. Sposób budowy wybierasz
   Ty (patrz niżej).
4. **Złożenie scenariusza.** Claude proponuje podział ruchu między flowy i czeka na Twoją zgodę. Flow, który nie
   przeszedł sprawdzenia, jest zgłoszony taki, jaki jest, nigdy ukryty.
5. **Przygotowanie danych testowych.** Konta testowe i inne dane, których scenariusz potrzebuje. Zakładanie
   kont w Twoim systemie to zawsze pytanie do Ciebie.
6. **Uruchomienie testu.** Claude wymienia środowisko, profil obciążenia, progi i wersję kodu wdrożoną na
   środowisku, a test startuje dopiero po Twojej zgodzie.
7. **Odczyt raportu.** Werdykt wobec Twoich progów, w Twoim języku, z tym, czego werdykt nie dowodzi, i z
   uwagą, gdy obciążenie zostało przycięte.
8. **Szukanie przyczyny i poprawka kodu.** Gdy test nie przechodzi, LoadCraft analizuje przebieg, a Claude szuka
   przyczyny w Twoim kodzie i proponuje poprawkę. Po jej wdrożeniu możesz powtórzyć ten sam test i porównać.

## Cztery metody budowy flowów

Claude zapyta, którą wybierasz:

- **Z opisu API.** LoadCraft proponuje ścieżki użytkownika na podstawie opisu, Ty wybierasz te, które się liczą.
  Domyślna dla większości projektów.
- **Ręcznie, z wybranych endpointów.** Podajesz wywołania i ich kolejność. Gdy dokładnie wiesz, co testować.
- **Z nagrania (HAR).** Nagrywasz sesję w narzędziach deweloperskich przeglądarki i zapisujesz jako plik `.har` w
  repozytorium; plugin go wysyła. Nagranie zawiera prawdziwą sesję, więc Claude najpierw pyta.
- **Z opisu, który przechodzi przeglądarka.** Opisujesz ścieżkę słowami, a przeglądarka LoadCrafta przechodzi ją
  w Twojej aplikacji.

Jak przebiega ostatnia metoda. Claude proponuje opis ścieżek, a Ty poprawiasz go, aż będzie trafny. Wybierasz,
gdzie przejść aplikację: w przeglądarce LoadCrafta albo w Twojej własnej, z nagraniem HAR, gdy środowisko
jest za VPN-em albo działa lokalnie. Potem wybierasz konto testowe, którym przeglądarka się loguje. Plugin czyta je
z pliku w Twoim repozytorium, więc hasło nie przechodzi przez model, ale LoadCraft je dostaje i trzyma przy przebiegu,
żeby móc przejść ścieżki ponownie: użyj konta testowego, nigdy prywatnego.

LoadCraft dzieli opis na ścieżki, a Claude Ci je pokazuje. Nic nie jest przechodzone, dopóki nie zatwierdzisz
ścieżek; od razu rusza tylko plan z jedną ścieżką. Przeglądarka przechodzi wtedy każdą ścieżkę i zapisuje wywołania
API, a flowy są zapisywane na końcu. Claude daje Ci link do podglądu na żywo: gdy przeglądarka utknie na kodzie
jednorazowym albo CAPTCHA, pomóc możesz tylko Ty, przejmując tam przeglądarkę w aplikacji LoadCraft. Krok, którego
test obciążeniowy nie przejdzie, na przykład CAPTCHA albo płatność z 3-D Secure, jest nazwany w wyniku, a Claude
pyta, jak go obejść, zanim złoży scenariusz.

## O co zapyta Claude

Claude zadaje krótkie pytania, w miarę możliwości z gotowymi wyborami, w języku, w którym piszesz. Spodziewaj się:

- czy napisać lub odświeżyć opis API, gdy go brakuje albo jest starszy niż kod;
- które środowiska są współdzielone i jakie na nie nałożyć limity;
- na którym środowisku testować;
- jak zbudować flowy i które ścieżki zostawić;
- przy flowach z opisu: czy opis jest trafny, którym kontem testowym loguje się przeglądarka i które ścieżki
  przechodzi;
- podziału ruchu i mieszanki danych w scenariuszu;
- skąd wziąć konta testowe i czy wolno je założyć;
- który profil obciążenia uruchomić i jakie progi uznać za sukces;
- czy uruchomić test z obciążeniem zmniejszonym do limitów środowiska, gdy to dotyczy.

Nigdy nie musisz wpisywać hasła w rozmowie. Gdy potrzebne jest hasło konta, wskaż Claude'owi plik, w którym
jest zapisane; plugin sam czyta ten plik, a model nie widzi wartości. Zobacz [SECURITY.pl.md](SECURITY.pl.md).

## Komendy

| Komenda | Co robi |
|---|---|
| `/loadcraft:status` | Pokazuje projekt, flowy, scenariusze, ostatnie przebiegi, trwające operacje i następny krok. |
| `/loadcraft:doctor` | Sprawdza instalację (Node, połączenie, token, backend) i mówi, jak naprawić każdy problem. |
| `/loadcraft-panel` | Otwiera panel boczny moda: trwający przebieg z przyciskiem **Stop test**. Zobacz [przewodnik po modzie](../../mod/docs/USER.pl.md). |

Cztery skille przygotowania (opis API, journeys, API zdarzeń, opis projektu) działają też samodzielnie: zobacz
[przewodnik po skillach](../../skills/README.pl.md).

## Powrót do przerwanej pracy

Claude Code możesz zamknąć w dowolnym momencie. Projekt i jego postęp żyją w LoadCrafcie, a repozytorium trzyma
powiązanie z projektem w `loadcraft/project.json`. W nowej sesji uruchom `/loadcraft:status` albo po prostu
powiedz *„kontynuuj test obciążeniowy”*: Claude odczyta stan, odhaczy to, co zrobione, i ruszy od pierwszego
niedokończonego kroku. Test, który już trwał, działa dalej w LoadCrafcie, gdy Cię nie ma; po powrocie poproś o
jego wynik.

Naciśnięcie Esc w trakcie oczekiwania na test go nie zatrzymuje. Claude zapyta, czy go zatrzymać, i dopiero wtedy
go anuluje.

## Linie zaczynające się od ↗

Pod wieloma wynikami Claude przepisuje linię zaczynającą się od `↗` z adresem strony, na przykład stroną flowa,
scenariusza albo raportu w LoadCrafcie. To link do Twojej instancji LoadCrafta: otwórz go w przeglądarce, żeby
zobaczyć to samo w pełnym interfejsie. Claude nigdy nie otwiera go za Ciebie.

## Gdzie szukać szczegółów

- Instalacja i reguły uprawnień: [INSTALL.pl.md](INSTALL.pl.md).
- Co opuszcza Twój komputer, a co zostaje: [SECURITY.pl.md](SECURITY.pl.md).
