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


## QC failure reason extraction (v2026-11-09g)

Central's exact JSON field names are **not live-verified** here (intranet swagger only).
Public FaceMe materials mention QC for occlusion / blur / lighting / angle / size / grayscale.

This thin backend loosely matches common aliases and always fail-closes:

| Concern | Example aliases (case-insensitive) |
| --- | --- |
| Face count | `faceCount`, `faces`, `numFaces` |
| Quality / score | `quality`, `qualityScore`, `score` + `threshold` / `minQuality` |
| Blur | `blur`, `sharpness`, `clarity` |
| Pose | `yaw` / `pitch` / `roll` (nested under `pose` / `headPose` OK) |
| Lighting | `brightness`, `exposure`, `lighting`, `isDark` |
| Occlusion | `occlusion`, `mask`, `glasses`, `sunglasses` |
| Size | `faceSize`, `iod`, `interOcular` |
| Messages | `message`, `errorCode`, `failReason` |

Failures return Traditional Chinese `reasons[]` + masked `techDetails` (no token/password/image/feature).
Masked payload is also appended to `runtime/qc.log` and `runtime/upstream.log`.
