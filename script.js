(function(){
"use strict";

/* ============================================================
   0. STORAGE KEYS & DEFAULTS
   ============================================================ */
const LS_SETTINGS = "otr_settings_v1";
const LS_ENTRIES  = "otr_entries_v1";
const LS_META     = "otr_meta_v1";

const DEFAULT_SETTINGS = {
  orgName: "",
  empName: "",
  stdStart: "08:30",
  stdEnd: "16:15",
  graceEnd: "09:00",
  otBlock: 15,
  otBlockOptions: [15],
  currency: "LKR",
  weekdayRate: 0,
  weekendRate: 0,
  wfhRate: 0,
  monthlySalary: 0,
  otMultiplier: 1.5,
  otLimitHours: 0,
  wfhDailyCapHours: 4
};

const now = new Date();
let STATE = {
  settings: loadJSON(LS_SETTINGS, DEFAULT_SETTINGS),
  entries: loadJSON(LS_ENTRIES, {}),
  meta: loadJSON(LS_META, { lang: "en", theme: "light", lastSaved: null, periodMode: "month", periodStart: null, periodEnd: null }),
  viewYear: now.getFullYear(),
  viewMonth: now.getMonth(),
  openDate: null
};

function loadJSON(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return JSON.parse(JSON.stringify(fallback));
    const parsed = JSON.parse(raw);
    return Object.assign(JSON.parse(JSON.stringify(fallback)), parsed);
  }catch(e){ return JSON.parse(JSON.stringify(fallback)); }
}

let saveTimer = null;
function persist(){
  const dot = document.getElementById("saveIndicator");
  dot.classList.add("saving");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(STATE.settings));
    localStorage.setItem(LS_ENTRIES, JSON.stringify(STATE.entries));
    STATE.meta.lastSaved = Date.now();
    localStorage.setItem(LS_META, JSON.stringify(STATE.meta));
    dot.classList.remove("saving");
    updateSaveIndicator();
  }, 350);
}

function updateSaveIndicator(){
  const el = document.getElementById("saveText");
  if(!STATE.meta.lastSaved){ el.textContent = t("savedJustNow"); return; }
  const diff = Date.now() - STATE.meta.lastSaved;
  if(diff < 8000){ el.textContent = t("savedJustNow"); return; }
  const d = new Date(STATE.meta.lastSaved);
  const time = d.toLocaleTimeString(undefined, {hour:"2-digit", minute:"2-digit"});
  el.textContent = t("savedAt").replace("{time}", time);
}
setInterval(updateSaveIndicator, 15000);

/* ============================================================
   1. i18n
   ============================================================ */
function t(key){
  const dict = I18N[STATE.meta.lang] || I18N.en;
  return dict[key] || I18N.en[key] || key;
}

function applyI18n(){
  const lang = STATE.meta.lang;
  document.documentElement.lang = lang;
  document.body.setAttribute("data-lang", lang);
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
  document.getElementById("langSelect").value = lang;
  updateSaveIndicator();
  renderMonthLabel();
  renderCalendar();
  renderSummary();
}

/* ============================================================
   2. TIME UTILITIES
   ============================================================ */
