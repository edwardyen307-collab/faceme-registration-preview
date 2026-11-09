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
- **Observed live Central response (2026-11-09)** — this is the canonical shape:

```json
{
  "quality_result": true,
  "condition": {
    "face_size": true,
    "angle": true,
    "occlusion": true,
    "color": true,
    "single_face": true,
    "mask": true
  }
}
```

- `quality_result === true` → QC **pass** (only this boolean grants pass for this shape)
- `quality_result === false` → QC **fail**; each `condition.*` value: **`true` = that check passed**, **`false` = that check failed**
- `quality_result` missing or non-boolean → **fail-closed** with「無法判讀」
- Legacy fixture shapes (`pass` / `success` / `result`) still accepted for older tests
- **HTTP 200 with unknown body = QC fail (fail closed)** — never treat status alone as pass

### QC failure reason extraction (v2026-11-09h)

When `condition` is present, **only `false` flags** become Traditional Chinese reasons:

| condition key | Meaning when false |
| --- | --- |
| `face_size` | 臉太小或太大，請調整距離 |
| `angle` | 角度不正，請正面直視 |
| `occlusion` | 有遮擋 |
| `color` | 顏色或光線異常 |
| `single_face` | 不只一張臉 |
| `mask` | 戴了口罩 |

Numeric / alias heuristics (yaw, blur scores, …) run **only when `condition` is absent**.
Do **not** invert condition booleans (true never means “has problem”).
Masked tech details go to `runtime/qc.log` / `upstream.log`.


## POST `/api/website/person/import`
- Request: multipart `name`, `snapshot`, optional `employeeId`, **plus group field (GUESSED)**
- Group field default: `groupId` (also sends `groupIds` / `groupName` aliases). Override with `FACEME_IMPORT_GROUP_FIELD`.
- Assumed success: `{ "personId": "P-FAKE-001" }` or `{ "data": { "personId": "..." } }`
- Observed failure: HTTP **406** with message like `Exists similar person` and detail URL `https://<host>/user-detail?id=<id>`

## Groups (GUESSED — not live-verified; override via .env)

FaceMe Security Central website API paths are not published like FaceOS device WebRest.
We keep an adapter layer with defaults aligned to `/api/website/*` naming:

| Action | Default (GUESSED) | Env override |
| --- | --- | --- |
| List groups | `GET /api/website/group` | `FACEME_GROUP_LIST_PATH` |
| Create group | `POST /api/website/group` JSON `{ "name": "..." }` | `FACEME_GROUP_CREATE_PATH` |
| Import group field | multipart `groupId` | `FACEME_IMPORT_GROUP_FIELD` |

Related FaceOS device docs use `groupId` on person create — polarity of field name is plausible but **paths differ**. Confirm on intranet swagger (`/swagger-ui/doc.html`) before production.



## QC failure reason extraction (v2026-11-09h)

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
