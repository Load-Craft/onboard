#!/usr/bin/env bash
# The bound sklep repository (see resume/scaffold.sh) and a fresh, untracked recording of a login
# whose request carries the test account's password from .env.perf: the sentinel secret.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$here/../../resume/scaffold.sh"
password="$(sed -n 's/^TEST_USER_PASSWORD=//p' .env.perf)"
mkdir -p nagrania
cat > nagrania/logowanie.har <<HAR
{
  "log": {
    "version": "1.2",
    "creator": { "name": "synthetic", "version": "1" },
    "entries": [
      {
        "startedDateTime": "2026-01-15T10:00:00.000Z",
        "time": 120,
        "request": {
          "method": "POST",
          "url": "https://perf.example.com/api/auth/login",
          "httpVersion": "HTTP/1.1",
          "headers": [{ "name": "Content-Type", "value": "application/json" }],
          "queryString": [],
          "cookies": [],
          "headersSize": -1,
          "bodySize": -1,
          "postData": {
            "mimeType": "application/json",
            "text": "{\"email\": \"user@example.com\", \"password\": \"$password\"}"
          }
        },
        "response": {
          "status": 200,
          "statusText": "OK",
          "httpVersion": "HTTP/1.1",
          "headers": [{ "name": "Content-Type", "value": "application/json" }],
          "cookies": [{ "name": "session", "value": "s-$password" }],
          "content": { "size": 30, "mimeType": "application/json", "text": "{\"token\": \"t-$password\"}" },
          "redirectURL": "",
          "headersSize": -1,
          "bodySize": -1
        },
        "cache": {},
        "timings": { "send": 1, "wait": 110, "receive": 9 }
      },
      {
        "startedDateTime": "2026-01-15T10:00:04.000Z",
        "time": 80,
        "request": {
          "method": "GET",
          "url": "https://perf.example.com/api/products?q=kubek",
          "httpVersion": "HTTP/1.1",
          "headers": [{ "name": "Authorization", "value": "Bearer t-$password" }],
          "queryString": [{ "name": "q", "value": "kubek" }],
          "cookies": [],
          "headersSize": -1,
          "bodySize": 0
        },
        "response": {
          "status": 200,
          "statusText": "OK",
          "httpVersion": "HTTP/1.1",
          "headers": [{ "name": "Content-Type", "value": "application/json" }],
          "cookies": [],
          "content": { "size": 40, "mimeType": "application/json", "text": "[{\"id\": \"p-1\", \"name\": \"kubek\"}]" },
          "redirectURL": "",
          "headersSize": -1,
          "bodySize": -1
        },
        "cache": {},
        "timings": { "send": 1, "wait": 70, "receive": 9 }
      }
    ]
  }
}
HAR
