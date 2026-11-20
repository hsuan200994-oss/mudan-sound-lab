import { createClient } from 'npm:@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
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
   const class_name=String(body.class_name||''),seat_number=Number(body.seat_number);
   if(!allowed.includes(class_name)||!Number.isInteger(seat_number)||seat_number<1||seat_number>30)return reply({error:'請選擇有效的班級及座號'},400);
   // 可選課堂通行碼：若設定了 CLASSROOM_CODE，前端須在開始時一併提交。
   const code=Deno.env.get('CLASSROOM_CODE');if(code&&body.classroom_code!==code)return reply({error:'課堂通行碼不正確'},403);
   const since=new Date(Date.now()-86400000).toISOString();
   const {count,error:ce}=await admin.from('student_sessions').select('id',{head:true,count:'exact'}).eq('class_name',class_name).eq('seat_number',seat_number).gte('created_at',since);
   if(ce)throw ce;if((count||0)>=5)return reply({error:'此座號今日建立的作答次數已達上限，請洽老師'},429);
   const raw=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const {data,error}=await admin.from('student_sessions').insert({class_name,seat_number,token_hash:await digest(raw)}).select('id,class_name,seat_number,expires_at').single();
   if(error)throw error;return reply({session:{...data,token:raw}});
  }
  const token=String(body.token||'');if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'作答識別碼無效，請重新開始'},401);
  const {data:session,error:se}=await admin.from('student_sessions').select('id,class_name,seat_number,expires_at').eq('token_hash',await digest(token)).maybeSingle();
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
  if(action==='ask'){
   const question=String(body.question||'').trim(),mode=String(body.mode||'manual').slice(0,50);
   if(!question||question.length>1000)return reply({error:'問題須介於 1 至 1000 字'},400);
   const key=Deno.env.get('GEMINI_API_KEY');if(!key)return reply({error:'尚未設定 Gemini API Key'},503);
   const {count,error:ce}=await admin.from('student_messages').select('id',{count:'exact',head:true}).eq('session_id',session.id).eq('role','user').gte('created_at',new Date(Date.now()-3600000).toISOString());if(ce)throw ce;
   if((count||0)>=20)return reply({error:'每小時最多提問 20 次，請稍後再試'},429);
   const [w,m]=await Promise.all([admin.from('student_worksheets').select('answers').eq('session_id',session.id).maybeSingle(),admin.from('student_messages').select('role,content').eq('session_id',session.id).order('id',{ascending:false}).limit(12)]);
   if(w.error||m.error)throw w.error||m.error;
   const prompt=`你是臺灣國小四年級自然科學「有趣的聲光現象——聲音的產生」探究助教。課程操作直尺、橡皮筋、鈴鐺，慢動作攝影、手按住阻斷測試，最後使用 CER（主張、證據、推理）。用繁體中文，親切簡短，通常 40～100 字；一次只問一個明確可操作的問題。先肯定具體觀察，再引導比較、證據或公平測試，不直接替學生完成假設或 CER。必要時可簡短解釋，但要引導回實驗證據。不得要求姓名或個資。橡皮筋不可對人彈射，直尺不可過度折彎。學生目前的紀錄：${JSON.stringify(w.data?.answers||{}).slice(0,3500)}。`;
   const contents=[...(m.data||[]).reverse().map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.content}]})),{role:'user',parts:[{text:question}]}];
   const model=Deno.env.get('GEMINI_MODEL')||'gemini-2.5-flash';
   const res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({systemInstruction:{parts:[{text:prompt}]},contents,generationConfig:{temperature:0.5,maxOutputTokens:450}})});
   if(!res.ok){console.error('Gemini HTTP',res.status);return reply({error:'Gemini 暫時無法回應，請檢查金鑰、模型或額度'},502)}
   const out=await res.json();const ai=(out.candidates?.[0]?.content?.parts||[]).map((p:{text?:string})=>p.text||'').join('').trim();if(!ai)return reply({error:'AI 沒有產生回覆'},502);
   const {error}=await admin.from('student_messages').insert([{session_id:session.id,role:'user',content:question,mode},{session_id:session.id,role:'assistant',content:ai.slice(0,5000),mode}]);if(error)throw error;
   return reply({reply:ai});
  }
  return reply({error:'不支援的操作'},400);
 }catch(e){console.error(e);return reply({error:'後端處理失敗，請檢查資料庫遷移及函式日誌'},500)}
});