function toMinutes(hhmm){
  if(!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if(!m) return null;
  const h = parseInt(m[1],10), mi = parseInt(m[2],10);
  if(h>23||mi>59) return null;
  return h*60+mi;
}
function fromMinutes(min){
  min = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(min/60), m = min%60;
  return {h,m};
}
function pad2(n){ return n<10 ? "0"+n : ""+n; }
function to24(h,m){ return pad2(h)+":"+pad2(m); }

// Parse loose user input into 24h "HH:MM" or null
function parseLooseTime(str){
  if(!str) return null;
  str = str.trim().toUpperCase().replace(/\s+/g,' ');
  if(str === "") return null;
  let ampm = null;
  if(/AM$/.test(str)){ ampm="AM"; str=str.replace(/AM$/,'').trim(); }
  else if(/PM$/.test(str)){ ampm="PM"; str=str.replace(/PM$/,'').trim(); }
  let h,m;
  if(str.includes(":")){
    const parts = str.split(":");
    h = parseInt(parts[0],10); m = parseInt(parts[1],10);
  } else if(/^\d{3,4}$/.test(str)){
    if(str.length===3){ h=parseInt(str.slice(0,1),10); m=parseInt(str.slice(1),10); }
    else { h=parseInt(str.slice(0,2),10); m=parseInt(str.slice(2),10); }
  } else if(/^\d{1,2}$/.test(str)){
    h = parseInt(str,10); m = 0;
  } else {
    return null;
  }
  if(isNaN(h)||isNaN(m)||m>59) return null;
  if(ampm){
    if(h<1||h>12) return null;
    if(ampm==="AM"){ h = (h===12)?0:h; }
    else { h = (h===12)?12:h+12; }
  } else {
    if(h>23) return null;
  }
  return to24(h,m);
}

function formatDisplay12(hhmm, forceEnglish){
  const min = toMinutes(hhmm);
  if(min===null) return "";
  let {h,m} = fromMinutes(min);
  const ap = forceEnglish ? (h<12 ? "AM" : "PM") : (h<12 ? t("am") : t("pm"));
  let h12 = h%12; if(h12===0) h12=12;
  return h12+":"+pad2(m)+" "+ap;
}

function formatDuration(totalMinutes){
  const h = Math.floor(totalMinutes/60), m = totalMinutes%60;
  return h+"h "+pad2(m)+"m";
}

/* ============================================================
   3. OT CALCULATION ENGINE
   ============================================================ */
function isWeekendDate(dateStr){
  const d = new Date(dateStr+"T00:00:00");
  const day = d.getDay();
  return day===0 || day===6;
}
function getEffectiveType(dateStr, entry){
  if(entry && entry.dayType && entry.dayType !== "auto") return entry.dayType;
  return isWeekendDate(dateStr) ? "weekend" : "weekday";
}

const OT_MIN_ELIGIBLE_MINUTES = 60; // government rule: the first full hour must be completed before any OT is granted

function applyOtBlockRule(rawMinutes, blockSize){
  if(rawMinutes < OT_MIN_ELIGIBLE_MINUTES) return 0;
  // Beyond the mandatory first hour, credit is worked out one 60-minute tier at a
  // time — each tier's leftover only counts once it reaches at least two full
  // blocks, so a lone leftover block (e.g. a single 15 minutes) is dropped whether
  // it falls right after the first hour or after any later hour.
  const fullHours = Math.floor(rawMinutes / 60) * 60;
  const remainder = rawMinutes % 60;
  const remainderCredit = remainder >= blockSize * 2 ? Math.floor(remainder / blockSize) * blockSize : 0;
  return fullHours + remainderCredit;
}

// WFH/online sessions don't need to wait for a first full hour like office hours do,
// but within every 60-minute tier, a lone leftover block on its own still isn't
// credited — at least two full blocks are needed before that tier's extra counts.
function applyWfhBlockRule(rawMinutes, blockSize){
  const fullHours = Math.floor(rawMinutes / 60) * 60;
  const remainder = rawMinutes % 60;
  const remainderCredit = remainder >= blockSize * 2 ? Math.floor(remainder / blockSize) * blockSize : 0;
  return fullHours + remainderCredit;
}

function calcWeekdaySession(entry, settings){
  const inM = toMinutes(entry.timeIn1), outM = toMinutes(entry.timeOut1);
  if(inM===null || outM===null) return {otMinutes:0, otStartMin:null, hasData:false};
  const stdStart = toMinutes(settings.stdStart);
  const stdEnd = toMinutes(settings.stdEnd);
  const lateOffset = Math.max(0, inM - stdStart);
  const otStartMin = stdEnd + lateOffset;
  let raw = outM - otStartMin;
  if(raw < 0) raw = 0;
  const otMinutes = applyOtBlockRule(raw, settings.otBlock);
  return {otMinutes, otStartMin, hasData:true, rawMinutes: raw};
}
function calcWeekendSession(entry, settings){
  const inM = toMinutes(entry.timeIn1), outM = toMinutes(entry.timeOut1);
  if(inM===null || outM===null) return {otMinutes:0, hasData:false};
  let raw = outM - inM;
  if(raw < 0) raw = 0;
  const otMinutes = applyOtBlockRule(raw, settings.otBlock);
  return {otMinutes, hasData:true, rawMinutes: raw};
}
function migrateEntry(entry){
  entry = entry || {};
  if(!Array.isArray(entry.wfhSessions)){
    entry.wfhSessions = [];
    if(entry.timeIn2 || entry.timeOut2){
      entry.wfhSessions.push({timeIn: entry.timeIn2 || null, timeOut: entry.timeOut2 || null});
    }
  }
  delete entry.timeIn2; delete entry.timeOut2;
  return entry;
}
// Government rule: WFH/online OT is capped per day, combined across every WFH
// session entered for that day. Configurable in Settings (default 4h, 0 =
// no cap). This does not apply to the office session (which can also fall on
// a Saturday/Sunday with no such ceiling).
const WFH_DAILY_OT_CAP_MINUTES_DEFAULT = 240;

function calcWfhSessions(entry, settings){
  const list = Array.isArray(entry.wfhSessions) ? entry.wfhSessions : [];
  const capHours = (settings.wfhDailyCapHours === undefined || settings.wfhDailyCapHours === null)
    ? (WFH_DAILY_OT_CAP_MINUTES_DEFAULT/60) : settings.wfhDailyCapHours;
  const capMinutes = capHours > 0 ? Math.round(capHours*60) : Infinity;
  let totalOt = 0;
  const details = [];
  list.forEach(s => {
    const inM = toMinutes(s.timeIn), outM = toMinutes(s.timeOut);
    if(inM===null || outM===null){ details.push({timeIn:s.timeIn, timeOut:s.timeOut, otMinutes:0, rawMinutes:0, hasData:false}); return; }
    let raw = outM - inM;
    if(raw < 0) raw += 1440;
    let otMinutes = applyWfhBlockRule(raw, settings.otBlock);
    const remaining = capMinutes - totalOt;
    if(remaining <= 0) otMinutes = 0;
    else if(otMinutes > remaining) otMinutes = remaining;
    totalOt += otMinutes;
    details.push({timeIn:s.timeIn, timeOut:s.timeOut, otMinutes, rawMinutes: raw, hasData:true});
  });
  return {otMinutes: totalOt, hasData: details.some(d=>d.hasData), sessions: details};
}
function calcDay(dateStr, entry, settings){
  entry = migrateEntry(entry);
  const type = getEffectiveType(dateStr, entry);
  const session1 = (type==="weekend")
    ? calcWeekendSession(entry, settings)
    : calcWeekdaySession(entry, settings);
  const session2 = calcWfhSessions(entry, settings);
  const totalMinutes = session1.otMinutes + session2.otMinutes;
  const rate1 = type==="weekend" ? settings.weekendRate : settings.weekdayRate;
  const rate2 = settings.wfhRate;
  const pay = (session1.otMinutes/60)*rate1 + (session2.otMinutes/60)*rate2;
  return {type, session1, session2, totalMinutes, pay};
}

/* ============================================================
   4. TIME INPUT COMPONENT (typeable + clock picker)
   ============================================================ */
let activeTimeTarget = null;
let clockState = {h:8, m:0, ampm:"AM", mode:"hour"};

function mountTimeInput(container, opts){
  // opts: {value, onChange}
  container.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "time-typed";
  input.placeholder = "--:-- --";
  input.value = opts.value ? formatDisplay12(opts.value) : "";
  input.autocomplete = "off";
  input.inputMode = "text";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "time-clock-trigger";
  btn.setAttribute("aria-label","Open time picker");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  container.appendChild(input);
  container.appendChild(btn);
  container._value = opts.value || null;
  container._onChange = opts.onChange;

  function commit(){
    const raw = input.value;
    if(raw.trim()===""){
      container._value = null;
      input.classList.remove("invalid");
      opts.onChange(null);
      return;
    }
    const parsed = parseLooseTime(raw);
    if(parsed===null){
      input.classList.add("invalid");
    } else {
      input.classList.remove("invalid");
      container._value = parsed;
      input.value = formatDisplay12(parsed);
      opts.onChange(parsed);
    }
  }
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", e => { if(e.key==="Enter"){ input.blur(); } });

  btn.addEventListener("click", () => openClockPopover(container, btn));

  container._setValue = (val) => {
    container._value = val;
    input.value = val ? formatDisplay12(val) : "";
    input.classList.remove("invalid");
  };
  return container;
}

/* ---- Clock popover (singleton) ---- */
let popoverEl = null;
function ensurePopover(){
  if(popoverEl) return popoverEl;
  popoverEl = document.createElement("div");
  popoverEl.className = "clock-popover";
  popoverEl.innerHTML = `
    <div class="clock-mode-tabs">
      <button type="button" data-mode="hour" class="active" data-i18n="hour">Hour</button>
      <button type="button" data-mode="minute" data-i18n="minute">Minute</button>
    </div>
    <div class="clock-popover-head">
      <span class="clock-time-display">
        <span id="cpHourDisplay">08</span><span>:</span><input type="text" inputmode="numeric" maxlength="2" id="cpMinuteInput" class="cp-minute-input" value="00">
      </span>
      <div class="clock-ampm-toggle">
        <button type="button" data-ap="AM" class="active">AM</button>
        <button type="button" data-ap="PM">PM</button>
      </div>
    </div>
    <div class="clock-face" id="cpFace">
      <div class="clock-center"></div>
      <div class="clock-hand" id="cpHand"></div>
    </div>
    <div class="clock-actions">
      <button type="button" class="btn btn-ghost" id="cpCancel">Cancel</button>
      <button type="button" class="btn btn-primary" id="cpConfirm" data-i18n="confirmTime">Confirm</button>
    </div>
  `;
  document.body.appendChild(popoverEl);

  popoverEl.querySelectorAll(".clock-mode-tabs button").forEach(b=>{
    b.addEventListener("click", ()=>{ clockState.mode=b.dataset.mode; renderClockFace(); syncModeTabs(); });
  });
  popoverEl.querySelectorAll(".clock-ampm-toggle button").forEach(b=>{
    b.addEventListener("click", ()=>{ clockState.ampm=b.dataset.ap; syncAmPm(); updateClockDisplay(); });
  });
  popoverEl.querySelector("#cpCancel").addEventListener("click", closeClockPopover);

  const minuteInput = popoverEl.querySelector("#cpMinuteInput");
  minuteInput.addEventListener("focus", () => {
    clockState.mode="minute"; renderClockFace(); syncModeTabs();
    minuteInput.select();
  });
  minuteInput.addEventListener("input", () => {
    const digits = minuteInput.value.replace(/[^0-9]/g,"").slice(0,2);
    minuteInput.value = digits;
    let v = parseInt(digits, 10);
    if(isNaN(v)) v = 0;
    v = Math.max(0, Math.min(59, v));
    clockState.m = v;
    renderClockFace();
    positionHand();
  });
  minuteInput.addEventListener("blur", () => {
    minuteInput.value = pad2(clockState.m);
  });

  popoverEl.querySelector("#cpConfirm").addEventListener("click", () => {
    let h24 = clockState.h % 12;
    if(clockState.ampm==="PM") h24 += 12;
    if(clockState.h===12 && clockState.ampm==="AM") h24 = 0;
    if(clockState.h===12 && clockState.ampm==="PM") h24 = 12;
    const val = to24(h24, clockState.m);
    if(activeTimeTarget){
      activeTimeTarget._setValue(val);
      activeTimeTarget._value = val;
      activeTimeTarget._onChange(val);
    }
    closeClockPopover();
  });
  document.addEventListener("mousedown", (e) => {
    if(popoverEl.classList.contains("open") && !popoverEl.contains(e.target) && !e.target.closest(".time-clock-trigger")){
      closeClockPopover();
    }
  });

  attachFaceDrag();
  return popoverEl;
}
function syncModeTabs(){
  popoverEl.querySelectorAll(".clock-mode-tabs button").forEach(b=>{
    b.classList.toggle("active", b.dataset.mode===clockState.mode);
  });
}
function syncAmPm(){
  popoverEl.querySelectorAll(".clock-ampm-toggle button").forEach(b=>{
    b.classList.toggle("active", b.dataset.ap===clockState.ampm);
  });
}
function updateClockDisplay(){
  popoverEl.querySelector("#cpHourDisplay").textContent = pad2(clockState.h);
  const minuteInput = popoverEl.querySelector("#cpMinuteInput");
  if(document.activeElement !== minuteInput){
    minuteInput.value = pad2(clockState.m);
  }
}
function renderClockFace(){
  const face = popoverEl.querySelector("#cpFace");
  face.querySelectorAll(".clock-num, .clock-tick").forEach(n=>n.remove());
  const R = 92, CX=110, CY=110;
  const items = clockState.mode==="hour"
    ? Array.from({length:12}, (_,i)=> i===0?12:i)
    : Array.from({length:12}, (_,i)=> i*5);
  items.forEach((val, idx) => {
    const angle = (idx*30 - 90) * Math.PI/180;
    const x = CX + R*Math.cos(angle), y = CY + R*Math.sin(angle);
    const el = document.createElement("div");
    el.className = "clock-num";
    el.style.left = x+"px"; el.style.top = y+"px";
    el.textContent = clockState.mode==="hour" ? val : pad2(val);
    const isSelected = clockState.mode==="hour" ? (clockState.h===val || (clockState.h===0&&val===12)) : (clockState.m===val);
    if(isSelected) el.classList.add("selected");
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if(clockState.mode==="hour"){ clockState.h = val; clockState.mode="minute"; syncModeTabs(); }
      else { clockState.m = val; }
      updateClockDisplay();
      renderClockFace();
      positionHand();
    });
    face.appendChild(el);
  });

  // Fine 1-minute tick marks between the labelled 5-minute numbers, so the dial
  // reads as continuous rather than only jumping in steps of 5.
  if(clockState.mode==="minute"){
    for(let mm=0; mm<60; mm++){
      if(mm % 5 === 0) continue;
      const angle = (mm*6 - 90) * Math.PI/180;
      const x = CX + R*Math.cos(angle), y = CY + R*Math.sin(angle);
      const dot = document.createElement("div");
      dot.className = "clock-tick" + (clockState.m===mm ? " selected" : "");
      dot.style.left = x+"px"; dot.style.top = y+"px";
      face.appendChild(dot);
    }
  }

  positionHand();
}
function positionHand(){
  const hand = popoverEl.querySelector("#cpHand");
  const angleDeg = clockState.mode==="hour" ? (clockState.h % 12)*30 : clockState.m*6;
  hand.style.height = "76px";
  hand.style.transform = `rotate(${angleDeg}deg)`;
  hand.style.marginLeft = "-1.5px";
  hand.style.top = "34px";
}
function faceAngleFromEvent(face, clientX, clientY){
  const rect = face.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const dx = clientX-cx, dy = clientY-cy;
  let deg = Math.atan2(dy, dx) * 180/Math.PI + 90;
  if(deg < 0) deg += 360;
  return deg;
}
function applyFaceAngle(deg){
  if(clockState.mode==="minute"){
    clockState.m = Math.round(deg/6) % 60;
  } else {
    let hour = Math.round(deg/30) % 12;
    if(hour===0) hour = 12;
    clockState.h = hour;
  }
  updateClockDisplay();
  renderClockFace();
}
let faceDragging = false;
function attachFaceDrag(){
  const face = popoverEl.querySelector("#cpFace");
  face.addEventListener("pointerdown", (e) => {
    faceDragging = true;
    try{ face.setPointerCapture(e.pointerId); }catch(err){}
    applyFaceAngle(faceAngleFromEvent(face, e.clientX, e.clientY));
  });
  face.addEventListener("pointermove", (e) => {
    if(!faceDragging) return;
    applyFaceAngle(faceAngleFromEvent(face, e.clientX, e.clientY));
  });
  const endDrag = () => {
    if(!faceDragging) return;
    faceDragging = false;
    if(clockState.mode==="hour"){ clockState.mode="minute"; syncModeTabs(); renderClockFace(); }
  };
  face.addEventListener("pointerup", endDrag);
  face.addEventListener("pointercancel", endDrag);
}
function openClockPopover(container, anchorBtn){
  activeTimeTarget = container;
  const cur = container._value;
  if(cur){
    const min = toMinutes(cur);
    const {h,m} = fromMinutes(min);
    let h12 = h%12; if(h12===0) h12=12;
    clockState = {h:h12, m: m, ampm: h<12?"AM":"PM", mode:"hour"};
  } else {
    clockState = {h:8, m:0, ampm:"AM", mode:"hour"};
  }
  const pop = ensurePopover();
  applyI18nToPopover();
  syncModeTabs(); syncAmPm(); updateClockDisplay(); renderClockFace();
  pop.classList.add("open");
  const rect = anchorBtn.getBoundingClientRect();
  const popW = 272;
  let left = rect.left - popW + rect.width + window.scrollX;
  let top = rect.bottom + 8 + window.scrollY;
  if(left < 8) left = 8;
  if(left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if(top + 380 > window.innerHeight + window.scrollY) top = rect.top - 380 + window.scrollY;
  pop.style.left = left+"px";
  pop.style.top = top+"px";
}
function applyI18nToPopover(){
  if(!popoverEl) return;
  popoverEl.querySelectorAll("[data-i18n]").forEach(el=>{
    el.textContent = t(el.getAttribute("data-i18n"));
  });
}
function closeClockPopover(){
  if(popoverEl) popoverEl.classList.remove("open");
  activeTimeTarget = null;
}

/* ============================================================
   5. CALENDAR RENDERING
   ============================================================ */
function dateStrOf(y,m,d){ return y+"-"+pad2(m+1)+"-"+pad2(d); }

function getActivePeriodRange(){
  if(STATE.meta.periodMode === "custom" && STATE.meta.periodStart && STATE.meta.periodEnd
     && STATE.meta.periodStart <= STATE.meta.periodEnd){
    return { start: STATE.meta.periodStart, end: STATE.meta.periodEnd };
  }
  const y = STATE.viewYear, m = STATE.viewMonth;
  return { start: dateStrOf(y,m,1), end: dateStrOf(y,m, new Date(y,m+1,0).getDate()) };
}
function iteratePeriodDates(){
  const { start, end } = getActivePeriodRange();
  const dates = [];
  let d = new Date(start+"T00:00:00");
  const endD = new Date(end+"T00:00:00");
  let guard = 0;
  while(d <= endD && guard < 730){
    dates.push(dateStrOf(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setDate(d.getDate()+1);
    guard++;
  }
  return dates;
}
function renderPeriodLabel(){
  const label = document.getElementById("periodLabel");
  if(STATE.meta.periodMode !== "custom"){ label.textContent = ""; return; }
  const { start, end } = getActivePeriodRange();
  const dictEn = I18N.en;
  const fmt = (str) => {
    const d = new Date(str+"T00:00:00");
    return d.getDate()+" "+dictEn.months[d.getMonth()].slice(0,3)+" "+d.getFullYear();
  };
  label.textContent = `${t("reportingPeriod")}: ${fmt(start)} \u2013 ${fmt(end)}`;
}

function renderMonthLabel(){
  const dict = I18N[STATE.meta.lang]||I18N.en;
  document.getElementById("monthLabel").textContent = dict.months[STATE.viewMonth] + " " + STATE.viewYear;
}

function renderCalendar(){
  const weekdaysEl = document.getElementById("calendarWeekdays");
  const dict = I18N[STATE.meta.lang]||I18N.en;
  const weekOrder = [1,2,3,4,5,6,0]; // Monday first, Sunday last (right side)
  weekdaysEl.innerHTML = weekOrder.map(i => `<span class="${i===0?'sun-label':''}">${dict.weekdaysShort[i]}</span>`).join("");

  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  const y = STATE.viewYear, m = STATE.viewMonth;
  const firstDay = new Date(y,m,1).getDay(); // 0=Sun...6=Sat
  const leadingBlanks = (firstDay + 6) % 7; // convert to Monday-first offset
  const daysInMonth = new Date(y,m+1,0).getDate();
  const todayStr = dateStrOf(now.getFullYear(), now.getMonth(), now.getDate());

  for(let i=0;i<leadingBlanks;i++){
    const blank = document.createElement("div");
    blank.className = "day-cell empty";
    grid.appendChild(blank);
  }
  for(let d=1; d<=daysInMonth; d++){
    const dateStr = dateStrOf(y,m,d);
    const entry = STATE.entries[dateStr];
    const calc = calcDay(dateStr, entry, STATE.settings);
    const dow = new Date(y,m,d).getDay();
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "day-cell";
    if(calc.type==="weekend") cell.classList.add("is-weekend");
    if(dow===0) cell.classList.add("is-sunday");
    if(dateStr===todayStr) cell.classList.add("is-today");
    if(entry && entry.note) cell.classList.add("has-note");

    const blocksCount = Math.min(12, Math.round(calc.totalMinutes / STATE.settings.otBlock));
    let blocksHtml = "";
    for(let b=0;b<blocksCount;b++){
      const cls = calc.type==="weekend" ? "wknd" : (b >= Math.round(calc.session1.otMinutes/STATE.settings.otBlock) ? "wfh" : "");
      blocksHtml += `<span class="day-block ${cls}"></span>`;
    }

    let timesHtml = "";
    if(entry && entry.timeIn1 && entry.timeOut1){
      timesHtml = formatDisplay12(entry.timeIn1)+" – "+formatDisplay12(entry.timeOut1);
    }

    cell.innerHTML = `
      <span class="day-num">${d}</span>
      <span class="day-blocks">${blocksHtml}</span>
      <span class="day-times">${timesHtml}</span>
      <span class="day-ot-label">${calc.totalMinutes>0 ? formatDuration(calc.totalMinutes) : "—"}</span>
    `;
    cell.addEventListener("click", () => openDayModal(dateStr));
    grid.appendChild(cell);
  }
}

function renderSummary(){
  const dates = iteratePeriodDates();
  let weekdayMin=0, weekendMin=0, wfhMin=0, pay=0;
  dates.forEach(dateStr => {
    const entry = STATE.entries[dateStr];
    if(!entry) return;
    const calc = calcDay(dateStr, entry, STATE.settings);
    if(calc.type==="weekend") weekendMin += calc.session1.otMinutes;
    else weekdayMin += calc.session1.otMinutes;
    wfhMin += calc.session2.otMinutes;
    pay += calc.pay;
  });
  const totalMin = weekdayMin+weekendMin+wfhMin;
  document.getElementById("sumTotalHours").textContent = formatDuration(totalMin);
  document.getElementById("sumWeekdayHours").textContent = formatDuration(weekdayMin);
  document.getElementById("sumWeekendHours").textContent = formatDuration(weekendMin);
  document.getElementById("sumWfhHours").textContent = formatDuration(wfhMin);
  document.getElementById("sumPay").textContent = STATE.settings.currency+" "+pay.toFixed(2);
  renderPeriodLabel();
}

/* ============================================================
   6. DAY MODAL
   ============================================================ */
let day1In, day1Out;

function openDayModal(dateStr){
  STATE.openDate = dateStr;
  const existing = STATE.entries[dateStr];
  const entry = migrateEntry(Object.assign({dayType:"auto"}, existing ? JSON.parse(JSON.stringify(existing)) : {}));
  const d = new Date(dateStr+"T00:00:00");
  const dict = I18N[STATE.meta.lang]||I18N.en;
  const monthName = dict.months[d.getMonth()];
  document.getElementById("dayModalDate").textContent = `${monthName} ${d.getDate()}, ${d.getFullYear()}`;

  const effType = getEffectiveType(dateStr, entry);

  // Auto-fill office "time in" with the standard start time on weekdays when empty,
  // so the user only needs to change it if that particular day was different.
  if(!entry.timeIn1 && effType === "weekday"){
    entry.timeIn1 = STATE.settings.stdStart;
  }

  document.querySelectorAll("#dayTypeSegment .seg-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.val === (entry.dayType||"auto"));
  });
  document.getElementById("daytypeCurrentLabel").textContent =
    entry.dayType==="weekend" ? t("weekendHoliday") : entry.dayType==="weekday" ? t("weekday") : t("auto");
  document.getElementById("dayTypeSegment").hidden = true;

  day1In = mountTimeInput(document.querySelector('[data-target="timeIn1"]'), {
    value: entry.timeIn1, onChange: v => { entry.timeIn1=v; refreshDayCalc(dateStr, entry); }
  });
  day1Out = mountTimeInput(document.querySelector('[data-target="timeOut1"]'), {
    value: entry.timeOut1, onChange: v => { entry.timeOut1=v; refreshDayCalc(dateStr, entry); }
  });

  document.getElementById("dayNote").value = entry.note || "";

  document.getElementById("dayModalOverlay")._entry = entry;
  document.getElementById("dayModalOverlay")._date = dateStr;

  renderWfhSessions(dateStr, entry);
  refreshDayCalc(dateStr, entry);
  document.getElementById("dayModalOverlay").classList.add("open");
}

function renderWfhSessions(dateStr, entry){
  const list = document.getElementById("wfhSessionsList");
  list.innerHTML = "";
  entry.wfhSessions.forEach((session, idx) => {
    const row = document.createElement("div");
    row.className = "wfh-session-row";
    row.innerHTML = `
      <div class="time-fields">
        <div class="time-field-wrap">
          <label>${t("timeIn")}</label>
          <div class="time-input-group" data-role="in"></div>
        </div>
        <div class="time-field-wrap">
          <label>${t("timeOut")}</label>
          <div class="time-input-group" data-role="out"></div>
        </div>
      </div>
      <div class="wfh-row-foot">
        <span class="session-result" data-role="result"></span>
        <button type="button" class="link-btn link-danger" data-role="remove">${t("removeSession")}</button>
      </div>
    `;
    mountTimeInput(row.querySelector('[data-role="in"]'), {
      value: session.timeIn, onChange: v => { entry.wfhSessions[idx].timeIn = v; refreshDayCalc(dateStr, entry); }
    });
    mountTimeInput(row.querySelector('[data-role="out"]'), {
      value: session.timeOut, onChange: v => { entry.wfhSessions[idx].timeOut = v; refreshDayCalc(dateStr, entry); }
    });
    row.querySelector('[data-role="remove"]').addEventListener("click", () => {
      entry.wfhSessions.splice(idx, 1);
      renderWfhSessions(dateStr, entry);
      refreshDayCalc(dateStr, entry);
    });
    list.appendChild(row);
  });
}

function refreshDayCalc(dateStr, entry){
  const effType = getEffectiveType(dateStr, entry);
  document.getElementById("dayTypePill").textContent = effType==="weekend" ? t("weekendShort") : t("weekdayShort");
  const calc = calcDay(dateStr, entry, STATE.settings);
  const s1 = calc.session1;
  const label1 = document.getElementById("session1Result");
  if(s1.hasData){
    if(effType==="weekend"){
      label1.textContent = `${t("otShort")}: ${formatDuration(s1.otMinutes)}`;
    } else {
      const otStart = s1.otStartMin!=null ? formatDisplay12(to24(fromMinutes(s1.otStartMin).h, fromMinutes(s1.otStartMin).m)) : "";
      label1.textContent = `${t("otShort")}: ${formatDuration(s1.otMinutes)}  (from ${otStart})`;
    }
  } else {
    label1.textContent = "";
  }

  const rows = document.querySelectorAll("#wfhSessionsList .wfh-session-row");
  calc.session2.sessions.forEach((s, idx) => {
    const resultEl = rows[idx] && rows[idx].querySelector('[data-role="result"]');
    if(resultEl) resultEl.textContent = s.hasData ? `${t("otShort")}: ${formatDuration(s.otMinutes)}` : "";
  });

  document.getElementById("dayTotalValue").textContent = formatDuration(calc.totalMinutes);
}

document.addEventListener("DOMContentLoaded", () => {

  document.querySelectorAll("#dayTypeSegment .seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#dayTypeSegment .seg-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const entry = document.getElementById("dayModalOverlay")._entry;
      entry.dayType = btn.dataset.val;
      document.getElementById("daytypeCurrentLabel").textContent =
        btn.dataset.val==="weekend" ? t("weekendHoliday") : btn.dataset.val==="weekday" ? t("weekday") : t("auto");
      refreshDayCalc(document.getElementById("dayModalOverlay")._date, entry);
    });
  });

  document.getElementById("addWfhSessionBtn").addEventListener("click", () => {
    const overlay = document.getElementById("dayModalOverlay");
    const entry = overlay._entry, dateStr = overlay._date;
    entry.wfhSessions.push({timeIn:null, timeOut:null});
    renderWfhSessions(dateStr, entry);
    refreshDayCalc(dateStr, entry);
  });

  document.getElementById("daytypeOverrideTrigger").addEventListener("click", () => {
    const seg = document.getElementById("dayTypeSegment");
    seg.hidden = !seg.hidden;
  });

  document.getElementById("saveDayBtn").addEventListener("click", () => {
    const dateStr = document.getElementById("dayModalOverlay")._date;
    const entry = document.getElementById("dayModalOverlay")._entry;
    entry.note = document.getElementById("dayNote").value.trim();
    const hasWfh = entry.wfhSessions.some(s => s.timeIn || s.timeOut);
    const hasAny = entry.timeIn1||entry.timeOut1||hasWfh||entry.note||(entry.dayType&&entry.dayType!=="auto");
    entry.wfhSessions = entry.wfhSessions.filter(s => s.timeIn || s.timeOut);
    if(hasAny){ STATE.entries[dateStr] = entry; } else { delete STATE.entries[dateStr]; }
    persist();
    renderCalendar();
    renderSummary();
    closeDayModal();
    showToast(t("toastSaved"));
  });

  document.getElementById("clearDayBtn").addEventListener("click", () => {
    const dateStr = document.getElementById("dayModalOverlay")._date;
    delete STATE.entries[dateStr];
    persist();
    renderCalendar();
    renderSummary();
    closeDayModal();
    showToast(t("toastCleared"));
  });

  document.getElementById("dayModalClose").addEventListener("click", closeDayModal);
  document.getElementById("dayModalOverlay").addEventListener("mousedown", (e) => {
    if(e.target.id === "dayModalOverlay") closeDayModal();
  });

  initSettingsModal();
  initTopBar();
  initExports();
  applyI18n();
  renderMonthLabel();
  renderCalendar();
  renderSummary();
  updateSaveIndicator();
});

