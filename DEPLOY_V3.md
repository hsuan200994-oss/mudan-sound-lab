# 聲音偵探 V3 部署說明

## 本版功能
- 學生登入：第一至第四組、組員自行填寫「四年級01號」等（每行一位），不填姓名。
- 左側四階段探究，右側 AI 對話；操作文字／畫圖；網頁錄影或影片上傳；0.25×／0.5×／1× 播放。
- 影片使用 Supabase 私人 Storage bucket `sound-lab-videos`，單檔最多 50 MB，支援 MP4／WebM／MOV。教師透過既有帳號查看影片。
- 保留舊的 student_sessions、student_worksheets、student_messages 資料。

## 必須依序部署（缺一不可）
1. **備份** Supabase 資料庫及原 GitHub 專案。
2. 在 Supabase SQL Editor 執行 `supabase/migrations/003_group_video.sql`。若曾手動建立同名 constraint，先檢查避免重複。
3. Supabase Edge Functions → `sound-lab-api`：使用本 ZIP 的 `supabase/functions/sound-lab-api/index.ts` **完整替換並 Deploy**。保留原本 secrets，尤其 `GEMINI_MODEL`（目前能用的值）、`GEMINI_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。**Verify JWT 仍維持關閉**，因為學生以匿名 Session Token 驗證；教師影片查閱由函式內驗證 JWT。
4. GitHub Pages 專案根目錄上傳 `index.html`、`student.js`、`teacher.html`、`teacher.js`、`style.css`（可保留原 `config.js`）。請勿把任何 service_role、Gemini API Key 放進 `config.js`。
5. 強制重新整理網站；學生新版登入會建立新小組 Session。舊的學生紀錄仍留在資料庫，教師後台可查看。

## 驗收
- 以第一組、四年級01號／四年級03號登入，完成四階段並儲存；在教師後台檢查資料。
- 使用 HTTPS 平板開啟鏡頭，錄製 5–10 秒、播放 0.25×、儲存影片，再於教師後台播放。
- 上傳手機／平板相簿中 MP4／MOV，確認私人影片可查看。
- 試 AI 問答，確認學生與 AI 的訊息同時寫入 `student_messages`。

## 注意事項
- 網頁 0.25× 播放不等於 120fps 高影格率錄影。若需真正高幀率，請用裝置相機 App 拍攝後上傳。
- 不同瀏覽器的 MediaRecorder 格式不同；本版支援常見 MP4、WebM、MOV。部分 iPad 可能無法直接錄影，請改用相機 App 拍攝上傳。
- 影片含可能辨識學生的影像，務必取得必要同意並避免拍攝臉部、姓名及其他個資。
- 本版新小組 Session 仍沿用資料庫原本 `class_name`、`seat_number` 的非空欄位，填入相容佔位值；**新版請以 group_name、members 為準**，勿以佔位值判斷真實組員。
- 目前每組每日最多 15 次建立 Session；作答 Session 仍按原資料庫期限到期。已登入教師可查閱所有小組資料，勿將教師帳密分享給學生。
- 若資料庫既有 `student_sessions` 欄位／policy 有其他手動修改，請先在測試專案驗證 migration。
