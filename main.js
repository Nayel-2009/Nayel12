// main.js
// Make sure firebase.js is loaded (type="module") before this.
const ST = window.ST || {};
const fb = ST.firebase;
if(!fb) console.error('firebase.js must be loaded before main.js');

///////////////////
// SOUND FX (WebAudio)
///////////////////
const AudioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq=440, type='sine', dur=0.08, vol=0.03){
  try{
    const o = AudioCtx.createOscillator();
    const g = AudioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g);
    g.connect(AudioCtx.destination);
    o.start();
    setTimeout(()=>{ o.stop(); }, dur*1000);
  } catch(e){ /* ignore on older browsers */ }
}
function playSound(name){
  if(name==='click') playTone(800,'square',0.05,0.03);
  if(name==='success') { playTone(1200,'sine',0.08,0.04); playTone(880,'triangle',0.1,0.02); }
  if(name==='error') playTone(220,'sawtooth',0.12,0.06);
}

///////////////////
// AUTH UI RENDERING
///////////////////
function renderAuthUI(container){
  container.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center">
      <button id="googleSign" class="btn-game">Sign in with Google</button>
      <div style="display:flex;gap:6px;align-items:center">
        <input id="authEmail" placeholder="Email" style="padding:8px;border-radius:8px;" />
        <input id="authPw" placeholder="Password" type="password" style="padding:8px;border-radius:8px;" />
        <button id="emailSignIn" class="btn-game">Sign in</button>
      </div>
      <button id="signOutBtn" style="display:none;" class="btn-game">Sign out</button>
    </div>
  `;
  container.querySelector('#googleSign').addEventListener('click', async ()=>{
    try{ await fb.signInWithGoogle(); playSound('success'); } catch(e){ alert(e.message); playSound('error'); }
  });
  container.querySelector('#emailSignIn').addEventListener('click', async ()=>{
    const email = container.querySelector('#authEmail').value;
    const pw = container.querySelector('#authPw').value;
    try{ await fb.signinWithEmail(email,pw); playSound('success'); } catch(e){ alert(e.message); playSound('error'); }
  });
  container.querySelector('#signOutBtn').addEventListener('click', async ()=>{
    try{ await fb.signOutUser(); playSound('click'); } catch(e){ console.error(e); }
  });
}

function initAuthState(onChange){
  fb.onAuthStateChanged(user=>{
    onChange(user);
  });
}

///////////////////
// FIRESTORE helpers
///////////////////
const { collection, addDoc, query, orderBy, onSnapshot, getDocs, serverTimestamp } = fb;

async function postContactMessage(name,email,message){
  const col = collection(fb.db, 'contactMessages');
  return await addDoc(col, { name, email, message, createdAt: serverTimestamp() });
}

async function postWall(name, message){
  const col = collection(fb.db, 'posts');
  return await addDoc(col, { name, message, createdAt: serverTimestamp() });
}

async function addStory(title, body, authorName){
  const col = collection(fb.db, 'stories');
  return await addDoc(col, { title, body, authorName, createdAt: serverTimestamp() });
}

function subscribeWall(renderFn){
  const col = collection(fb.db, 'posts');
  const q = query(col, orderBy('createdAt','desc'));
  return onSnapshot(q, snap=> renderFn(snap.docs.map(d => ({id:d.id, ...d.data()}))));
}

function subscribeStories(renderFn){
  const col = collection(fb.db, 'stories');
  const q = query(col, orderBy('createdAt','desc'));
  return onSnapshot(q, snap=> renderFn(snap.docs.map(d => ({id:d.id, ...d.data()}))));
}

function subscribeTimeline(renderFn){
  const col = collection(fb.db, 'timeline');
  const q = query(col, orderBy('year','desc'));
  return onSnapshot(q, snap=> renderFn(snap.docs.map(d => ({id:d.id, ...d.data()}))));
}

async function addTimelineEvent(year, text){
  const col = collection(fb.db,'timeline');
  return await addDoc(col, { year, text, createdAt: serverTimestamp() });
}

///////////////////
// QUIZ: render from collection 'quizQuestions'
///////////////////
async function renderQuiz(containerId, opts={shuffle:true, limit:6}){
  const container = document.getElementById(containerId);
  if(!container) return;
  // fetch
  const snap = await getDocs(collection(fb.db, 'quizQuestions'));
  let questions = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  if(questions.length===0){ container.innerHTML = '<div class="card">No quiz questions yet. Sign in as admin to seed sample data.</div>'; return; }
  if(opts.shuffle) questions = questions.sort(()=>Math.random()-0.5);
  if(opts.limit) questions = questions.slice(0, opts.limit);

  const formId = containerId + '-form';
  let html = `<form id="${formId}" class="quiz-box">`;
  questions.forEach((q,i)=>{
    html += `<fieldset class="q-block"><legend>${i+1}. ${escapeHtml(q.question)}</legend>`;
    q.choices.forEach((c,ci)=> html += `<label><input type="radio" name="q${i}" value="${ci}"> ${escapeHtml(c)}</label><br>` );
    html += `</fieldset>`;
  });
  html += `<div style="margin-top:10px"><button type="submit" class="btn-game">Submit Quiz</button></div>`;
  html += `<div id="${containerId}-result" style="margin-top:14px"></div></form>`;
  container.innerHTML = html;

  document.getElementById(formId).onsubmit = async (e)=>{
    e.preventDefault();
    playSound('click');
    const fd = new FormData(e.target);
    let score = 0;
    const details = [];
    questions.forEach((q,i)=>{
      const ans = fd.get('q'+i);
      const correct = String(q.answerIndex);
      const correctBool = ans !== null && String(ans) === correct;
      if(correctBool) score++;
      details.push({ qid:q.id, selected: ans===null ? null : Number(ans), correctIndex: q.answerIndex, correct: correctBool });
    });
    document.getElementById(containerId+'-result').innerHTML = `<div class="card"><strong>Score: ${score}/${questions.length}</strong></div>`;
    playSound('success');
    // Save result
    const user = fb.auth.currentUser;
    await addDoc(collection(fb.db,'quizResults'), { user: user ? { uid:user.uid, name:user.displayName||user.email } : { anon:true }, score, total:questions.length, details, createdAt: serverTimestamp() });
  };
}

///////////////////
// SEED SAMPLE DATA helper (admin only use)
///////////////////
async function seedSampleData(){
  // stories
  const stories = [
    { title:"Fortnite Lobby Rescue", body:"I was getting bullied in voice chat until a player spoke up. They escorted me to a private squad and we became friends.", authorName:"Alex" },
    { title:"Hallway Support", body:"A teacher helped after I told them what was happening. It made school bearable again.", authorName:"Priya" },
    { title:"Art Club Heals", body:"I used art to talk about my feelings and others joined in.", authorName:"Mateo" }
  ];
  for(const s of stories) await addStory(s.title,s.body,s.authorName);

  // timeline
  const t = [{year:2005,text:"Local peer-support groups started."},{year:2016,text:"Online reporting tools launched."},{year:2024,text:"StandUpTogether launched."}];
  for(const e of t) await addTimelineEvent(e.year,e.text);

  // quiz questions (fortnite flavored)
  const quiz = [
    { question:"What do you do if someone abuses voice chat in Fortnite?", choices:["Join in","Report & support the target","Leave without doing anything","Post on social"], answerIndex:1, difficulty:"easy" },
    { question:"A teammate teases another for their skin. Best first step?", choices:["Laugh","Tell them to stop privately","Record and post it","Join the teasing"], answerIndex:1, difficulty:"easy" },
    { question:"If a friend bullies someone due to peer pressure, you should:", choices:["Encourage them","Call them out publicly","Talk to them privately and explain","Ignore it"], answerIndex:2, difficulty:"med" }
  ];
  for(const q of quiz) await addDoc(collection(fb.db,'quizQuestions'), { ...q, createdAt: serverTimestamp() });
  alert('Seed complete');
}

///////////////////
// small helpers
///////////////////
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;'}[c]) ); }

///////////////////
// expose to window
///////////////////
window.ST = window.ST || {};
window.ST.main = { renderAuthUI, initAuthState, postContactMessage, postWall, addStory, subscribeWall, subscribeStories, subscribeTimeline, addTimelineEvent, renderQuiz, seedSampleData, playSound };
