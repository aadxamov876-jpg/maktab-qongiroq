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


/* ==========================================================
   SECURITY HELPERS (input validation / sanitisation)
   ========================================================== */
// Frame-busting: GitHub Pages cannot send X-Frame-Options / frame-ancestors headers
if (window.top !== window.self) {
  try { document.documentElement.style.display = 'none'; } catch (e) { }
  try { window.top.location = window.self.location; } catch (e) { }
}

const MAX_ALARMS = 200;
const MAX_TITLE_LENGTH = 50;
const ALLOWED_SOUNDS = ['barkamol', 'qongiroq', 'school', 'melodic', 'siren', 'gentle', 'classic', 'retro'];
const SHIFT_LIMITS = {
  lessons: [4, 8, 6],
  duration: [20, 90, 45],
  breakDur: [2, 30, 5],
  bigBreak: [2, 30, 5]
};

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function cleanText(value, maxLen, fallback = '') {
  if (typeof value !== 'string') return fallback;
  // strip control characters, collapse whitespace, cap length
  const t = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return t || fallback;
}

function sanitizeShiftCfg(raw, defaults) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  return {
    startH: clampInt(r.startH, 0, 23, defaults.startH),
    startM: clampInt(r.startM, 0, 59, defaults.startM),
    lessons: clampInt(r.lessons, SHIFT_LIMITS.lessons[0], SHIFT_LIMITS.lessons[1], defaults.lessons),
    duration: clampInt(r.duration, SHIFT_LIMITS.duration[0], SHIFT_LIMITS.duration[1], defaults.duration),
    breakDur: clampInt(r.breakDur, SHIFT_LIMITS.breakDur[0], SHIFT_LIMITS.breakDur[1], defaults.breakDur),
    bigBreak: clampInt(r.bigBreak, SHIFT_LIMITS.bigBreak[0], SHIFT_LIMITS.bigBreak[1], defaults.bigBreak)
  };
}

// Validate one bell object coming from localStorage (untrusted input)
function sanitizeAlarm(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = (typeof raw.id === 'string' && /^[A-Za-z0-9_\-]{1,64}$/.test(raw.id))
    ? raw.id : `bell_restored_${Date.now()}_${index}`;
  return {
    id,
    hour: String(clampInt(raw.hour, 0, 23, 0)).padStart(2, '0'),
    minute: String(clampInt(raw.minute, 0, 59, 0)).padStart(2, '0'),
    second: String(clampInt(raw.second, 0, 59, 0)).padStart(2, '0'),
    title: cleanText(raw.title, MAX_TITLE_LENGTH, "Dars qo'ng'irog'i"),
    sound: ALLOWED_SOUNDS.includes(raw.sound) ? raw.sound : 'barkamol',
    snoozeMinutes: clampInt(raw.snoozeMinutes, 1, 60, 5),
    durationSeconds: clampInt(raw.durationSeconds, 1, 60, 60),
    enabled: raw.enabled !== false,
    createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now()
  };
}

// Standart va sozlanuvchi smena parametrlari (1- va 2-smena)
const DEFAULT_SHIFT_SETTINGS = {
  s1: { startH: 8, startM: 0, lessons: 6, duration: 45, breakDur: 5, bigBreak: 5 },
  s2: { startH: 13, startM: 10, lessons: 6, duration: 45, breakDur: 5, bigBreak: 5 }
};

function loadStoredShiftSettings() {
  try {
    const raw = localStorage.getItem('smart_qongiroq_shift_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        s1: sanitizeShiftCfg(parsed && parsed.s1, DEFAULT_SHIFT_SETTINGS.s1),
        s2: sanitizeShiftCfg(parsed && parsed.s2, DEFAULT_SHIFT_SETTINGS.s2)
      };
    }
  } catch (e) {
    console.warn("Shift settings yuklashda xatolik:", e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_SHIFT_SETTINGS));
}

