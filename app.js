/**
 * ==========================================================
 * SMART QO'NG'IROQ - MAKTAB AVTOMATIK QO'NG'IROQ TIZIMI
 * ==========================================================
 * Xususiyatlar:
 * - Real-time raqamli soat (O'zbekcha mahalliylashtirish & 12/24H format)
 * - Haqiqiy maktab qo'ng'irog'i (MP3) va Web Audio API sintezatori
 * - Standart 1-smena dars jadvalini bitta tugma bilan yuklash (6 ta dars va tanaffuslar)
 * - Tezkor dars nomlari tanlagichi (1-dars, tanaffus, katta tanaffus...)
 * - Saqlanadigan qo'ng'iroqlar (localStorage) va kechiktirish (snooze)
 * - To'liq ekranli jarangdor ogohlantirish oynasi (maks. 15 soniya xavfsiz davomiylik)
 * - Dars va tanaffus taymeri (45 daq, 5 daq, 15 daq, 20 daq)
 * - Sport mashg'ulotlari va musobaqalar uchun sekundomer
 */

// State Management
const STATE = {
  is24Hour: true,
  bigBreakDuration: parseInt(localStorage.getItem('smart_qongiroq_big_break') || '10', 10),
  alarms: [],
  activeRingingAlarm: null,
  ringingIntervalId: null,
  ringingTimeoutId: null,
  ringingCountdownIntervalId: null,
  previewTimeoutId: null,
  previewIntervalId: null,
  timer: {
    totalSeconds: 2700, // 45 minutes default for school lesson
    remainingSeconds: 2700,
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

/**
 * ==========================================================
 * TANAFFUS (PERERYV) VA DARS JADVALI LOGIKASI
 * ==========================================================
 * Qoidalar:
 * - Oddiy tanaffus (qisqa: 5 daq) faqat darslar orasida bo'ladi (1->2, 2->3, 4->5, 5->6).
 * - Katta tanaffus (uzun: 15 daq) FAQAT 3-darsdan keyin bo'ladi.
 * - Oxirgi darsdan keyin tanaffus bo'lmaydi (0 daq), darslar yakunlanadi.
 */

/**
 * Dars raqamiga qarab tanaffus davomiyligini hisoblovchi funksiya
 * @param {number} lessonNumber - Dars raqami (1, 2, 3...)
 * @param {number} totalLessons - Jami darslar soni (standart: 6)
 * @param {number} [customLongBreak] - Katta tanaffus davomiyligi (10 yoki 5 daqiqa)
 * @returns {number} Tanaffus davomiyligi daqiqalarda
 */
function getBreakDuration(lessonNumber, totalLessons = 6, customLongBreak = null) {
  // Oxirgi darsdan keyin tanaffus bo'lmaydi
  if (lessonNumber >= totalLessons) {
    return 0;
  }
  // Katta tanaffus FAQAT 3-darsdan keyin bo'ladi (10 daqiqa yoki 5 daqiqaga kichraytirilgan)
  if (lessonNumber === 3) {
    if (customLongBreak !== null && customLongBreak !== undefined) {
      return customLongBreak;
    }
    return (STATE && STATE.bigBreakDuration) ? STATE.bigBreakDuration : 10;
  }
  // Oddiy tanaffus (qisqa) faqat darslar orasida: 5 daqiqa
  return 5;
}

/**
 * Maktab dars jadvali va qo'ng'iroqlari vaqtlarini qoidaga mos hisoblovchi funksiya
 * @param {Object} options
 * @param {number} [options.startHour=8] - Boshlanish soati
 * @param {number} [options.startMinute=0] - Boshlanish daqiqasi
 * @param {number} [options.totalLessons=6] - Jami darslar soni
 * @param {number} [options.lessonDuration=45] - Dars davomiyligi (daqiqa)
 * @param {number} [options.longBreakDuration] - Katta tanaffus (10 yoki 5 daqiqa)
 * @returns {Array<{hour: string, minute: string, second: string, title: string}>}
 */
function calculateSchoolSchedule(options = {}) {
  const {
    startHour = 8,
    startMinute = 0,
    totalLessons = 6,
    lessonDuration = 45,
    longBreakDuration = (STATE && STATE.bigBreakDuration) ? STATE.bigBreakDuration : 10
  } = options;

  const schedule = [];
  let currentTotalMinutes = startHour * 60 + startMinute;

  const formatTime = (totalMin) => {
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return {
      hour: String(h).padStart(2, '0'),
      minute: String(m).padStart(2, '0'),
      second: '00'
    };
  };

  for (let lesson = 1; lesson <= totalLessons; lesson++) {
    // Dars boshlanishi
    const startTime = formatTime(currentTotalMinutes);
    schedule.push({
      hour: startTime.hour,
      minute: startTime.minute,
      second: startTime.second,
      title: `${lesson}-Dars boshlanishi`
    });

    // Dars tugashi
    currentTotalMinutes += lessonDuration;
    const endTime = formatTime(currentTotalMinutes);

    const breakDuration = getBreakDuration(lesson, totalLessons, longBreakDuration);

    if (lesson === totalLessons) {
      // Darslar yakuni (oxirgi darsdan keyin tanaffus qo'shilmaydi)
      schedule.push({
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
        title: "Darslar yakuni (Katta qo'ng'iroq)"
      });
    } else if (lesson === 3) {
      // FAQAT 3-darsdan keyin katta tanaffus
      schedule.push({
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
        title: `Katta tanaffus (${breakDuration} daqiqa)`
      });
      currentTotalMinutes += breakDuration;
    } else {
      // Oddiy qisqa tanaffus
      schedule.push({
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
        title: `${lesson}-Tanaffus (Dars tugashi)`
      });
      currentTotalMinutes += breakDuration;
    }
  }

  return schedule;
}

// Standart 1-smena maktab dars jadvali
function getStandardSchoolSchedule() {
  return calculateSchoolSchedule({
    startHour: 8,
    startMinute: 0,
    totalLessons: 6,
    lessonDuration: 45,
    longBreakDuration: (STATE && STATE.bigBreakDuration) ? STATE.bigBreakDuration : 10
  });
}

/* ==========================================================
   WEB AUDIO API SOUND ENGINE
   Produces crisp, reliable tones without external audio dependencies
   Also manages qongiroq.mp3 audio playback safely
   ========================================================== */
class AlarmAudioEngine {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.engineSafetyTimeoutId = null;
    this.qongiroqAudio = null;
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

  // Play single synthesized note
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
  playAlarmPattern(soundType = 'qongiroq') {
    this.init();
    if (!this.ctx) return;

    switch (soundType) {
      case 'school': {
        // Maktab elektr qo'ng'irog'i (zvonok)
        const strikeCount = 18;
        for (let i = 0; i < strikeCount; i++) {
          const t = i * 0.046;
          this.playTone(1661.22, 'triangle', 0.055, t, 0.26);
          this.playTone(2489.02, 'sine', 0.04, t, 0.18);
          this.playTone(830.61, 'sine', 0.08, t, 0.14);
        }
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
      case 'classic': {
        // Double digital beep: Beep-Beep ... Beep-Beep
        this.playTone(1046.5, 'square', 0.12, 0, 0.25);
        this.playTone(1046.5, 'square', 0.12, 0.18, 0.25);
        this.playTone(1318.5, 'square', 0.12, 0.45, 0.3);
        this.playTone(1318.5, 'square', 0.12, 0.63, 0.3);
        break;
      }
      case 'siren': {
        // Urgent rising siren pulse
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
  startContinuousRinging(soundType = 'qongiroq', maxDurationSec = 15) {
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
  previewSound(soundType = 'qongiroq', onEndCallback) {
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
      }, 5500);
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

  // Bell Form
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
  loadStandardScheduleBtn: document.getElementById('loadStandardScheduleBtn'),
  break10Btn: document.getElementById('break10Btn'),
  break5Btn: document.getElementById('break5Btn'),
  currentBreakBadge: document.getElementById('currentBreakBadge'),
  breakTimeHint: document.getElementById('breakTimeHint'),
  presetChipL4: document.getElementById('presetChipL4'),
  presetChipB4: document.getElementById('presetChipB4'),
  presetChipL5: document.getElementById('presetChipL5'),
  presetChipEnd: document.getElementById('presetChipEnd'),

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
  setInterval(updateLiveClock, 500); // Check time & bells twice every second

  // Set initial big break duration state & update UI
  setBigBreakDuration(STATE.bigBreakDuration || 10);

  // Set default form time to +5 minutes from now
  setDefaultFormTime(5);

  // Request notification permission if available
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/**
 * Katta tanaffus davomiyligini (10 yoki 5 daqiqa) almashtirish funksiyasi
 * @param {number} duration - 10 yoki 5 daqiqa
 */
function setBigBreakDuration(duration) {
  STATE.bigBreakDuration = duration;
  try {
    localStorage.setItem('smart_qongiroq_big_break', String(duration));
  } catch (e) {}

  // Update UI toggle buttons
  if (DOM.break10Btn && DOM.break5Btn) {
    DOM.break10Btn.classList.toggle('active', duration === 10);
    DOM.break5Btn.classList.toggle('active', duration === 5);
  }

  // Update badge
  if (DOM.currentBreakBadge) {
    DOM.currentBreakBadge.textContent = `${duration} daqiqa`;
  }

  // Update live explanatory hint
  if (DOM.breakTimeHint) {
    if (duration === 5) {
      DOM.breakTimeHint.innerHTML = `📌 <b>Qisqartirilgan:</b> 3-dars (10:25) ➔ 5 daq tanaffus ➔ 4-dars (10:30) ➔ 11:15 tugashi ➔ 11:20 5-dars ➔ 6-dars yakuni: <b>12:55</b>`;
    } else {
      DOM.breakTimeHint.innerHTML = `📌 <b>Standart:</b> 3-dars (10:25) ➔ 10 daq tanaffus ➔ 4-dars (10:35) ➔ 11:20 tugashi ➔ 11:25 5-dars ➔ 6-dars yakuni: <b>13:00</b>`;
    }
  }

  // Update Preset Chips on the left
  if (DOM.presetChipL4) {
    const timeL4 = duration === 5 ? "10:30" : "10:35";
    DOM.presetChipL4.dataset.time = timeL4;
    DOM.presetChipL4.textContent = `${timeL4} (4-dars)`;
  }
  if (DOM.presetChipB4) {
    const timeB4 = duration === 5 ? "11:15" : "11:20";
    DOM.presetChipB4.dataset.time = timeB4;
    DOM.presetChipB4.textContent = `${timeB4} (4-tanaffus)`;
  }
  if (DOM.presetChipL5) {
    const timeL5 = duration === 5 ? "11:20" : "11:25";
    DOM.presetChipL5.dataset.time = timeL5;
    DOM.presetChipL5.textContent = `${timeL5} (5-dars)`;
  }
  if (DOM.presetChipEnd) {
    const timeEnd = duration === 5 ? "12:55" : "13:00";
    DOM.presetChipEnd.dataset.time = timeEnd;
    DOM.presetChipEnd.textContent = `${timeEnd} (Dars yakuni)`;
  }
}

// Set initial input time offset (e.g. current time + 5 min)
function setDefaultFormTime(minutesOffset = 5) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + minutesOffset);

  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');

  if (DOM.alarmHour) DOM.alarmHour.value = h;
  if (DOM.alarmMinute) DOM.alarmMinute.value = m;
  if (DOM.alarmSecond) DOM.alarmSecond.value = "00";
}

// Load bells from localStorage (with legacy compatibility)
function loadAlarms() {
  try {
    let saved = localStorage.getItem('smart_qongiroq_alarms');
    if (!saved) {
      saved = localStorage.getItem('smart_budilnik_alarms');
    }

    if (saved) {
      STATE.alarms = JSON.parse(saved);
      // Strictly enforce max 15 seconds ringing duration on all loaded bells
      STATE.alarms.forEach(a => {
        const d = parseInt(a.durationSeconds, 10);
        if (isNaN(d) || d > 15 || d <= 0) {
          a.durationSeconds = 15;
        }
        if (!a.sound) a.sound = 'qongiroq';
      });
    }
  } catch (err) {
    console.error("Qo'ng'iroqlarni yuklashda xatolik:", err);
    STATE.alarms = [];
  }
  renderAlarmsList();
  updateUpcomingAlarmBadge();
}

// Save bells to localStorage
function saveAlarms() {
  try {
    localStorage.setItem('smart_qongiroq_alarms', JSON.stringify(STATE.alarms));
  } catch (err) {
    console.error("Qo'ng'iroqlarni saqlashda xatolik:", err);
  }
  renderAlarmsList();
  updateUpcomingAlarmBadge();
}

/* ==========================================================
   STANDARD SCHOOL TIMETABLE LOADER
   ========================================================== */
function loadStandardSchoolSchedule() {
  const currentSchedule = getStandardSchoolSchedule();
  const breakLabel = (STATE.bigBreakDuration === 5) ? "5 daqiqa (qisqartirilgan)" : "10 daqiqa (standart)";

  if (STATE.alarms.length > 0) {
    const shouldAdd = confirm(`1-smena dars jadvali (${breakLabel} katta tanaffus bilan) yuklansinmi?\n\nMavjud jadval yangilanadi.`);
    if (!shouldAdd) return;

    // Avvalgi dars jadvali qo'ng'iroqlarini tozalab, to'liq yangisini joylash
    STATE.alarms = STATE.alarms.filter(a => !a.id.startsWith('bell_std_'));
  }

  let addedCount = 0;
  currentSchedule.forEach((item, index) => {
    STATE.alarms.push({
      id: 'bell_std_' + Date.now() + '_' + index,
      hour: item.hour,
      minute: item.minute,
      second: item.second,
      title: item.title,
      sound: 'qongiroq',
      snoozeMinutes: 5,
      durationSeconds: 15,
      enabled: true,
      createdAt: Date.now() + index
    });
    addedCount++;
  });

  saveAlarms();
  showToast(`🏫 Dars jadvali (${breakLabel} tanaffus, ${addedCount} ta qo'ng'iroq) yuklandi!`, "success");
}

/* ==========================================================
   LIVE CLOCK & BELL TICKER
   ========================================================== */
function updateLiveClock() {
  const now = new Date();

  // Current Date in Uzbek
  const dayName = UZ_DAYS[now.getDay()];
  const dayNum = now.getDate();
  const monthName = UZ_MONTHS[now.getMonth()];
  const year = now.getFullYear();
  if (DOM.currentDate) {
    DOM.currentDate.textContent = `${dayName}, ${dayNum}-${monthName}, ${year}`;
  }

  // Time format calculations
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  let ampm = "";

  if (!STATE.is24Hour) {
    ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
  }

  const hoursStr = String(hours).padStart(2, '0');
  if (DOM.currentTime) {
    DOM.currentTime.textContent = `${hoursStr}:${minutes}:${seconds}`;
  }
  if (DOM.currentAmPm) {
    DOM.currentAmPm.textContent = ampm;
  }

  // Check active bells
  checkAlarmTriggers(now);

  // Update countdowns on bell cards every 10 seconds or when minute rolls
  if (now.getSeconds() % 10 === 0) {
    updateUpcomingAlarmBadge();
    updateAlarmsCountdownBadges();
  }
}

/* ==========================================================
   BELL TRIGGER CHECKER
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

// Trigger Bell Ringing (Max 15 seconds)
function triggerAlarm(alarm) {
  STATE.activeRingingAlarm = alarm;

  // Enforce max 15 seconds ringing duration
  const MAX_RING_SECONDS = 15;
  const durationSec = Math.min(Math.max(parseInt(alarm.durationSeconds || MAX_RING_SECONDS, 10), 1), MAX_RING_SECONDS);

  // Sound playback (default: qongiroq MP3)
  soundEngine.startContinuousRinging(alarm.sound || 'qongiroq', durationSec);

  // Update Ringing Modal text
  const timeFormatted = `${String(alarm.hour).padStart(2, '0')}:${String(alarm.minute).padStart(2, '0')}`;
  if (DOM.ringingClock) DOM.ringingClock.textContent = timeFormatted;
  if (DOM.ringingTitle) DOM.ringingTitle.textContent = alarm.title || "Dars qo'ng'irog'i";
  if (DOM.ringingDescription) {
    DOM.ringingDescription.textContent = `Rejalashtirilgan vaqt (${timeFormatted}) yetib keldi! Dars yoki tanaffus boshlandi.`;
  }
  if (DOM.snoozeBtnText) {
    DOM.snoozeBtnText.textContent = `Kechiktirish (+${alarm.snoozeMinutes || 5} daqiqa)`;
  }

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

  // Auto-stop bell after at most 15 seconds
  STATE.ringingTimeoutId = setTimeout(() => {
    stopRingingAlarm(true);
  }, durationSec * 1000);

  // Show modal
  if (DOM.ringingModal) DOM.ringingModal.style.display = 'flex';

  // Flash tab title
  startTitleFlash(alarm.title || "Dars qo'ng'irog'i");

  // Web Notification
  showDesktopNotification(alarm);
}

// Stop Ringing Bell
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
  if (DOM.ringingModal) DOM.ringingModal.style.display = 'none';

  if (isAutoStopped) {
    showToast("Maktab qo'ng'irog'i 15 soniya jaranglab, avtomatik to'xtatildi", "info");
  }

  if (STATE.activeRingingAlarm) {
    STATE.activeRingingAlarm = null;
  }
}

// Snooze Ringing Bell
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

  // Update existing bell
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
    document.title = toggle ? `🔔 QO'NG'IROQ: ${title}! 🔔` : `🔔 JIRINGLAMOQDA! 🔔`;
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
      new Notification(`Maktab Qo'ng'irog'i: ${alarm.title || "Vaqt bo'ldi!"}`, {
        body: `${String(alarm.hour).padStart(2, '0')}:${String(alarm.minute).padStart(2, '0')} - Dars yoki tanaffus vaqti yetib keldi!`,
        icon: 'https://cdn-icons-png.flaticon.com/512/864/864685.png',
        requireInteraction: true
      });
    } catch (e) {
      console.warn("Notification yaratib bo'lmadi:", e);
    }
  }
}

/* ==========================================================
   BELLS LIST RENDERING & MANAGEMENT
   ========================================================== */
function renderAlarmsList() {
  if (!DOM.alarmsList) return;
  DOM.alarmsList.innerHTML = '';

  if (STATE.alarms.length === 0) {
    if (DOM.emptyState) {
      DOM.emptyState.style.display = 'flex';
      DOM.alarmsList.appendChild(DOM.emptyState);
    }
    if (DOM.alarmCountSubtitle) {
      DOM.alarmCountSubtitle.textContent = "0 ta o'rnatilgan qo'ng'iroq";
    }
    if (DOM.clearAllAlarmsBtn) {
      DOM.clearAllAlarmsBtn.style.display = 'none';
    }
    return;
  }

  if (DOM.emptyState) DOM.emptyState.style.display = 'none';
  if (DOM.clearAllAlarmsBtn) DOM.clearAllAlarmsBtn.style.display = 'inline-block';
  if (DOM.alarmCountSubtitle) {
    DOM.alarmCountSubtitle.textContent = `${STATE.alarms.length} ta rejalashtirilgan qo'ng'iroq`;
  }

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
          <span class="alarm-item-title">${escapeHtml(alarm.title || "Dars qo'ng'irog'i")}</span>
          <span class="alarm-item-duration" title="Qo'ng'iroq davomiyligi: maks. 15 soniya">⏱️ ${alarm.durationSeconds || 15}s</span>
          <span class="alarm-item-countdown" data-countdown-id="${alarm.id}">${countdownText}</span>
        </div>
      </div>
      <div class="alarm-item-right">
        <label class="switch" title="${alarm.enabled ? "Qo'ng'iroqni o'chirish" : "Qo'ng'iroqni yoqish"}">
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

// Calculate milliseconds until bell triggers next
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

// Update the top hero banner with the nearest upcoming bell
function updateUpcomingAlarmBadge() {
  if (!DOM.upcomingBanner || !DOM.upcomingAlarmText) return;

  const activeAlarms = STATE.alarms.filter(a => a.enabled);
  if (activeAlarms.length === 0) {
    DOM.upcomingBanner.className = "upcoming-banner";
    DOM.upcomingAlarmText.textContent = "Hozircha faol qo'ng'iroq yo'q";
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
  const titleStr = nearest.title ? ` (${nearest.title})` : '';

  DOM.upcomingBanner.className = "upcoming-banner has-alarm";
  DOM.upcomingAlarmText.textContent = `Keyingi qo'ng'iroq: ${timeStr}${titleStr} - ${cdText}`;
}

/* ==========================================================
   EVENT LISTENERS & USER INTERACTIONS
   ========================================================== */
function setupEventListeners() {
  // Global AudioContext unlocker on first click or touch
  const unlockAudio = () => {
    soundEngine.init();
    if (DOM.audioUnlockBanner) {
      DOM.audioUnlockBanner.style.display = 'none';
    }
  };
  window.addEventListener('click', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  if (DOM.unlockAudioBtn) {
    DOM.unlockAudioBtn.addEventListener('click', unlockAudio);
  }

  // Tab Switching
  DOM.navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      DOM.navTabs.forEach(t => t.classList.remove('active'));
      DOM.tabContents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.dataset.tab;
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  // 12/24 Hour format toggle
  if (DOM.formatToggleBtn) {
    DOM.formatToggleBtn.addEventListener('click', () => {
      STATE.is24Hour = !STATE.is24Hour;
      if (DOM.formatLabel) {
        DOM.formatLabel.textContent = STATE.is24Hour ? "24H" : "12H";
      }
      updateLiveClock();
      renderAlarmsList();
    });
  }

  // Quick school bell sound tester in header
  if (DOM.soundTestQuickBtn) {
    DOM.soundTestQuickBtn.addEventListener('click', () => {
      soundEngine.init();
      soundEngine.previewSound('qongiroq');
    });
  }

  // Form Stepper buttons
  document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetInput = document.getElementById(btn.dataset.step);
      if (!targetInput) return;
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
    if (!input) return;
    input.addEventListener('blur', () => {
      let val = parseInt(input.value || 0, 10);
      const max = parseInt(input.max, 10);
      const min = parseInt(input.min, 10);
      if (isNaN(val) || val < min) val = min;
      if (val > max) val = max;
      input.value = String(val).padStart(2, '0');
    });
  });

  // Quick preset pills (Schedule times or offsets)
  document.querySelectorAll('.preset-chip[data-time], .preset-chip[data-offset]').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.time) {
        const parts = chip.dataset.time.split(':');
        if (DOM.alarmHour) DOM.alarmHour.value = parts[0];
        if (DOM.alarmMinute) DOM.alarmMinute.value = parts[1];
        if (DOM.alarmSecond) DOM.alarmSecond.value = "00";
      } else if (chip.dataset.offset) {
        const offset = parseInt(chip.dataset.offset, 10);
        setDefaultFormTime(offset);
      }

      if (chip.dataset.title && DOM.alarmTitle) {
        DOM.alarmTitle.value = chip.dataset.title;
      }

      // Flash feedback
      chip.style.transform = 'scale(0.95)';
      setTimeout(() => { chip.style.transform = ''; }, 150);
    });
  });

  // Quick lesson title chips
  document.querySelectorAll('.title-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (DOM.alarmTitle) {
        DOM.alarmTitle.value = chip.dataset.title || '';
        DOM.alarmTitle.focus();
      }
      chip.style.transform = 'scale(0.95)';
      setTimeout(() => { chip.style.transform = ''; }, 150);
    });
  });

  // Big break duration toggle buttons (10 daqiqa yoki 5 daqiqa qisqartirish)
  if (DOM.break10Btn) {
    DOM.break10Btn.addEventListener('click', () => {
      setBigBreakDuration(10);
      showToast("🥪 Katta tanaffus 10 daqiqa (standart) qilib belgilandi", "info");
    });
  }
  if (DOM.break5Btn) {
    DOM.break5Btn.addEventListener('click', () => {
      setBigBreakDuration(5);
      showToast("⚡ Katta tanaffus 5 daqiqa (qisqartirilgan) qilib belgilandi: 10:30 da 4-dars!", "info");
    });
  }

  // Standard school schedule loader button
  if (DOM.loadStandardScheduleBtn) {
    DOM.loadStandardScheduleBtn.addEventListener('click', loadStandardSchoolSchedule);
  }

  // Preview / Test Sound Button
  let isTesting = false;
  if (DOM.testSoundBtn) {
    DOM.testSoundBtn.addEventListener('click', () => {
      soundEngine.init();
      const selectedSound = DOM.alarmSound ? DOM.alarmSound.value : 'qongiroq';

      if (!isTesting) {
        isTesting = true;
        if (DOM.testIcon) DOM.testIcon.textContent = "⏹️";
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
  }

  // ==========================================================
  // SUBMIT NEW BELL - ROBUST & BUG-FREE (CANNOT GET STUCK)
  // ==========================================================
  const DEFAULT_SAVE_BTN_HTML = `<span class="btn-icon-inside">🔔</span> Qo'ng'iroqni o'rnatish`;
  let saveBtnTimeoutId = null;

  if (DOM.alarmForm) {
    DOM.alarmForm.addEventListener('submit', (e) => {
      e.preventDefault();
      soundEngine.init();

      const btn = document.getElementById('saveAlarmBtn');
      if (saveBtnTimeoutId) {
        clearTimeout(saveBtnTimeoutId);
        saveBtnTimeoutId = null;
      }

      try {
        let h = parseInt(DOM.alarmHour.value || 0, 10);
        let m = parseInt(DOM.alarmMinute.value || 0, 10);
        let s = parseInt(DOM.alarmSecond.value || 0, 10);

        // Validate boundaries
        if (isNaN(h) || h < 0 || h > 23) h = 0;
        if (isNaN(m) || m < 0 || m > 59) m = 0;
        if (isNaN(s) || s < 0 || s > 59) s = 0;

        const title = DOM.alarmTitle.value.trim() || "Dars qo'ng'irog'i";
        const sound = DOM.alarmSound.value || "qongiroq";
        const snoozeRadio = document.querySelector('input[name="snoozeTime"]:checked');
        const snoozeMinutes = snoozeRadio ? parseInt(snoozeRadio.value, 10) : 5;

        // Enforce maximum 15 seconds duration
        const durationRadio = document.querySelector('input[name="ringDuration"]:checked');
        const ringDuration = durationRadio ? Math.min(Math.max(parseInt(durationRadio.value, 10) || 15, 1), 15) : 15;

        const newAlarm = {
          id: 'bell_' + Date.now(),
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

        // Reset title input
        DOM.alarmTitle.value = '';

        // Safe visual feedback on button: disable to prevent spam, reliably restore
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<span>✅</span> Muvaffaqiyatli saqlandi!`;
          btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';

          saveBtnTimeoutId = setTimeout(() => {
            btn.innerHTML = DEFAULT_SAVE_BTN_HTML;
            btn.style.background = '';
            btn.disabled = false;
            saveBtnTimeoutId = null;
          }, 1200);
        }

        showToast("🔔 Qo'ng'iroq muvaffaqiyatli saqlandi!", "success");
      } catch (err) {
        console.error("Qo'ng'iroqni saqlashda xatolik:", err);
        if (btn) {
          btn.innerHTML = DEFAULT_SAVE_BTN_HTML;
          btn.style.background = '';
          btn.disabled = false;
        }
        showToast("Xatolik yuz berdi!", "warning");
      }
    });
  }

  // Bell list delegation (Toggle & Delete)
  if (DOM.alarmsList) {
    DOM.alarmsList.addEventListener('click', (e) => {
      // Delete button
      const delBtn = e.target.closest('.btn-delete-alarm');
      if (delBtn) {
        const id = delBtn.dataset.id;
        STATE.alarms = STATE.alarms.filter(a => a.id !== id);
        saveAlarms();
        showToast("Qo'ng'iroq o'chirildi", "info");
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
  }

  // Clear all bells
  if (DOM.clearAllAlarmsBtn) {
    DOM.clearAllAlarmsBtn.addEventListener('click', () => {
      if (confirm("Haqiqatan ham barcha qo'ng'iroqlarni o'chirmoqchimisiz?")) {
        STATE.alarms = [];
        saveAlarms();
        showToast("Barcha qo'ng'iroqlar tozalandi", "info");
      }
    });
  }

  // Ringing Modal Actions
  if (DOM.stopAlarmBtn) {
    DOM.stopAlarmBtn.addEventListener('click', () => stopRingingAlarm(false));
  }
  if (DOM.snoozeAlarmBtn) {
    DOM.snoozeAlarmBtn.addEventListener('click', snoozeRingingAlarm);
  }

  // Setup Timer Tab
  setupTimer();

  // Setup Stopwatch Tab
  setupStopwatch();
}

/* ==========================================================
   TAB 2: DARS VA TANAFFUS TAYMERI
   ========================================================== */
function setupTimer() {
  function updateTimerDisplay() {
    const total = STATE.timer.remainingSeconds;
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    if (DOM.timerDisplay) {
      DOM.timerDisplay.textContent = `${h}:${m}:${s}`;
    }
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
      if (DOM.timerStartBtn) DOM.timerStartBtn.style.display = 'none';
      if (DOM.timerPauseBtn) DOM.timerPauseBtn.style.display = 'inline-flex';
      if (DOM.timerInputsWrap) DOM.timerInputsWrap.style.display = 'none';

      STATE.timer.intervalId = setInterval(() => {
        if (STATE.timer.remainingSeconds > 0) {
          STATE.timer.remainingSeconds--;
          updateTimerDisplay();
        } else {
          // Timer finished!
          clearInterval(STATE.timer.intervalId);
          STATE.timer.isRunning = false;
          if (DOM.timerStartBtn) DOM.timerStartBtn.style.display = 'inline-flex';
          if (DOM.timerPauseBtn) DOM.timerPauseBtn.style.display = 'none';
          if (DOM.timerInputsWrap) DOM.timerInputsWrap.style.display = 'flex';

          triggerAlarm({
            id: 'timer_bell',
            hour: new Date().getHours(),
            minute: new Date().getMinutes(),
            title: "Taymer vaqti tugadi! Dars yoki tanaffus yakunlandi",
            sound: "qongiroq",
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
      if (DOM.timerStartBtn) DOM.timerStartBtn.style.display = 'inline-flex';
      if (DOM.timerPauseBtn) DOM.timerPauseBtn.style.display = 'none';
    }
  }

  function resetTimer() {
    pauseTimer();
    const h = parseInt(DOM.timerH ? DOM.timerH.value : 0, 10);
    const m = parseInt(DOM.timerM ? DOM.timerM.value : 45, 10);
    const s = parseInt(DOM.timerS ? DOM.timerS.value : 0, 10);
    STATE.timer.totalSeconds = h * 3600 + m * 60 + s;
    STATE.timer.remainingSeconds = STATE.timer.totalSeconds;
    if (DOM.timerInputsWrap) DOM.timerInputsWrap.style.display = 'flex';
    updateTimerDisplay();
  }

  if (DOM.timerStartBtn) DOM.timerStartBtn.addEventListener('click', startTimer);
  if (DOM.timerPauseBtn) DOM.timerPauseBtn.addEventListener('click', pauseTimer);
  if (DOM.timerResetBtn) DOM.timerResetBtn.addEventListener('click', resetTimer);

  DOM.timerPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pauseTimer();
      const sec = parseInt(btn.dataset.sec, 10);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;

      if (DOM.timerH) DOM.timerH.value = String(h).padStart(2, '0');
      if (DOM.timerM) DOM.timerM.value = String(m).padStart(2, '0');
      if (DOM.timerS) DOM.timerS.value = String(s).padStart(2, '0');

      STATE.timer.totalSeconds = sec;
      STATE.timer.remainingSeconds = sec;
      updateTimerDisplay();
    });
  });

  // Handle manual input changes
  [DOM.timerH, DOM.timerM, DOM.timerS].forEach(input => {
    if (!input) return;
    input.addEventListener('change', () => {
      if (!STATE.timer.isRunning) {
        resetTimer();
      }
    });
  });

  resetTimer();
}

/* ==========================================================
   TAB 3: MAKTAB SEKUNDOMERI
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
    if (DOM.stopwatchDisplay) {
      DOM.stopwatchDisplay.innerHTML = formatStopwatch(STATE.stopwatch.elapsedTime);
    }
  }

  function startStopwatch() {
    if (!STATE.stopwatch.isRunning) {
      STATE.stopwatch.isRunning = true;
      STATE.stopwatch.startTime = performance.now() - STATE.stopwatch.elapsedTime;
      if (DOM.swStartBtn) {
        DOM.swStartBtn.textContent = "⏸️ To'xtatish";
        DOM.swStartBtn.classList.remove('btn-primary');
        DOM.swStartBtn.classList.add('btn-secondary');
      }
      if (DOM.swLapBtn) DOM.swLapBtn.disabled = false;
      if (DOM.swResetBtn) DOM.swResetBtn.disabled = false;

      STATE.stopwatch.intervalId = setInterval(() => {
        STATE.stopwatch.elapsedTime = performance.now() - STATE.stopwatch.startTime;
        renderStopwatch();
      }, 33);
    } else {
      // Pause
      clearInterval(STATE.stopwatch.intervalId);
      STATE.stopwatch.isRunning = false;
      if (DOM.swStartBtn) {
        DOM.swStartBtn.textContent = "▶️ Davom ettirish";
        DOM.swStartBtn.classList.add('btn-primary');
        DOM.swStartBtn.classList.remove('btn-secondary');
      }
    }
  }

  function resetStopwatch() {
    clearInterval(STATE.stopwatch.intervalId);
    STATE.stopwatch.isRunning = false;
    STATE.stopwatch.elapsedTime = 0;
    STATE.stopwatch.laps = [];
    if (DOM.swStartBtn) {
      DOM.swStartBtn.textContent = "▶️ Boshlash";
      DOM.swStartBtn.classList.add('btn-primary');
      DOM.swStartBtn.classList.remove('btn-secondary');
    }
    if (DOM.swLapBtn) DOM.swLapBtn.disabled = true;
    if (DOM.swResetBtn) DOM.swResetBtn.disabled = true;
    if (DOM.lapsContainer) DOM.lapsContainer.style.display = 'none';
    if (DOM.lapsList) DOM.lapsList.innerHTML = '';
    renderStopwatch();
  }

  function recordLap() {
    if (!STATE.stopwatch.isRunning) return;
    const currentMs = STATE.stopwatch.elapsedTime;
    const lapNum = STATE.stopwatch.laps.length + 1;
    STATE.stopwatch.laps.push(currentMs);

    if (DOM.lapsContainer) DOM.lapsContainer.style.display = 'block';
    const li = document.createElement('li');
    li.innerHTML = `<span>#${lapNum} Davra</span> <span>${formatStopwatch(currentMs).replace(/<\/?span[^>]*>/g, '')}</span>`;
    if (DOM.lapsList) DOM.lapsList.prepend(li);
  }

  if (DOM.swStartBtn) DOM.swStartBtn.addEventListener('click', startStopwatch);
  if (DOM.swResetBtn) DOM.swResetBtn.addEventListener('click', resetStopwatch);
  if (DOM.swLapBtn) DOM.swLapBtn.addEventListener('click', recordLap);
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
  toast.innerHTML = `<span>🔔</span> <span>${escapeHtml(message)}</span>`;
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
