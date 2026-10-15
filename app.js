/**
 * ==========================================================
 * SMART BUDILNIK - CORE JAVASCRIPT APPLICATION
 * ==========================================================
 * Features:
 * - Real-time Digital Clock with Uzbek localization & 12/24H format
 * - Web Audio API Synthesizer (No external sound files required)
 * - Persistent Alarms (localStorage) with snooze & toggle
 * - Fullscreen Ringing Modal with vibration & visual alerts
 * - Countdown display & next upcoming alarm indicator
 * - Integrated Countdown Timer & Stopwatch with laps
 */

// State Management
const STATE = {
  is24Hour: true,
  alarms: [],
  activeRingingAlarm: null,
  ringingIntervalId: null,
  ringingTimeoutId: null,
  ringingCountdownIntervalId: null,
  previewTimeoutId: null,
  previewIntervalId: null,
  timer: {
    totalSeconds: 300,
    remainingSeconds: 300,
    isRunning: false,
    intervalId: null
  },
  stopwatch: {
    startTime: 0,
    elapsedTime: 0,
    isRunning: false,
    intervalId: null,
    laps: []
  }
};

// Uzbek Days & Months
const UZ_MONTHS = [
  "Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun",
  "Iyul", "Avgust", "Sentabr", "Oktyabr", "Noyabr", "Dekabr"
];

const UZ_DAYS = [
  "Yakshanba", "Dushanba", "Seshanba", "Chorshanba",
  "Payshanba", "Juma", "Shanba"
];

/* ==========================================================
   WEB AUDIO API SOUND ENGINE
   Produces crisp, reliable tones without any external audio files
   ========================================================== */
class AlarmAudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.engineSafetyTimeoutId = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Play single note
  playTone(freq, type = 'sine', duration = 0.2, startTime = 0, volume = 0.3) {
    if (!this.ctx) this.init();
    if (!this.ctx) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);

      // Volume envelope (smooth attack & release)
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime + startTime);
      gain.gain.exponentialRampToValueAtTime(volume, this.ctx.currentTime + startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(this.ctx.currentTime + startTime);
      osc.stop(this.ctx.currentTime + startTime + duration + 0.05);
    } catch (e) {
      console.warn("Audio playTone error:", e);
    }
  }

  // Ring pattern by sound profile
  playAlarmPattern(soundType = 'classic') {
    this.init();
    if (!this.ctx) return;

    switch (soundType) {
      case 'classic': {
        // Double digital beep: Beep-Beep ... Beep-Beep
        this.playTone(1046.5, 'square', 0.12, 0, 0.25); // C6
        this.playTone(1046.5, 'square', 0.12, 0.18, 0.25);
        this.playTone(1318.5, 'square', 0.12, 0.45, 0.3); // E6
        this.playTone(1318.5, 'square', 0.12, 0.63, 0.3);
        break;
      }
      case 'school': {
        // Maktab qo'ng'irog'i: Elektr metall qo'ng'iroq (tezkor vibro-zarbalar va jarangdor metall sado)
        if (!this.ctx) return;
        const strikeCount = 18;
        for (let i = 0; i < strikeCount; i++) {
          const t = i * 0.046; // Har 46ms da bolg'acha qo'ng'iroqqa uriladi (~22 Hz)
          this.playTone(1661.22, 'triangle', 0.055, t, 0.26); // G#6 metall jiringlash
          this.playTone(2489.02, 'sine', 0.04, t, 0.18);     // D#7 yuqori garmonika
          this.playTone(830.61, 'sine', 0.08, t, 0.14);      // G#5 asosiy korpus sadolari
        }
        // Qo'ng'iroqning jarangdor aks-sadosi
        this.playTone(1661.22, 'sine', 0.4, 18 * 0.046, 0.18);
        break;
      }
      case 'melodic': {
        // Melodic arpeggio: C5 - E5 - G5 - B5 - C6
        const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
        notes.forEach((freq, i) => {
          this.playTone(freq, 'sine', 0.25, i * 0.14, 0.35);
        });
        break;
      }
      case 'siren': {
        // Urgent rising siren pulse
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(500, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, this.ctx.currentTime + 0.4);
        osc.frequency.linearRampToValueAtTime(600, this.ctx.currentTime + 0.7);

        gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.1);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.7);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.75);
        break;
      }
      case 'gentle': {
        // Warm ambient chime
        const chord = [440, 554.37, 659.25, 880];
        chord.forEach((freq) => {
          this.playTone(freq, 'triangle', 0.8, 0, 0.18);
        });
        break;
      }
      case 'retro': {
        // 8-bit game cadence
        const rNotes = [440, 660, 880, 1320];
        rNotes.forEach((freq, idx) => {
          this.playTone(freq, 'square', 0.1, idx * 0.1, 0.2);
        });
        break;
      }
      default:
        this.playTone(880, 'square', 0.3, 0, 0.3);
    }
  }

  // Loop pattern until stopped (strictly capped at max 15 seconds)
  startContinuousRinging(soundType = 'classic', maxDurationSec = 15) {
    this.stopAll();

    // Audio Engine level safety: Never play for more than 15 seconds
    const safeDurationMs = Math.min(Math.max(maxDurationSec || 15, 1), 15) * 1000;
    this.engineSafetyTimeoutId = setTimeout(() => {
      this.stopAll();
    }, safeDurationMs);

    if (soundType === 'qongiroq') {
      this.init();
      const audioEl = document.getElementById('qongiroqAudio') || new Audio('qongiroq.mp3');
      this.qongiroqAudio = audioEl;
      this.qongiroqAudio.currentTime = 0;
      this.qongiroqAudio.loop = true;
      const playPromise = this.qongiroqAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => console.warn("MP3 play error:", e));
      }
      return;
    }
    this.playAlarmPattern(soundType);
    const intervalMs = soundType === 'melodic' ? 1200 : (soundType === 'gentle' ? 1500 : (soundType === 'school' ? 1050 : 900));
    STATE.ringingIntervalId = setInterval(() => {
      this.playAlarmPattern(soundType);
    }, intervalMs);
  }

  // Play quick sample (preview)
  previewSound(soundType = 'classic', onEndCallback) {
    this.stopAll();
    if (soundType === 'qongiroq') {
      this.init();
      const audioEl = document.getElementById('qongiroqAudio') || new Audio('qongiroq.mp3');
      this.qongiroqAudio = audioEl;
      this.qongiroqAudio.currentTime = 0;
      this.qongiroqAudio.loop = false;
      const playPromise = this.qongiroqAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => console.warn("MP3 play error:", e));
      }

      const handleEnd = () => {
        this.stopAll();
        if (onEndCallback) onEndCallback();
        if (this.qongiroqAudio) {
          this.qongiroqAudio.removeEventListener('ended', handleEnd);
        }
      };
      this.qongiroqAudio.addEventListener('ended', handleEnd);

      STATE.previewTimeoutId = setTimeout(() => {
        handleEnd();
      }, 6000);
      return;
    }

    this.playAlarmPattern(soundType);
    const intervalMs = soundType === 'melodic' ? 1200 : (soundType === 'school' ? 1050 : 900);
    STATE.previewIntervalId = setInterval(() => {
      this.playAlarmPattern(soundType);
    }, intervalMs);

    STATE.previewTimeoutId = setTimeout(() => {
      this.stopAll();
      if (onEndCallback) onEndCallback();
    }, 2800);
  }

  stopAll() {
    if (this.engineSafetyTimeoutId) {
      clearTimeout(this.engineSafetyTimeoutId);
      this.engineSafetyTimeoutId = null;
    }
    if (this.qongiroqAudio) {
      try {
        this.qongiroqAudio.pause();
        this.qongiroqAudio.currentTime = 0;
      } catch (e) {
        console.warn("Audio pause error:", e);
      }
    }
    if (STATE.ringingIntervalId) {
      clearInterval(STATE.ringingIntervalId);
      STATE.ringingIntervalId = null;
    }
    if (STATE.previewIntervalId) {
      clearInterval(STATE.previewIntervalId);
      STATE.previewIntervalId = null;
    }
    if (STATE.previewTimeoutId) {
      clearTimeout(STATE.previewTimeoutId);
      STATE.previewTimeoutId = null;
    }
  }
}

const soundEngine = new AlarmAudioEngine();

/* ==========================================================
   DOM ELEMENTS
   ========================================================== */
