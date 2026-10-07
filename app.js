window.__appLoaded=!0;
let firebaseConfig={apiKey:"AIzaSyCqHBCbqGSuo4V2FpQ9QICg00QQpO1-P-s",authDomain:"chat-42f66.firebaseapp.com",projectId:"chat-42f66",storageBucket:"chat-42f66.firebasestorage.app",messagingSenderId:"708710541235",appId:"1:708710541235:web:246f6a7ecd2b4f0b3ecdc6"},db=null;

function firebaseConfigFilled(){return!!(firebaseConfig.apiKey&&firebaseConfig.projectId&&firebaseConfig.appId&&firebaseConfig.authDomain)}

async function tryInitFirebase(){try{window.firebase&&firebase.apps&&firebase.apps.length&&await firebase.app().delete()}catch(t){}try{firebase.initializeApp(firebaseConfig),db=firebase.firestore();try{db.settings({cacheSizeBytes:157286400,merge:!0})}catch(t){}if("1"===localStorage.getItem("fsPersistence"))try{db.enablePersistence({synchronizeTabs:!0}).catch(()=>{})}catch(t){}else if(!localStorage.getItem("fsCacheDropped"))try{localStorage.setItem("fsCacheDropped","1"),indexedDB.deleteDatabase("firestore/[DEFAULT]/"+firebaseConfig.projectId+"/main")}catch(t){}return firebase.auth(),{ok:!0}}catch(t){return{ok:!1,error:t&&t.message?t.message:"Не удалось подключиться к Firebase."}}}

function authErrorMessage(t){return{"auth/email-already-in-use":"Пользователь с таким email уже зарегистрирован.","auth/invalid-email":"Некорректный email.","auth/weak-password":"Пароль должен быть не короче 6 символов.","auth/user-not-found":"Пользователь с таким email не найден.","auth/wrong-password":"Неверный пароль.","auth/invalid-credential":"Неверный email или пароль.","auth/too-many-requests":"Слишком много попыток. Попробуйте позже.","auth/user-disabled":"Этот аккаунт отключён.","auth/network-request-failed":"Нет связи с сервером. Проверьте подключение.","auth/requires-recent-login":"Для этого действия нужно заново подтвердить пароль."}[t&&t.code||""]||t&&t.message||"Произошла ошибка."}

const state={currentUser:null,view:"login",activeTab:"chats",chats:[],contacts:[],activeChatId:null,activeChatMeta:null,pendingImages:[],pendingFiles:[],currentMessages:[],knownMsgIds:new Set,msgsInitialLoad:!0,chatSelectMode:!1,selectedChats:new Set,chatSelectAction:"delete",contactSelectMode:!1,selectedContacts:new Set,contactSelectAction:"delete",notifPrefs:{},activeCallState:null,activeCallOtherUid:null,activeCallOtherName:null,callLogs:[],callMinimized:!1,incomingCallDismissed:!1,callLogSelectMode:!1,lastViewedCallsTab:0,lastViewedReactionsTab:0,lastViewedFriendRequestsTab:0,activeFriendsSubtab:"list",selectedCallLogs:new Set,msgSelectMode:!1,selectedMessages:new Set,unsubChats:null,unsubMessages:null,unsubSelf:null,unsubContacts:null,adminTab:"users",unsubAdminUsers:null,unsubAdminChats:null,userProfileCache:{},appConfig:{},contactAliasMap:{},editSocialLinks:[],regSocialLinks:[],pendingLoginUser:null,blacklist:[],retentionMinutes:10080,replyingTo:null,editingMessageId:null,knownReactionsSig:{},reactionFlashUntil:{}};

function toast(t){const e=document.getElementById("toast");e.textContent=t,e.classList.add("show"),clearTimeout(toast._h),toast._h=setTimeout(()=>e.classList.remove("show"),2800)}
function normEmail(t){return(t||"").trim().toLowerCase()}
function normUser(t){return(t||"").trim().toLowerCase()}
function normPhone(t){let e=(t||"").replace(/\D/g,"");return 11===e.length&&"8"===e[0]&&(e="7"+e.slice(1)),e}
function initials(t){return(t||"?").trim().slice(0,2).toUpperCase()}
function escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML.replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
function validEmail(t){return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)}
function validUsername(t){return/^[a-zA-Z0-9_]{3,20}$/.test(t)}