// State Management
const STATE = {
  is24Hour: true,
  bigBreakDuration: (parseInt(localStorage.getItem('smart_qongiroq_big_break') || '5', 10) === 10) ? 10 : 5,
  shiftSettings: loadStoredShiftSettings(),
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
/**
 * Dars raqamiga qarab tanaffus davomiyligini hisoblovchi funksiya
 * @param {number} lessonNumber - Dars raqami (1, 2, 3...)
 * @param {number} totalLessons - Jami darslar soni (standart: 6)
 * @param {number} [customLongBreak] - Katta tanaffus davomiyligi (10 yoki 5 daqiqa)
 * @param {number} [shift=1] - Smena raqami
 * @param {number} [regularBreak=5] - Oddiy tanaffus davomiyligi
 * @returns {number} Tanaffus davomiyligi daqiqalarda
 */
function getBreakDuration(lessonNumber, totalLessons = 6, customLongBreak = null, shift = 1, regularBreak = 5) {
  // Oxirgi darsdan keyin tanaffus bo'lmaydi
  if (lessonNumber >= totalLessons) {
    return 0;
  }
  // 3-darsdan keyin agar katta tanaffus belgilangan bo'lsa
  if (lessonNumber === 3 && customLongBreak !== null && customLongBreak !== undefined) {
    return customLongBreak;
  }
  // Standart tanaffuslar
  return regularBreak || 5;
}

/**
 * Maktab dars jadvali va qo'ng'iroqlari vaqtlarini qoidaga mos hisoblovchi funksiya
 * @param {Object} options
 * @param {number} [options.startHour=8] - Boshlanish soati
 * @param {number} [options.startMinute=0] - Boshlanish daqiqasi
 * @param {number} [options.totalLessons=6] - Jami darslar soni
 * @param {number} [options.lessonDuration=45] - Dars davomiyligi (daqiqa)
 * @param {number} [options.breakDuration=5] - Oddiy tanaffus davomiyligi
 * @param {number} [options.longBreakDuration=5] - Katta tanaffus (10 yoki 5 daqiqa)
 * @param {number} [options.shift=1] - Smena raqami (1 yoki 2)
 * @returns {Array<{hour: string, minute: string, second: string, title: string, sound: string, shift: number}>}
 */
function calculateSchoolSchedule(options = {}) {
  const {
    startHour = 8,
    startMinute = 0,
    totalLessons = 6,
    lessonDuration = 45,
    breakDuration = 5,
    longBreakDuration = 5,
    shift = 1
  } = options;

  const schedule = [];
  // Defensive clamping: prevents huge loops / nonsense times from tampered data
  const safeLessons = clampInt(totalLessons, SHIFT_LIMITS.lessons[0], SHIFT_LIMITS.lessons[1], 6);
  const safeDuration = clampInt(lessonDuration, SHIFT_LIMITS.duration[0], SHIFT_LIMITS.duration[1], 45);
  const safeBreak = clampInt(breakDuration, SHIFT_LIMITS.breakDur[0], SHIFT_LIMITS.breakDur[1], 5);
  const safeLongBreak = clampInt(longBreakDuration, SHIFT_LIMITS.bigBreak[0], SHIFT_LIMITS.bigBreak[1], 5);
  const safeShift = (shift === 2) ? 2 : 1;
  let currentTotalMinutes = clampInt(startHour, 0, 23, 8) * 60 + clampInt(startMinute, 0, 59, 0);

  const formatTime = (totalMin) => {
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return {
      hour: String(h).padStart(2, '0'),
      minute: String(m).padStart(2, '0'),
      second: '00'
    };
  };

  const shiftLabel = `${safeShift}-smena: `;

  for (let lesson = 1; lesson <= safeLessons; lesson++) {
    // Dars boshlanishi (1 minutlik Barkamol avlod qo'shig'i)
    const startTime = formatTime(currentTotalMinutes);
    schedule.push({
      hour: startTime.hour,
      minute: startTime.minute,
      second: startTime.second,
      title: `${shiftLabel}${lesson}-Dars boshlanishi (Barkamol avlod - 1 daq)`,
      sound: 'barkamol', // 1 minutlik Barkamol avlod qo'shig'i!
      durationSeconds: 60,
      shift: safeShift
    });

    // Dars tugashi
    currentTotalMinutes += safeDuration;
    const endTime = formatTime(currentTotalMinutes);

    const currBreakDur = getBreakDuration(lesson, safeLessons, safeLongBreak, safeShift, safeBreak);

    if (lesson === safeLessons) {
      // Darslar yakuni (Oxirgi ohang: 1 minutlik Barkamol avlod!)
      schedule.push({
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
        title: `${shiftLabel}Darslar yakuni (Oxirgi ohang - Barkamol avlod)`,
        sound: 'barkamol', // 1 minutlik Ozodbek Nazarbekov - Barkamol avlod!
        durationSeconds: 60,
        shift: safeShift
      });
    } else if (lesson === 3 && currBreakDur > safeBreak) {
      // Katta tanaffus (1 minutlik Barkamol avlod)
      schedule.push({
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
        title: `${shiftLabel}Katta tanaffus (${currBreakDur} daq - Barkamol avlod)`,
        sound: 'barkamol', // 1 minutlik Barkamol avlod qo'shig'i!
        durationSeconds: 60,
        shift: safeShift
      });
      currentTotalMinutes += currBreakDur;
    } else {
      // Standart tanaffus (1 minutlik Barkamol avlod qo'shig'i)
      schedule.push({
        hour: endTime.hour,
        minute: endTime.minute,
        second: endTime.second,
        title: `${shiftLabel}${lesson}-Tanaffus (Barkamol avlod - 1 daq)`,
        sound: 'barkamol', // 1 minutlik Barkamol avlod qo'shig'i!
        durationSeconds: 60,
        shift: safeShift
      });
      currentTotalMinutes += currBreakDur;
    }
  }

  return schedule;
}

// Standart va sozlanuvchi 1-smena va 2-smena maktab dars jadvali
function getStandardSchoolSchedule(shift = 1) {
  const sKey = shift === 2 ? 's2' : 's1';
  const cfg = (STATE.shiftSettings && STATE.shiftSettings[sKey])
    ? STATE.shiftSettings[sKey]
    : DEFAULT_SHIFT_SETTINGS[sKey];

  const c = sanitizeShiftCfg(cfg, DEFAULT_SHIFT_SETTINGS[sKey]);
  return calculateSchoolSchedule({
    startHour: c.startH,
    startMinute: c.startM,
    totalLessons: c.lessons,
    lessonDuration: c.duration,
    breakDuration: c.breakDur,
    longBreakDuration: c.bigBreak,
    shift: shift
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
    this.barkamolAudio = null;
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

  // Loop pattern until stopped (maxDurationSec: up to 60 seconds / 1 minute)
  startContinuousRinging(soundType = 'barkamol', maxDurationSec = 60) {
    this.stopAll();

    // Safety timeout: up to 60 seconds (1 minute)
    const safeDurationMs = Math.min(Math.max(maxDurationSec || 60, 1), 60) * 1000;
    this.engineSafetyTimeoutId = setTimeout(() => {
      this.stopAll();
    }, safeDurationMs);

    if (soundType === 'barkamol') {
      this.init();
      const audioEl = document.getElementById('barkamolAudio') || new Audio('barkamol_avlod.mp3');
      this.barkamolAudio = audioEl;
      this.barkamolAudio.currentTime = 0;
      this.barkamolAudio.loop = false;
      const playPromise = this.barkamolAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => console.warn("Barkamol avlod play error:", e));
      }
      return;
    }

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
  previewSound(soundType = 'barkamol', onEndCallback) {
    this.stopAll();

    if (soundType === 'barkamol') {
      this.init();
      const audioEl = document.getElementById('barkamolAudio') || new Audio('barkamol_avlod.mp3');
      this.barkamolAudio = audioEl;
      this.barkamolAudio.currentTime = 0;
      this.barkamolAudio.loop = false;
      const playPromise = this.barkamolAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => console.warn("Barkamol preview play error:", e));
      }

      const handleEnd = () => {
        this.stopAll();
        if (onEndCallback) onEndCallback();
        if (this.barkamolAudio) {
          this.barkamolAudio.removeEventListener('ended', handleEnd);
        }
      };
      this.barkamolAudio.addEventListener('ended', handleEnd);

      // Sinov uchun 15 soniya tinglab ko'rish kifoya (yoki to'xtatish tugmasi bor)
      STATE.previewTimeoutId = setTimeout(() => {
        handleEnd();
      }, 15000);
      return;
    }

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
    if (this.barkamolAudio) {
      try {
        this.barkamolAudio.pause();
        this.barkamolAudio.currentTime = 0;
      } catch (e) {
        console.warn("Barkamol audio pause error:", e);
      }
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
  loadShift1Btn: document.getElementById('loadShift1Btn'),
  loadShift2Btn: document.getElementById('loadShift2Btn'),
  loadAllShiftsBtn: document.getElementById('loadAllShiftsBtn'),
  tabPresetShift1: document.getElementById('tabPresetShift1'),
  tabPresetShift2: document.getElementById('tabPresetShift2'),
  presetsRowShift1: document.getElementById('presetsRowShift1'),
  presetsRowShift2: document.getElementById('presetsRowShift2'),
  break10Btn: document.getElementById('break10Btn'),
  break5Btn: document.getElementById('break5Btn'),
  currentBreakBadge: document.getElementById('currentBreakBadge'),
  breakTimeHint: document.getElementById('breakTimeHint'),
  presetChipL4: document.getElementById('presetChipL4'),
  presetChipB4: document.getElementById('presetChipB4'),
  presetChipL5: document.getElementById('presetChipL5'),
  presetChipEnd: document.getElementById('presetChipEnd'),

  // Shift Customizer
  toggleShiftSettingsBtn: document.getElementById('toggleShiftSettingsBtn'),
  shiftSettingsPanel: document.getElementById('shiftSettingsPanel'),
  shiftSettingsArrow: document.getElementById('shiftSettingsArrow'),
  shiftSettingsStatusBadge: document.getElementById('shiftSettingsStatusBadge'),
  tabShiftCfg1: document.getElementById('tabShiftCfg1'),
  tabShiftCfg2: document.getElementById('tabShiftCfg2'),
  shiftConfigForm1: document.getElementById('shiftConfigForm1'),
  shiftConfigForm2: document.getElementById('shiftConfigForm2'),
  cfgS1Start: document.getElementById('cfgS1Start'),
  cfgS1Lessons: document.getElementById('cfgS1Lessons'),
  cfgS1Duration: document.getElementById('cfgS1Duration'),
  cfgS1Break: document.getElementById('cfgS1Break'),
  cfgS1BigBreak: document.getElementById('cfgS1BigBreak'),
  cfgS1Preview: document.getElementById('cfgS1Preview'),
  cfgS2Start: document.getElementById('cfgS2Start'),
  cfgS2Lessons: document.getElementById('cfgS2Lessons'),
  cfgS2Duration: document.getElementById('cfgS2Duration'),
  cfgS2Break: document.getElementById('cfgS2Break'),
  cfgS2BigBreak: document.getElementById('cfgS2BigBreak'),
  cfgS2Preview: document.getElementById('cfgS2Preview'),
  saveShiftConfigBtn: document.getElementById('saveShiftConfigBtn'),
  resetShiftConfigBtn: document.getElementById('resetShiftConfigBtn'),
  shift1ButtonTimeLabel: document.getElementById('shift1ButtonTimeLabel'),
  shift2ButtonTimeLabel: document.getElementById('shift2ButtonTimeLabel'),
  allShiftsButtonTimeLabel: document.getElementById('allShiftsButtonTimeLabel'),

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

  // Set initial big break duration state & update UI (default: 5 min -> 12:55 finish)
  setBigBreakDuration(STATE.bigBreakDuration || 5);

  // Initialize Shift Customizer UI and dynamic elements
  initShiftCustomizerUI();
  updateShiftButtonLabels();
  renderDynamicPresetChips();

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
  duration = (parseInt(duration, 10) === 10) ? 10 : 5;
  STATE.bigBreakDuration = duration;
  try {
    localStorage.setItem('smart_qongiroq_big_break', String(duration));
  } catch (e) { }

  // Update UI toggle buttons
  const b10 = DOM.break10Btn || document.getElementById('break10Btn');
  const b5 = DOM.break5Btn || document.getElementById('break5Btn');
  if (b10) b10.classList.toggle('active', duration === 10);
  if (b5) b5.classList.toggle('active', duration === 5);

  // Update badge
  const badge = DOM.currentBreakBadge || document.getElementById('currentBreakBadge');
  if (badge) {
    badge.textContent = duration === 5 ? "5 daqiqa (12:55 da tugash)" : "10 daqiqa (13:00 da tugash)";
  }

  // Update live explanatory hint
  const hint = DOM.breakTimeHint || document.getElementById('breakTimeHint');
  if (hint) {
    if (duration === 5) {
      hint.innerHTML = `📌 <b>1-smena:</b> 08:00 ➔ 6 ta dars (5 daq tanaffus) ➔ <b>12:55</b> da darslar tugaydi va <b>"Barkamol avlod" (oxirgi ohang)</b> yangraydi!`;
    } else {
      hint.innerHTML = `📌 <b>1-smena (10 daq katta tanaffus bilan):</b> 3-dars (10:25) ➔ 10 daq tanaffus ➔ 4-dars (10:35) ➔ <b>13:00</b> da darslar tugaydi.`;
    }
  }

  // Update Preset Chips on the left
  const pL4 = DOM.presetChipL4 || document.getElementById('presetChipL4');
  const pB4 = DOM.presetChipB4 || document.getElementById('presetChipB4');
  const pL5 = DOM.presetChipL5 || document.getElementById('presetChipL5');
  const pEnd = DOM.presetChipEnd || document.getElementById('presetChipEnd');

  if (pL4) {
    const timeL4 = duration === 5 ? "10:30" : "10:35";
    pL4.dataset.time = timeL4;
    pL4.dataset.sound = "barkamol";
    pL4.dataset.title = "1-smena: 4-Dars boshlanishi";
    pL4.textContent = `🎵 ${timeL4} (4-dars)`;
  }
  if (pB4) {
    const timeB4 = duration === 5 ? "11:15" : "11:20";
    pB4.dataset.time = timeB4;
    pB4.dataset.sound = "barkamol";
    pB4.dataset.title = "1-smena: 4-Tanaffus (Barkamol avlod)";
    pB4.textContent = `${timeB4} (4-tanaffus)`;
  }
  if (pL5) {
    const timeL5 = duration === 5 ? "11:20" : "11:25";
    pL5.dataset.time = timeL5;
    pL5.dataset.sound = "barkamol";
    pL5.dataset.title = "1-smena: 5-Dars boshlanishi";
    pL5.textContent = `🎵 ${timeL5} (5-dars)`;
  }
  if (pEnd) {
    const timeEnd = duration === 5 ? "12:55" : "13:00";
    pEnd.dataset.time = timeEnd;
    pEnd.dataset.sound = "barkamol";
    pEnd.dataset.title = "1-smena: Darslar yakuni (Oxirgi ohang - Barkamol avlod)";
    pEnd.textContent = `🏁 ${timeEnd} (1-smena yakuni)`;
  }
}

// Global click handler for break toggle buttons (accessible via inline onclick and JS)
window.handleBreakToggle = function (duration) {
  duration = parseInt(duration, 10) || 5;
  setBigBreakDuration(duration);
  if (duration === 5) {
    showToast("⚡ 1-smena: 5 daqiqalik tanaffus tartibi (12:55 da dars yakuni va 'Barkamol avlod')", "info");
  } else {
    showToast("🥪 1-smena: 3-darsdan so'ng 10 daqiqa katta tanaffus (13:00 da dars yakuni)", "info");
  }
};

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
      const parsedAlarms = JSON.parse(saved);
      const list = Array.isArray(parsedAlarms) ? parsedAlarms.slice(0, MAX_ALARMS) : [];
      const seenIds = new Set();
      STATE.alarms = list
        .map((a, i) => sanitizeAlarm(a, i))
        .filter(a => a && !seenIds.has(a.id) && seenIds.add(a.id));
      // Standart bo'yicha HAMMASI 1 minutlik Barkamol avlod qo'shig'i bo'lishi ta'minlanadi
      STATE.alarms.forEach(a => {
        a.sound = 'barkamol';
        a.durationSeconds = 60;
      });
      saveAlarms();
    } else {
      // Dastlabki yuklash: Standart 1-smena dars jadvalini tayyorlab qo'yish (hammasi 1 daqiqalik Barkamol avlod)
      const defaultSchedule = getStandardSchoolSchedule(1);
      STATE.alarms = defaultSchedule.map((item, index) => ({
        id: `bell_std_${item.shift || 1}_${Date.now()}_${index}`,
        hour: item.hour,
        minute: item.minute,
        second: item.second,
        title: item.title,
        sound: 'barkamol',
        snoozeMinutes: 5,
        durationSeconds: 60,
        enabled: true,
        createdAt: Date.now() + index
      }));
      saveAlarms();
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
   STANDARD SCHOOL TIMETABLE LOADER (1-SMENA VA 2-SMENA)
   ========================================================== */
function loadSchoolSchedule(shift = 1) {
  let scheduleItems = [];
  let shiftLabel = "";

  if (shift === 1) {
    scheduleItems = getStandardSchoolSchedule(1);
    const breakLabel = (STATE.bigBreakDuration === 10) ? "10 daqiqa katta tanaffus, 13:00 tugash" : "12:55 darslar yakuni";
    shiftLabel = `1-smena (08:00 - 12:55, ${breakLabel})`;
  } else if (shift === 2) {
    scheduleItems = getStandardSchoolSchedule(2);
    shiftLabel = "2-smena (13:10 - 18:05, 18:05 darslar yakuni)";
  } else if (shift === 'all' || shift === 3) {
    scheduleItems = [...getStandardSchoolSchedule(1), ...getStandardSchoolSchedule(2)];
    shiftLabel = "1- va 2-smena to'liq kunlik (08:00 - 18:05)";
  }

  // Confirmation if bells already exist
  if (STATE.alarms.length > 0) {
    let confirmPrompt = `🏫 ${shiftLabel} jadvali yuklansinmi?\n\n`;
    if (shift === 1 && STATE.alarms.some(a => a.id.startsWith('bell_std_2_') || (a.title && a.title.includes('2-smena')))) {
      confirmPrompt += "• Mavjud 2-smena qo'ng'iroqlari saqlanadi, 1-smena yangilanadi.\n• Barcha dars va tanaffuslarda 1 minutlik 'Barkamol avlod' qo'shig'i yangraydi.";
    } else if (shift === 2 && STATE.alarms.some(a => a.id.startsWith('bell_std_1_') || (a.title && a.title.includes('1-smena')))) {
      confirmPrompt += "• Mavjud 1-smena qo'ng'iroqlari saqlanadi, 2-smena qo'shiladi.\n• Barcha dars va tanaffuslarda 1 minutlik 'Barkamol avlod' qo'shig'i yangraydi.";
    } else if (shift === 'all' || shift === 3) {
      confirmPrompt += "• Ertalab 08:00 dan kechki 18:05 gacha bo'lgan barcha 24 ta dars va tanaffus qo'ng'iroqlari yuklanadi.\n• Hammasida 1 minutlik 'Barkamol avlod' qo'shig'i yangraydi.";
    } else {
      confirmPrompt += "• Barcha qo'ng'iroqlarda (dars boshlanishi, tanaffuslar va darslar yakunida) 1 minutlik 'Barkamol avlod' qo'shig'i yangraydi.";
    }

    const shouldAdd = confirm(confirmPrompt);
    if (!shouldAdd) return;

    // Filter out previous bells of this specific shift
    if (shift === 1) {
      STATE.alarms = STATE.alarms.filter(a => !a.id.startsWith('bell_std_1_') && !(a.id.startsWith('bell_std_') && !a.id.startsWith('bell_std_2_')));
    } else if (shift === 2) {
      STATE.alarms = STATE.alarms.filter(a => !a.id.startsWith('bell_std_2_'));
    } else {
      STATE.alarms = STATE.alarms.filter(a => !a.id.startsWith('bell_std_'));
    }
  }

  let addedCount = 0;
  scheduleItems.forEach((item, index) => {
    STATE.alarms.push({
      id: `bell_std_${item.shift || shift}_${Date.now()}_${index}`,
      hour: item.hour,
      minute: item.minute,
      second: item.second,
      title: item.title,
      sound: 'barkamol', // Hammasi 1 minutlik Barkamol avlod!
      snoozeMinutes: 5,
      durationSeconds: 60, // 1 minut jaranglaydi
      enabled: true,
      createdAt: Date.now() + index
    });
    addedCount++;
  });

  saveAlarms();
  const closingText = "Hammasi: 1 daqiqalik 'Barkamol avlod'";
  showToast(`🏫 ${shiftLabel} muvaffaqiyatli yuklandi! (${closingText})`, "success");
}

function loadStandardSchoolSchedule() {
  loadSchoolSchedule(1);
}

/* ==========================================================
   MANUAL SHIFT CUSTOMIZATION LOGIC (1-SMENA VA 2-SMENA SOZLAMALARI)
   ========================================================== */
function parseTimeInput(timeStr, fallbackH = 8, fallbackM = 0) {
  if (!timeStr || !timeStr.includes(':')) {
    return { h: fallbackH, m: fallbackM };
  }
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  if (isNaN(h) || h < 0 || h > 23) h = fallbackH;
  if (isNaN(m) || m < 0 || m > 59) m = fallbackM;
  return { h, m };
}

function formatTimeInputStr(h, m) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function initShiftCustomizerUI() {
  const panel = DOM.shiftSettingsPanel || document.getElementById('shiftSettingsPanel');
  const toggleBtn = DOM.toggleShiftSettingsBtn || document.getElementById('toggleShiftSettingsBtn');
  const arrow = DOM.shiftSettingsArrow || document.getElementById('shiftSettingsArrow');

  const tab1 = DOM.tabShiftCfg1 || document.getElementById('tabShiftCfg1');
  const tab2 = DOM.tabShiftCfg2 || document.getElementById('tabShiftCfg2');
  const form1 = DOM.shiftConfigForm1 || document.getElementById('shiftConfigForm1');
  const form2 = DOM.shiftConfigForm2 || document.getElementById('shiftConfigForm2');

  const s1Start = DOM.cfgS1Start || document.getElementById('cfgS1Start');
  const s1Lessons = DOM.cfgS1Lessons || document.getElementById('cfgS1Lessons');
  const s1Duration = DOM.cfgS1Duration || document.getElementById('cfgS1Duration');
  const s1Break = DOM.cfgS1Break || document.getElementById('cfgS1Break');
  const s1BigBreak = DOM.cfgS1BigBreak || document.getElementById('cfgS1BigBreak');

  const s2Start = DOM.cfgS2Start || document.getElementById('cfgS2Start');
  const s2Lessons = DOM.cfgS2Lessons || document.getElementById('cfgS2Lessons');
  const s2Duration = DOM.cfgS2Duration || document.getElementById('cfgS2Duration');
  const s2Break = DOM.cfgS2Break || document.getElementById('cfgS2Break');
  const s2BigBreak = DOM.cfgS2BigBreak || document.getElementById('cfgS2BigBreak');

  const saveBtn = DOM.saveShiftConfigBtn || document.getElementById('saveShiftConfigBtn');
  const resetBtn = DOM.resetShiftConfigBtn || document.getElementById('resetShiftConfigBtn');

  // Populate inputs from STATE
  const cfg1 = (STATE.shiftSettings && STATE.shiftSettings.s1) ? STATE.shiftSettings.s1 : DEFAULT_SHIFT_SETTINGS.s1;
  const cfg2 = (STATE.shiftSettings && STATE.shiftSettings.s2) ? STATE.shiftSettings.s2 : DEFAULT_SHIFT_SETTINGS.s2;

  if (s1Start) s1Start.value = formatTimeInputStr(cfg1.startH, cfg1.startM);
  if (s1Lessons) s1Lessons.value = String(cfg1.lessons);
  if (s1Duration) s1Duration.value = String(cfg1.duration);
  if (s1Break) s1Break.value = String(cfg1.breakDur);
  if (s1BigBreak) s1BigBreak.value = String(cfg1.bigBreak);

  if (s2Start) s2Start.value = formatTimeInputStr(cfg2.startH, cfg2.startM);
  if (s2Lessons) s2Lessons.value = String(cfg2.lessons);
  if (s2Duration) s2Duration.value = String(cfg2.duration);
  if (s2Break) s2Break.value = String(cfg2.breakDur);
  if (s2BigBreak) s2BigBreak.value = String(cfg2.bigBreak);

  // Toggle open/close drawer
  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      const isClosed = panel.style.display === 'none' || panel.style.display === '';
      panel.style.display = isClosed ? 'flex' : 'none';
      toggleBtn.classList.toggle('open', isClosed);
      if (arrow) arrow.textContent = isClosed ? '▲' : '▼';
    });
  }

  // Tab switching (1-smena vs 2-smena)
  if (tab1 && tab2 && form1 && form2) {
    tab1.addEventListener('click', () => {
      tab1.classList.add('active');
      tab2.classList.remove('active');
      form1.style.display = 'block';
      form2.style.display = 'none';
    });
    tab2.addEventListener('click', () => {
      tab2.classList.add('active');
      tab1.classList.remove('active');
      form1.style.display = 'none';
      form2.style.display = 'block';
    });
  }

  // Live input changes update previews
  [s1Start, s1Lessons, s1Duration, s1Break, s1BigBreak, s2Start, s2Lessons, s2Duration, s2Break, s2BigBreak].forEach(input => {
    if (!input) return;
    input.addEventListener('input', updateShiftCustomizerPreviews);
    input.addEventListener('change', updateShiftCustomizerPreviews);
  });

  // Save button
  if (saveBtn) {
    saveBtn.addEventListener('click', saveCustomShiftSettings);
  }

  // Reset button
  if (resetBtn) {
    resetBtn.addEventListener('click', resetCustomShiftSettings);
  }

  updateShiftCustomizerPreviews();
}