const DOM = {
  // Clock Hero
  currentTime: document.getElementById('currentTime'),
  currentAmPm: document.getElementById('currentAmPm'),
  currentDate: document.getElementById('currentDate'),
  currentTimezone: document.getElementById('currentTimezone'),
  upcomingBanner: document.getElementById('upcomingBanner'),
  upcomingAlarmText: document.getElementById('upcomingAlarmText'),
  formatToggleBtn: document.getElementById('formatToggleBtn'),
  formatLabel: document.getElementById('formatLabel'),
  soundTestQuickBtn: document.getElementById('soundTestQuickBtn'),

  // Tabs
  navTabs: document.querySelectorAll('.nav-tab'),
  tabContents: document.querySelectorAll('.tab-content'),

  // Alarm Form
  alarmForm: document.getElementById('alarmForm'),
  alarmHour: document.getElementById('alarmHour'),
  alarmMinute: document.getElementById('alarmMinute'),
  alarmSecond: document.getElementById('alarmSecond'),
  alarmTitle: document.getElementById('alarmTitle'),
  alarmSound: document.getElementById('alarmSound'),
  testSoundBtn: document.getElementById('testSoundBtn'),
  testIcon: document.getElementById('testIcon'),
  alarmsList: document.getElementById('alarmsList'),
  emptyState: document.getElementById('emptyState'),
  alarmCountSubtitle: document.getElementById('alarmCountSubtitle'),
  clearAllAlarmsBtn: document.getElementById('clearAllAlarmsBtn'),
  presetChips: document.querySelectorAll('.preset-chip[data-offset]'),

  // Ringing Modal
  ringingModal: document.getElementById('ringingModal'),
  ringingClock: document.getElementById('ringingClock'),
  ringingTitle: document.getElementById('ringingTitle'),
  ringingDescription: document.getElementById('ringingDescription'),
  ringingProgressBar: document.getElementById('ringingProgressBar'),
  ringingSecondsLeft: document.getElementById('ringingSecondsLeft'),
  ringingAutoStopWrap: document.getElementById('ringingAutoStopWrap'),
  stopAlarmBtn: document.getElementById('stopAlarmBtn'),
  snoozeAlarmBtn: document.getElementById('snoozeAlarmBtn'),
  snoozeBtnText: document.getElementById('snoozeBtnText'),

  // Audio unlock banner
  audioUnlockBanner: document.getElementById('audioUnlockBanner'),
  unlockAudioBtn: document.getElementById('unlockAudioBtn'),

  // Timer Tab
  timerDisplay: document.getElementById('timerDisplay'),
  timerH: document.getElementById('timerH'),
  timerM: document.getElementById('timerM'),
  timerS: document.getElementById('timerS'),
  timerStartBtn: document.getElementById('timerStartBtn'),
  timerPauseBtn: document.getElementById('timerPauseBtn'),
  timerResetBtn: document.getElementById('timerResetBtn'),
  timerPresetBtns: document.querySelectorAll('.timer-set'),
  timerInputsWrap: document.getElementById('timerInputsWrap'),

  // Stopwatch Tab
  stopwatchDisplay: document.getElementById('stopwatchDisplay'),
  swStartBtn: document.getElementById('swStartBtn'),
  swLapBtn: document.getElementById('swLapBtn'),
  swResetBtn: document.getElementById('swResetBtn'),
  lapsContainer: document.getElementById('lapsContainer'),
  lapsList: document.getElementById('lapsList')
};

/* ==========================================================
   INITIALIZATION & PERSISTENCE
   ========================================================== */
function initApp() {
  loadAlarms();
  setupEventListeners();
  updateLiveClock();
  setInterval(updateLiveClock, 500); // Check time & alarms twice every second

  // Set default form time to +5 minutes from now
  setDefaultFormTime(5);

  // Request notification permission if available
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Set initial input time offset (e.g. current time + 5 min)
function setDefaultFormTime(minutesOffset = 5) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + minutesOffset);

  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');

  DOM.alarmHour.value = h;
  DOM.alarmMinute.value = m;
  DOM.alarmSecond.value = "00";
}

// Load alarms from localStorage
function loadAlarms() {
  try {
    const saved = localStorage.getItem('smart_budilnik_alarms');
    if (saved) {
      STATE.alarms = JSON.parse(saved);
      // Strictly enforce max 15 seconds ringing duration on all loaded alarms
      STATE.alarms.forEach(a => {
        const d = parseInt(a.durationSeconds, 10);
        if (isNaN(d) || d > 15 || d <= 0) {
          a.durationSeconds = 15;
        }
      });
    }
  } catch (err) {
    console.error("Alarmlarni yuklashda xatolik:", err);
    STATE.alarms = [];
  }
  renderAlarmsList();
  updateUpcomingAlarmBadge();
}

// Save alarms to localStorage
function saveAlarms() {
  try {
    localStorage.setItem('smart_budilnik_alarms', JSON.stringify(STATE.alarms));
  } catch (err) {
    console.error("Alarmlarni saqlashda xatolik:", err);
  }
  renderAlarmsList();
  updateUpcomingAlarmBadge();
}

/* ==========================================================
   LIVE CLOCK & ALARM TICKER
   ========================================================== */
function updateLiveClock() {
  const now = new Date();

  // Current Date in Uzbek
  const dayName = UZ_DAYS[now.getDay()];
  const dayNum = now.getDate();
  const monthName = UZ_MONTHS[now.getMonth()];
  const year = now.getFullYear();
  DOM.currentDate.textContent = `${dayName}, ${dayNum}-${monthName}, ${year}`;

  // Time format calculations
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  let ampm = "";

  if (!STATE.is24Hour) {
    ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 becomes 12
  }

  const hoursStr = String(hours).padStart(2, '0');
  DOM.currentTime.textContent = `${hoursStr}:${minutes}:${seconds}`;
  DOM.currentAmPm.textContent = ampm;

  // Check active alarms
  checkAlarmTriggers(now);

  // Update countdowns on alarm cards every 10 seconds or when minute rolls
  if (now.getSeconds() % 10 === 0) {
    updateUpcomingAlarmBadge();
    updateAlarmsCountdownBadges();
  }
}

/* ==========================================================
   ALARM TRIGGER CHECKER
   ========================================================== */
