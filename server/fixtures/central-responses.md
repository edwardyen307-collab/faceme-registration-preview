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

### QC failure reason extraction (v2026-11-09j)

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
- Request: multipart **confirmed** fields: `name` (required), `snapshot` (required, ≤5 images, one face each, PNG/BMP/JPG/JPEG), optional `employeeId`, `information` (JSON string: email/company/title/note…), `accessPeriod` (JSON string), **`groupId` (int64)**, `tags` (array; only with groupId — **we do not send tags**), `coverImage`, `skipQC`, `forceImport`.
- This thin backend sends: `name`, `snapshot`, optional `employeeId`, optional `information`, and **`groupId` only**.
- **Not sent**: aliases (`groupIds`/`groupName`), `tags`, `skipQC` (keep default false), `forceImport` (keep default false — preserve similar-person protection).
- No post-import group move (`FACEME_GROUP_MOVE_AFTER_IMPORT` removed / unused).
- Assumed success: `{ "personId": "P-FAKE-001" }` or `{ "data": { "personId": "..." } }`
- Observed failure: HTTP **406** with message like `Exists similar person` and detail URL `https://<host>/user-detail?id=<id>`

## Groups (swagger-confirmed 2026-11-09)

| Action | Default | Body / notes |
| --- | --- | --- |
| List groups | `POST /api/website/group/list` | `{ pageIndex, pageSize, orderBy: "name:asc" }` — paginate ≤20 pages |
| Create group | `POST /api/website/group/create` | required `{ name, color, patternId }` — **do not send type** |
| Import group field | multipart `groupId` (int64) | only official field; resolve create id from response or re-list by name |

Env overrides still exist (`FACEME_GROUP_LIST_PATH`, `FACEME_GROUP_CREATE_PATH`, `FACEME_IMPORT_GROUP_FIELD`) but defaults match swagger.

**Invisible people after “success”**: previously wrong/missing group multipart field (aliases or no group) likely put people outside the expected Central group filter. Fix = send only numeric `groupId`.



## QC failure reason extraction (v2026-11-09j)

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