function updateShiftCustomizerPreviews() {
  const s1Start = document.getElementById('cfgS1Start');
  const s1Lessons = document.getElementById('cfgS1Lessons');
  const s1Duration = document.getElementById('cfgS1Duration');
  const s1Break = document.getElementById('cfgS1Break');
  const s1BigBreak = document.getElementById('cfgS1BigBreak');
  const preview1 = document.getElementById('cfgS1Preview');

  const s2Start = document.getElementById('cfgS2Start');
  const s2Lessons = document.getElementById('cfgS2Lessons');
  const s2Duration = document.getElementById('cfgS2Duration');
  const s2Break = document.getElementById('cfgS2Break');
  const s2BigBreak = document.getElementById('cfgS2BigBreak');
  const preview2 = document.getElementById('cfgS2Preview');

  if (s1Start && preview1) {
    const t1 = parseTimeInput(s1Start.value, 8, 0);
    const lessons1 = clampInt(s1Lessons ? s1Lessons.value : 6, SHIFT_LIMITS.lessons[0], SHIFT_LIMITS.lessons[1], 6);
    const dur1 = clampInt(s1Duration ? s1Duration.value : 45, SHIFT_LIMITS.duration[0], SHIFT_LIMITS.duration[1], 45);
    const brk1 = clampInt(s1Break ? s1Break.value : 5, SHIFT_LIMITS.breakDur[0], SHIFT_LIMITS.breakDur[1], 5);
    const bigBrk1 = clampInt(s1BigBreak ? s1BigBreak.value : 5, SHIFT_LIMITS.bigBreak[0], SHIFT_LIMITS.bigBreak[1], 5);

    const tempSched1 = calculateSchoolSchedule({
      startHour: t1.h,
      startMinute: t1.m,
      totalLessons: lessons1,
      lessonDuration: dur1,
      breakDuration: brk1,
      longBreakDuration: bigBrk1,
      shift: 1
    });

    const startStr = tempSched1[0] ? `${tempSched1[0].hour}:${tempSched1[0].minute}` : '08:00';
    const endStr = tempSched1[tempSched1.length - 1] ? `${tempSched1[tempSched1.length - 1].hour}:${tempSched1[tempSched1.length - 1].minute}` : '12:55';
    preview1.innerHTML = `📊 Hisoblangan: <b>${startStr} — ${endStr}</b> (${lessons1} ta dars, ${dur1} daq, tanaffus: ${brk1} daq, barchasida 1 daq Barkamol avlod)`;
  }

  if (s2Start && preview2) {
    const t2 = parseTimeInput(s2Start.value, 13, 10);
    const lessons2 = clampInt(s2Lessons ? s2Lessons.value : 6, SHIFT_LIMITS.lessons[0], SHIFT_LIMITS.lessons[1], 6);
    const dur2 = clampInt(s2Duration ? s2Duration.value : 45, SHIFT_LIMITS.duration[0], SHIFT_LIMITS.duration[1], 45);
    const brk2 = clampInt(s2Break ? s2Break.value : 5, SHIFT_LIMITS.breakDur[0], SHIFT_LIMITS.breakDur[1], 5);
    const bigBrk2 = clampInt(s2BigBreak ? s2BigBreak.value : 5, SHIFT_LIMITS.bigBreak[0], SHIFT_LIMITS.bigBreak[1], 5);

    const tempSched2 = calculateSchoolSchedule({
      startHour: t2.h,
      startMinute: t2.m,
      totalLessons: lessons2,
      lessonDuration: dur2,
      breakDuration: brk2,
      longBreakDuration: bigBrk2,
      shift: 2
    });

    const startStr2 = tempSched2[0] ? `${tempSched2[0].hour}:${tempSched2[0].minute}` : '13:10';
    const endStr2 = tempSched2[tempSched2.length - 1] ? `${tempSched2[tempSched2.length - 1].hour}:${tempSched2[tempSched2.length - 1].minute}` : '18:05';
    preview2.innerHTML = `📊 Hisoblangan: <b>${startStr2} — ${endStr2}</b> (${lessons2} ta dars, ${dur2} daq, tanaffus: ${brk2} daq, barchasida 1 daq Barkamol avlod)`;
  }
}