function closeDayModal(){
  document.getElementById("dayModalOverlay").classList.remove("open");
  closeClockPopover();
}

function showToast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>el.classList.remove("show"), 2600);
}

/* ============================================================
   7. TOP BAR: month nav, theme, language
   ============================================================ */
function initTopBar(){
  document.getElementById("prevMonth").addEventListener("click", () => {
    STATE.viewMonth--; if(STATE.viewMonth<0){ STATE.viewMonth=11; STATE.viewYear--; }
    renderMonthLabel(); renderCalendar(); renderSummary();
  });
  document.getElementById("nextMonth").addEventListener("click", () => {
    STATE.viewMonth++; if(STATE.viewMonth>11){ STATE.viewMonth=0; STATE.viewYear++; }
    renderMonthLabel(); renderCalendar(); renderSummary();
  });
  document.getElementById("todayBtn").addEventListener("click", () => {
    STATE.viewYear = now.getFullYear(); STATE.viewMonth = now.getMonth();
    renderMonthLabel(); renderCalendar(); renderSummary();
  });

  const themeToggle = document.getElementById("themeToggle");
  document.documentElement.setAttribute("data-theme", STATE.meta.theme);
  themeToggle.addEventListener("click", () => {
    STATE.meta.theme = STATE.meta.theme==="light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", STATE.meta.theme);
    localStorage.setItem(LS_META, JSON.stringify(STATE.meta));
  });

  document.getElementById("langSelect").addEventListener("change", (e) => {
    STATE.meta.lang = e.target.value;
    localStorage.setItem(LS_META, JSON.stringify(STATE.meta));
    applyI18n();
  });

  // Reporting period: calendar month (default) or a custom date range
  const startInput = document.getElementById("periodStartInput");
  const endInput = document.getElementById("periodEndInput");
  document.querySelectorAll("#periodModeSegment .seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#periodModeSegment .seg-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      STATE.meta.periodMode = btn.dataset.mode;
      document.getElementById("periodRangeInputs").hidden = btn.dataset.mode !== "custom";
      if(btn.dataset.mode === "custom" && !STATE.meta.periodStart){
        const r = getActivePeriodRange();
        STATE.meta.periodStart = r.start; STATE.meta.periodEnd = r.end;
        startInput.value = r.start; endInput.value = r.end;
      }
      localStorage.setItem(LS_META, JSON.stringify(STATE.meta));
      renderSummary();
    });
  });
  if(STATE.meta.periodMode === "custom"){
    document.querySelectorAll("#periodModeSegment .seg-btn").forEach(b=>{
      b.classList.toggle("active", b.dataset.mode==="custom");
    });
    document.getElementById("periodRangeInputs").hidden = false;
  }
  if(STATE.meta.periodStart) startInput.value = STATE.meta.periodStart;
  if(STATE.meta.periodEnd) endInput.value = STATE.meta.periodEnd;
  startInput.addEventListener("change", () => {
    STATE.meta.periodStart = startInput.value || null;
    localStorage.setItem(LS_META, JSON.stringify(STATE.meta));
    renderSummary();
  });
  endInput.addEventListener("change", () => {
    STATE.meta.periodEnd = endInput.value || null;
    localStorage.setItem(LS_META, JSON.stringify(STATE.meta));
    renderSummary();
  });

  // Quick-fill: populate every empty weekday in the visible month with standard hours,
  // so only the exceptional days need to be opened and edited.
  document.getElementById("quickFillBtn").addEventListener("click", () => {
    const y = STATE.viewYear, m = STATE.viewMonth;
    const daysInMonth = new Date(y,m+1,0).getDate();
    const msg = t("quickFillConfirm")
      .replace("{start}", formatDisplay12(STATE.settings.stdStart))
      .replace("{end}", formatDisplay12(STATE.settings.stdEnd));
    if(!confirm(msg)) return;
    let count = 0;
    for(let d=1; d<=daysInMonth; d++){
      const dateStr = dateStrOf(y,m,d);
      if(STATE.entries[dateStr]) continue;
      if(isWeekendDate(dateStr)) continue;
      STATE.entries[dateStr] = { dayType:"auto", timeIn1: STATE.settings.stdStart, timeOut1: STATE.settings.stdEnd, wfhSessions: [] };
      count++;
    }
    persist();
    renderCalendar();
    renderSummary();
    showToast(count+" "+t("quickFillDone"));
  });
}