function checkAlarmTriggers(now) {
  // If already ringing, don't trigger another one right over it
  if (STATE.activeRingingAlarm) return;

  const currentH = now.getHours();
  const currentM = now.getMinutes();
  const currentS = now.getSeconds();

  for (const alarm of STATE.alarms) {
    if (!alarm.enabled) continue;

    const alarmH = parseInt(alarm.hour, 10);
    const alarmM = parseInt(alarm.minute, 10);
    const alarmS = parseInt(alarm.second || 0, 10);

    // Exact match on hour, minute and second
    if (currentH === alarmH && currentM === alarmM && currentS === alarmS) {
      triggerAlarm(alarm);
      break;
    }
  }
}

// Trigger Alarm Ringing (Max 15 seconds)
function triggerAlarm(alarm) {
  STATE.activeRingingAlarm = alarm;

  // Enforce max 15 seconds ringing duration
  const MAX_RING_SECONDS = 15;
  const durationSec = Math.min(Math.max(parseInt(alarm.durationSeconds || MAX_RING_SECONDS, 10), 1), MAX_RING_SECONDS);

  // Sound playback (capped to durationSec <= 15s)
  soundEngine.startContinuousRinging(alarm.sound || 'classic', durationSec);

  // Update Ringing Modal text
  const timeFormatted = `${String(alarm.hour).padStart(2, '0')}:${String(alarm.minute).padStart(2, '0')}`;
  DOM.ringingClock.textContent = timeFormatted;
  DOM.ringingTitle.textContent = alarm.title || "Budilnik";
  DOM.ringingDescription.textContent = `Belgilangan vaqt (${timeFormatted}) yetib keldi!`;
  DOM.snoozeBtnText.textContent = `Kechiktirish (+${alarm.snoozeMinutes || 5} daqiqa)`;

  // Setup auto-stop progress bar and countdown
  if (DOM.ringingSecondsLeft) {
    DOM.ringingSecondsLeft.textContent = durationSec;
  }
  if (DOM.ringingProgressBar) {
    DOM.ringingProgressBar.style.transition = 'none';
    DOM.ringingProgressBar.style.width = '100%';
    void DOM.ringingProgressBar.offsetWidth; // Force reflow
    DOM.ringingProgressBar.style.transition = `width ${durationSec}s linear`;
    DOM.ringingProgressBar.style.width = '0%';
  }

  // Clear any previous countdown intervals / timeouts
  if (STATE.ringingTimeoutId) {
    clearTimeout(STATE.ringingTimeoutId);
    STATE.ringingTimeoutId = null;
  }
  if (STATE.ringingCountdownIntervalId) {
    clearInterval(STATE.ringingCountdownIntervalId);
    STATE.ringingCountdownIntervalId = null;
  }

  // Live countdown ticker (15 -> 0)
  let secondsRemaining = durationSec;
  STATE.ringingCountdownIntervalId = setInterval(() => {
    secondsRemaining--;
    if (DOM.ringingSecondsLeft) {
      DOM.ringingSecondsLeft.textContent = Math.max(secondsRemaining, 0);
    }
    if (secondsRemaining <= 0) {
      clearInterval(STATE.ringingCountdownIntervalId);
      STATE.ringingCountdownIntervalId = null;
    }
  }, 1000);

  // Auto-stop alarm after at most 15 seconds
  STATE.ringingTimeoutId = setTimeout(() => {
    stopRingingAlarm(true);
  }, durationSec * 1000);

  // Show modal
  DOM.ringingModal.style.display = 'flex';

  // Flash tab title
  startTitleFlash(alarm.title || "Budilnik");

  // Web Notification
  showDesktopNotification(alarm);
}

// Stop Ringing Alarm
function stopRingingAlarm(isAutoStopped = false) {
  if (STATE.ringingTimeoutId) {
    clearTimeout(STATE.ringingTimeoutId);
    STATE.ringingTimeoutId = null;
  }
  if (STATE.ringingCountdownIntervalId) {
    clearInterval(STATE.ringingCountdownIntervalId);
    STATE.ringingCountdownIntervalId = null;
  }

  soundEngine.stopAll();
  stopTitleFlash();
  DOM.ringingModal.style.display = 'none';

  if (isAutoStopped) {
    showToast("Budilnik 15 soniya jiringlab, avtomatik to'xtatildi", "info");
  }

  if (STATE.activeRingingAlarm) {
    STATE.activeRingingAlarm = null;
  }
}

// Snooze Ringing Alarm
function snoozeRingingAlarm() {
  if (!STATE.activeRingingAlarm) return;

  const currentAlarm = STATE.activeRingingAlarm;
  const snoozeMins = parseInt(currentAlarm.snoozeMinutes || 5, 10);

  // Calculate new time
  const targetDate = new Date();
  targetDate.setMinutes(targetDate.getMinutes() + snoozeMins);

  const newH = String(targetDate.getHours()).padStart(2, '0');
  const newM = String(targetDate.getMinutes()).padStart(2, '0');
  const newS = String(targetDate.getSeconds()).padStart(2, '0');

  // Update existing alarm or create temporary snooze alarm
  const idx = STATE.alarms.findIndex(a => a.id === currentAlarm.id);
  if (idx !== -1) {
    STATE.alarms[idx].hour = newH;
    STATE.alarms[idx].minute = newM;
    STATE.alarms[idx].second = newS;
    STATE.alarms[idx].enabled = true;
    STATE.alarms[idx].title = `${currentAlarm.title} (Kechiktirilgan)`;
    saveAlarms();
  }

  stopRingingAlarm();
}