function saveCustomShiftSettings() {
  const s1Start = document.getElementById('cfgS1Start');
  const s1Lessons = document.getElementById('cfgS1Lessons');
  const s1Duration = document.getElementById('cfgS1Duration');
  const s1Break = document.getElementById('cfgS1Break');
  const s1BigBreak = document.getElementById('cfgS1BigBreak');

  const s2Start = document.getElementById('cfgS2Start');
  const s2Lessons = document.getElementById('cfgS2Lessons');
  const s2Duration = document.getElementById('cfgS2Duration');
  const s2Break = document.getElementById('cfgS2Break');
  const s2BigBreak = document.getElementById('cfgS2BigBreak');

  const t1 = parseTimeInput(s1Start ? s1Start.value : '08:00', 8, 0);
  const t2 = parseTimeInput(s2Start ? s2Start.value : '13:10', 13, 10);

  STATE.shiftSettings = {
    s1: sanitizeShiftCfg({
      startH: t1.h, startM: t1.m,
      lessons: s1Lessons ? s1Lessons.value : 6,
      duration: s1Duration ? s1Duration.value : 45,
      breakDur: s1Break ? s1Break.value : 5,
      bigBreak: s1BigBreak ? s1BigBreak.value : 5
    }, DEFAULT_SHIFT_SETTINGS.s1),
    s2: sanitizeShiftCfg({
      startH: t2.h, startM: t2.m,
      lessons: s2Lessons ? s2Lessons.value : 6,
      duration: s2Duration ? s2Duration.value : 45,
      breakDur: s2Break ? s2Break.value : 5,
      bigBreak: s2BigBreak ? s2BigBreak.value : 5
    }, DEFAULT_SHIFT_SETTINGS.s2)
  };

  try {
    localStorage.setItem('smart_qongiroq_shift_settings', JSON.stringify(STATE.shiftSettings));
  } catch (e) {
    console.error("Sozlamalarni saqlashda xatolik:", e);
  }

  updateShiftButtonLabels();
  renderDynamicPresetChips();

  const applyNow = confirm("✅ Yangi smena vaqtlari muvaffaqiyatli saqlandi!\n\nJoriy dars jadvaliga yangi vaqtlar hoziroq qo'llansinmi?");
  if (applyNow) {
    loadSchoolSchedule(1);
  } else {
    showToast("⚙️ Smena sozlamalari muvaffaqiyatli saqlandi!", "success");
  }
}