/* ============================================================
   8. SETTINGS MODAL
   ============================================================ */
let setStdStart, setStdEnd, setGraceEnd;
function initSettingsModal(){
  document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
  document.getElementById("settingsClose").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsOverlay").addEventListener("mousedown", (e) => {
    if(e.target.id === "settingsOverlay") closeSettingsModal();
  });

  // More than one block size can be enabled for this institution (e.g. 15 and 30 together).
  // At least one must always stay checked.
  document.querySelectorAll('#setOtBlockGroup input').forEach(cb => {
    cb.addEventListener("change", () => {
      const anyChecked = Array.from(document.querySelectorAll('#setOtBlockGroup input')).some(c => c.checked);
      if(!anyChecked) cb.checked = true;
    });
  });

  // Salary → OT rate helper: rate = monthly salary / 240 * multiplier.
  // Purely a calculator — it never touches the rate fields until "→ Weekday/Weekend/WFH" is clicked.
  const salaryInput = document.getElementById("setMonthlySalary");
  const multiplierSelect = document.getElementById("setOtMultiplier");
  const multiplierCustom = document.getElementById("setOtMultiplierCustom");
  multiplierSelect.addEventListener("change", () => {
    multiplierCustom.hidden = multiplierSelect.value !== "custom";
    if(multiplierSelect.value === "custom") multiplierCustom.focus();
    updateSalaryCalcResult();
  });
  salaryInput.addEventListener("input", updateSalaryCalcResult);
  multiplierCustom.addEventListener("input", updateSalaryCalcResult);
  document.getElementById("setCurrency").addEventListener("input", updateSalaryCalcResult);

  document.getElementById("applyRateWeekday").addEventListener("click", () => {
    document.getElementById("setWeekdayRate").value = computeSalaryRate().toFixed(2);
  });
  document.getElementById("applyRateWeekend").addEventListener("click", () => {
    document.getElementById("setWeekendRate").value = computeSalaryRate().toFixed(2);
  });
  document.getElementById("applyRateWfh").addEventListener("click", () => {
    document.getElementById("setWfhRate").value = computeSalaryRate().toFixed(2);
  });

  document.getElementById("settingsSaveBtn").addEventListener("click", () => {
    const s = STATE.settings;
    s.orgName = document.getElementById("setOrgName").value.trim();
    s.empName = document.getElementById("setEmpName").value.trim();
    s.stdStart = setStdStart._value || s.stdStart;
    s.stdEnd = setStdEnd._value || s.stdEnd;
    s.graceEnd = setGraceEnd._value || s.graceEnd;
    const checkedBlocks = Array.from(document.querySelectorAll('#setOtBlockGroup input:checked')).map(cb => parseInt(cb.value,10));
    s.otBlockOptions = checkedBlocks.length ? checkedBlocks : [15];
    s.otBlock = Math.max(...s.otBlockOptions);
    s.currency = document.getElementById("setCurrency").value.trim() || "LKR";
    s.weekdayRate = parseFloat(document.getElementById("setWeekdayRate").value) || 0;
    s.weekendRate = parseFloat(document.getElementById("setWeekendRate").value) || 0;
    s.wfhRate = parseFloat(document.getElementById("setWfhRate").value) || 0;
    s.monthlySalary = parseFloat(document.getElementById("setMonthlySalary").value) || 0;
    s.otMultiplier = getSelectedMultiplier();
    s.otLimitHours = parseFloat(document.getElementById("setOtLimitHours").value) || 0;
    s.wfhDailyCapHours = parseFloat(document.getElementById("setWfhCapHours").value);
    if(isNaN(s.wfhDailyCapHours) || s.wfhDailyCapHours < 0) s.wfhDailyCapHours = 0;
    persist();
    renderCalendar();
    renderSummary();
    showToast(t("toastSettingsSaved"));
    closeSettingsModal();
  });

  document.getElementById("resetAllBtn").addEventListener("click", () => {
    if(confirm(t("confirmReset"))){
      localStorage.removeItem(LS_SETTINGS);
      localStorage.removeItem(LS_ENTRIES);
      localStorage.removeItem(LS_META);
      STATE.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      STATE.entries = {};
      STATE.meta = { lang:"en", theme:"light", lastSaved: null };
      document.documentElement.setAttribute("data-theme","light");
      applyI18n();
      renderCalendar(); renderSummary();
      closeSettingsModal();
      showToast(t("toastReset"));
    }
  });
}

