# 聲音偵探｜班級座號免帳號版（GitHub Pages + Supabase + Gemini）

## 重要：這是新版，不是只修改登入畫面
學生輸入班級、座號即可開始，預設示範「四年級 01 號」。不需建立學生 Authentication 帳號；**教師仍以原有 Supabase Auth 帳號登入**。每次新建作答由後端產生不可猜測的 256-bit token，資料以 token 的 SHA-256 雜湊識別。學生只經過 Edge Function 讀寫自己的紀錄；資料表不對匿名使用者開放。教師後台可查詢所有作答、CER、繪圖及 AI 對話，並下載 CSV/JSON。

**限制**：班級座號不是身分認證。任何人若知道公開網址，都可能輸入相同座號另開一份紀錄（但不能取得其他作答的 token）。同一座號可出現多份作答，後台以建立時間區分。作答 token 儲存在瀏覽器 localStorage；清除瀏覽器資料或換裝置就無法取回原有作答。共用平板請於每位學生結束後按「結束本次作答」，清除本機 token。若需要防冒用、跨裝置續答，建議增設教師核發的個別 PIN 或一次性 QR 碼。請勿將此版視為可驗證真實學生身分的系統。

## 1. Supabase 資料庫遷移（必要）
您已執行 `supabase/migrations/001_schema.sql`，已有 `profiles`、`worksheets`、`messages`。**請勿刪除舊資料表，也不要重新執行 001**。在 SQL Editor 執行 `supabase/migrations/002_anonymous_seat.sql`，新增：
- `student_sessions`：班級、座號、token_hash、有效期限
- `student_worksheets`：每次作答的答案及繪圖
- `student_messages`：Gemini 完整對話

新表全部啟用 RLS，只有已登入且 `profiles.role='teacher'` 的教師可直接查詢。**原教師帳號及 teacher 角色保留不變**。新學生不需要建立 `profiles`。

## 2. Gemini API Key
前往 https://aistudio.google.com/api-keys 建立 Gemini API Key。切勿貼到 GitHub 或前端程式碼。進入 Supabase Dashboard → Edge Functions → Secrets，新增 `GEMINI_API_KEY`。可選 `GEMINI_MODEL=gemini-2.5-flash`，模型須為您帳號可用的型號。

## 3. 部署新的 Edge Function
使用 Supabase CLI：
```
supabase login
supabase link --project-ref 您的PROJECT_REF
supabase functions deploy sound-lab-api --no-verify-jwt
```
或在 Supabase Dashboard → Edge Functions 建立 `sound-lab-api`，將 `supabase/functions/sound-lab-api/index.ts` 全部貼入，並在函式設定中**關閉 Verify JWT**（因為學生不登入）。這個函式仍自行驗證 256-bit 作答 token。`SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY` 通常由 Supabase 提供為函式環境變數；若無則依 Supabase 文件安全設定，**絕不放入 GitHub**。

可選：在 Secrets 設定 `CLASSROOM_CODE` 可阻擋未持有課堂通行碼的人建立新作答；若啟用，需另外在學生端加入輸入欄位並於 `start` 提交 `classroom_code`，否則無法開始。預設不啟用。

## 4. GitHub Pages 前端
修改 `config.js` 的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`（填 Supabase 公開 publishable/anon key，**不是** secret/service_role key）。將新版 `index.html`、`student.js`、`teacher.html`、`teacher.js`、`style.css`、`config.js` 上傳覆蓋 GitHub Repository 根目錄同名檔案。SQL 和 Edge Function 原始碼可留在 repository 中，但金鑰不可上傳。

學生網址：https://hsuan200994-oss.github.io/mudan-sound-lab/
教師網址：https://hsuan200994-oss.github.io/mudan-sound-lab/teacher.html

## 5. 驗收
1. 開學生網址，選四年級 01 號，填寫假設，按「儲存學習單」，重整後仍能看到答案。
2. 點選某階段「請 AI 追問」，再在下方主動輸入問題，確認兩種都收到 Gemini 回覆。
3. 教師用原帳號登入 `teacher.html`，按重新整理，確認看到「四年級 01 號」、答案及完整對話；試下載 CSV、JSON。
4. 用另一個無痕視窗選同座號，應**無法讀取前一份作答**，但可以另開新作答；教師後台會看到兩份不同建立時間的紀錄。
5. 確認 `student_sessions`、`student_worksheets`、`student_messages` 的 RLS 已啟用；匿名客戶端不可直接讀取資料。

## 隱私及安全提醒
- 前端公開的是 Supabase URL 與 publishable key，**Gemini API Key 和 service role key 僅在 Edge Function**。
- AI 會接收學習單文字與最近 12 則對話，不會刻意傳送班級座號或畫圖；請勿讓學生輸入真實姓名或其他個資。
- 每次作答每小時最多 20 次 AI 提問；同班級座號 24 小時內最多新建 5 份作答。此為基本節流，不是防 DDoS 或防刷帳單的完整方案，正式公開前應監控用量並設置平台額度。
- 作答 token 有效 14 天；過期後不能繼續讀寫。此版沒有跨裝置找回功能。
- 教師匯出的 JSON/CSV 可能包含學生作答，應保存在受控位置，避免公開分享。
- **此套件尚未實際連接您的 Supabase 或 Gemini API 測試**；必須依上述步驟完成部署及驗收後才可供學生正式使用。
