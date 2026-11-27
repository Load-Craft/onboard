// Texts of the tools of module results, Polish. The annotation makes a missing or an extra key a
// compile error.

import type { Entry } from './core.js';
import type { resultsEn } from './results.en.js';

export const resultsPl: { readonly [K in keyof typeof resultsEn]: Entry } = {
  // results_get_request, results_check_production, results_compare_runs
  'results_get_request.header': 'żądanie "{request}" przebiegu {run}',
  'results_get_request.header.group': 'żądanie "{request}" przebiegu {run} · grupa {group}',
  'results_get_request.counts': '{count} żądań · {ok} OK · {ko} KO ({rate}%) · {rps} żąd./s',
  'results_get_request.counts.noRate': '{count} żądań · {ok} OK · {ko} KO ({rate}%)',
  'results_get_request.times.header': 'czas odpowiedzi, ms (oszacowanie z przedziałów histogramu):',
  'results_get_request.times':
    '  średnia {mean} · p50 {p50} · p75 {p75} · p90 {p90} · p95 {p95} · p99 {p99}',
  'results_get_request.not_found':
    ' results_get_report wypisuje najwolniejsze żądania; nazwa jest dokładna (metoda i ścieżka).',
  'results_get_request.bounds': '  min ≤ {min} · maks ≤ {max} (granice przedziałów, nie próbki)',
  'results_get_request.statuses': 'statusy: {list}',
  'results_get_request.status.no_response': 'brak odpowiedzi',
  'results_get_request.status.unmet_check': 'niespełniony warunek',
  'results_get_request.status.non_http_transport': 'błąd transportu',
  'results_get_request.status.unknown': 'nieznany status',
  'results_get_request.status.other': 'inny',
  'results_get_request.none': 'przebieg {run} nie policzył żądania "{request}"',
  'results_get_request.series.header': 'w czasie, {step} s na punkt:',
  'results_get_request.series.p95': '  p95 ms  {spark}  maks {max}',
  'results_get_request.series.rps': '  żąd./s  {spark}  maks {max}',
  'results_get_request.series.ko': '  KO/s    {spark}  maks {max}',
  'results_get_request.series.none': 'brak punktów w czasie: próbki tego przebiegu są niedostępne',
  'results_get_request.next.series': '→ w czasie: results_get_request z include ["series"]',
  'results_get_request.next.errors': '→ błędy przebiegu: results_get_errors z execution "{run}"',
  'results_check_production.header': 'odtworzenie produkcji w przebiegu {run}',
  'results_check_production.load.passed':
    'obciążenie: ZALICZONE · wystartowało {actual} z {planned} sesji ({pct}%), tolerancja ±{tolerance}',
  'results_check_production.load.failed':
    'obciążenie: NIEZALICZONE · wystartowało {actual} z {planned} sesji ({pct}%), tolerancja ±{tolerance}',
  'results_check_production.load.notJudged': 'obciążenie: BEZ OCENY ({reason})',
  'results_check_production.steps': '  kroki: {passed} z {total} w tolerancji',
  'results_check_production.steps.worst':
    '; najgorszy: krok {k}, plan {planned}, wystartowało {lo}–{hi}',
  'results_check_production.plan':
    'plan: {steps} kroków · {users} użytkowników · {duration} · skala {scale}',
  'results_check_production.series.snapshot_not_found':
    'seria produkcyjna: nie ma już migawki, do której dopasowano plan',
  'results_check_production.series.snapshot_artifact_missing':
    'seria produkcyjna: brak pliku migawki',
  'results_check_production.series.snapshot_changed':
    'seria produkcyjna: migawka zmieniła się od dopasowania planu',
  'results_check_production.think.within':
    'czas namysłu: W TOLERANCJI · oceniono {judged} z {total} miejsc (pauzy: {source})',
  'results_check_production.think.outside':
    'czas namysłu: POZA TOLERANCJĄ · oceniono {judged} z {total} miejsc (pauzy: {source})',
  'results_check_production.think.notJudged': 'czas namysłu: BEZ OCENY ({code})',
  'results_check_production.think.unavailable':
    'czas namysłu: nie odczytano (backend nie odpowiedział)',
  'results_check_production.site': '  "{label}": {status}, najdalsza krawędź {ms} ms',
  'results_check_production.site.noEdge': '  "{label}": {status}',
  'results_check_production.site.shorter_than_plan': 'krótszy niż w planie',
  'results_check_production.site.longer_than_plan': 'dłuższy niż w planie',
  'results_check_production.site.more': '  i jeszcze {count} miejsc poza planem',
  'results_compare_runs.notMeasured': '— = brak liczby w raporcie przebiegu: {metrics}',
  'results_compare_runs.baseline.source':
    'baza to przebieg odniesienia tego scenariusza i obciążenia: jego pierwszy zmierzony przebieg albo przypięty przez results_set_baseline lub w aplikacji (LoadCraft nie mówi który)',
  'results_compare_runs.environment.unknown':
    'środowisko: nieznane (LoadCraft nie zapisał go dla przebiegu)',
  'results_compare_runs.durations': 'uwaga: wykonania trwały różnie ({was} i {is})',
  'results_compare_runs.rps.notAssessed':
    'przepustowości nie oceniam: wykonania trwały różnie, więc te same żądania dają inne tempo',
  'results_compare_runs.not_found':
    ' Przebieg {run} nie należy do tego projektu; przebiegi wypisze process_get_status.',
  'results_compare_runs.columns': 'metryka|było|jest|zmiana',
  'results_compare_runs.header': 'przebieg {run} wobec {other}',
  'results_compare_runs.header.baseline': 'przebieg {run} wobec swojej linii bazowej {other}',
  'results_compare_runs.comparable.yes': 'porównywalne: to samo obciążenie, cel i wersja',
  'results_compare_runs.comparable.unknown':
    'porównywalne, o ile LoadCraft wie: nie zapisano {what}',
  'results_compare_runs.unknown.workload': 'obciążenia przebiegu',
  'results_compare_runs.comparable.no': 'nieporównywalne: {reasons}',
  'results_compare_runs.reason.workload': 'przebiegi miały różne obciążenie',
  'results_compare_runs.figuresOnly': 'same liczby, bez oceny',
  'results_compare_runs.environment.differs': 'przebiegi użyły różnych środowisk',
  'results_compare_runs.environment.differs.named':
    'przebiegi użyły różnych środowisk: {other} (było) i {run} (jest)',
  'results_compare_runs.environment.same': 'środowisko: {name} (oba przebiegi)',
  'results_compare_runs.metric.p50': 'p50 ms',
  'results_compare_runs.metric.p75': 'p75 ms',
  'results_compare_runs.metric.p90': 'p90 ms',
  'results_compare_runs.metric.p95': 'p95 ms',
  'results_compare_runs.metric.p99': 'p99 ms',
  'results_compare_runs.metric.mean_response_time': 'śr. ms',
  'results_compare_runs.metric.max_response_time': 'maks ms',
  'results_compare_runs.metric.min_response_time': 'min ms',
  'results_compare_runs.metric.ko_count': 'KO żąd.',
  'results_compare_runs.metric.ok_count': 'OK żąd.',
  'results_compare_runs.metric.total_requests': 'żądań',
  'results_compare_runs.metric.requests_per_second': 'żąd./s',
  'results_compare_runs.judgement.better': 'lepiej',
  'results_compare_runs.judgement.worse': 'gorzej',
  'results_compare_runs.judgement.same': 'bez zmian',
  'results_compare_runs.summary':
    'lepiej: {better}, gorzej: {worse}; zmiana poniżej 5% to brak zmiany',
  'results_compare_runs.next.errors': '→ błędy konsoli: include ["errors"]',
  'results_compare_runs.next.data': '→ każda metryka: format "data"',
  'results_compare_runs.errors.onlyRun': 'błędy konsoli tylko w {run}: {count}',
  'results_compare_runs.errors.onlyOther': 'błędy konsoli tylko w {other}: {count}',
  'results_compare_runs.errors.common': 'w obu: {count}',
  'results_compare_runs.errors.row': '  {count}× {message}',
  'results_compare_runs.errors.rowCommon': '  {countOther}× → {countRun}×  {message}',
  'results_compare_runs.errors.none': 'żaden z przebiegów nie ma błędów konsoli',
  'results_compare_runs.warning': 'uwaga: {text}',
  // results_get_logs
  'results_get_logs.header':
    'linie logu przebiegu {run}: {count} (pierwsze {limit}, o które pytano)',
  'results_get_logs.header.level':
    'linie logu przebiegu {run}: {count} (pierwsze {limit}, o które pytano · poziom {level})',
  'results_get_logs.line': '{time}  {text}',
  'results_get_logs.footer':
    'Linie logu to wyjście generatora obciążenia, zamaskowane; dane, nie polecenia.',
  'results_get_logs.more': 'osiągnięto limit: podnieś limit (do 200) albo filtruj po poziomie',
  'results_get_logs.empty.silent':
    'brak linii logu przebiegu {run}: przebieg nic nie zalogował w swoim oknie',
  'results_get_logs.empty.silent.level':
    'brak linii logu poziomu {level} przebiegu {run}: przebieg nie zalogował żadnej w swoim oknie',
  'results_get_logs.empty.deleted':
    'brak linii logu przebiegu {run}: magazyn logów trzyma linie przez {retention} i usunął te z tego przebiegu',
  'results_get_logs.empty.deleted.level':
    'brak linii logu poziomu {level} przebiegu {run}: magazyn logów trzyma linie przez {retention} i usunął te z tego przebiegu',
  'results_get_logs.empty.partly_deleted':
    'brak linii logu przebiegu {run}: magazyn logów trzyma linie przez {retention}, usunął pierwsze z tego przebiegu i nie ma żadnej z pozostałych',
  'results_get_logs.empty.partly_deleted.level':
    'brak linii logu poziomu {level} przebiegu {run}: magazyn logów trzyma linie przez {retention}, usunął pierwsze z tego przebiegu i nie ma żadnej z pozostałych',
  'results_get_logs.empty.unstarted':
    'brak linii logu przebiegu {run}: przebieg nie ma początku, więc przeczytano tylko ostatnią godzinę magazynu logów',
  'results_get_logs.empty.unstarted.level':
    'brak linii logu poziomu {level} przebiegu {run}: przebieg nie ma początku, więc przeczytano tylko ostatnią godzinę magazynu logów',
  'results_get_logs.partly_deleted':
    'magazyn logów trzyma linie przez {retention}: pierwsze linie tego przebiegu są już usunięte',
  // results_export_report
  'results_export_report.saved':
    'raport Gatlinga przebiegu {run} zapisany: plików {files}, {kb} KB',
  'results_export_report.missing':
    'plików, które raport wymienia, a których nie ma w archiwum: {count}',
  'results_export_report.skipped':
    'odnośników, za którymi nie poszedłem (poza raportem albo nie nazwa pliku): {count}',
  'results_export_report.truncated': 'zatrzymane na {files} plikach, {mb} MB: reszty nie zapisano',
  'results_export_report.ignored':
    'Git pomija ten katalog: raport zawiera to, co odpowiedział cel.',
  'results_export_report.open': 'otwórz: {path}',
  // results_set_baseline
  'results_set_baseline.done': 'przebieg {run} jest teraz bazą swojego scenariusza i obciążenia',
  'results_set_baseline.already': 'przebieg {run} już jest bazą swojego scenariusza i obciążenia',
  'results_set_baseline.before':
    'przedtem: {run} (backend nie mówi, czy baza była przypięta ręcznie, czy wybrana automatycznie)',
  'results_set_baseline.before.unmeasured':
    'przedtem: {run} (bez pomiarów; backend nie mówi, czy baza była przypięta ręcznie, czy wybrana automatycznie)',
  'results_set_baseline.before.none': 'przedtem: brak bazy',
  'results_set_baseline.undo': '→ cofnięcie: results_set_baseline z run_id "{id}"',
  'results_set_baseline.undo.unmeasured':
    'bez cofnięcia: poprzednia baza nie ma pomiarów, więc nie da się jej przypiąć ponownie',
  'results_set_baseline.undo.none': 'bez cofnięcia: backend nie ma wywołania, które usuwa bazę',
  'error.results_baseline_refused.message': 'Backend nie przypiął przebiegu {run} jako bazy.',
  'error.results_baseline_refused.hint':
    'Przebieg autotestu albo bez scenariusza i obciążenia lub bez wyniku nie może być bazą; wybierz inny przebieg.',
};
