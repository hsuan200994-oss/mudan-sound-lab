# 聲音偵探：Gemini × Supabase 互動實驗學習單

## 檔案
- `index.html`：學生端（登入、實驗、畫圖、CER、主動問 AI、分站自動追問）
- `teacher.html`：教師端（權限驗證、逐人展開答案及對話、CSV/JSON 匯出）
- `config.js`：**僅**公開 Supabase URL 與 publishable/anon key
- `supabase/migrations/001_schema.sql`：資料表與 RLS 安全政策
- `supabase/functions/ask-gemini/index.ts`：驗證登入、頻率限制、Gemini 呼叫、對話存檔

## 部署步驟
1. 在 Supabase 建立專案，在 SQL Editor 執行 `supabase/migrations/001_schema.sql`。
2. Supabase Authentication > Users 建立教師與學生的 Email/Password 帳號（建議停用公開註冊、由管理員建立）。
3. 從 Authentication > Users 複製每位使用者的 UUID，在 SQL Editor 執行：
   ```sql
   insert into public.profiles(id,display_name,role,class_name)
   values ('貼入教師UUID','自然老師','teacher','四年級'),
          ('貼入學生UUID','學生一','student','四年級');
   ```
4. 到 [Google AI Studio](https://aistudio.google.com/api-keys) 建立 Gemini API Key。
5. 在 Supabase Edge Function Secrets 設定 `GEMINI_API_KEY`。可選設 `GEMINI_MODEL=gemini-2.5-flash`。**不要**將 Gemini Key 放進 HTML、config.js 或版本控制。
6. 安裝 Supabase CLI 並登入，於專案資料夾執行：
   ```bash
   supabase login
   supabase link --project-ref 你的專案REF
   supabase functions deploy ask-gemini
   ```
7. 修改 `config.js` 的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`，值可從 Supabase Dashboard > Project Settings > API Keys 取得。**不可填 service_role / secret key**。
8. 將 `index.html`、`teacher.html`、`style.css`、`student.js`、`teacher.js`、`config.js` 一起上傳到 HTTPS 靜態網站服務（例如 Netlify 或 GitHub Pages）。學生開啟 `index.html`；教師開啟 `teacher.html`。
9. 在 Supabase Auth URL Configuration 設定 Site URL。測試學生登入、作答、AI 回覆、登出，以及教師查閱與匯出。部署前先確認學校學生資料處理規範與家長告知程序。

## 安全說明
- 前端只持有公開 publishable key；Gemini API Key 和 Supabase service role key 只在 Edge Function 伺服器端。
- RLS：學生只能讀寫自己的學習單、讀自己的對話；教師能唯讀全班。對話只由後端寫入，避免偽造 AI 回答。
- Edge Function 會再次驗證使用者 JWT 和學生角色，且每人每小時最多 25 次 AI 提問。
- Gemini 會收到學生最近 12 則對話及目前學習單文字；**不會傳送姓名或畫圖**。如涉及未成年學生，請先依學校政策確認使用外部 AI 的資料告知與同意。
- 目前是單班、每位學生一份學習單的版本；多班多學期須擴充活動 ID、班級範圍與教師授權。繪圖以 data URL 儲存於資料表，適合小班；大量使用建議改為 Supabase Storage。
- 目前 AI 自動追問是**點擊各階段按鈕觸發**，不會在每次輸入時自動呼叫 API，避免意外費用。
- 若 AI 已產生回覆但寫入資料庫失敗，後端會回報錯誤；教師只會看到成功保存的完整回合。

## 驗收清單
- [ ] 學生 A 無法查閱學生 B 的學習單及對話
- [ ] 學生不能進入教師後台
- [ ] 學生無法改寫 profiles.role 或直接寫入 messages
- [ ] AI 主動提問及階段追問都能儲存對話
- [ ] 教師可以檢視並匯出完整紀錄
- [ ] 瀏覽器原始碼和網路請求均無 Gemini Key / service role key

> 這是可部署的原始碼套件；尚未代替您在 Supabase 或 Google AI Studio 建立帳號、填入金鑰或實際上線。
