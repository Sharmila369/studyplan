(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORAGE_KEY = "studyflow-v1";
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const shiftDate = (key, amount) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate()+amount); return dateKey(d); };
  const prettyDate = (key, options={month:"short",day:"numeric"}) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, options);
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
  const defaultState = () => ({
    profile: {name:"Student"},
    tasks: [],
    subjects: [
      {id:uid(),name:"Computer Science",color:"#8d7ddd",emoji:"💻",description:"Programming & systems"},
      {id:uid(),name:"Mathematics",color:"#e8ad9d",emoji:"📐",description:"Practice & problem solving"},
      {id:uid(),name:"English",color:"#82c5ac",emoji:"📖",description:"Reading & writing"}
    ],
    schedules: [],
    notes: [],
    goals: [
      {id:uid(),title:"Study for 2 hours",description:"Build a steady daily study routine.",target:120,progress:0,unit:"minutes",emoji:"⏱"},
      {id:uid(),title:"Complete 5 tasks",description:"Turn your plan into progress.",target:5,progress:0,unit:"tasks",emoji:"☑"},
      {id:uid(),title:"Read for 30 minutes",description:"Make room for learning every day.",target:30,progress:0,unit:"minutes",emoji:"📚"},
      {id:uid(),title:"Revise one topic",description:"Strengthen what you've already learned.",target:1,progress:0,unit:"topics",emoji:"✦"}
    ],
    focusLog: [],
    completedDates: [],
    taskHistory: {},
    settings: {}
  });
  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    state = saved && typeof saved === "object" ? {...defaultState(), ...saved} : defaultState();
  } catch { state = defaultState(); }
  let activeFilter = "all", selectedScheduleDate = todayKey(), timerRemaining = 25*60, timerDuration = 25*60, timerMode = "focus", timerInterval = null, timerRunning = false, toastTimer = null;
  const quotes = [
    "You don't have to be perfect. You just have to begin.",
    "Focus on the step in front of you, not the whole staircase.",
    "Small progress is still progress. Keep going.",
    "Your future self will thank you for starting today.",
    "Consistency beats intensity when you keep showing up."
  ];
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { toast("Browser storage is full. Export your data and remove old notes."); } }
  function toast(message) { const el=$("#toast"); el.textContent=message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2600); }
  function escapeAttr(s){return escapeHTML(s);}
  function taskDueLabel(task) {
    if (!task.due) return "No deadline";
    if (task.due === todayKey()) return "Today";
    if (task.due < todayKey()) return `Overdue · ${prettyDate(task.due)}`;
    return prettyDate(task.due);
  }
  function isOverdue(task) { return !task.completed && task.due && task.due < todayKey(); }
  function tasksForToday() { return state.tasks.filter(t => !t.due || t.due === todayKey()); }
  function todayCompleted() { return state.tasks.filter(t=>t.completed && t.completedDate===todayKey()).length; }
  function todayMinutes() { return state.focusLog.filter(s=>s.date===todayKey() && s.mode==="focus").reduce((n,s)=>n+s.minutes,0); }
  function completionRate() { return state.tasks.length ? Math.round(state.tasks.filter(t=>t.completed).length/state.tasks.length*100) : 0; }
  function subjectTaskStats(subjectName) { const related=state.tasks.filter(t=>t.subject===subjectName); return related.length ? Math.round(related.filter(t=>t.completed).length/related.length*100) : 0; }
  function studyStreak() {
    const dates=new Set([...(state.completedDates||[]),...state.focusLog.filter(s=>s.mode==="focus").map(s=>s.date)]);
    let streak=0, cursor=todayKey();
    if (!dates.has(cursor)) cursor=shiftDate(cursor,-1);
    while(dates.has(cursor) && streak<366){streak++;cursor=shiftDate(cursor,-1);}
    return streak;
  }
  function markStudyDay() { if (!state.completedDates.includes(todayKey())) state.completedDates.push(todayKey()); }
  function updateProfile() {
    const name=state.profile.name || "Student";
    $("#profileName").textContent=name; $("#welcomeName").textContent=name; $("#avatarInitials").textContent=name.trim().charAt(0).toUpperCase()||"S"; $("#settingsName").value=name;
    const hour=new Date().getHours(); $("#greetingTime").textContent=hour<12?"morning":hour<17?"afternoon":"evening";
  }
  function updateDate() { $("#todayDate").textContent=new Date().toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}); }
  function renderTaskRow(task, compact=false) {
    const subject=task.subject||"General";
    return `<div class="task-row ${task.completed?"is-complete":""}" data-task-row="${escapeAttr(task.id)}">
      <input class="task-check" type="checkbox" aria-label="Mark ${escapeAttr(task.title)} complete" data-action="toggle-task" data-id="${escapeAttr(task.id)}" ${task.completed?"checked":""}>
      <div class="task-row-main"><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta"><span class="subject-pill">${escapeHTML(subject)}</span><span>${escapeHTML(taskDueLabel(task))}</span><span class="priority ${escapeAttr(task.priority||"Medium")}">● ${escapeHTML(task.priority||"Medium")} priority</span></div></div>
      ${compact?"":`<div class="task-actions"><button class="tiny-action" title="Edit task" aria-label="Edit task" data-action="edit-task" data-id="${escapeAttr(task.id)}">✎</button><button class="tiny-action" title="Delete task" aria-label="Delete task" data-action="delete-task" data-id="${escapeAttr(task.id)}">×</button></div>`}
    </div>`;
  }
  function renderBars(target, values, labels, large=false) {
    const max=Math.max(1,...values);
    target.innerHTML=values.map((value,i)=>`<div class="bar-column"><div class="bar-track"><div class="bar-fill ${labels[i]==="Today"||labels[i]===new Date().toLocaleDateString(undefined,{weekday:"short"})?"today":""}" style="height:${Math.max(value?6:3, value/max*100)}%"></div></div><span class="bar-label">${escapeHTML(labels[i])}</span></div>`).join("");
  }
  function weeklyData() {
    const days=[]; const base=new Date(); base.setHours(12,0,0,0); const offset=(base.getDay()+6)%7; base.setDate(base.getDate()-offset);
    for(let i=0;i<7;i++){const d=new Date(base);d.setDate(base.getDate()+i);const key=dateKey(d);days.push({key,label:d.toLocaleDateString(undefined,{weekday:"short"}),value:state.tasks.filter(t=>t.completed&&t.completedDate===key).length});}
    return days;
  }
  function renderSubjectProgress(target, limit=99) {
    const subjects=state.subjects.slice(0,limit);
    if(!subjects.length){target.innerHTML='<div class="empty-state">No subjects yet. Add one to track your learning.</div>';return;}
    target.innerHTML=subjects.map(s=>{const pct=subjectTaskStats(s.name);return `<div class="subject-progress-row"><span class="subject-name">${escapeHTML(s.emoji||"📘")} &nbsp;${escapeHTML(s.name)}</span><span class="subject-percent">${pct}%</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>`;}).join("");
  }
  function renderDeadlines() {
    const upcoming=state.tasks.filter(t=>!t.completed&&t.due).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,4);
    $("#deadlineList").innerHTML=upcoming.length?upcoming.map(t=>`<div class="deadline-row"><div class="deadline-date"><strong>${escapeHTML(new Date(`${t.due}T12:00:00`).getDate())}</strong><small>${escapeHTML(new Date(`${t.due}T12:00:00`).toLocaleDateString(undefined,{month:"short"}))}</small></div><div class="deadline-copy"><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.subject||"General")} · ${escapeHTML(taskDueLabel(t))}</small></div>${isOverdue(t)?'<span class="deadline-tag">Overdue</span>':""}</div>`).join(""):'<div class="empty-state">No deadlines yet.<strong>Enjoy the breathing room.</strong>Add a task with a due date to see it here.</div>';
  }
  function renderOverview() {
    const todayTasks=tasksForToday(), done=todayCompleted(), progress=todayTasks.length?Math.round(todayTasks.filter(t=>t.completed).length/todayTasks.length*100):0;
    $("#heroPercent").textContent=`${progress}%`; $("#heroRing").style.background=`conic-gradient(#8c7bdc ${progress*3.6}deg,#ffffffa8 ${progress*3.6}deg)`;
    $("#heroProgressText").textContent=progress===100?"Wonderful work — plan complete!":progress?`${todayTasks.filter(t=>t.completed).length} of ${todayTasks.length} tasks done`:"Let's get started today";
    $("#statTasks").innerHTML=`${done} <small>/ ${todayTasks.length}</small>`; $("#taskStatBar").style.width=`${todayTasks.length?Math.min(100,done/todayTasks.length*100):0}%`;
    $("#statFocus").innerHTML=`${todayMinutes()} <small>min</small>`; $("#statStreak").innerHTML=`${studyStreak()} <small>days</small>`;
    $("#statDeadlines").innerHTML=`${state.tasks.filter(t=>!t.completed&&t.due&&t.due>=todayKey()).length} <small>tasks</small>`;
    $("#navTaskCount").textContent=state.tasks.filter(t=>!t.completed).length;
    const todayList=state.tasks.filter(t=>!t.completed&&(!t.due||t.due<=todayKey())).slice(0,4);
    $("#todayTaskList").innerHTML=todayList.length?todayList.map(t=>renderTaskRow(t,true)).join(""):'<div class="empty-state">Your list is clear for now.<strong>Add a task to start your day.</strong></div>';
    const week=weeklyData();$("#weeklyTotal").textContent=week.reduce((a,d)=>a+d.value,0);renderBars($("#weeklyChart"),week.map(d=>d.value),week.map(d=>d.label));
    renderSubjectProgress($("#subjectProgressList"),4);renderDeadlines();
  }
  function renderTasks() {
    const search=$("#taskSearch").value.trim().toLowerCase();
    let tasks=[...state.tasks];
    if(activeFilter==="pending")tasks=tasks.filter(t=>!t.completed&&!isOverdue(t));
    if(activeFilter==="completed")tasks=tasks.filter(t=>t.completed);
    if(activeFilter==="overdue")tasks=tasks.filter(isOverdue);
    if(search)tasks=tasks.filter(t=>`${t.title} ${t.subject} ${t.notes||""}`.toLowerCase().includes(search));
    tasks.sort((a,b)=>(a.completed-b.completed)||(a.due||"9999").localeCompare(b.due||"9999"));
    $("#allTaskList").innerHTML=tasks.length?tasks.map(t=>renderTaskRow(t)).join(""):'<div class="empty-state">Nothing here just yet.<strong>Your next win starts with one task.</strong>Use “Add a task” to build your plan.</div>';
  }
  function renderWeekStrip() {
    const selected=new Date(`${selectedScheduleDate}T12:00:00`), start=new Date(selected);start.setDate(start.getDate()-((start.getDay()+6)%7));
    const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const key=dateKey(d);return {key,d};});
    $("#weekStrip").innerHTML=days.map(({key,d})=>`<button class="day-card ${key===selectedScheduleDate?"selected":""}" data-schedule-date="${key}"><strong>${d.toLocaleDateString(undefined,{weekday:"short"})}</strong><span>${d.getDate()}</span><small>${state.schedules.filter(s=>s.date===key).length} sessions</small></button>`).join("");
    $("#scheduleDayTitle").textContent=selectedScheduleDate===todayKey()?"Today's sessions":`Sessions · ${prettyDate(selectedScheduleDate,{weekday:"long",month:"short",day:"numeric"})}`;
    const rows=state.schedules.filter(s=>s.date===selectedScheduleDate).sort((a,b)=>(a.time||"").localeCompare(b.time||""));
    $("#scheduleList").innerHTML=rows.length?rows.map(s=>`<div class="schedule-row"><div class="schedule-time">${escapeHTML(s.time||"Any time")}</div><div class="schedule-line" style="background:${escapeAttr(s.color||"#b7a7f1")}"></div><div class="schedule-info"><strong>${escapeHTML(s.title)}</strong><small>${escapeHTML(s.duration||30)} minutes · ${escapeHTML(s.notes||"Study session")}</small></div><div class="task-actions"><button class="tiny-action" data-action="edit-schedule" data-id="${escapeAttr(s.id)}" aria-label="Edit session">✎</button><button class="tiny-action" data-action="delete-schedule" data-id="${escapeAttr(s.id)}" aria-label="Delete session">×</button></div></div>`).join(""):'<div class="empty-state">No study sessions planned for this day.<strong>Give your goals a place in your calendar.</strong>Add a session to get started.</div>';
  }
  function renderSubjects() {
    $("#subjectCards").innerHTML=state.subjects.length?state.subjects.map(s=>{const related=state.tasks.filter(t=>t.subject===s.name),pct=subjectTaskStats(s.name);return `<article class="subject-card"><div class="subject-card-top"><span class="subject-emoji">${escapeHTML(s.emoji||"📘")}</span><button class="tiny-action" data-action="edit-subject" data-id="${escapeAttr(s.id)}" aria-label="Edit subject">✎</button></div><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.description||"Your learning journey")}</p><div class="subject-progress-row"><span class="subject-name">Task progress</span><span class="subject-percent">${pct}%</span><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${escapeAttr(s.color||"#8d7ddd")}"></div></div></div><div class="subject-card-foot"><span>${related.filter(t=>t.completed).length} of ${related.length} tasks done</span><button class="tiny-action" data-action="delete-subject" data-id="${escapeAttr(s.id)}" aria-label="Delete subject">Remove</button></div></article>`;}).join(""):'<div class="empty-state">No subjects yet.<strong>Add your first subject.</strong></div>';
  }
  function renderAnalytics() {
    $("#analyticsCompleted").textContent=state.tasks.filter(t=>t.completed).length;$("#analyticsMinutes").innerHTML=`${state.focusLog.reduce((n,s)=>n+s.minutes,0)} <small>min</small>`;$("#analyticsSubjects").textContent=state.subjects.length;$("#analyticsRate").textContent=`${completionRate()}%`;
    const week=weeklyData();renderBars($("#analyticsChart"),week.map(d=>d.value),week.map(d=>d.label),true);renderSubjectProgress($("#analyticsSubjectList"));
  }
  function renderNotes() {
    const q=$("#noteSearch").value.trim().toLowerCase();const notes=[...state.notes].filter(n=>`${n.title} ${n.subject} ${n.body}`.toLowerCase().includes(q)).sort((a,b)=>b.updated.localeCompare(a.updated));
    $("#noteCountLabel").textContent=`${state.notes.length} ${state.notes.length===1?"note":"notes"}`;
    $("#notesGrid").innerHTML=notes.length?notes.map(n=>`<article class="note-card"><div class="note-card-top"><span class="subject-pill">${escapeHTML(n.subject||"General")}</span><div class="note-card-actions"><button class="tiny-action" data-action="edit-note" data-id="${escapeAttr(n.id)}" aria-label="Edit note">✎</button><button class="tiny-action" data-action="delete-note" data-id="${escapeAttr(n.id)}" aria-label="Delete note">×</button></div></div><h3>${escapeHTML(n.title)}</h3><p>${escapeHTML(n.body)}</p><small>Updated ${escapeHTML(prettyDate(n.updated))}</small></article>`).join(""):'<div class="empty-state">Your notebook is ready.<strong>Capture your first idea.</strong>Create a note for a lesson, revision, or useful reminder.</div>';
  }
  function renderGoals() {
    $("#goalsList").innerHTML=state.goals.length?state.goals.map(g=>{const pct=Math.min(100,Math.round(g.progress/g.target*100));return `<article class="goal-card"><div class="goal-card-top"><span class="subject-emoji">${escapeHTML(g.emoji||"🎯")}</span><button class="tiny-action" data-action="delete-goal" data-id="${escapeAttr(g.id)}" aria-label="Delete goal">×</button></div><h3>${escapeHTML(g.title)}</h3><p>${escapeHTML(g.description||"One step at a time.")}</p><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><div class="goal-card-bottom"><span>${escapeHTML(g.progress)} / ${escapeHTML(g.target)} ${escapeHTML(g.unit||"steps")} · ${pct}%</span><div class="goal-progress-controls"><button data-action="goal-minus" data-id="${escapeAttr(g.id)}" aria-label="Decrease progress">−</button><button data-action="goal-plus" data-id="${escapeAttr(g.id)}" aria-label="Increase progress">＋</button></div></div></article>`;}).join(""):'<div class="empty-state">No goals yet.<strong>Choose something you want to work toward.</strong></div>';
  }
  function renderAll() { updateProfile();updateDate();renderOverview();renderTasks();renderWeekStrip();renderSubjects();renderAnalytics();renderNotes();renderGoals();updateTimerUI(); }
  function showView(name) {
    const viewNames=["overview","tasks","schedule","subjects","focus","analytics","notes","goals","settings"];
    if(!viewNames.includes(name))name="overview";
    $$(".view").forEach(v=>v.classList.toggle("active-view",v.id===`view-${name}`));
    $$(".nav-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
    $("#breadcrumbTitle").textContent=({overview:"Overview",tasks:"My Tasks",schedule:"Study Schedule",subjects:"My Subjects",focus:"Focus Timer",analytics:"Analytics",notes:"Notes",goals:"Goals",settings:"Settings"})[name];
    if(name==="schedule")renderWeekStrip();if(name==="focus")updateTimerUI();window.scrollTo({top:0,behavior:"smooth"});
  }
  function field(name,label,type="text",value="",options=null,required=false,full=false,placeholder="") {
    let input="";
    if(options)input=`<select id="field-${name}" name="${name}" ${required?"required":""}>${options.map(o=>`<option value="${escapeAttr(o.value)}" ${String(o.value)===String(value)?"selected":""}>${escapeHTML(o.label)}</option>`).join("")}</select>`;
    else if(type==="textarea")input=`<textarea id="field-${name}" name="${name}" ${required?"required":""} placeholder="${escapeAttr(placeholder)}">${escapeHTML(value)}</textarea>`;
    else input=`<input id="field-${name}" name="${name}" type="${type}" value="${escapeAttr(value)}" ${required?"required":""} ${placeholder?`placeholder="${escapeAttr(placeholder)}"`:""} ${type==="number"?'min="1" max="1440"':""}>`;
    return `<label class="field ${full?"full":""}" for="field-${name}">${label}${input}</label>`;
  }
  let modalKind="", editingId=null;
  function openModal(kind,id=null) {
    modalKind=kind;editingId=id;
    const records={task:state.tasks,schedule:state.schedules,subject:state.subjects,note:state.notes,goal:state.goals};
    const item=id&&records[kind]?records[kind].find(x=>x.id===id):null;
    const subjectOptions=[{value:"",label:"General"},...state.subjects.map(s=>({value:s.name,label:s.name}))];
    let title="",fields="",submit="Save";
    if(kind==="task"){
      title=item?"Edit task":"Add a task";submit=item?"Save changes":"Add task";
      fields=field("title","Task name","text",item?.title||"",null,true,true,"e.g. Revise chapter 3")+field("subject","Subject","text",item?.subject||"",subjectOptions,false)+field("due","Due date","date",item?.due||todayKey())+field("priority","Priority","text",item?.priority||"Medium",[{value:"Low",label:"Low priority"},{value:"Medium",label:"Medium priority"},{value:"High",label:"High priority"}])+field("notes","Notes (optional)","textarea",item?.notes||"",null,false,true,"What do you need to remember?");
    } else if(kind==="schedule"){
      title=item?"Edit study session":"Add study session";submit=item?"Save changes":"Add session";
      fields=field("title","Session title","text",item?.title||"",null,true,true,"e.g. JavaScript practice")+field("date","Date","date",item?.date||selectedScheduleDate,null,true)+field("time","Start time","time",item?.time||"09:00",null,true)+field("duration","Duration (minutes)","number",item?.duration||30,null,true)+field("notes","Notes (optional)","text",item?.notes||"",null,false,true,"Topic or chapter");
    } else if(kind==="subject"){
      title=item?"Edit subject":"Add subject";submit=item?"Save changes":"Add subject";
      fields=field("name","Subject name","text",item?.name||"",null,true,true,"e.g. Data Structures")+field("emoji","Icon / emoji","text",item?.emoji||"📘",null,false,false,"📘")+field("description","Short description","text",item?.description||"",null,false,true,"What are you learning?");
    } else if(kind==="note"){
      title=item?"Edit note":"New study note";submit=item?"Save changes":"Save note";
      fields=field("title","Note title","text",item?.title||"",null,true,true,"e.g. JavaScript array methods")+field("subject","Subject","text",item?.subject||"",subjectOptions,false)+field("body","Your note","textarea",item?.body||"",null,true,true,"Write your notes here...");
    } else if(kind==="goal"){
      title="Add a goal";submit="Create goal";
      fields=field("title","Goal title","text","",null,true,true,"e.g. Practise coding daily")+field("description","Description","text","",null,false,true,"Why does this goal matter?")+field("target","Target number","number",1,null,true)+field("unit","Unit","text","steps",null,true)+field("emoji","Icon / emoji","text","🎯",null,false);
    }
    $("#modalTitle").textContent=title;$("#modalFields").innerHTML=fields;$("#modalSubmit").textContent=submit;$("#modalBackdrop").hidden=false;
    setTimeout(()=>$("#modalFields input, #modalFields textarea, #modalFields select")?.focus(),40);
  }
  function closeModal() { $("#modalBackdrop").hidden=true;$("#modalForm").reset(); }
  function handleModalSubmit(event) {
    event.preventDefault();const data=Object.fromEntries(new FormData(event.currentTarget).entries());let message="Saved successfully.";
    if(modalKind==="task"){
      if(!data.title.trim())return;
      const old=state.tasks.find(t=>t.id===editingId);
      const record={id:editingId||uid(),title:data.title.trim(),subject:data.subject||"General",due:data.due||"",priority:data.priority||"Medium",notes:data.notes||"",completed:old?.completed||false,completedDate:old?.completedDate||""};
      if(old)Object.assign(old,record);else state.tasks.push(record);message=old?"Task updated.":"Task added.";
    } else if(modalKind==="schedule"){
      const record={id:editingId||uid(),title:data.title.trim(),date:data.date,time:data.time,duration:Math.max(1,Math.min(1440,Number(data.duration)||30)),notes:data.notes||"",color:"#a89aeb"};
      const old=state.schedules.find(s=>s.id===editingId);if(old)Object.assign(old,record);else state.schedules.push(record);selectedScheduleDate=record.date;message=old?"Session updated.":"Study session added.";
    } else if(modalKind==="subject"){
      const name=data.name.trim();if(!name)return;
      const old=state.subjects.find(s=>s.id===editingId);
      if(state.subjects.some(s=>s.name.toLowerCase()===name.toLowerCase()&&s.id!==editingId)){toast("That subject already exists.");return;}
      const record={id:editingId||uid(),name,emoji:data.emoji||"📘",description:data.description||"",color:old?.color||"#8d7ddd"};
      if(old){const previous=old.name;Object.assign(old,record);state.tasks.forEach(t=>{if(t.subject===previous)t.subject=name;});state.notes.forEach(n=>{if(n.subject===previous)n.subject=name;});}else state.subjects.push(record);message=old?"Subject updated.":"Subject added.";
    } else if(modalKind==="note"){
      const old=state.notes.find(n=>n.id===editingId);const record={id:editingId||uid(),title:data.title.trim(),subject:data.subject||"General",body:data.body.trim(),updated:todayKey()};
      if(old)Object.assign(old,record);else state.notes.push(record);message=old?"Note updated.":"Note saved.";
    } else if(modalKind==="goal"){
      state.goals.push({id:uid(),title:data.title.trim(),description:data.description||"",target:Math.max(1,Number(data.target)||1),progress:0,unit:data.unit||"steps",emoji:data.emoji||"🎯"});message="Goal created.";
    }
    save();closeModal();renderAll();toast(message);
  }
  function toggleTask(id) {
    const t=state.tasks.find(x=>x.id===id);if(!t)return;t.completed=!t.completed;t.completedDate=t.completed?todayKey():"";if(t.completed)markStudyDay();save();renderAll();toast(t.completed?"Task completed. Great work!":"Task marked as pending.");
  }
  function deleteRecord(collection,id,label) {
    const record=state[collection].find(x=>x.id===id);if(!record)return;
    if(!confirm(`Delete ${label} “${record.title||record.name}”?`))return;
    state[collection]=state[collection].filter(x=>x.id!==id);save();renderAll();toast(`${label.charAt(0).toUpperCase()+label.slice(1)} deleted.`);
  }
  function actionHandler(event) {
    const button=event.target.closest("[data-action]");if(!button)return;
    const {action,id}=button.dataset;
    if(action==="toggle-task")return toggleTask(id);
    if(action==="edit-task")return openModal("task",id);
    if(action==="delete-task")return deleteRecord("tasks",id,"task");
    if(action==="edit-schedule")return openModal("schedule",id);
    if(action==="delete-schedule")return deleteRecord("schedules",id,"session");
    if(action==="edit-subject")return openModal("subject",id);
    if(action==="delete-subject"){
      const subject=state.subjects.find(s=>s.id===id);if(!subject)return;
      if(!confirm(`Remove “${subject.name}”? Tasks and notes using it will become General.`))return;
      state.subjects=state.subjects.filter(s=>s.id!==id);state.tasks.forEach(t=>{if(t.subject===subject.name)t.subject="General";});state.notes.forEach(n=>{if(n.subject===subject.name)n.subject="General";});save();renderAll();toast("Subject removed.");return;
    }
    if(action==="edit-note")return openModal("note",id);
    if(action==="delete-note")return deleteRecord("notes",id,"note");
    if(action==="delete-goal")return deleteRecord("goals",id,"goal");
    if(action==="goal-plus"||action==="goal-minus"){
      const g=state.goals.find(x=>x.id===id);if(!g)return;g.progress=Math.max(0,Math.min(g.target,g.progress+(action==="goal-plus"?1:-1)));save();renderGoals();toast("Goal progress updated.");
    }
  }
  function updateTimerUI() {
    const mins=Math.floor(timerRemaining/60),secs=timerRemaining%60;$("#timerDisplay").textContent=`${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
    $("#timerMode").textContent=timerMode==="focus"?"Focus session":"Break time";
    $("#timerStatus").textContent=timerRunning?"You're in the zone":timerRemaining===0?"Session complete!": "Ready when you are";
    $("#timerStart").textContent=timerRunning?"Ⅱ Pause timer":timerRemaining===0?"↻ Start again":timerRemaining===timerDuration?"▶ Start focus":"▶ Resume";
    const progress=timerDuration?1-timerRemaining/timerDuration:0;$("#timerRing").style.background=`conic-gradient(#8c7bdd ${progress*360}deg,#ded7f9 ${progress*360}deg)`;
    $("#focusTodayTotal").textContent=`${todayMinutes()} min`;$("#focusSessionsTotal").textContent=state.focusLog.filter(s=>s.date===todayKey()&&s.mode==="focus").length;
  }
  function stopTimer(){if(timerInterval)clearInterval(timerInterval);timerInterval=null;timerRunning=false;}
  function finishTimer() {
    stopTimer();
    if(timerMode==="focus"){
      const minutes=Math.round(timerDuration/60);state.focusLog.push({id:uid(),date:todayKey(),minutes,mode:"focus"});markStudyDay();
      state.goals.filter(g=>g.unit.toLowerCase().startsWith("min")).forEach(g=>g.progress=Math.min(g.target,g.progress+minutes));
      save();toast("Focus session complete! Take a well-earned break. ✨");
    } else toast("Break finished. Ready for another round?");
    timerRemaining=0;updateTimerUI();renderOverview();renderAnalytics();
  }
  function setTimer(minutes,mode) {
    stopTimer();timerMode=mode;timerDuration=minutes*60;timerRemaining=timerDuration;
    $$(".preset").forEach(b=>b.classList.toggle("active",Number(b.dataset.minutes)===minutes&&b.dataset.mode===mode));updateTimerUI();
  }
  function startPauseTimer() {
    if(timerRunning){stopTimer();updateTimerUI();return;}
    if(timerRemaining<=0)timerRemaining=timerDuration;
    timerRunning=true;updateTimerUI();
    timerInterval=setInterval(()=>{timerRemaining--;if(timerRemaining<=0)finishTimer();else updateTimerUI();},1000);
  }
  function exportData() {
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`studyflow-backup-${todayKey()}.json`;a.click();URL.revokeObjectURL(url);toast("Your data backup has been exported.");
  }
  function clearAllData() {
    if(!confirm("This will permanently remove all StudyFlow tasks, notes, subjects, schedules, goals, and focus history from this browser. Export a backup first if needed. Continue?"))return;
    stopTimer();state=defaultState();save();renderAll();showView("overview");toast("App data cleared.");
  }
  function bindEvents() {
    $$(".nav-item[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
    $$("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
    $("#quickAdd").addEventListener("click",()=>openModal("task"));$("#taskPageAdd").addEventListener("click",()=>openModal("task"));$("#addTaskInline").addEventListener("click",()=>openModal("task"));
    $("#addScheduleButton").addEventListener("click",()=>openModal("schedule"));$("#addSubjectButton").addEventListener("click",()=>openModal("subject"));$("#addNoteButton").addEventListener("click",()=>openModal("note"));$("#addGoalButton").addEventListener("click",()=>openModal("goal"));
    $("#taskFilters").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;activeFilter=b.dataset.filter;$$(".filter-tab").forEach(x=>x.classList.toggle("selected",x===b));renderTasks();});
    $("#taskSearch").addEventListener("input",renderTasks);$("#noteSearch").addEventListener("input",renderNotes);
    document.addEventListener("click",actionHandler);
    $("#weekStrip").addEventListener("click",e=>{const b=e.target.closest("[data-schedule-date]");if(!b)return;selectedScheduleDate=b.dataset.scheduleDate;renderWeekStrip();});
    $("#closeModal").addEventListener("click",closeModal);$("#cancelModal").addEventListener("click",closeModal);$("#modalBackdrop").addEventListener("click",e=>{if(e.target===$("#modalBackdrop"))closeModal();});document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modalBackdrop").hidden)closeModal();});$("#modalForm").addEventListener("submit",handleModalSubmit);
    $$(".preset").forEach(b=>b.addEventListener("click",()=>setTimer(Number(b.dataset.minutes),b.dataset.mode)));
    $("#timerStart").addEventListener("click",startPauseTimer);$("#timerReset").addEventListener("click",()=>{stopTimer();timerRemaining=timerDuration;updateTimerUI();});
    $("#newQuote").addEventListener("click",()=>{$("#focusQuote").textContent=quotes[Math.floor(Math.random()*quotes.length)];});
    $("#quoteButton").addEventListener("click",()=>{const q=quotes[Math.floor(Math.random()*quotes.length)];$("#motivationText").textContent=q;toast(q);});
    $("#editProfile").addEventListener("click",()=>showView("settings"));
    $("#profileForm").addEventListener("submit",e=>{e.preventDefault();const name=$("#settingsName").value.trim();if(!name){toast("Please enter your name.");return;}state.profile.name=name;save();updateProfile();toast("Profile updated. Welcome!");});
    $("#exportData").addEventListener("click",exportData);$("#clearData").addEventListener("click",clearAllData);
  }
  bindEvents();renderAll();
})();
