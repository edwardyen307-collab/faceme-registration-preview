# FaceMe 本機註冊預覽（Windows 同機）

版本：**v2026-11-09o**

## 若「雙擊 start.bat 視窗閃一下就關掉」

1. **先關掉**所有舊的黑色命令視窗／舊版 node 服務。  
2. 下載本版修復檔（見下方），用新的 `start.bat` **覆蓋**專案根目錄同名檔（**不要刪、不要覆蓋你的 `.env`**）。若提示還缺檔，再解壓修復 ZIP 內列出的檔案到同一資料夾。  
3. 再雙擊新的 `start.bat`。視窗應會停住並顯示英文錯誤或啟動過程；詳細中文／日誌在 Node 輸出與 `runtime\launcher.log`、`runtime\bat-boot.log`（不含密碼）。

**已確認的舊版問題（v2026-11-06c 的 `start.bat`）**：檔案為 Unix **LF** 換行（非 Windows CRLF）；且在 `if (...)` 括號區塊內放了 `:標籤`（如 `:FAIL_NODE`）與 UTF-8 中文／`choice`。Windows `cmd` 常因此在跑到 `pause` 前就解析失敗並直接關窗。本版改為 **純 ASCII + CRLF** 啟動器，錯誤路徑一律 `goto HOLD` 再 `pause`；中文詳訊改由 Node 顯示。

**修復包**：見 release 工作區 `/workspace/faceme-update-v2026-11-09o.zip`（或完整 repo ZIP）。至少覆蓋 `start.bat` + `scripts/windows-launcher.js`；**勿覆蓋 `.env`**。

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


## 用 iPhone（同一 Wi-Fi）開啟註冊頁（v2026-11-09o）

預設只聽 `127.0.0.1`，手機連不到。需在**電腦本機頁**手動開啟「手機連線（區網）」：

1. 在電腦用 `http://127.0.0.1:8443/?local=1` 開啟。註冊／同意流程在頁面最上方；連線設定等管理功能已移到最下方收合的「管理／設定（僅本機）」。
2. 展開「管理／設定（僅本機）」，勾選 **手機連線（區網）**。開啟後，頁面上方「手機掃碼註冊」與設定區都會出現 QR（本機離線產生，不經過外部 QR 網站）。
3. 若提示請重開 `start.bat`，先關掉舊視窗再雙擊一次。也可用 iPhone 相機掃描 QR，或手動開啟畫面上的 `http://192.168.x.x:8443/`。
4. 第一次監聽區網時，Windows 可能跳出「Windows 安全性警訊」：請只允許 **私人網路**，**不要**勾選公用網路。本程式不會自動改防火牆。
5. iPhone 連上**同一 Wi-Fi**，用 Safari 開啟該 HTTP 網址（不必 HTTPS；拍照使用檔案選擇／相機，不需安全內容）。手機頁只顯示註冊流程，不會出現管理／設定。群組請用下拉選單選擇（進入頁面會自動載入），也可自行輸入新名稱。
6. 用完請在電腦把開關關掉（並視需要重開 start.bat），避免區網持續暴露此服務。設定與 `.env` 仍只能在 127.0.0.1 修改。不要把這個服務放到公網。


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

## 「無法連線上游／fetch failed」怎麼辦（v2026-11-09n）

錯誤會展開底層原因。常見：
- **ECONNREFUSED**：該 IP／埠沒有服務（`https://127.0.0.1`＝443 埠；Central 若在別的埠請寫 `:埠號`）
- **憑證錯誤**：自簽／SAN 不符 → 改主機名或信任 CA；勿隨便關驗證
- **EPROTO**：http／https 弄反
詳見畫面訊息與 `runtime/upstream.log`。

## 「聲明版本不符」怎麼辦（v2026-11-09n）

原因多半是：舊 `.env` 裡有 `FACEME_STATEMENT_VERSION=…`（建立 .env 時從舊 example 帶入），而網頁已更新。  
現在程式以 `statement-version.json` 為準，**會忽略 .env 裡不同的覆寫值**（不自動改你的 .env）。建議刪除或註解該行後重開 `start.bat`，並重新整理瀏覽器。

## TLS 與 IP 位址（v2026-11-09n）

連線 `https://127.0.0.1`（或其它 IP）時**不會**再設定非法的 TLS `servername`（Node 禁止 SNI 為 IP）。憑證驗證預設仍開啟；若出現「憑證不被信任／名稱不符」，請改用憑證 SAN 上的主機名、匯入 CA，或僅在明白風險時設 `FACEME_SKIP_TLS_VERIFY=1`（不會自動略過）。

## 略過自簽憑證（v2026-11-09n）

本機版連線設定區有開關「**略過自簽憑證檢查（僅限本機 Central）**」。