// Document title blinker
let titleFlashInterval = null;
const originalTitle = document.title;

function startTitleFlash(title) {
  if (titleFlashInterval) clearInterval(titleFlashInterval);
  let toggle = false;
  titleFlashInterval = setInterval(() => {
    document.title = toggle ? `🚨 BUDILNIK: ${title}! 🚨` : `⏰ JIRINGLAMOQDA! ⏰`;
    toggle = !toggle;
  }, 500);
}

function stopTitleFlash() {
  if (titleFlashInterval) {
    clearInterval(titleFlashInterval);
    titleFlashInterval = null;
  }
  document.title = originalTitle;
}

// Desktop Notification
function showDesktopNotification(alarm) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`Budilnik: ${alarm.title || "Vaqt bo'ldi!"}`, {
        body: `${String(alarm.hour).padStart(2, '0')}:${String(alarm.minute).padStart(2, '0')} - Rejalashtirilgan vaqt yetib keldi!`,
        icon: 'https://cdn-icons-png.flaticon.com/512/864/864685.png',
        requireInteraction: true
      });
    } catch (e) {
      console.warn("Notification yaratib bo'lmadi:", e);
    }
  }
}

/* ==========================================================
   ALARM LIST RENDERING & MANAGEMENT
   ========================================================== */
function renderAlarmsList() {
  DOM.alarmsList.innerHTML = '';

  if (STATE.alarms.length === 0) {
    DOM.emptyState.style.display = 'flex';
    DOM.alarmsList.appendChild(DOM.emptyState);
    DOM.alarmCountSubtitle.textContent = "0 ta o'rnatilgan budilnik";
    DOM.clearAllAlarmsBtn.style.display = 'none';
    return;
  }

  DOM.emptyState.style.display = 'none';
  DOM.clearAllAlarmsBtn.style.display = 'inline-block';
  DOM.alarmCountSubtitle.textContent = `${STATE.alarms.length} ta o'rnatilgan budilnik`;

  // Sort by next ringing time
  const sortedAlarms = [...STATE.alarms].sort((a, b) => {
    return getTimeDifferenceMs(a) - getTimeDifferenceMs(b);
  });

  sortedAlarms.forEach(alarm => {
    const item = document.createElement('div');
    item.className = `alarm-item ${alarm.enabled ? 'active' : 'inactive'}`;
    item.dataset.id = alarm.id;

    // Format display time
    let h = parseInt(alarm.hour, 10);
    const m = String(alarm.minute).padStart(2, '0');
    let ampmStr = "";

    if (!STATE.is24Hour) {
      ampmStr = h >= 12 ? "PM" : "AM";
      h = h % 12;
      h = h ? h : 12;
    }
    const displayTime = `${String(h).padStart(2, '0')}:${m}`;

    // Calculate time remaining countdown
    const countdownText = alarm.enabled ? getCountdownText(alarm) : "O'chirilgan";

    item.innerHTML = `
      <div class="alarm-item-left">
        <div class="alarm-item-time">
          ${displayTime}
          ${ampmStr ? `<span class="alarm-item-ampm">${ampmStr}</span>` : ''}
        </div>
        <div class="alarm-item-info">
          <span class="alarm-item-title">${escapeHtml(alarm.title || "Budilnik")}</span>
          <span class="alarm-item-duration" title="Jiringlash davomiyligi: maks. 15 soniya">⏱️ ${alarm.durationSeconds || 15}s</span>
          <span class="alarm-item-countdown" data-countdown-id="${alarm.id}">${countdownText}</span>
        </div>
      </div>
      <div class="alarm-item-right">
        <label class="switch" title="${alarm.enabled ? "Budilnikni o'chirish" : "Budilnikni yoqish"}">
          <input type="checkbox" class="alarm-toggle" data-id="${alarm.id}" ${alarm.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
        <button class="btn-delete-alarm" data-id="${alarm.id}" title="O'chirib tashlash">
          🗑️
        </button>
      </div>
    `;

    DOM.alarmsList.appendChild(item);
  });
}

function updateAlarmsCountdownBadges() {
  STATE.alarms.forEach(alarm => {
    const el = document.querySelector(`[data-countdown-id="${alarm.id}"]`);
    if (el) {
      el.textContent = alarm.enabled ? getCountdownText(alarm) : "O'chirilgan";
    }
  });
}