async function sha256hex(t){const e=(new TextEncoder).encode(t),n=await crypto.subtle.digest("SHA-256",e);return Array.from(new Uint8Array(n)).map(t=>t.toString(16).padStart(2,"0")).join("")}
function randomSalt(){const t=new Uint8Array(16);return crypto.getRandomValues(t),Array.from(t).map(t=>t.toString(16).padStart(2,"0")).join("")}
function fmtDate(t){return new Date(t).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})}
function fmtTime(t){const e=new Date(t),n=new Date;return e.toDateString()===n.toDateString()?e.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"}):e.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"})}

async function doRegister(t){
  try{
    const e=normEmail(t.email),n=normUser(t.username);
    if(!validEmail(e))return{error:"Введите корректный email."};
    if(!validUsername(n))return{error:'Ник: 3–20 символов, латиница, цифры, "_".'};
    if(t.password.length<6)return{error:"Пароль должен быть не короче 6 символов."};
    if(t.password!==t.password2)return{error:"Пароли не совпадают."};
    if(!t.firstName||!t.firstName.trim())return{error:"Укажите имя."};
    if(!t.lastName||!t.lastName.trim())return{error:"Укажите фамилию."};
    if(!t.location||!t.location.trim())return{error:"Укажите местоположение."};
    const a=String(t.birthDate||"").trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(a))return{error:"Укажите дату рождения: число, месяц и год."};
    const s=ageFromBirth(a);
    if(isNaN(s)||s<7)return{error:"Проверьте дату рождения."};
    if(s>120)return{error:"Проверьте дату рождения."};
    if(t.phone&&normPhone(t.phone).length>=6)try{if((await db.collection("phones").doc(await phoneKey(t.phone)).get()).exists)return{error:"Этот номер телефона уже указан в другом аккаунте."}}catch(t){}
    try{const n=await banFor(e,t.phone);if(n)return{error:"Регистрация запрещена администратором."+(n.reason?" Причина: "+n.reason:"")}}catch(t){}
    if((await db.collection("usernames").doc(n).get()).exists)return{error:"Такой ник уже занят."};
    if((await db.collection("emails").doc(e).get()).exists)return{error:"Пользователь с таким email уже зарегистрирован."};
    let i;try{i=await firebase.auth().createUserWithEmailAndPassword(e,t.password)}catch(t){return{error:authErrorMessage(t)}}
    const o=i.user.uid,r=randomSalt(),c=await sha256hex(r+":0000"),l={uid:o,email:e,username:n,createdAt:Date.now(),isAdmin:!1,blocked:!1,firstName:t.firstName.trim(),lastName:t.lastName.trim(),age:s,birthDate:a,birthMD:a.slice(5),isMinor:s<18,location:t.location.trim(),phone:t.phone||"",socialLinks:t.socialLinks||[],emailVisible:!1,showOnline:!0,discoverable:!0,pinHash:c,pinSalt:r,pinEnabled:!1};
    try{if(await db.collection("users").doc(o).set(l),await db.collection("usernames").doc(n).set({uid:o}),await db.collection("emails").doc(e).set({uid:o}),t.phone&&normPhone(t.phone).length>=6)try{await db.collection("phones").doc(await phoneKey(t.phone)).set({uid:o})}catch(t){}}catch(t){return{error:"Аккаунт создан, но профиль не сохранён: "+t.message}}
    return{ok:!0,user:{uid:o,email:e,username:n,isAdmin:!1}}
  }catch(t){return{error:"Ошибка сервера: "+(t&&t.message?t.message:String(t))}}
}

async function doLogin(t,e){
  try{
    let n;t=normEmail(t);
    try{n=await firebase.auth().signInWithEmailAndPassword(t,e)}catch(t){return{error:authErrorMessage(t)}}
    const a=n.user.uid,s=await db.collection("users").doc(a).get();
    if(!s.exists){
      let t="";
      try{const e=await db.collection("deletedUsers").doc(a).get();if(e.exists){const n=e.data();t="Аккаунт удалён администратором"+(n.ban?" без возможности восстановления":"")+"."+(n.reason?"\nПричина: "+n.reason:"")}}catch(t){}
      return await firebase.auth().signOut(),t?(setTimeout(()=>{try{showAccountNotice("Аккаунт удалён",t)}catch(t){}},50),{error:t}):{error:"Профиль не найден. Возможно, аккаунт был удалён администратором."}
    }
    const i=s.data(),o=!!i.pinHash&&!1!==i.pinEnabled;
    return{ok:!0,user:{uid:a,email:i.email,username:i.username,isAdmin:!!i.isAdmin},needsPin:o}
  }catch(t){return{error:"Ошибка сервера: "+(t&&t.message?t.message:String(t))}}
}

