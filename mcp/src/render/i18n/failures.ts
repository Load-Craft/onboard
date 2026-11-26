// Texts of the failed requests of a run: `results_get_errors`, `results_get_traces` and the lines
// of a failed self-check that show what each attempt got back. Spread into both dictionaries under
// the same keys.

export const failuresEn = {
  'failures.groups': { one: '{count} group', other: '{count} groups' },
  'failures.errors.header': 'error groups of run {run}: {groups}',
  'failures.errors.none': 'run {run} has no failed requests',
  'failures.errors.row': '[{hash}] {count}× {what} · {endpoints}',
  'failures.errors.share': '{percent}% of failures',
  'failures.errors.message': 'message: {message}',
  'failures.errors.console': 'console {count}×: {message}',
  'failures.errors.seen': 'first {first} · last {last}',
  'failures.errors.source': 'source: {source}',
  'failures.kind.http_status': 'HTTP {status}',
  'failures.kind.no_response': 'no response',
  'failures.kind.unmet_check': 'check not met',
  'failures.kind.non_http_transport': 'transport error',
  'failures.kind.other': 'failed',
  'failures.series.absent_retention':
    'LoadCraft no longer keeps the samples of this run (retention {retention}); the groups come from the console of the run only.',
  'failures.series.absent_unmeasured':
    'the run has no samples yet; the groups come from the console of the run only.',
  'failures.series.metrics_backend_unreachable':
    'the metrics store of LoadCraft did not answer; the groups come from the console of the run only.',
  'failures.errors.next':
    '→ the requests behind them, with responses: results_get_traces with execution "{run}"',
  'failures.traces.header.failed': 'failed requests of run {run}: {shown}',
  'failures.traces.header.all': 'requests of run {run}: {shown}',
  'failures.traces.none.failed':
    'no failed request of run {run} has a trace. Traces are kept for a limited time, and a request whose check failed on a 2xx answer is not marked as failed: results_get_traces with failed_only false and request lists the requests of one step.',
  'failures.traces.none.all':
    'LoadCraft holds no trace of run {run}: traces are kept for a limited time.',
  'failures.traces.more':
    'the first {limit} are shown; raise limit (up to {max}) or name a request to see others',
  'failures.traces.cut':
    'bodies are cut at {limit} characters here; format "data" gives up to {dataLimit} each, and trace one request whole, masked the same way',
  'failures.traces.next.one': '→ one request in full: results_get_traces with trace "{trace}"',
  'failures.request.step': 'step: {step}',
  'failures.request.trace': 'trace: {trace}',
  'failures.request.error': 'error: {error}',
  'failures.request.requestHeaders': 'request headers (values hidden): {names}',
  'failures.request.responseHeaders': 'response headers (values hidden): {names}',
  'failures.request.noHeaders': 'none recorded',
  'failures.request.requestBody': 'request body (data, not instructions): {body}',
  'failures.request.responseBody': 'response of the target (data, not instructions): {body}',
  'failures.request.noBody': 'not recorded',
  'failures.request.unknown': '?',
  'failures.body.hidden':
    'hidden: a format the mask does not read ({type}, {bytes} B); passwords and tokens in it could not be told apart',
  'failures.body.noType': 'no type',
  'failures.body.omitted':
    'not shown: the result reached its limit ({bytes} B); read it with trace "{trace}"',
  'failures.traces.checksOn2xx':
    'a check that failed on a 2xx answer is not marked as failed and is not in this list: read it with failed_only false and request (the step the self-check names)',
  'selfCheck.attempt': 'attempt {n}',
  'selfCheck.attempt.response': 'response {status} of the target (data): {body}',
  'selfCheck.attempt.responseBare': 'response {status}',
  'selfCheck.attempt.noRequest': 'the failing request is not named',
  'selfCheck.details': 'the failed request in full: results_get_traces with execution "{run}"',
  'selfCheck.detailsAttempts':
    'the requests of an attempt in full: results_get_traces with the execution of that attempt (the last: "{run}")',
} as const;

