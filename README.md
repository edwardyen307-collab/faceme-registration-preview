# FaceMe 本機註冊預覽（Windows 同機）

版本：**v2026-11-06c**

## 三步開始（個人 Windows 筆電）

1. **安裝 Node.js LTS**（若已安裝可略過）→ [https://nodejs.org/](https://nodejs.org/)  
   這**不是**完全免安裝軟體：一定要有 Node／npm。本工具**不會**靜默安裝 Node，也**不會**繞過公司執行原則。
2. **下載 ZIP 解壓，雙擊 `start.bat`，必要時在記事本填 `.env` 帳密**  
   壓縮包（預設分支 `main`）：  
   **https://github.com/edwardyen307-collab/faceme-registration-preview/archive/refs/heads/main.zip**  
   若 Windows 封鎖來自網際網路的檔案：對 ZIP 或解壓後的 `start.bat` 右鍵 → 內容 → 勾選「解除鎖定」→ 確定。  
   **不要**對腳本使用 `-ExecutionPolicy Bypass`；建議用 `start.bat`（bat＋Node），不必改 PowerShell 原則。
3. 瀏覽器開啟（一鍵會試著自動開）：**http://127.0.0.1:8443/?local=1**（本機 **HTTP**，不是 HTTPS）

> 一鍵**不等于**已串上真實 Central 註冊成功。預設 `FACEME_REAL_MODE=0`、法務確認＝0；首次真實寫入仍需聲明定稿並自行啟用旗標。Central API 形狀**尚未**在此環境對真機驗證。

---

## 同機架構說明

Central、薄後端、瀏覽器都在**同一台 Windows** 時：

| 元件 | 位址 |
|------|------|
| 薄後端＋前端 | 聽 `127.0.0.1:8443`，頁面 `http://127.0.0.1:8443/`（同源） |
| `.env` 預設 `FACEME_BASE_URL` | `https://127.0.0.1`（**不保證** Central 有聽 loopback） |

若 Central 只綁 LAN（例如 `192.168.32.220`）或 TLS 憑證 SAN 是主機名而非 `127.0.0.1`，請把 `FACEME_BASE_URL` 改成 Central **實際**提供且憑證相符的 URL。優先信任 CA；僅在明白 MITM 風險時才設 `FACEME_SKIP_TLS_VERIFY=1`（預設關閉）。

既有 `.env`：**永遠不覆蓋**。僅在缺少 `.env` 時由 `.env.example` 建立。

## 公開 Mock 預覽（無本機後端）

- https://edwardyen307-collab.github.io/faceme-registration-preview/  
- Repo：https://github.com/edwardyen307-collab/faceme-registration-preview  

GitHub Pages **無法**打你筆電上的 Central／127.0.0.1。

## 一鍵會做什麼

`start.bat` → `scripts/windows-launcher.js`：

1. 檢查 Node／npm 與最低主版本（≥ 18）
2. 若無 `.env`：從 example 建立並可開記事本（不把密碼送進任何遠端工具）
3. 需要時才 `npm ci`（失敗保留可讀訊息，視窗 pause）
4. 探測 `http://127.0.0.1:PORT/api/health`：已是本版則不重複啟動；被其他程式占用則**拒絕**並不開瀏覽器（避免假成功）
5. 啟動薄後端，確認 health 的 `appVersion` 後再開 `http://127.0.0.1:8443/?local=1`

可選：`setup-and-start.ps1` 同樣只呼叫上述 Node 腳本，**不** Bypass。ZIP 的 Mark of the Web 請用「解除鎖定」，或直接用 `start.bat`。

## 模式與連線測試

- `?local=1`：自動把 API base 設成目前頁面 origin（本機薄後端），模式橫幅會明顯標示。仍可按「Mock 預覽」清空。
- **連線測試**：呼叫本機 `POST /api/connection-test`（TCP／TLS；可選登入）。**不是** `/api/health`。不 QC、不 import、不記 token／密碼。`FACEME_REAL_MODE=0` 時也可測。登入測試需使用者在頁面上明確確認。

真實註冊閘門（同意票、fail-closed QC、雙旗標）不變。

## 開發者

```bash
npm install
npm start          # http://127.0.0.1:8443/
npm test
```

修改聲明：`index.html` 的 `#notice-text`；版本字串須與 `FACEME_STATEMENT_VERSION`／前端 `STATEMENT_VERSION` 一致（目前 `v2026-11-06c-draft`）。

## 安全提醒

- `.env` 含密碼：勿提交、勿上傳公開雲端；一鍵會嘗試縮限 Windows ACL。
- 薄後端僅內網／本機試驗，勿對網際網路公開。
- 規格見 `server/fixtures/`；**未**宣稱已對真實 Central 驗證通過。