// Calculate milliseconds until alarm triggers next
function getTimeDifferenceMs(alarm) {
  const now = new Date();
  const target = new Date();

  target.setHours(parseInt(alarm.hour, 10));
  target.setMinutes(parseInt(alarm.minute, 10));
  target.setSeconds(parseInt(alarm.second || 0, 10));
  target.setMilliseconds(0);

  // If time has passed today, it rings tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime() - now.getTime();
}

// Human readable countdown text in Uzbek
function getCountdownText(alarm) {
  const diffMs = getTimeDifferenceMs(alarm);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours === 0 && minutes === 0) {
    return "1 daqiqadan kam vaqt qoldi";
  }
  if (hours === 0) {
    return `${minutes} daqiqadan so'ng`;
  }
  return `${hours} soat ${minutes} daqiqadan so'ng`;
}

// Update the top hero banner with the nearest upcoming alarm
function updateUpcomingAlarmBadge() {
  const activeAlarms = STATE.alarms.filter(a => a.enabled);
  if (activeAlarms.length === 0) {
    DOM.upcomingBanner.className = "upcoming-banner";
    DOM.upcomingAlarmText.textContent = "Hozircha faol budilnik yo'q";
    return;
  }

  // Find minimum diff
  let nearest = activeAlarms[0];
  let minDiff = getTimeDifferenceMs(nearest);

  for (let i = 1; i < activeAlarms.length; i++) {
    const diff = getTimeDifferenceMs(activeAlarms[i]);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = activeAlarms[i];
    }
  }

  const timeStr = `${String(nearest.hour).padStart(2, '0')}:${String(nearest.minute).padStart(2, '0')}`;
  const cdText = getCountdownText(nearest);

  DOM.upcomingBanner.className = "upcoming-banner has-alarm";
  DOM.upcomingAlarmText.textContent = `Keyingi budilnik: ${timeStr} da (${cdText})`;
}

/* ==========================================================
   EVENT LISTENERS & USER INTERACTIONS
   ========================================================== */