function getSelectedMultiplier(){
  const sel = document.getElementById("setOtMultiplier").value;
  if(sel === "custom"){
    const v = parseFloat(document.getElementById("setOtMultiplierCustom").value);
    return isNaN(v) || v <= 0 ? 1 : v;
  }
  return parseFloat(sel);
}
function computeSalaryRate(){
  const salary = parseFloat(document.getElementById("setMonthlySalary").value) || 0;
  const multiplier = getSelectedMultiplier();
  return (salary / 240) * multiplier;
}
function updateSalaryCalcResult(){
  const currency = document.getElementById("setCurrency").value.trim() || "LKR";
  document.getElementById("salaryCalcResult").textContent = `= ${currency} ${computeSalaryRate().toFixed(2)} / hr`;
}

function openSettingsModal(){
  const s = STATE.settings;
  document.getElementById("setOrgName").value = s.orgName || "";
  document.getElementById("setEmpName").value = s.empName || "";
  document.querySelectorAll('#setOtBlockGroup input').forEach(cb => {
    cb.checked = (s.otBlockOptions||[15]).includes(parseInt(cb.value,10));
  });
  document.getElementById("setCurrency").value = s.currency;
  document.getElementById("setWeekdayRate").value = s.weekdayRate;
  document.getElementById("setWeekendRate").value = s.weekendRate;
  document.getElementById("setWfhRate").value = s.wfhRate;
  document.getElementById("setMonthlySalary").value = s.monthlySalary || "";
  document.getElementById("setOtLimitHours").value = s.otLimitHours || 0;
  document.getElementById("setWfhCapHours").value = (s.wfhDailyCapHours === undefined || s.wfhDailyCapHours === null) ? 4 : s.wfhDailyCapHours;
  const multiplierSelect = document.getElementById("setOtMultiplier");
  const multiplierCustom = document.getElementById("setOtMultiplierCustom");
  const knownMultipliers = ["1","1.5","2"];
  const currentMultiplier = String(s.otMultiplier || 1.5);
  if(knownMultipliers.includes(currentMultiplier)){
    multiplierSelect.value = currentMultiplier;
    multiplierCustom.hidden = true;
  } else {
    multiplierSelect.value = "custom";
    multiplierCustom.hidden = false;
    multiplierCustom.value = currentMultiplier;
  }
  updateSalaryCalcResult();

  setStdStart = mountTimeInput(document.querySelector('[data-target="setStdStart"]'), { value: s.stdStart, onChange: v=>{} });
  setStdEnd = mountTimeInput(document.querySelector('[data-target="setStdEnd"]'), { value: s.stdEnd, onChange: v=>{} });
  setGraceEnd = mountTimeInput(document.querySelector('[data-target="setGraceEnd"]'), { value: s.graceEnd, onChange: v=>{} });

  const lastSavedEl = document.getElementById("settingsLastSaved");
  lastSavedEl.textContent = STATE.meta.lastSaved
    ? t("savedAt").replace("{time}", new Date(STATE.meta.lastSaved).toLocaleString())
    : "";

  document.getElementById("settingsOverlay").classList.add("open");
}
function closeSettingsModal(){
  document.getElementById("settingsOverlay").classList.remove("open");
  closeClockPopover();
}