- 僅當 `FACEME_BASE_URL` 主機是 `127.0.0.1`／`localhost`／`::1` 時可開啟；否則 API 拒絕並說明原因。
- 開關會寫入 `.env` 的 `FACEME_SKIP_TLS_VERIFY`（替換同名重複行、備份 `.env.bak`），並立即重建 upstream Agent；連線測試回傳的 `skipTlsVerify` 會反映新值。
- 若之後把 Central 改成非本機位址，會自動關閉略過並寫回 `.env`。
- `.env` 載入改為**後出現的同名鍵覆寫**；啟動與 `/api/local-settings` 會顯示診斷（路徑、是否找到、重複鍵次數、是否被系統環境變數覆蓋、是否存在 `.env.txt`），不輸出秘密值。若系統環境變數蓋掉 `.env`，請到 Windows「系統內容 → 進階 → 環境變數」移除 `FACEME_SKIP_TLS_VERIFY`。


## 在網頁修改 Central 位址（本機）

於 `http://127.0.0.1:8443/` 連線設定區：

1. **① 薄後端 API base**（瀏覽器 → 本機薄後端，localStorage）
2. **② Central 位址**（薄後端 → FaceMe Central，寫入 `.env` 的 `FACEME_BASE_URL`）

② 僅 loopback 可用，需本機管理 token；只接受 `https://主機或IP[:埠]`；立即生效；不顯示密碼。GitHub Pages 會顯示「僅本機版可用」。

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

修改聲明全文：`index.html` 的 `#notice-text`。**聲明版本**只改 `statement-version.json`（與程式版號無關）。前端從 `/api/health` 或該 JSON 讀取。若 `.env` 仍有舊的 `FACEME_STATEMENT_VERSION=`，會被忽略並在啟動時警告。

## 安全提醒

- `.env` 含密碼：勿提交、勿上傳公開雲端；一鍵會嘗試縮限 Windows ACL。
- 薄後端僅內網／本機試驗，勿對網際網路公開。
- 規格見 `server/fixtures/`；**未**宣稱已對真實 Central 驗證通過。

## QC 失敗原因（v2026-11-09n）

真實註冊若人臉品質檢查未通過，畫面會列出**白話原因與調整建議**（例如偵測到多張臉、光線太暗、臉偏轉），並可展開已遮罩的「技術細節」。

- 行為仍是 **fail-closed**：QC 失敗一律不匯入。
- 遮罩後的內容會寫入 `runtime/qc.log`（與 `upstream.log`），不含 token／帳密／影像／特徵值。
- 欄位名稱依文件與常見別名**寬鬆比對**；Central 實際 swagger 欄位若不同，可對照 log 再改進解析。


## QC 真實格式（v2026-11-09n）

Central 實際回應（2026-11-09 觀察）：

```json
{ "quality_result": true, "condition": { "face_size": true, "angle": true, "occlusion": true, "color": true, "single_face": true, "mask": true } }
```

- 只有 `quality_result === true` 算通過
- `condition` 各項：`true`＝該項通過、`false`＝不合格（才顯示原因）
- 缺欄或非布林 → fail-closed「無法判讀」

## 群組與匯入（v2026-11-09n）

- 註冊頁**群組必填**：`<select>` 下拉（另有輸入新名稱）在頁面載入時自動打 `GET /api/groups`（薄後端代打 `POST /api/website/group/list`，分頁；權杖不外露）。本機與區網手機皆可讀取清單；不必按管理區的「測試讀取群組」。
- 新群組：前端選顏色／圖示編號 → 薄後端 `POST /api/website/group/create`（`name`+`color`+`patternId`，不送 type）→ 取得 id（回應或再 list）→ 匯入。
- 群組 list 實際格式 `{ totalSize, results:[{ groupId, name, type, … }] }`；list/create 預設 **form → multipart → json**（僅 HTTP 415 才換編碼；可用 `FACEME_GROUP_BODY_ENCODING` 覆寫）。signIn 為 `application/x-www-form-urlencoded`；QC／import 為 multipart。
- 人員匯入只送官方 multipart **`groupId`（int64）**，外加 `name`／`snapshot`／可選 `employeeId`／可選 `information` JSON。**不送** tags、skipQC、forceImport、群組別名。已移除匯入後搬群組備援。
- 先前「註冊成功但 Central 看不到人」極可能是群組欄位名稱不對或根本沒帶群組；現在改為官方 `groupId`。
- HTTP 406 `Exists similar person` → 「此人已註冊過（相似人員 #id）」；detail 連結僅允許與 `FACEME_BASE_URL` 同主機。
- 管理／設定（僅本機）整區移到頁面最下方，預設收合；區網／手機頁不會輸出此區塊。狀態存在 localStorage。


## 找人／補群組（v2026-11-09n）

僅本機 `http://127.0.0.1:8443/`（區網模式不會開放這些 API）。在本機頁展開最下方「管理／設定（僅本機）」後使用「找人／補群組」：

1. **列出未分群組的人**：試著不帶 groupId 呼叫 member/list。若中央只回已分組的人，請改用編號查詢或範圍掃描。
2. **用編號查詢／範圍掃描**：只讀。詳細頁連結為 `https://<Central 主機>/user-detail?id=<編號>`。
3. **指定群組**：選現有群組後確認。需 `FACEME_REAL_MODE=1` 且 `FACEME_STATEMENT_LEGAL_CONFIRMED=1`。只送 personId 與 groupId。

尚未在真實 Central 驗證：不帶 groupId 的 list 是否含未分組者、query 的未分組形態、update 是否取代原群組。