function setupEventListeners() {
  // Global AudioContext unlocker on first click or touch
  const unlockAudio = () => {
    soundEngine.init();
    DOM.audioUnlockBanner.style.display = 'none';
  };
  window.addEventListener('click', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  DOM.unlockAudioBtn.addEventListener('click', unlockAudio);

  // Tab Switching
  DOM.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      DOM.navTabs.forEach(t => t.classList.remove('active'));
      DOM.tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.dataset.tab;
      document.getElementById(targetId).classList.add('active');
    });
  });

  // 12/24 Hour format toggle
  DOM.formatToggleBtn.addEventListener('click', () => {
    STATE.is24Hour = !STATE.is24Hour;
    DOM.formatLabel.textContent = STATE.is24Hour ? "24H" : "12H";
    updateLiveClock();
    renderAlarmsList();
  });

  // Quick sound tester in header
  DOM.soundTestQuickBtn.addEventListener('click', () => {
    soundEngine.init();
    soundEngine.previewSound('classic');
  });

  // Form Stepper buttons
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetInput = document.getElementById(btn.dataset.step);
      const isUp = btn.dataset.dir === 'up';
      let val = parseInt(targetInput.value || 0, 10);
      const max = parseInt(targetInput.max, 10);
      const min = parseInt(targetInput.min, 10);

      if (isUp) {
        val = val >= max ? min : val + 1;
      } else {
        val = val <= min ? max : val - 1;
      }
      targetInput.value = String(val).padStart(2, '0');
    });
  });

  // Auto-pad and clamp on blur/change
  [DOM.alarmHour, DOM.alarmMinute, DOM.alarmSecond].forEach(input => {
    input.addEventListener('blur', () => {
      let val = parseInt(input.value || 0, 10);
      const max = parseInt(input.max, 10);
      const min = parseInt(input.min, 10);
      if (isNaN(val) || val < min) val = min;
      if (val > max) val = max;
      input.value = String(val).padStart(2, '0');
    });
  });

  // Quick preset pills (+1m, +5m, +15m, +30m, +1h)
  DOM.presetChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const offset = parseInt(chip.dataset.offset, 10);
      setDefaultFormTime(offset);

      // Flash feedback
      chip.style.transform = 'scale(0.95)';
      setTimeout(() => { chip.style.transform = ''; }, 150);
    });
  });

  // Preview / Test Sound Button
  let isTesting = false;
  DOM.testSoundBtn.addEventListener('click', () => {
    soundEngine.init();
    const selectedSound = DOM.alarmSound.value;

    if (!isTesting) {
      isTesting = true;
      DOM.testIcon.textContent = "⏹️";
      DOM.testSoundBtn.innerHTML = `<span>⏹️</span> To'xtatish`;

      soundEngine.previewSound(selectedSound, () => {
        isTesting = false;
        DOM.testSoundBtn.innerHTML = `<span>▶️</span> Sinab ko'rish`;
      });
    } else {
      isTesting = false;
      soundEngine.stopAll();
      DOM.testSoundBtn.innerHTML = `<span>▶️</span> Sinab ko'rish`;
    }
  });

  // Submit New Alarm
  DOM.alarmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    soundEngine.init();

    let h = parseInt(DOM.alarmHour.value || 0, 10);
    let m = parseInt(DOM.alarmMinute.value || 0, 10);
    let s = parseInt(DOM.alarmSecond.value || 0, 10);

    // Validate boundaries
    if (isNaN(h) || h < 0 || h > 23) h = 0;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    if (isNaN(s) || s < 0 || s > 59) s = 0;

    const title = DOM.alarmTitle.value.trim() || "Budilnik";
    const sound = DOM.alarmSound.value || "classic";
    const snoozeRadio = document.querySelector('input[name="snoozeTime"]:checked');
    const snoozeMinutes = snoozeRadio ? parseInt(snoozeRadio.value, 10) : 5;

    // Enforce maximum 15 seconds duration
    const durationRadio = document.querySelector('input[name="ringDuration"]:checked');
    const ringDuration = durationRadio ? Math.min(Math.max(parseInt(durationRadio.value, 10) || 15, 1), 15) : 15;

    const newAlarm = {
      id: 'alarm_' + Date.now(),
      hour: String(h).padStart(2, '0'),
      minute: String(m).padStart(2, '0'),
      second: String(s).padStart(2, '0'),
      title: title,
      sound: sound,
      snoozeMinutes: snoozeMinutes,
      durationSeconds: ringDuration,
      enabled: true,
      createdAt: Date.now()
    };

    STATE.alarms.push(newAlarm);
    saveAlarms();

    // Show temporary toast or feedback
    const btn = document.getElementById('saveAlarmBtn');
    const oldText = btn.innerHTML;
    btn.innerHTML = `<span>✅</span> Saqlandi!`;
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';

    setTimeout(() => {
      btn.innerHTML = oldText;
      btn.style.background = '';
    }, 1500);

    // Reset title
    DOM.alarmTitle.value = '';
  });

  // Alarm list delegation (Toggle & Delete)
  DOM.alarmsList.addEventListener('click', (e) => {
    // Delete button
    const delBtn = e.target.closest('.btn-delete-alarm');
    if (delBtn) {
      const id = delBtn.dataset.id;
      STATE.alarms = STATE.alarms.filter(a => a.id !== id);
      saveAlarms();
      return;
    }

    // Toggle switch
    const toggle = e.target.closest('.alarm-toggle');
    if (toggle) {
      const id = toggle.dataset.id;
      const alarm = STATE.alarms.find(a => a.id === id);
      if (alarm) {
        alarm.enabled = toggle.checked;
        saveAlarms();
      }
    }
  });

  // Clear all alarms
  DOM.clearAllAlarmsBtn.addEventListener('click', () => {
    if (confirm("Haqiqatan ham barcha budilniklarni o'chirmoqchimisiz?")) {
      STATE.alarms = [];
      saveAlarms();
    }
  });

  // Ringing Modal Actions
  DOM.stopAlarmBtn.addEventListener('click', () => stopRingingAlarm(false));
  DOM.snoozeAlarmBtn.addEventListener('click', snoozeRingingAlarm);

  // Setup Timer Tab
  setupTimer();

  // Setup Stopwatch Tab
  setupStopwatch();
}

/* ==========================================================
   TAB 2: COUNTDOWN TIMER
   ========================================================== */