function resetCustomShiftSettings() {
  if (!confirm("Haqiqatan ham smena vaqtlarini standart holatga (08:00 va 13:10) qaytarmoqchimisiz?")) {
    return;
  }

  STATE.shiftSettings = JSON.parse(JSON.stringify(DEFAULT_SHIFT_SETTINGS));
  try {
    localStorage.removeItem('smart_qongiroq_shift_settings');
  } catch (e) {
    console.error(e);
  }

  const s1Start = document.getElementById('cfgS1Start');
  const s1Lessons = document.getElementById('cfgS1Lessons');
  const s1Duration = document.getElementById('cfgS1Duration');
  const s1Break = document.getElementById('cfgS1Break');
  const s1BigBreak = document.getElementById('cfgS1BigBreak');

  const s2Start = document.getElementById('cfgS2Start');
  const s2Lessons = document.getElementById('cfgS2Lessons');
  const s2Duration = document.getElementById('cfgS2Duration');
  const s2Break = document.getElementById('cfgS2Break');
  const s2BigBreak = document.getElementById('cfgS2BigBreak');

  if (s1Start) s1Start.value = "08:00";
  if (s1Lessons) s1Lessons.value = "6";
  if (s1Duration) s1Duration.value = "45";
  if (s1Break) s1Break.value = "5";
  if (s1BigBreak) s1BigBreak.value = "5";

  if (s2Start) s2Start.value = "13:10";
  if (s2Lessons) s2Lessons.value = "6";
  if (s2Duration) s2Duration.value = "45";
  if (s2Break) s2Break.value = "5";
  if (s2BigBreak) s2BigBreak.value = "5";

  updateShiftCustomizerPreviews();
  updateShiftButtonLabels();
  renderDynamicPresetChips();

  showToast("🔄 Smena vaqtlari standart holatga qaytarildi!", "info");
}

