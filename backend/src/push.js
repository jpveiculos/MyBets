import webpush from "web-push";
import { pool } from "./db.js";

function configured(){
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}
if(configured()){
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(){
  return process.env.VAPID_PUBLIC_KEY || "";
}

export async function saveAdminSubscription({adminId,subscription}){
  if(!subscription?.endpoint||!subscription?.keys?.p256dh||!subscription?.keys?.auth) throw new Error("Assinatura de push inválida.");
  await pool.query(
    `INSERT INTO admin_push_subscriptions(admin_id,endpoint,p256dh,auth,updated_at)
     VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)
     ON CONFLICT(endpoint) DO UPDATE SET admin_id=EXCLUDED.admin_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=CURRENT_TIMESTAMP`,
    [adminId,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth]
  );
  return {ok:true};
}

export async function removeAdminSubscription({adminId,endpoint}){
  await pool.query("DELETE FROM admin_push_subscriptions WHERE admin_id=$1 AND endpoint=$2",[adminId,endpoint]);
}

export async function sendAdminPush({title,body,url="/admin.html",tag="mybets",unreadCount=null}){
  if(!configured()) return {sent:0,configured:false};
  const r=await pool.query("SELECT id,endpoint,p256dh,auth FROM admin_push_subscriptions");
  let sent=0;
  for(const row of r.rows){
    const subscription={endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}};
    try{
      await webpush.sendNotification(subscription,JSON.stringify({title,body,url,tag,...(Number.isFinite(Number(unreadCount))?{unreadCount:Number(unreadCount)}:{})}));
      sent++;
    }catch(error){
      if(error.statusCode===404||error.statusCode===410){
        await pool.query("DELETE FROM admin_push_subscriptions WHERE id=$1",[row.id]);
      }else{
        console.error("Falha no push administrativo:",error.message);
      }
    }
  }
  return {sent,configured:true};
}