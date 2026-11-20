import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type,authorization','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const allowed=['三年級','四年級','五年級','六年級'];
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return reply({error:'僅接受 POST'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!service)return reply({error:'伺服器尚未設定 Supabase secrets'},503);
  const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const body=await req.json();const action=String(body.action||'');
  if(action==='start'){
   const group_name=String(body.group_name||'');
   const members=String(body.members||'').trim();
   if(!['第一組','第二組','第三組','第四組'].includes(group_name))return reply({error:'請選擇第一至第四組'},400);
   const lines=members.split(/\n|,|，|、/).map(x=>x.trim()).filter(Boolean);
   if(!lines.length||lines.length>10||members.length>500||lines.some(x=>!/^([一二三四五六]|[1-6])年級\s*0?([1-9]|[12][0-9]|30)號?$/.test(x)))return reply({error:'請逐行填寫組員班級與座號，例如：40102（最多10人）'},400);
   const code=Deno.env.get('CLASSROOM_CODE');if(code&&body.classroom_code!==code)return reply({error:'課堂通行碼不正確'},403);
   const since=new Date(Date.now()-86400000).toISOString();
   const {count,error:ce}=await admin.from('student_sessions').select('id',{head:true,count:'exact'}).eq('group_name',group_name).gte('created_at',since);
   if(ce)throw ce;if((count||0)>=15)return reply({error:'此組今日建立作答次數已達上限，請洽老師'},429);
   const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const {data,error}=await admin.from('student_sessions').insert({class_name:'四年級',seat_number:1,group_name,members,token_hash:await digest(raw)}).select('id,group_name,members,expires_at').single();
   if(error)throw error;return reply({session:{...data,token:raw}});
  }
  if(action==='teacher_delete_session'){
   const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\\s+/i,'');
   if(!jwt)return reply({error:'教師尚未登入'},401);
   const {data:auth,error:ae}=await admin.auth.getUser(jwt);
   if(ae||!auth.user)return reply({error:'教師登入已失效'},401);
   const {data:profile,error:pe}=await admin.from('profiles').select('role').eq('id',auth.user.id).maybeSingle();
   if(pe){console.error('Teacher profile query failed',pe.code,pe.message);return reply({error:'教師角色資料查詢失敗'},500)}
   if(profile?.role!=='teacher')return reply({error:'無教師權限'},403);
   const sessionId=String(body.session_id||'');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId))return reply({error:'作答紀錄 ID 格式錯誤'},400);
   const {data:target,error:te}=await admin.from('student_sessions').select('id').eq('id',sessionId).maybeSingle();
   if(te)throw te;
   if(!target)return reply({error:'作答紀錄不存在或已刪除'},404);
   const {data:videos,error:ve}=await admin.from('student_videos').select('path').eq('session_id',sessionId);
   if(ve)throw ve;
   const {data:uploads,error:ue}=await admin.from('student_video_uploads').select('path').eq('session_id',sessionId);
   if(ue)throw ue;
   const paths=[...new Set([...(videos||[]),...(uploads||[])].map(v=>v.path).filter(Boolean))];
   // 刪除雲端影片後再刪除資料庫紀錄；任何 Storage 錯誤都停止，避免留下未處理的私人檔案。
   for(let i=0;i<paths.length;i+=100){
    const {error:se}=await admin.storage.from('sound-lab-videos').remove(paths.slice(i,i+100));
    if(se){console.error('Teacher delete storage error',se.message);return reply({error:'影片檔案刪除失敗，資料庫紀錄尚未刪除，請重試'},500)}
   }
   const {data:deleted,error:de}=await admin.from('student_sessions').delete().eq('id',sessionId).select('id');
   if(de){console.error('Teacher delete session error',de.code,de.message);return reply({error:'影片已清除，但作答紀錄刪除失敗，請檢查資料庫權限'},500)}
   if(!deleted?.length)return reply({error:'找不到可刪除的作答紀錄'},404);
   return reply({deleted:true,session_id:sessionId,video_files_removed:paths.length});
  }
  if(action==='teacher_video_view'){
   const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
   if(!jwt)return reply({error:'教師尚未登入'},401);
   const {data:auth,error:ae}=await admin.auth.getUser(jwt);
   if(ae||!auth.user)return reply({error:'教師登入已失效'},401);
   const {data:profile,error:pe}=await admin.from('profiles').select('role').eq('id',auth.user.id).maybeSingle();
   if(pe||profile?.role!=='teacher')return reply({error:'無教師權限'},403);
   const {data:v,error:ve}=await admin.from('student_videos').select('path').eq('id',String(body.video_id||'')).maybeSingle();
   if(ve)throw ve;if(!v)return reply({error:'影片不存在'},404);
   const {data,error}=await admin.storage.from('sound-lab-videos').createSignedUrl(v.path,600);
   if(error)throw error;return reply({url:data.signedUrl});
  }
  const token=String(body.token||'');if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'作答識別碼無效，請重新開始'},401);
  const {data:session,error:se}=await admin.from('student_sessions').select('id,class_name,seat_number,group_name,members,expires_at').eq('token_hash',await digest(token)).maybeSingle();
  if(se)throw se;if(!session||new Date(session.expires_at).getTime()<=Date.now())return reply({error:'本次作答已過期，請重新開始'},401);
  if(action==='load'){
   const [w,m]=await Promise.all([admin.from('student_worksheets').select('answers,drawing,updated_at').eq('session_id',session.id).maybeSingle(),admin.from('student_messages').select('role,content,mode,created_at').eq('session_id',session.id).order('id',{ascending:true}).limit(500)]);
   if(w.error)throw w.error;if(m.error)throw m.error;return reply({worksheet:w.data,messages:m.data});
  }
  if(action==='save'){
   const answers=body.answers,drawing=body.drawing;
   if(!answers||typeof answers!=='object'||Array.isArray(answers)||JSON.stringify(answers).length>16000)return reply({error:'學習單內容超過限制'},400);
   if(Object.values(answers).some(v=>typeof v!=='string'||v.length>2000))return reply({error:'答案欄位內容過長'},400);
   if(typeof drawing!=='string'||drawing.length>390000||!drawing.startsWith('data:image/png;base64,'))return reply({error:'繪圖資料不正確或太大'},400);
   const {error}=await admin.from('student_worksheets').upsert({session_id:session.id,answers,drawing,updated_at:new Date().toISOString()},{onConflict:'session_id'});if(error)throw error;return reply({saved:true});
  }
  const bucket='sound-lab-videos';
  if(action==='video_prepare'){
   const size=Number(body.size),filename=String(body.filename||'').slice(0,150),contentType=String(body.content_type||'');
   const ext=filename.toLowerCase().split('.').pop();
   const allowedMime=['video/mp4','video/webm','video/quicktime'];
   if(!['mp4','webm','mov'].includes(ext||'')||!allowedMime.includes(contentType)||!Number.isFinite(size)||size<1||size>50*1024*1024)return reply({error:'僅支援 50MB 以下 MP4、WebM 或 MOV 影片'},400);
   const path=`${session.id}/${crypto.randomUUID()}.${ext}`;
   const {data,error}=await admin.storage.from(bucket).createSignedUploadUrl(path);
   if(error)throw error;
   const {error:ie}=await admin.from('student_video_uploads').insert({session_id:session.id,path,filename,size_bytes:size,content_type:contentType});
   if(ie)throw ie;
   return reply({bucket,path,upload_token:data.token});
  }
  if(action==='video_complete'){
   const path=String(body.path||'');
   const {data:upload,error:ue}=await admin.from('student_video_uploads').select('*').eq('session_id',session.id).eq('path',path).maybeSingle();
   if(ue)throw ue;if(!upload)return reply({error:'找不到本次上傳授權'},404);
   if(upload.completed_at)return reply({saved:true});
   const folder=path.slice(0,path.lastIndexOf('/')),file=path.split('/').pop();
   const {data:objects,error:le}=await admin.storage.from(bucket).list(folder,{limit:100,search:file});
   if(le)throw le;if(!(objects||[]).some(x=>x.name===file))return reply({error:'影片尚未上傳完成'},409);
   const {error:ve}=await admin.from('student_videos').insert({session_id:session.id,path,filename:upload.filename,size_bytes:upload.size_bytes,content_type:upload.content_type});
   if(ve&&ve.code!=='23505')throw ve;
   const {error:fe}=await admin.from('student_video_uploads').update({completed_at:new Date().toISOString()}).eq('path',path).eq('session_id',session.id);
   if(fe)throw fe;
   return reply({saved:true});
  }
  if(action==='video_list'){
   const {data,error}=await admin.from('student_videos').select('id,filename,created_at,size_bytes').eq('session_id',session.id).order('created_at',{ascending:false});
   if(error)throw error;return reply({videos:data});
  }
  if(action==='video_view'){
   const {data:v,error:ve}=await admin.from('student_videos').select('path').eq('id',String(body.video_id||'')).eq('session_id',session.id).maybeSingle();
   if(ve)throw ve;if(!v)return reply({error:'影片不存在'},404);
   const {data,error}=await admin.storage.from(bucket).createSignedUrl(v.path,600);
   if(error)throw error;return reply({url:data.signedUrl});
  }
  if(action==='teacher_video_view'){
   // Teacher requests are verified separately below, before student token validation.
   return reply({error:'請使用教師驗證端點'},400);
  }
  if(action==='ask'){
   const question=String(body.question||'').trim(),mode=String(body.mode||'manual').slice(0,50);
   if(!question||question.length>1000)return reply({error:'問題須介於 1 至 1000 字'},400);
   const key=Deno.env.get('GEMINI_API_KEY');if(!key)return reply({error:'尚未設定 Gemini API Key'},503);
   const {count,error:ce}=await admin.from('student_messages').select('id',{count:'exact',head:true}).eq('session_id',session.id).eq('role','user').gte('created_at',new Date(Date.now()-3600000).toISOString());if(ce)throw ce;
   if((count||0)>=20)return reply({error:'每小時最多提問 20 次，請稍後再試'},429);
   const [w,m]=await Promise.all([admin.from('student_worksheets').select('answers').eq('session_id',session.id).maybeSingle(),admin.from('student_messages').select('role,content').eq('session_id',session.id).order('id',{ascending:false}).limit(12)]);
   if(w.error||m.error)throw w.error||m.error;
   const prompt=`你是臺灣國小四年級自然科學「聲音偵探」小組探究助教。四個階段：1預測聲音如何產生、2小組自選器材並記錄操作、3錄影慢速觀察並用「我看到……」描述、4用「因為我觀察到……所以……」形成證據與結論。用繁體中文、40至80字為目標，一次只提出一個探究問題。先肯定具體觀察，再引導實驗證據，不代寫預測或結論。學生自行決定器材，不要假定使用直尺或橡皮筋。你不能直接觀看影片，只能依學生文字紀錄回應，不得假裝看過影片。不索取姓名或個資，提醒安全操作。學生目前的紀錄：${JSON.stringify(w.data?.answers||{}).slice(0,3500)}。`;
   const contents=[...(m.data||[]).reverse().map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]})),{role:'user',parts:[{text:question}]}];
   const model=Deno.env.get('GEMINI_MODEL')||'gemini-2.5-flash';
   const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({systemInstruction:{parts:[{text:prompt}]},contents,generationConfig:{temperature:0.3,maxOutputTokens:450}})});
   if(!res.ok){console.error('Gemini HTTP',res.status);return reply({error:'Gemini 暫時無法回應，請檢查金鑰、模型或額度'},502)}
   const out=await res.json();const ai=(out.candidates?.[0]?.content?.parts||[]).map((p:{text?:string})=>p.text||'').join('').trim();if(!ai)return reply({error:'AI 沒有產生回覆'},502);
   const {error}=await admin.from('student_messages').insert([{session_id:session.id,role:'user',content:question,mode},{session_id:session.id,role:'assistant',content:ai.slice(0,5000),mode}]);if(error)throw error;
   return reply({reply:ai});
  }
  return reply({error:'不支援的操作'},400);
 }catch(e){console.error(e);return reply({error:'後端處理失敗，請檢查資料庫遷移及函式日誌'},500)}
});