function updateShiftButtonLabels() {
  const s1Schedule = getStandardSchoolSchedule(1);
  const s2Schedule = getStandardSchoolSchedule(2);

  const s1Start = s1Schedule[0] ? `${s1Schedule[0].hour}:${s1Schedule[0].minute}` : '08:00';
  const s1End = s1Schedule[s1Schedule.length - 1] ? `${s1Schedule[s1Schedule.length - 1].hour}:${s1Schedule[s1Schedule.length - 1].minute}` : '12:55';

  const s2Start = s2Schedule[0] ? `${s2Schedule[0].hour}:${s2Schedule[0].minute}` : '13:10';
  const s2End = s2Schedule[s2Schedule.length - 1] ? `${s2Schedule[s2Schedule.length - 1].hour}:${s2Schedule[s2Schedule.length - 1].minute}` : '18:05';

  const lbl1 = DOM.shift1ButtonTimeLabel || document.getElementById('shift1ButtonTimeLabel');
  const lbl2 = DOM.shift2ButtonTimeLabel || document.getElementById('shift2ButtonTimeLabel');
  const lblAll = DOM.allShiftsButtonTimeLabel || document.getElementById('allShiftsButtonTimeLabel');

  if (lbl1) lbl1.textContent = `${s1Start} — ${s1End} (Hammasi: 1 daq Barkamol avlod)`;
  if (lbl2) lbl2.textContent = `${s2Start} — ${s2End} (Hammasi: 1 daq Barkamol avlod)`;
  if (lblAll) lblAll.textContent = `${s1Start} — ${s2End} (Barchasida 1 daq Barkamol avlod)`;
}

