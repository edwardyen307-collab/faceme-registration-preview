# Assumed Central response shapes (NOT live-verified)

Source: operator brief for FaceMe Security Central at `https://192.168.32.220`.
Swagger (intranet): `https://192.168.32.220/swagger-ui/doc.html`.

These fixtures are **fake data** for adapters/tests. Adjust after intranet verification.

## POST `/api/website/account/signIn`
- Request: `application/x-www-form-urlencoded` `account`, `password`
- Assumed success JSON: `{ "token": "fake-token-for-tests-only" }`
- Also accepted by adapter: `{ "data": { "token": "..." } }`, `{ "accessToken": "..." }`
- Authorization on later calls: raw token header value, **no** `Bearer ` prefix

## POST `/api/website/snapshot/qc`
- Request: multipart field `image`
- Assumed pass: `{ "pass": true }` or `{ "success": true }` or `{ "result": "PASS" }`
- Assumed fail: `{ "pass": false }` / `{ "success": false }` / `{ "result": "FAIL" }`
- **HTTP 200 with unknown body = QC fail (fail closed)** — never treat status alone as pass

## POST `/api/website/person/import`
- Request: multipart `name`, `snapshot`, optional `employeeId`
- Assumed success: `{ "personId": "P-FAKE-001" }` or `{ "data": { "personId": "..." } }`