function setupTimer() {
  function updateTimerDisplay() {
    const total = STATE.timer.remainingSeconds;
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    DOM.timerDisplay.textContent = `${h}:${m}:${s}`;
  }

  function startTimer() {
    soundEngine.init();

    if (!STATE.timer.isRunning) {
      if (STATE.timer.remainingSeconds <= 0) {
        const h = parseInt(DOM.timerH.value || 0, 10);
        const m = parseInt(DOM.timerM.value || 0, 10);
        const s = parseInt(DOM.timerS.value || 0, 10);
        STATE.timer.totalSeconds = h * 3600 + m * 60 + s;
        STATE.timer.remainingSeconds = STATE.timer.totalSeconds;
      }

      if (STATE.timer.remainingSeconds <= 0) return;

      STATE.timer.isRunning = true;
      DOM.timerStartBtn.style.display = 'none';
      DOM.timerPauseBtn.style.display = 'inline-flex';
      DOM.timerInputsWrap.style.display = 'none';

      STATE.timer.intervalId = setInterval(() => {
        if (STATE.timer.remainingSeconds > 0) {
          STATE.timer.remainingSeconds--;
          updateTimerDisplay();
        } else {
          // Timer finished!
          clearInterval(STATE.timer.intervalId);
          STATE.timer.isRunning = false;
          DOM.timerStartBtn.style.display = 'inline-flex';
          DOM.timerPauseBtn.style.display = 'none';
          DOM.timerInputsWrap.style.display = 'flex';

          triggerAlarm({
            id: 'timer_alarm',
            hour: new Date().getHours(),
            minute: new Date().getMinutes(),
            title: "Taymer vaqti tugadi!",
            sound: "siren",
            snoozeMinutes: 5,
            durationSeconds: 15
          });
        }
      }, 1000);
    }
  }

  function pauseTimer() {
    if (STATE.timer.isRunning) {
      clearInterval(STATE.timer.intervalId);
      STATE.timer.isRunning = false;
      DOM.timerStartBtn.style.display = 'inline-flex';
      DOM.timerPauseBtn.style.display = 'none';
    }
  }

  function resetTimer() {
    pauseTimer();
    const h = parseInt(DOM.timerH.value || 0, 10);
    const m = parseInt(DOM.timerM.value || 0, 10);
    const s = parseInt(DOM.timerS.value || 0, 10);
    STATE.timer.totalSeconds = h * 3600 + m * 60 + s;
    STATE.timer.remainingSeconds = STATE.timer.totalSeconds;
    DOM.timerInputsWrap.style.display = 'flex';
    updateTimerDisplay();
  }

  DOM.timerStartBtn.addEventListener('click', startTimer);
  DOM.timerPauseBtn.addEventListener('click', pauseTimer);
  DOM.timerResetBtn.addEventListener('click', resetTimer);

  DOM.timerPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pauseTimer();
      const sec = parseInt(btn.dataset.sec, 10);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;

      DOM.timerH.value = String(h).padStart(2, '0');
      DOM.timerM.value = String(m).padStart(2, '0');
      DOM.timerS.value = String(s).padStart(2, '0');

      STATE.timer.totalSeconds = sec;
      STATE.timer.remainingSeconds = sec;
      updateTimerDisplay();
    });
  });

  // Handle manual input changes
  [DOM.timerH, DOM.timerM, DOM.timerS].forEach(input => {
    input.addEventListener('change', () => {
      if (!STATE.timer.isRunning) {
        resetTimer();
      }
    });
  });

  resetTimer();
}

/* ==========================================================
   TAB 3: STOPWATCH
   ========================================================== */
function setupStopwatch() {
  function formatStopwatch(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    const hundredths = String(Math.floor((ms % 1000) / 10)).padStart(2, '0');

    return `${h}:${m}:${s}.<span class="millis">${hundredths}</span>`;
  }

  function renderStopwatch() {
    DOM.stopwatchDisplay.innerHTML = formatStopwatch(STATE.stopwatch.elapsedTime);
  }

  function startStopwatch() {
    if (!STATE.stopwatch.isRunning) {
      STATE.stopwatch.isRunning = true;
      STATE.stopwatch.startTime = performance.now() - STATE.stopwatch.elapsedTime;
      DOM.swStartBtn.textContent = "⏸️ To'xtatish";
      DOM.swStartBtn.classList.remove('btn-primary');
      DOM.swStartBtn.classList.add('btn-secondary');
      DOM.swLapBtn.disabled = false;
      DOM.swResetBtn.disabled = false;

      STATE.stopwatch.intervalId = setInterval(() => {
        STATE.stopwatch.elapsedTime = performance.now() - STATE.stopwatch.startTime;
        renderStopwatch();
      }, 33);
    } else {
      // Pause
      clearInterval(STATE.stopwatch.intervalId);
      STATE.stopwatch.isRunning = false;
      DOM.swStartBtn.textContent = "▶️ Davom ettirish";
      DOM.swStartBtn.classList.add('btn-primary');
      DOM.swStartBtn.classList.remove('btn-secondary');
    }
  }

  function resetStopwatch() {
    clearInterval(STATE.stopwatch.intervalId);
    STATE.stopwatch.isRunning = false;
    STATE.stopwatch.elapsedTime = 0;
    STATE.stopwatch.laps = [];
    DOM.swStartBtn.textContent = "▶️ Boshlash";
    DOM.swStartBtn.classList.add('btn-primary');
    DOM.swStartBtn.classList.remove('btn-secondary');
    DOM.swLapBtn.disabled = true;
    DOM.swResetBtn.disabled = true;
    DOM.lapsContainer.style.display = 'none';
    DOM.lapsList.innerHTML = '';
    renderStopwatch();
  }

  function recordLap() {
    if (!STATE.stopwatch.isRunning) return;
    const currentMs = STATE.stopwatch.elapsedTime;
    const lapNum = STATE.stopwatch.laps.length + 1;
    STATE.stopwatch.laps.push(currentMs);

    DOM.lapsContainer.style.display = 'block';
    const li = document.createElement('li');
    li.innerHTML = `<span>#${lapNum} Davra</span> <span>${formatStopwatch(currentMs).replace(/<\/?span[^>]*>/g, '')}</span>`;
    DOM.lapsList.prepend(li);
  }

  DOM.swStartBtn.addEventListener('click', startStopwatch);
  DOM.swResetBtn.addEventListener('click', resetStopwatch);
  DOM.swLapBtn.addEventListener('click', recordLap);
}

// Utility: HTML escape
function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// Utility: Toast notification
function showToast(message, type = 'info') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>⏱️</span> <span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 3500);
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', initApp);
