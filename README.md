# FaceMe 註冊前個資聲明（靜態預覽）

繁體中文靜態網頁預覽：**個資聲明 → 同意後進入註冊表單**。  
**不串接 FaceMe Central API、無後端、不上傳／不持久儲存**姓名或人臉照片。

- 線上預覽：https://edwardyen307-collab.github.io/faceme-registration-preview/
- 版本：`v2026-11-06a`（頁面標題與右上角徽章）
- Repo：https://github.com/edwardyen307-collab/faceme-registration-preview

## 頁面流程

1. `index.html`（首頁／個資聲明）
   - 可捲動聲明全文，標示「草稿」「範本／待法務確認」
   - Checkbox「我已閱讀並同意上述個資聲明」（預設未勾）
   - 「確認送出」未勾選時 disabled；勾選後可進入註冊頁
   - 同意狀態寫入 `sessionStorage` key：`faceme_privacy_consent_v1`（值 `1`）
2. `register.html`（註冊預覽）
   - 若未同意直接開啟，會導回 `index.html`
   - 姓名必填；員工／訪客編號選填
   - 人臉照片：檔案選擇或手機相機（`capture="user"`），本機 Object URL 縮圖，不外傳
   - 「送出註冊」僅顯示：`已送出（預覽模式，尚未寫入 FaceMe）`
   - 可返回聲明頁

## 如何修改聲明文案

編輯 **`index.html`** 內 `div#notice-text`（class `notice-scroll`）區塊即可。

- 所有尚未確認的公司名、期間、地區、聯絡窗口等，請維持或更新為  
  `<span class="placeholder">【待填寫：…】</span>`，**不要**寫成已核准的假內容。
- 頁首草稿提示在 `div.draft-banner`；法務定稿後可調整標籤文案，但上線前請務必置換全文。
- 若需調整同意 checkbox 文案，修改 `label[for="consent-check"]`。
- 樣式在 `styles.css`；同意／閘道／表單邏輯在 `app.js`。

## 純預覽行為與限制

| 項目 | 行為 |
|------|------|
| API | 不呼叫任何 FaceMe 或第三方 API |
| 網路傳送個資 | 無（照片僅 `URL.createObjectURL` 本機預覽） |
| 持久儲存 | 無 localStorage／IndexedDB／伺服器寫入；僅 sessionStorage 存同意旗標 |
| 分析／外部圖 | 無 |
| 正式 enrollment | 不在本版範圍 |

請勿在預覽環境輸入真實個資或上傳真實人臉。

## 本機開啟

任選靜態伺服器，例如：

```bash
cd faceme-registration-preview
python3 -m http.server 8080
# 開啟 http://127.0.0.1:8080/
```

## 測試

```bash
npm install --no-save jsdom
node tests/run-checks.js
```

測試涵蓋：靜態 HTML 結構與版本字串、同意 gating、姓名必填、照片類型／大小驗證與縮圖、mock 送出文案、響應式 meta／基本 a11y 屬性。  
**不含**真實瀏覽器／Playwright 操作（若需 UI 截圖請另開桌面瀏覽器驗證線上網址）。

## GitHub Pages

本 repo 以 `main` 分支根目錄部署。推送後等待 Pages 建置完成即可用 HTTPS 網址開啟。

## 檔案一覽

- `index.html` — 個資聲明
- `register.html` — 註冊預覽
- `styles.css` — 樣式
- `app.js` — 前端邏輯
- `tests/run-checks.js` — Node／jsdom 檢查