function renderDynamicPresetChips() {
  const rowS1 = DOM.presetsRowShift1 || document.getElementById('presetsRowShift1');
  const rowS2 = DOM.presetsRowShift2 || document.getElementById('presetsRowShift2');

  const s1Schedule = getStandardSchoolSchedule(1);
  const s2Schedule = getStandardSchoolSchedule(2);

  if (rowS1) {
    let html = '';
    s1Schedule.forEach((item) => {
      const timeStr = `${item.hour}:${item.minute}`;
      const isEnd = item.title.includes('Darslar yakuni');
      const isBreak = item.title.includes('Tanaffus');
      const chipClass = isEnd ? 'preset-chip preset-chip-end' : (isBreak ? 'preset-chip preset-chip-break' : 'preset-chip preset-chip-lesson');
      const icon = isEnd ? '🏁' : '🎵';
      let shortLabel = timeStr;
      if (item.title.includes('Dars boshlanishi')) {
        const num = item.title.match(/(\d+)-Dars/);
        shortLabel = `${timeStr} (${num ? num[1] : ''}-dars)`;
      } else if (item.title.includes('Tanaffus')) {
        const num = item.title.match(/(\d+)-Tanaffus/);
        shortLabel = `${timeStr} (${num ? num[1] : ''}-tanaffus)`;
      } else if (item.title.includes('Katta tanaffus')) {
        shortLabel = `${timeStr} (Katta tanaffus)`;
      } else if (isEnd) {
        shortLabel = `${timeStr} (1-smena yakuni)`;
      }

      html += `<button type="button" class="${chipClass}" data-time="${escapeHtml(timeStr)}" data-title="${escapeHtml(item.title)}" data-sound="barkamol">${icon} ${escapeHtml(shortLabel)}</button>\n`;
    });
    html += `<button type="button" class="preset-chip" data-offset="1" data-sound="barkamol">+1 daq (Sinov)</button>\n`;
    html += `<button type="button" class="preset-chip" data-offset="5" data-sound="barkamol">+5 daq</button>`;
    rowS1.innerHTML = html;
  }

  if (rowS2) {
    let html = '';
    s2Schedule.forEach((item) => {
      const timeStr = `${item.hour}:${item.minute}`;
      const isEnd = item.title.includes('Darslar yakuni');
      const isBreak = item.title.includes('Tanaffus');
      const chipClass = isEnd ? 'preset-chip preset-chip-end' : (isBreak ? 'preset-chip preset-chip-break' : 'preset-chip preset-chip-lesson');
      const icon = isEnd ? '🏁' : '🎵';
      let shortLabel = timeStr;
      if (item.title.includes('Dars boshlanishi')) {
        const num = item.title.match(/(\d+)-Dars/);
        shortLabel = `${timeStr} (${num ? num[1] : ''}-dars)`;
      } else if (item.title.includes('Tanaffus')) {
        const num = item.title.match(/(\d+)-Tanaffus/);
        shortLabel = `${timeStr} (${num ? num[1] : ''}-tanaffus)`;
      } else if (item.title.includes('Katta tanaffus')) {
        shortLabel = `${timeStr} (Katta tanaffus)`;
      } else if (isEnd) {
        shortLabel = `${timeStr} (2-smena yakuni)`;
      }

      html += `<button type="button" class="${chipClass}" data-time="${escapeHtml(timeStr)}" data-title="${escapeHtml(item.title)}" data-sound="barkamol">${icon} ${escapeHtml(shortLabel)}</button>\n`;
    });
    html += `<button type="button" class="preset-chip" data-offset="1" data-sound="barkamol">+1 daq (Sinov)</button>\n`;
    html += `<button type="button" class="preset-chip" data-offset="5" data-sound="barkamol">+5 daq</button>`;
    rowS2.innerHTML = html;
  }
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

// Trigger Bell Ringing (Max 60 seconds / 1 minute)
function triggerAlarm(alarm) {
  STATE.activeRingingAlarm = alarm;

  // Enforce max 60 seconds (1 minute) ringing duration
  const MAX_RING_SECONDS = 60;
  const durationSec = Math.min(Math.max(parseInt(alarm.durationSeconds || MAX_RING_SECONDS, 10), 1), MAX_RING_SECONDS);

  // Sound playback (default: barkamol MP3)
  soundEngine.startContinuousRinging(alarm.sound || 'barkamol', durationSec);

  // Update Ringing Modal text
  const timeFormatted = `${String(alarm.hour).padStart(2, '0')}:${String(alarm.minute).padStart(2, '0')}`;
  if (DOM.ringingClock) DOM.ringingClock.textContent = timeFormatted;
  if (DOM.ringingTitle) DOM.ringingTitle.textContent = alarm.title || "Dars qo'ng'irog'i";
  if (DOM.ringingDescription) {
    if (alarm.title && (alarm.title.includes('Darslar yakuni') || alarm.title.includes('Oxirgi ohang'))) {
      const shiftMention = alarm.title.includes('1-smena') ? '1-smena' : (alarm.title.includes('2-smena') ? '2-smena' : '');
      DOM.ringingDescription.textContent = `🎉 Rejalashtirilgan vaqt (${timeFormatted}) yetib keldi! ${shiftMention} darslari yakunlandi. 1 minutlik "Barkamol avlod" madhiyasi yangramoqda!`;
    } else if (alarm.title && alarm.title.toLowerCase().includes('tanaffus')) {
      DOM.ringingDescription.textContent = `☕ Rejalashtirilgan vaqt (${timeFormatted}) yetib keldi! Tanaffus boshlandi. 1 minutlik "Barkamol avlod" qo'shig'i yangramoqda!`;
    } else {
      DOM.ringingDescription.textContent = `🔔 Rejalashtirilgan vaqt (${timeFormatted}) yetib keldi! Dars boshlandi. 1 minutlik "Barkamol avlod" qo'shig'i yangramoqda!`;
    }
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

  // Live countdown ticker
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

  // Auto-stop bell after duration
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
    showToast("Qo'ng'iroq / Musiqa yangrab bo'ldi, avtomatik to'xtatildi", "info");
  }

  if (STATE.activeRingingAlarm) {
    STATE.activeRingingAlarm = null;
  }
}

// Snooze Ringing Bell
function snoozeRingingAlarm() {
  if (!STATE.activeRingingAlarm) return;

  const currentAlarm = STATE.activeRingingAlarm;
  const snoozeMins = clampInt(currentAlarm.snoozeMinutes, 1, 60, 5);

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
    STATE.alarms[idx].title = cleanText(`${currentAlarm.title} (Kechiktirilgan)`, MAX_TITLE_LENGTH + 20, "Dars qo'ng'irog'i");
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

    // Calculate duration display and sound badge
    const durSec = parseInt(alarm.durationSeconds, 10) || 60;
    const durLabel = (durSec >= 60) ? `${Math.floor(durSec / 60)} daq` : `${durSec}s`;
    const soundBadgeEl = document.createElement('span');
    soundBadgeEl.className = 'alarm-item-duration';
    if (alarm.sound === 'barkamol') {
      const isEnd = alarm.title && (alarm.title.includes('Darslar yakuni') || alarm.title.includes('Oxirgi ohang'));
      const isBreak = alarm.title && alarm.title.toLowerCase().includes('tanaffus');
      soundBadgeEl.classList.add('badge-barkamol');
      soundBadgeEl.textContent = isEnd
        ? `🎵 Barkamol avlod (Oxirgi ohang - ${durLabel})`
        : (isBreak ? `🎵 Barkamol avlod (Tanaffus - ${durLabel})` : `🎵 Barkamol avlod (Dars - ${durLabel})`);
      soundBadgeEl.title = `Barkamol avlod qo'shig'i, davomiyligi: ${durSec} soniya`;
    } else if (alarm.sound === 'qongiroq') {
      soundBadgeEl.classList.add('badge-qongiroq');
      soundBadgeEl.textContent = `🔔 Qo'ng'iroq (${durLabel})`;
      soundBadgeEl.title = `Maktab qo'ng'irog'i, davomiyligi: ${durSec} soniya`;
    } else {
      const soundBadge = (alarm.sound === 'school') ? '🏫 Zvonok' : (alarm.sound === 'melodic' ? '✨ Melodiya' : '⏱️ Signal');
      soundBadgeEl.textContent = `${soundBadge} (${durLabel})`;
      soundBadgeEl.title = `Ohang: ${alarm.sound}, davomiyligi: ${durSec} soniya`;
    }

    const mk = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };

    const left = mk('div', 'alarm-item-left');
    const timeEl = mk('div', 'alarm-item-time', displayTime);
    if (ampmStr) timeEl.appendChild(mk('span', 'alarm-item-ampm', ampmStr));
    const info = mk('div', 'alarm-item-info');
    info.appendChild(mk('span', 'alarm-item-title', alarm.title || "Dars qo'ng'irog'i"));
    info.appendChild(soundBadgeEl);
    const countdownEl = mk('span', 'alarm-item-countdown', countdownText);
    countdownEl.dataset.countdownId = alarm.id;
    info.appendChild(countdownEl);
    left.append(timeEl, info);

    const right = mk('div', 'alarm-item-right');
    const sw = mk('label', 'switch');
    sw.title = alarm.enabled ? "Qo'ng'iroqni o'chirish" : "Qo'ng'iroqni yoqish";
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'alarm-toggle';
    chk.dataset.id = alarm.id;
    chk.checked = !!alarm.enabled;
    sw.append(chk, mk('span', 'slider'));
    const del = mk('button', 'btn-delete-alarm', '🗑️');
    del.type = 'button';
    del.dataset.id = alarm.id;
    del.title = "O'chirib tashlash";
    right.append(sw, del);

    item.append(left, right);

    DOM.alarmsList.appendChild(item);
  });
}

