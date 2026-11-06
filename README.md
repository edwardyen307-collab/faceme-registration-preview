# FaceMe 註冊前個資聲明 + 內網薄後端代理

版本：**v2026-11-06b**

繁體中文靜態前端（GitHub Pages 可預覽 Mock）＋可選 **Node 內網薄後端**，依**對方提供的 API 說明**代理 FaceMe Security Central。  
**本環境未連線真實 Central；API 回應形狀為依規格假設，待內網驗證後再調整 adapters／fixtures。**

- 公開 Mock 預覽：https://edwardyen307-collab.github.io/faceme-registration-preview/
- Repo：https://github.com/edwardyen307-collab/faceme-registration-preview
- 假設規格來源：Central `https://192.168.32.220`（:443）、Swagger `https://192.168.32.220/swagger-ui/doc.html`（僅內網）

> **不要**把 GitHub Pages 說成能直連 Central。Pages 是公網 HTTPS；瀏覽器無法可靠存取私網 IP，且 `https` 頁呼叫 `http://192…` 會 mixed content。真實註冊請用內網 **HTTPS 同源**（薄後端 serve 靜態 + `/api`）。

## 兩種前端模式

| 模式 | 條件 | 行為 |
|------|------|------|
| **Mock 預覽** | 未設定 API base | 無外部請求；同意存 `sessionStorage`；送出顯示「已送出（預覽模式，尚未寫入 FaceMe）」 |
| **真實後端** | localStorage 有 API base | 同意必須向薄後端 `POST /api/consent` 取得短效 ticket；註冊 `POST /api/register`。失敗**不會** fallback Mock 假成功 |

API base 只存非機密位址（`localStorage` key `faceme_api_base`）。變更 base 會清除同意狀態。帳密**永不**進瀏覽器。

若在 Pages（HTTPS）把 API base 設成 `http://…`，前端會明確提示阻擋（mixed content），並建議改走內網同源 HTTPS。**不要**關閉瀏覽器安全功能。

## 聲明文案怎麼改

編輯 `index.html` 的 `#notice-text`。未知欄位維持 `【待填寫：…】` 與「草稿／範本／待法務確認」。  
前端／後端聲明版本常數：`v2026-11-06b-draft`（`app.js` 的 `STATEMENT_VERSION` 與伺服器 `FACEME_STATEMENT_VERSION` 必須一致）。

**真實寫入 Central 預設關閉。** 需同時：

1. 法務確認／更新聲明後，將 `FACEME_STATEMENT_LEGAL_CONFIRMED=1`
2. `FACEME_REAL_MODE=1`
3. 設定 `FACEME_BASE_URL` / `FACEME_ACCOUNT` / `FACEME_PASSWORD`

否則 `/api/register` 回 503，不會呼叫 Central。此不代表法務合規已完成。

## 薄後端（內網試驗）

**用途**：內網試驗代理。未加企業 SSO／mTLS 等完整管控；請以網路 ACL 限制，**禁止公開到網際網路**。

### 環境變數

複製 `.env.example` → `.env`（已 gitignore）：

| 變數 | 說明 |
|------|------|
| `HOST` / `PORT` | 監聽（建議 `127.0.0.1`） |
| `FACEME_BASE_URL` | 僅伺服器；不可由 client 指定任意 upstream |
| `FACEME_ACCOUNT` / `FACEME_PASSWORD` | Central 帳密 |
| `FACEME_SKIP_TLS_VERIFY=1` | **僅** undici Agent 對上游關閉憑證驗證（自簽）。有 MITM 風險。**禁止**設全域 `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| `FACEME_REAL_MODE` / `FACEME_STATEMENT_LEGAL_CONFIRMED` | 皆為 `1` 才啟用真實寫入 |
| `FACEME_STATEMENT_VERSION` | 須與前端一致 |
| `CONSENT_TTL_SECONDS` | 同意 ticket 有效秒數 |
| `CONSENT_LOG_PATH` | 本地 append JSONL（同意事件；不含照片／token／密碼）。權限、備份、留存由營運負責 |
| `CORS_ORIGINS` | 逗號分隔 allowlist，**無 wildcard**。跨域只加可信 Pages origin；同源部署可不設 |
| `UPSTREAM_TIMEOUT_MS` / `MAX_UPLOAD_BYTES` | 逾時與 8MB 上限 |
| `RATE_LIMIT_*` | 簡易記憶體速率限制 |

### 啟動

```bash
cd faceme-registration-preview
cp .env.example .env   # 再編輯
npm install
npm start              # 預設 http://127.0.0.1:8443 （靜態 + /api）
```

本機開發：瀏覽器開 `http://127.0.0.1:8443/`，API base 留空（Mock）或設 `http://127.0.0.1:8443`（同源真實模式，仍需 `.env` 啟用 real mode 才會打 Central）。

### 反向代理 HTTPS 範例

見 `docs/nginx/faceme-proxy.example.conf`。以 nginx 終止 TLS，反代到本機薄後端，前端與 `/api` 同源，避免 mixed content／私網 CORS 問題。

### 後端 API

- `GET /api/health` — 版本、聲明版、realMode 是否啟用（無密）
- `POST /api/consent` — JSON `{ "agreed": true, "statementVersion": "v2026-11-06b-draft" }` → `{ ticket, expiresAt }`（短效、單次使用、伺服器綁定版本／時間；有 expiry／replay 防護）
- `POST /api/register` — multipart：`name`（必填）、`employeeId`（選填）、`image`、`consentTicket` → `{ personId }`

註冊流程（server）：驗證 ticket → 驗證姓名／圖片 MIME／魔數／大小 → Central signIn → **QC 通過才** import。QC 未知形狀 **fail closed**；HTTP 200 不視為 QC pass。錯誤不回傳上游原文／token。

### 依規格實作的 Central 呼叫（待內網驗證）

詳見 `server/fixtures/central-responses.md` 與 `server/central/adapters.js`。

| 呼叫 | 重點 |
|------|------|
| `POST /api/website/account/signIn` | form-urlencoded `account`,`password`；假設 JSON 含 `token` |
| 後續 | `Authorization: <token>`（**不加** Bearer） |
| `POST /api/website/snapshot/qc` | multipart `image` |
| `POST /api/website/person/import` | multipart `name`,`snapshot`；`employeeId` 選填；假設回 `personId` |

Fixtures 內皆為**假資料**標籤，非真實 token／personId。

## 測試

```bash
npm test
```

涵蓋：前端 Mock／真實模式不 fallback、adapters fail-closed、同意缺失／版號不符／過期／重放、QC fail／未知不 import、登入失敗、multipart／Authorization 形狀、CORS allowlist、檔案類型等。  
**不含**瀏覽器／Playwright；**未**對真實 `192.168.32.220` 驗證。

## 使用者內網要做的事

1. 在可達 Central 的主機部署本 repo，設定 `.env`（勿提交）。
2. 法務確認聲明文案後更新版本字串，並設 `FACEME_STATEMENT_LEGAL_CONFIRMED=1` 與 `FACEME_REAL_MODE=1`。
3. 以 HTTPS 反代同源提供前端；必要時 `FACEME_SKIP_TLS_VERIFY=1`（知悉風險）。
4. 對照 Swagger 調整 `server/central/adapters.js` 與 fixtures。
5. 用 ACL 限制來源；勿公開。

## 安全摘要

- Central base／帳密僅伺服器；client 不能指定 upstream。
- 臨時上傳在記憶體，用後丟棄；不寫照片到 disk；log 不含 token／密碼／照片。
- 同意 JSONL 僅必要稽核欄位；非正式合規聲明。