/* ============================================================
   9. EXPORTS: JSON backup/import, Excel, PDF
   ============================================================ */
/* Reports are always generated in English, regardless of the UI language,
   so the exported file reads consistently for any office/HR reviewer. */
function te(key){ return I18N.en[key] || key; }

function buildMonthRows(){
  const dates = iteratePeriodDates();
  const dictEn = I18N.en;
  const rows = [];
  let totalMin=0, totalPay=0;
  dates.forEach(dateStr => {
    const entry = migrateEntry(STATE.entries[dateStr] || {});
    const calc = calcDay(dateStr, entry, STATE.settings);
    const dow = new Date(dateStr+"T00:00:00").getDay();
    const dayLabel = dictEn.weekdaysShort[dow];

    // Office (weekday/weekend) row — always shown for the date, even if OT is zero,
    // so the report reads as a full day-by-day ledger.
    const officeRate = calc.type==="weekend" ? STATE.settings.weekendRate : STATE.settings.weekdayRate;
    const officePay = (calc.session1.otMinutes/60)*officeRate;
    totalMin += calc.session1.otMinutes;
    totalPay += officePay;
    rows.push({
      date: dateStr,
      day: dayLabel,
      type: calc.type==="weekend" ? te("weekendShort") : te("weekdayShort"),
      in1: entry.timeIn1 ? formatDisplay12(entry.timeIn1, true) : "",
      out1: entry.timeOut1 ? formatDisplay12(entry.timeOut1, true) : "",
      actual: calc.session1.hasData ? formatDuration(calc.session1.rawMinutes) : "-",
      ot: calc.session1.otMinutes>0 ? formatDuration(calc.session1.otMinutes) : "-",
      rate: `${STATE.settings.currency} ${officeRate.toFixed(2)}/hr`,
      pay: officePay,
      otMinutesRaw: calc.session1.otMinutes,
      rateVal: officeRate,
      category: "office",
      note: entry.note || ""
    });

    // One extra row per WFH session that has real data — kept separate from the
    // office row so each figure can be checked/added up on its own, without the
    // two different block-rounding rules (office vs WFH) getting mixed into one total.
    calc.session2.sessions.forEach(s => {
      if(!s.hasData) return;
      const wfhPay = (s.otMinutes/60)*STATE.settings.wfhRate;
      totalMin += s.otMinutes;
      totalPay += wfhPay;
      rows.push({
        date: dateStr,
        day: dayLabel,
        type: te("wfhLabel"),
        in1: formatDisplay12(s.timeIn, true),
        out1: formatDisplay12(s.timeOut, true),
        actual: formatDuration(s.rawMinutes),
        ot: s.otMinutes>0 ? formatDuration(s.otMinutes) : "-",
        rate: `${STATE.settings.currency} ${STATE.settings.wfhRate.toFixed(2)}/hr`,
        pay: wfhPay,
        otMinutesRaw: s.otMinutes,
        rateVal: STATE.settings.wfhRate,
        category: "wfh",
        note: entry.note || ""
      });
    });
  });
  return { rows, totalMin, totalPay };
}