async function verifyPin(t,e){
  try{
    const n=await db.collection("users").doc(t).get();
    if(!n.exists)return{ok:!1};
    const a=n.data();
    if(!a.pinHash||!1===a.pinEnabled)return{ok:!0,matched:"none"};
    if(await sha256hex(a.pinSalt+":"+e)===a.pinHash)return{ok:!0,matched:"normal"};
    if(a.duressPinHash&&!1!==a.duressPinEnabled){if(await sha256hex(a.duressPinSalt+":"+e)===a.duressPinHash)return{ok:!0,matched:"duress"}}
    return{ok:!1}
  }catch(t){return{ok:!1}}
}

async function wipeOwnAccountAndData(t){
  try{const e=await db.collection("chats").where("participants","array-contains",t).get();for(const t of e.docs)await deleteChatCompletely(t.id)}catch(t){}
  let e=null,n=null;
  try{const a=await db.collection("users").doc(t).get();a.exists&&(e=a.data().username,n=a.data().email)}catch(t){}
  try{await db.collection("contacts").doc(t).delete()}catch(t){}
  try{await db.collection("users").doc(t).delete()}catch(t){}
  if(e)try{await db.collection("usernames").doc(e).delete()}catch(t){}
  if(n)try{await db.collection("emails").doc(n).delete()}catch(t){}
  try{firebase.auth().currentUser&&await firebase.auth().currentUser.delete()}catch(t){}
}

async function doSendReset(t){if(!validEmail(t=normEmail(t)))return{error:"Введите корректный email."};try{await firebase.auth().sendPasswordResetEmail(t)}catch(t){}return{ok:!0}}

async function findUsers(t){
  try{
    const e=t.trim();if(!e)return{error:"Введите email, ник, имя, фамилию или телефон."};
    const n=state.currentUser.uid;
    if(e.includes("@")){
      const t=await db.collection("emails").doc(normEmail(e)).get();
      if(!t.exists)return{error:"Пользователь не найден."};
      const a=await db.collection("users").doc(t.data().uid).get();
      if(!a.exists)return{error:"Пользователь не найден."};
      const s=a.data();
      return!1===s.discoverable&&s.uid!==n?{error:"Пользователь не найден."}:{ok:!0,users:[s]}
    }
    const a=new Map;
    try{const t=await db.collection("usernames").doc(normUser(e)).get();if(t.exists){const e=await db.collection("users").doc(t.data().uid).get();if(e.exists){const t=e.data();!1===t.discoverable&&t.uid!==n||a.set(t.uid,t)}}}catch(t){}
    try{
      const t=e.toLowerCase(),s=normPhone(e),i=null!=window.__myMinor?window.__myMinor:isMinorProfile(state.userProfileCache[n]||{});
      (await db.collection("users").where("isMinor","==",i).get()).docs.forEach(e=>{
        const i=e.data();if(!1===i.discoverable&&i.uid!==n)return;
        const o=i.firstName&&i.firstName.toLowerCase().includes(t)||i.lastName&&i.lastName.toLowerCase().includes(t),r=s.length>=5&&i.phone&&normPhone(i.phone).includes(s);
        (o||r)&&a.set(i.uid,i)
      })
    }catch(t){}
    const s=Array.from(a.values());
    return s.length?{ok:!0,users:s.slice(0,20)}:{error:"Пользователь не найден."}
  }catch(t){return{error:"Ошибка сервера: "+(t&&t.message?t.message:String(t))}}
}

function chatIdFor(t,e){return[t,e].sort().join("__")}

// Обновленная функция отправки пуш-уведомлений через базу и сервер Railway
async function pushNotification(t, e, n) {
  if (t && t !== state.currentUser.uid) {
    try {
      await db.collection("notifications").add({
        toUid: t,
        type: e,
        data: n || {},
        timestamp: Date.now(),
        read: false
      });

      const userDoc = await db.collection("users").doc(t).get();
      if (userDoc.exists && userDoc.data().fcmToken) {
        const recipientToken = userDoc.data().fcmToken;
        const info = notifTypeInfo({ type: e, data: n || {} });

        await fetch('https://chat-backend-production-ee1e.up.railway.app/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: recipientToken,
            title: 'Новое сообщение в Chat',
            body: info.text || 'У вас новое уведомление'
          })
        });
      }
    } catch (err) {
      console.error("pushNotification failed for type=" + e, err);
    }
  }
}