function updateAlarmsCountdownBadges() {
  STATE.alarms.forEach(alarm => {
    const el = document.querySelector(`[data-countdown-id="${CSS.escape(alarm.id)}"]`);
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
      soundEngine.previewSound('barkamol');
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

  // Preset shift tab switching (1-smena vs 2-smena)
  const tabS1 = DOM.tabPresetShift1 || document.getElementById('tabPresetShift1');
  const tabS2 = DOM.tabPresetShift2 || document.getElementById('tabPresetShift2');
  const rowS1 = DOM.presetsRowShift1 || document.getElementById('presetsRowShift1');
  const rowS2 = DOM.presetsRowShift2 || document.getElementById('presetsRowShift2');

  if (tabS1 && tabS2) {
    tabS1.addEventListener('click', () => {
      tabS1.classList.add('active');
      tabS2.classList.remove('active');
      if (rowS1) rowS1.style.display = 'flex';
      if (rowS2) rowS2.style.display = 'none';
    });
    tabS2.addEventListener('click', () => {
      tabS2.classList.add('active');
      tabS1.classList.remove('active');
      if (rowS1) rowS1.style.display = 'none';
      if (rowS2) rowS2.style.display = 'flex';
    });
  }

  // Quick preset pills (Schedule times or offsets) - delegated event listener
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.preset-chip[data-time], .preset-chip[data-offset]');
    if (!chip) return;

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

    if (chip.dataset.sound && DOM.alarmSound) {
      DOM.alarmSound.value = chip.dataset.sound;
    }

    // Flash feedback
    chip.style.transform = 'scale(0.95)';
    setTimeout(() => { chip.style.transform = ''; }, 150);
  });

  // Quick lesson title chips
  document.querySelectorAll('.title-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (DOM.alarmTitle) {
        DOM.alarmTitle.value = chip.dataset.title || '';
        DOM.alarmTitle.focus();
      }
      if (chip.dataset.sound && DOM.alarmSound) {
        DOM.alarmSound.value = chip.dataset.sound;
      }
      chip.style.transform = 'scale(0.95)';
      setTimeout(() => { chip.style.transform = ''; }, 150);
    });
  });

  // Big break duration toggle buttons (10 daqiqa yoki 5 daqiqa qisqartirish)
  const b10 = DOM.break10Btn || document.getElementById('break10Btn');
  const b5 = DOM.break5Btn || document.getElementById('break5Btn');
  if (b10) {
    b10.addEventListener('click', (e) => {
      e.preventDefault();
      window.handleBreakToggle(10);
    });
  }
  if (b5) {
    b5.addEventListener('click', (e) => {
      e.preventDefault();
      window.handleBreakToggle(5);
    });
  }

  // Delegated fallback for break toggle
  document.addEventListener('click', (e) => {
    const opt = e.target.closest('.btn-break-opt');
    if (opt && opt.dataset && opt.dataset.break) {
      e.preventDefault();
      window.handleBreakToggle(parseInt(opt.dataset.break, 10));
    }
  });

  // Shift schedule load buttons (1-smena, 2-smena, To'liq kun)
  const s1Btn = DOM.loadShift1Btn || document.getElementById('loadShift1Btn');
  const s2Btn = DOM.loadShift2Btn || document.getElementById('loadShift2Btn');
  const allBtn = DOM.loadAllShiftsBtn || document.getElementById('loadAllShiftsBtn');

  if (s1Btn) {
    s1Btn.addEventListener('click', () => loadSchoolSchedule(1));
  }
  if (s2Btn) {
    s2Btn.addEventListener('click', () => loadSchoolSchedule(2));
  }
  if (allBtn) {
    allBtn.addEventListener('click', () => loadSchoolSchedule('all'));
  }
  if (DOM.loadStandardScheduleBtn) {
    DOM.loadStandardScheduleBtn.addEventListener('click', () => loadSchoolSchedule(1));
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

        if (STATE.alarms.length >= MAX_ALARMS) {
          showToast(`Eng ko'pi bilan ${MAX_ALARMS} ta qo'ng'iroq saqlash mumkin`, "warning");
          return;
        }
        const title = cleanText(DOM.alarmTitle.value, MAX_TITLE_LENGTH, "Dars qo'ng'irog'i");
        const sound = (DOM.alarmSound && ALLOWED_SOUNDS.includes(DOM.alarmSound.value)) ? DOM.alarmSound.value : "barkamol";
        const snoozeRadio = document.querySelector('input[name="snoozeTime"]:checked');
        const snoozeMinutes = snoozeRadio ? clampInt(snoozeRadio.value, 1, 60, 5) : 5;

        // Enforce maximum 60 seconds (1 minute) duration
        const durationRadio = document.querySelector('input[name="ringDuration"]:checked');
        const ringDuration = durationRadio ? Math.min(Math.max(parseInt(durationRadio.value, 10) || 60, 1), 60) : 60;

        const newAlarm = {
          id: 'bell_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
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
    const lapLabel = document.createElement('span');
    lapLabel.textContent = `#${lapNum} Davra`;
    const lapTime = document.createElement('span');
    lapTime.textContent = formatStopwatch(currentMs).replace(/<\/?span[^>]*>/g, '');
    li.append(lapLabel, document.createTextNode(' '), lapTime);
    if (DOM.lapsList) DOM.lapsList.prepend(li);
  }

  if (DOM.swStartBtn) DOM.swStartBtn.addEventListener('click', startStopwatch);
  if (DOM.swResetBtn) DOM.swResetBtn.addEventListener('click', resetStopwatch);
  if (DOM.swLapBtn) DOM.swLapBtn.addEventListener('click', recordLap);
}

// Utility: HTML escape
function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str).replace(/[&<>'"]/g, tag => ({
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
  const toastIcon = document.createElement('span');
  toastIcon.textContent = '🔔';
  const toastMsg = document.createElement('span');
  toastMsg.textContent = String(message);
  toast.append(toastIcon, document.createTextNode(' '), toastMsg);
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