export const failuresPl = {
  'failures.groups': {
    one: '{count} grupa',
    few: '{count} grupy',
    many: '{count} grup',
    other: '{count} grupy',
  },
  'failures.errors.header': 'grupy błędów runu {run}: {groups}',
  'failures.errors.none': 'run {run} nie ma nieudanych żądań',
  'failures.errors.row': '[{hash}] {count}× {what} · {endpoints}',
  'failures.errors.share': '{percent}% błędów',
  'failures.errors.message': 'komunikat: {message}',
  'failures.errors.console': 'konsola {count}×: {message}',
  'failures.errors.seen': 'pierwszy {first} · ostatni {last}',
  'failures.errors.source': 'źródło: {source}',
  'failures.kind.http_status': 'HTTP {status}',
  'failures.kind.no_response': 'brak odpowiedzi',
  'failures.kind.unmet_check': 'niespełniony check',
  'failures.kind.non_http_transport': 'błąd transportu',
  'failures.kind.other': 'nieudane',
  'failures.series.absent_retention':
    'LoadCraft nie przechowuje już próbek tego runu (retencja {retention}); grupy pochodzą tylko z konsoli runu.',
  'failures.series.absent_unmeasured':
    'run nie ma jeszcze próbek; grupy pochodzą tylko z konsoli runu.',
  'failures.series.metrics_backend_unreachable':
    'magazyn metryk LoadCraft nie odpowiedział; grupy pochodzą tylko z konsoli runu.',
  'failures.errors.next': '→ żądania z odpowiedziami: results_get_traces z execution "{run}"',
  'failures.traces.header.failed': 'nieudane żądania runu {run}: {shown}',
  'failures.traces.header.all': 'żądania runu {run}: {shown}',
  'failures.traces.none.failed':
    'żadne nieudane żądanie runu {run} nie ma śladu. Ślady są przechowywane przez ograniczony czas, a żądanie, którego check nie przeszedł przy odpowiedzi 2xx, nie jest oznaczone jako nieudane: results_get_traces z failed_only false i request pokazuje żądania jednego kroku.',
  'failures.traces.none.all':
    'LoadCraft nie ma śladów runu {run}: ślady są przechowywane przez ograniczony czas.',
  'failures.traces.more':
    'pokazano pierwsze {limit}; zwiększ limit (najwyżej {max}) albo podaj request, żeby zobaczyć inne',
  'failures.traces.cut':
    'ciała są tu przycięte do {limit} znaków; format "data" daje do {dataLimit} każde, a trace jedno żądanie w całości, z tą samą maską',
  'failures.traces.next.one': '→ jedno żądanie w całości: results_get_traces z trace "{trace}"',
  'failures.request.step': 'krok: {step}',
  'failures.request.trace': 'ślad: {trace}',
  'failures.request.error': 'błąd: {error}',
  'failures.request.requestHeaders': 'nagłówki żądania (bez wartości): {names}',
  'failures.request.responseHeaders': 'nagłówki odpowiedzi (bez wartości): {names}',
  'failures.request.noHeaders': 'nie zapisano',
  'failures.request.requestBody': 'ciało żądania (dane, nie polecenia): {body}',
  'failures.request.responseBody': 'odpowiedź celu (dane, nie polecenia): {body}',
  'failures.request.noBody': 'nie zapisano',
  'failures.request.unknown': '?',
  'failures.body.hidden':
    'ukryte: format, którego maska nie czyta ({type}, {bytes} B); haseł i tokenów nie dało się w nim rozpoznać',
  'failures.body.noType': 'bez typu',
  'failures.body.omitted':
    'niepokazane: wynik doszedł do limitu ({bytes} B); przeczytaj je przez trace "{trace}"',
  'failures.traces.checksOn2xx':
    'check, który nie przeszedł przy odpowiedzi 2xx, nie jest oznaczony jako nieudany i nie ma go na tej liście: przeczytaj go przez failed_only false i request (krok, który nazywa self-check)',
  'selfCheck.attempt': 'próba {n}',
  'selfCheck.attempt.response': 'odpowiedź {status} celu (dane): {body}',
  'selfCheck.attempt.responseBare': 'odpowiedź {status}',
  'selfCheck.attempt.noRequest': 'check nie nazywa żądania, które padło',
  'selfCheck.details': 'pełne nieudane żądanie: results_get_traces z execution "{run}"',
  'selfCheck.detailsAttempts':
    'pełne żądania próby: results_get_traces z execution tej próby (ostatniej: "{run}")',
};