// Splits already-built ledger rows into "within limit" / "excess" rows based on
// a cumulative OT-minutes ceiling for the period. Rows with no OT stay in the
// within-limit table (ledger continuity); a row that straddles the ceiling is
// split in two, with the pay for each portion recomputed from that row's rate.
function buildLimitSplitData(rows, limitMinutes){
  let cumulative = 0;
  const withinRows = [];
  const excessRows = [];
  let withinTotalMin = 0, excessTotalMin = 0, withinTotalPay = 0, excessTotalPay = 0;

  rows.forEach(r => {
    const otMin = r.otMinutesRaw || 0;
    if(otMin <= 0){
      withinRows.push(r);
      return;
    }
    if(cumulative >= limitMinutes){
      excessRows.push(r);
      excessTotalMin += otMin;
      excessTotalPay += r.pay;
      return;
    }
    const remaining = limitMinutes - cumulative;
    if(otMin <= remaining){
      withinRows.push(r);
      withinTotalMin += otMin;
      withinTotalPay += r.pay;
      cumulative += otMin;
    } else {
      const withinPortion = remaining;
      const excessPortion = otMin - remaining;
      const withinPay = (withinPortion/60) * r.rateVal;
      const excessPay = (excessPortion/60) * r.rateVal;
      withinRows.push(Object.assign({}, r, { ot: formatDuration(withinPortion), pay: withinPay }));
      excessRows.push(Object.assign({}, r, { ot: formatDuration(excessPortion), pay: excessPay }));
      withinTotalMin += withinPortion;
      withinTotalPay += withinPay;
      excessTotalMin += excessPortion;
      excessTotalPay += excessPay;
      cumulative = limitMinutes;
    }
  });

  return { withinRows, excessRows, withinTotalMin, excessTotalMin, withinTotalPay, excessTotalPay };
}

/* Shared PDF building blocks for the extra report types below.
   exportPdf() above is left untouched — these are independent helpers. */
function buildReportPdfHeader(doc, titleText){
  const dictEn = I18N.en;
  const s = STATE.settings;
  doc.setFont("helvetica","bold"); doc.setFontSize(17);
  doc.setTextColor(15,92,86);
  doc.text(titleText, 40, 46);

  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  doc.setTextColor(70,70,70);
  let y = 66;
  if(s.orgName){ doc.text(`${te("reportInstitution")}: ${s.orgName}`, 40, y); y+=15; }
  if(s.empName){ doc.text(`${te("reportEmployee")}: ${s.empName}`, 40, y); y+=15; }
  const periodText = STATE.meta.periodMode === "custom"
    ? (() => { const r = getActivePeriodRange(); return r.start+" \u2013 "+r.end; })()
    : dictEn.months[STATE.viewMonth]+" "+STATE.viewYear;
  doc.text(`${te("reportPeriod")}: ${periodText}`, 40, y); y+=15;
  doc.text(`${te("reportGenerated")}: ${new Date().toLocaleString()}`, 40, y); y+=10;
  return y;
}

function renderReportTablePdf(doc, opts){
  const s = STATE.settings;
  const head = [te("colDate"), te("colDay"), te("colType"), te("colIn1"), te("colOut1"), te("colActual"), te("colOt"), te("colRate"), te("colAmount")];
  const body = opts.rows.map(r => {
    const row = [r.date, r.day, r.type, r.in1, r.out1, r.actual, r.ot, r.rate, r.pay ? (s.currency+" "+r.pay.toFixed(2)) : "-"];
    if(opts.showDescription) row.push(r.note ? r.note : "-");
    return row;
  });
  const totalsRow = [te("totalsRow"),"","","","","", formatDuration(opts.totalMin), "", s.currency+" "+opts.totalPay.toFixed(2)];
  if(opts.showDescription){ head.push(te("colDescription")); totalsRow.push(""); }
  body.push(totalsRow);

  doc.setFont("helvetica","bold"); doc.setFontSize(12.5);
  doc.setTextColor(15,92,86);
  if(!opts.skipTitle) doc.text(opts.title, 40, opts.startY);

  doc.autoTable({
    head: [head], body, startY: opts.skipTitle ? opts.startY : opts.startY+12, styles:{ fontSize:7.5, cellPadding:4 },
    headStyles:{ fillColor:[15,92,86], textColor:255 },
    footStyles:{ fillColor:[245,166,35] },
    columnStyles: opts.showDescription ? { 9: { cellWidth: 220 } } : undefined,
    didParseCell: (data) => {
      if(data.row.index === body.length-1 && data.section==="body"){
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [253,241,219];
      }
    }
  });
  return doc.lastAutoTable.finalY;
}

function addPdfFooter(doc){
  const finalY = doc.lastAutoTable.finalY + 24;
  doc.setFont("helvetica","normal"); doc.setFontSize(5);
  doc.setTextColor(225,228,226);
  doc.text("A system by V.P.R. Lakshan Vidanapathirana \u2014 lakshan.vercel.app/ot", 40, finalY);
}