// Функция регистрации FCM-токена устройства
async function registerPushToken(force) {
  try {
    if (!('Notification' in window) || !firebase.messaging.isSupported()) return { ok: false, error: "Not supported" };
    const messaging = firebase.messaging();
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const vapidKey = state.appConfig && state.appConfig.vapidKey;
      const token = await messaging.getToken(vapidKey ? { vapidKey } : undefined);
      if (token && state.currentUser) {
        await db.collection("users").doc(state.currentUser.uid).update({ fcmToken: token });
        return { ok: true, token };
      }
    }
    return { ok: false, error: "Разрешение на уведомления не получено" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getMyFriendUids(){
  const t=state.currentUser.uid;
  try{
    const[e,n]=await Promise.all([db.collection("friendRequests").where("fromUid","==",t).get(),db.collection("friendRequests").where("toUid","==",t).get()]),a=new Set;
    return e.docs.forEach(t=>{const e=t.data();"accepted"===e.status&&a.add(e.toUid)}),n.docs.forEach(t=>{const e=t.data();"accepted"===e.status&&a.add(e.fromUid)}),Array.from(a)
  }catch(t){return[]}
}

async function notifyFriendsOfProfileChange(t,e){
  const n=await MyFriendUids();if(!n.length)return;
  const a=await myDisplayName();
  n.forEach(n=>pushNotification(n,t,Object.assign({fromUid:state.currentUser.uid,fromName:a},e||{})))
}

let notifListenerUnsub=null,allNotifications=[],notifFirstSnapshot=!0;
function startNotificationsListener(){
  notifListenerUnsub&&notifListenerUnsub(),notifFirstSnapshot=!0,
  notifListenerUnsub=db.collection("notifications").where("toUid","==",state.currentUser.uid).orderBy("timestamp","desc").onSnapshot(t=>{
    const e=notifFirstSnapshot;notifFirstSnapshot=!1;let n=!1;
    e||t.docChanges().forEach(t=>{"added"===t.type&&(n=!0)}),
    allNotifications=t.docs.map(t=>Object.assign({id:t.id},t.data())),
    updateNotifBadge(),"none"!==document.getElementById("notif-panel-overlay").style.display&&renderNotifPanel(),
    n&&!1!==state.notifPrefs.notificationSoundEnabled&&!1!==state.notifPrefs.bellSoundEnabled&&playNotificationSound(state.notifPrefs.notificationMelody,state.notifPrefs.notificationVolume)
  },t=>{console.error("notifications listener failed",t)})
}

function updateNotifBadge(){
  const t=document.getElementById("notif-bell-badge"),e=allNotifications.filter(t=>!t.read).length;
  e>0?(t.textContent=e>99?"99+":String(e),t.style.display="flex"):t.style.display="none"
}

function notifTypeInfo(t){
  const e=escapeHtml(t.data&&t.data.fromName||"Пользователь");
  return{friend_request:{icon:"👤",text:`${e} хочет добавить вас в друзья`},friend_accepted:{icon:"✅",text:`${e} принял(а) вашу заявку в друзья`},profile_like:{icon:"❤️",text:`${e} отметил(а) симпатию к вашему профилю`},photo_like:{icon:"📸",text:`${e} поставил(а) лайк вашему фото`},community_invite:{icon:"👥",text:`${e} пригласил(а) вас в сообщество «${escapeHtml(t.data&&t.data.communityName||"")}»`},missed_call:{icon:"📞",text:`Пропущенный ${t.data&&"video"===t.data.callType?"видео":"аудио"}звонок от ${e}`},friend_photo_change:{icon:"🖼️",text:`${e} обновил(а) фото профиля`},friend_status_change:{icon:"💬",text:`${e} изменил(а) статус: «${escapeHtml(t.data&&t.data.statusText||"")}»`},mutual_like:{icon:"💞",text:`Взаимная симпатия с ${e}!`}}[t.type]||{icon:"🔔",text:"Новое уведомление"}
}

function loginSuccess(t){
  state.currentUser=t;
  document.getElementById("auth-screen").style.display="none";
  document.getElementById("app-screen").style.display="block";
  document.getElementById("notif-bell-btn").style.display="flex";
  
  // Автоматическая регистрация пуш-токена устройства при входе
  registerPushToken();

  switchTab("chats");
  renderProfile();
  renderSettings();
  listenMyChats();
  listenContacts();
  listenSelf();
  startHeartbeat();
  listenForIncomingCalls();
  listenCallLogs();
  listenIncomingLikes();
  listenIncomingFriendRequests();
  listenIncomingPhotoLikes();
  listenIncomingCommunityInvites();
  startNotificationsListener();
  db.collection("config").doc("app").get().then(t=>{state.appConfig=t.exists?t.data():{},renderProfile()}).catch(()=>{});
}