function exportLimitSplitPdf(){
  const s = STATE.settings;
  const limitHours = parseFloat(s.otLimitHours) || 0;
  if(limitHours <= 0){
    showToast(t("toastSetLimitFirst"));
    return;
  }
  const limitMinutes = Math.round(limitHours*60);
  const { rows } = buildMonthRows();
  const split = buildLimitSplitData(rows, limitMinutes);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  let y = buildReportPdfHeader(doc, te("reportTitle"));
  doc.setFontSize(9); doc.setTextColor(100,100,100);
  doc.text(`${te("otLimitValueLabel")}: ${limitHours} h`, 40, y+4);
  y += 20;
  renderReportTablePdf(doc, { title: te("reportWithinLimit"), rows: split.withinRows, totalMin: split.withinTotalMin, totalPay: split.withinTotalPay, startY: y });
  addPdfFooter(doc);

  doc.addPage();
  let y2 = buildReportPdfHeader(doc, te("reportTitle"));
  doc.setFontSize(9); doc.setTextColor(100,100,100);
  doc.text(`${te("otLimitValueLabel")}: ${limitHours} h`, 40, y2+4);
  y2 += 20;
  renderReportTablePdf(doc, { title: te("reportExcessLimit"), rows: split.excessRows, totalMin: split.excessTotalMin, totalPay: split.excessTotalPay, startY: y2 });
  addPdfFooter(doc);

  doc.save(fileBaseName()+"-OT-Limit-Split.pdf");
}

function exportOfficeOnlyPdf(){
  const { rows } = buildMonthRows();
  const officeRows = rows.filter(r => r.category === "office");
  let totalMin=0, totalPay=0;
  officeRows.forEach(r => { totalMin += r.otMinutesRaw||0; totalPay += r.pay||0; });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const y = buildReportPdfHeader(doc, te("reportOfficeOnly"));
  renderReportTablePdf(doc, { title: te("reportOfficeOnly"), rows: officeRows, totalMin, totalPay, startY: y, skipTitle: true });
  addPdfFooter(doc);
  doc.save(fileBaseName()+"-Office-OT.pdf");
}

function exportWfhOnlyPdf(){
  const { rows } = buildMonthRows();
  const wfhRows = rows.filter(r => r.category === "wfh");
  if(wfhRows.length === 0){
    showToast(t("toastNoWfhData"));
    return;
  }
  let totalMin=0, totalPay=0;
  wfhRows.forEach(r => { totalMin += r.otMinutesRaw||0; totalPay += r.pay||0; });

  const { jsPDF } = window.jspdf;
  // Landscape so the Description column (day notes, which can run long — e.g.
  // course names for online sessions) has room to wrap without squeezing the
  // other columns.
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const y = buildReportPdfHeader(doc, te("reportWfhOnly"));
  renderReportTablePdf(doc, { title: te("reportWfhOnly"), rows: wfhRows, totalMin, totalPay, startY: y, showDescription: true, skipTitle: true });
  addPdfFooter(doc);
  doc.save(fileBaseName()+"-WFH-OT.pdf");
}

function initExports(){
  document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const data = { settings: STATE.settings, entries: STATE.entries, exportedAt: new Date().toISOString(), app: "Overtime Report Generator" };
    downloadBlob(JSON.stringify(data, null, 2), "application/json", fileBaseName()+".json");
  });

  document.getElementById("importJsonBtn").addEventListener("click", () => document.getElementById("importJsonInput").click());
  document.getElementById("importJsonInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const data = JSON.parse(reader.result);
        if(!data.entries) throw new Error("bad format");
        STATE.entries = data.entries || {};
        if(data.settings) STATE.settings = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data.settings);
        persist();
        renderCalendar(); renderSummary();
        showToast(t("toastImported"));
      }catch(err){
        showToast(t("toastImportError"));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);
  document.getElementById("exportPdfBtn").addEventListener("click", exportPdf);

  const moreBtn = document.getElementById("moreReportsBtn");
  const moreMenu = document.getElementById("moreReportsMenu");
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if(moreMenu.classList.contains("open") && !moreMenu.contains(e.target) && e.target !== moreBtn){
      moreMenu.classList.remove("open");
    }
  });
  document.getElementById("exportLimitSplitBtn").addEventListener("click", () => { moreMenu.classList.remove("open"); exportLimitSplitPdf(); });
  document.getElementById("exportOfficeOnlyBtn").addEventListener("click", () => { moreMenu.classList.remove("open"); exportOfficeOnlyPdf(); });
  document.getElementById("exportWfhOnlyBtn").addEventListener("click", () => { moreMenu.classList.remove("open"); exportWfhOnlyPdf(); });
}

function fileBaseName(){
  const dictEn = I18N.en;
  const org = (STATE.settings.orgName || "OT-Report").replace(/[^a-z0-9]+/gi,"-");
  const { start, end } = getActivePeriodRange();
  if(STATE.meta.periodMode === "custom"){
    return `${org}-${start}_to_${end}`;
  }
  return `${org}-${dictEn.months[STATE.viewMonth]}-${STATE.viewYear}`;
}

function downloadBlob(content, mime, filename){
  const blob = content instanceof Blob ? content : new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

function exportExcel(){
  const dictEn = I18N.en;
  const { rows, totalMin, totalPay } = buildMonthRows();
  const header = [te("colDate"), te("colDay"), te("colType"), te("colIn1"), te("colOut1"), te("colActual"), te("colOt"), te("colRate"), te("colAmount")];
  const aoa = [header];
  rows.forEach(r => aoa.push([r.date, r.day, r.type, r.in1, r.out1, r.actual, r.ot, r.rate, Number(r.pay.toFixed(2))]));
  aoa.push([te("totalsRow"),"","","","","", formatDuration(totalMin), "", Number(totalPay.toFixed(2))]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{wch:12},{wch:8},{wch:10},{wch:12},{wch:12},{wch:12},{wch:12},{wch:14},{wch:12}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, dictEn.months[STATE.viewMonth].slice(0,28));
  XLSX.writeFile(wb, fileBaseName()+".xlsx");
}

function exportPdf(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const dictEn = I18N.en;
  const { rows, totalMin, totalPay } = buildMonthRows();
  const s = STATE.settings;

  doc.setFont("helvetica","bold"); doc.setFontSize(17);
  doc.setTextColor(15,92,86);
  doc.text(te("reportTitle"), 40, 46);

  doc.setFont("helvetica","normal"); doc.setFontSize(10);
  doc.setTextColor(70,70,70);
  let y = 66;
  if(s.orgName){ doc.text(`${te("reportInstitution")}: ${s.orgName}`, 40, y); y+=15; }
  if(s.empName){ doc.text(`${te("reportEmployee")}: ${s.empName}`, 40, y); y+=15; }
  const periodText = STATE.meta.periodMode === "custom"
    ? (() => { const r = getActivePeriodRange(); return r.start+" \u2013 "+r.end; })()
    : dictEn.months[STATE.viewMonth]+" "+STATE.viewYear;
  doc.text(`${te("reportPeriod")}: ${periodText}`, 40, y); y+=15;
  doc.text(`${te("reportGenerated")}: ${new Date().toLocaleString()}`, 40, y); y+=10;

  const head = [[te("colDate"), te("colDay"), te("colType"), te("colIn1"), te("colOut1"), te("colActual"), te("colOt"), te("colRate"), te("colAmount")]];
  const body = rows.map(r => [r.date, r.day, r.type, r.in1, r.out1, r.actual, r.ot, r.rate, r.pay ? (s.currency+" "+r.pay.toFixed(2)) : "-"]);
  body.push([te("totalsRow"),"","","","","", formatDuration(totalMin), "", s.currency+" "+totalPay.toFixed(2)]);

  doc.autoTable({
    head, body, startY: y+10, styles:{ fontSize:7.5, cellPadding:4 },
    headStyles:{ fillColor:[15,92,86], textColor:255 },
    footStyles:{ fillColor:[245,166,35] },
    didParseCell: (data) => {
      if(data.row.index === body.length-1 && data.section==="body"){
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [253,241,219];
      }
    }
  });

  const finalY = doc.lastAutoTable.finalY + 24;
  doc.setFont("helvetica","normal"); doc.setFontSize(5);
  doc.setTextColor(225,228,226);
  doc.text("A system by V.P.R. Lakshan Vidanapathirana \u2014 lakshan.vercel.app/ot", 40, finalY);

  doc.save(fileBaseName()+".pdf");
}

})();
