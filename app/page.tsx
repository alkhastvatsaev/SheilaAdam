"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { db } from '@/lib/firebase';
import { ref, onValue, set } from 'firebase/database';
import { getPrayerTimesForCity, CITIES, CityId } from '@/lib/athan';
import WarpCanvas from '@/components/WarpCanvas';
import { motion, AnimatePresence } from 'framer-motion';

type VoiceMessage = {
  audio: string; // base64 data URL
  from: string;
  timestamp: number;
};

export default function AthanPage() {
  const [cityId, setCityId] = useState<CityId>('strasbourg');
  const [validated, setValidated] = useState<Record<string, boolean[]>>({
    strasbourg: [false, false, false, false, false],
    pavlodar: [false, false, false, false, false]
  });
  const [voiceMessage, setVoiceMessage] = useState<VoiceMessage | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentPrayerIdx, setCurrentPrayerIdx] = useState(-1);
  const [isDark, setIsDark] = useState(false);
  const [snakeSmoke, setSnakeSmoke] = useState(false);
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Firebase: sync voice message
  useEffect(() => {
    const vmRef = ref(db, 'voice_message');
    const unsub = onValue(vmRef, (snapshot) => {
      const val = snapshot.val();
      setVoiceMessage(val ?? null);
    });
    return () => unsub();
  }, []);

  // Firebase: sync validations
  useEffect(() => {
    const valRef = ref(db, 'validations');
    const unsub = onValue(valRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const today = new Date().toDateString();
        if (data.date !== today) {
          set(ref(db, 'validations'), {
            date: today,
            strasbourg: [false, false, false, false, false],
            pavlodar: [false, false, false, false, false]
          });
        } else {
          setValidated({
            strasbourg: data.strasbourg || [false, false, false, false, false],
            pavlodar: data.pavlodar || [false, false, false, false, false]
          });
        }
      }
    });
    return () => unsub();
  }, []);

  const saveValidations = useCallback((newValidations: Record<string, boolean[]>) => {
    set(ref(db, 'validations'), {
      date: new Date().toDateString(),
      strasbourg: newValidations.strasbourg,
      pavlodar: newValidations.pavlodar
    });
  }, []);

  const handleManualToggle = (idx: number) => {
    const newValidated = { ...validated };
    newValidated[cityId][idx] = !newValidated[cityId][idx];
    if (idx === currentPrayerIdx && newValidated[cityId][idx]) {
      setSnakeSmoke(true);
      setTimeout(() => setSnakeSmoke(false), 800);
    }
    setValidated(newValidated);
    saveValidations(newValidated);
  };

  const validateCurrent = () => {
    if (currentPrayerIdx !== -1) {
      const newValidated = { ...validated };
      newValidated[cityId][currentPrayerIdx] = true;
      setSnakeSmoke(true);
      setTimeout(() => setSnakeSmoke(false), 800);
      setValidated(newValidated);
      saveValidations(newValidated);
    }
  };

  // Clock + prayer logic
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      const prayers = getPrayerTimesForCity(cityId, now);
      const times = [prayers.fajr, prayers.dhuhr, prayers.asr, prayers.maghrib, prayers.isha];
      const nowTime = now.getTime();
      const isNight = nowTime < times[0].getTime() || nowTime > times[3].getTime();
      setIsDark(isNight);
      if (isNight) {
        document.body.classList.add('dark');
        document.documentElement.style.background = '#02040a';
      } else {
        document.body.classList.remove('dark');
        document.documentElement.style.background = '#ffffff';
      }
      let lastIdx = -1;
      times.forEach((t, i) => { if (nowTime > t.getTime()) lastIdx = i; });
      setCurrentPrayerIdx(lastIdx);
    }, 1000);
    return () => clearInterval(timer);
  }, [cityId]);

  // Voice recording methods
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Try different MIME types for cross-browser support
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const newMsg: VoiceMessage = {
            audio: reader.result as string,
            from: CITIES[cityId].user,
            timestamp: Date.now(),
          };
          set(ref(db, 'voice_message'), newMsg);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(t => {
          if (t >= 59) { stopRecording(); return 0; }
          return t + 1;
        });
      }, 1000);
    } catch {
      alert("Microphone inaccessible. Veuillez autoriser l'accès au micro.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    }
  };

  const playMessage = () => {
    if (!voiceMessage) return;
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }
    const audio = new Audio(voiceMessage.audio);
    audioRef.current = audio;
    audio.play();
    setIsPlaying(true);
    audio.onended = () => { setIsPlaying(false); audioRef.current = null; };
  };

  const formatTime = (secs: number) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

  const nowReal = new Date();
  const prayers = getPrayerTimesForCity(cityId, nowReal);
  const prayerData = [
    { label: 'Fajr', time: prayers.fajr },
    { label: 'Dhuhr', time: prayers.dhuhr },
    { label: 'Asr', time: prayers.asr },
    { label: 'Maghrib', time: prayers.maghrib },
    { label: 'Isha', time: prayers.isha },
  ];

  const getCelestialPos = () => {
    const nowTime = nowReal.getTime();
    const times = [prayers.fajr.getTime(), prayers.dhuhr.getTime(), prayers.asr.getTime(), prayers.maghrib.getTime(), prayers.isha.getTime()];
    if (!isDark) {
      const p = Math.max(0, Math.min(1, (nowTime - times[0]) / (times[3] - times[0])));
      return { left: `calc(${p * 100}% - 25px)`, bottom: `${Math.sin(p * Math.PI) * 200 + 190}px` };
    } else {
      let s = times[3], e = times[0];
      if (nowTime > times[3]) {
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        e = getPrayerTimesForCity(cityId, tomorrow).fajr.getTime();
      } else {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        s = getPrayerTimesForCity(cityId, yesterday).maghrib.getTime();
      }
      const p = Math.max(0, Math.min(1, (nowTime - s) / (e - s)));
      return { left: `calc(${p * 100}% - 25px)`, bottom: `${Math.sin(p * Math.PI) * 200 + 190}px` };
    }
  };

  const celestialPos = getCelestialPos();

  const formatLocalTime = (utcDate: Date, utcOffset: number) => {
    const shifted = new Date(utcDate.getTime() + utcOffset * 3600000);
    return `${shifted.getUTCHours().toString().padStart(2, '0')}:${shifted.getUTCMinutes().toString().padStart(2, '0')}`;
  };

  // Touch prevention
  useEffect(() => {
    const preventDefault = (e: TouchEvent) => {
      if ((e.target as HTMLElement).closest('.voice-btn, #timeline')) return;
      e.preventDefault();
    };
    document.addEventListener('touchmove', preventDefault, { passive: false });
    return () => document.removeEventListener('touchmove', preventDefault);
  }, []);

  // Voice message capsule rendering
  const renderVoiceCapsule = () => {
    if (isRecording) {
      return (
        <div id="voice-capsule">
          <div className="voice-info">
            <div className="voice-from">{CITIES[cityId].user} • En cours</div>
            <div className="voice-status">
              <div className="waveform">
                {[1,2,3,4,5,6,7].map(i => <div key={i} className="waveform-bar" />)}
              </div>
            </div>
          </div>
          <span className="voice-timer">{formatTime(recordingTime)}</span>
          <button className="voice-btn recording" onClick={stopRecording}>■</button>
        </div>
      );
    }

    if (voiceMessage) {
      return (
        <motion.div id="voice-capsule" animate={{ y: [0, -6, 3, -3, 0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}>
          <button className={`voice-btn ${isPlaying ? 'stop-play' : 'play'}`} onClick={playMessage}>
            {isPlaying ? '■' : '▶'}
          </button>
          <div className="voice-info">
            <div className="voice-from">{voiceMessage.from}</div>
            <div className="voice-status">
              {isPlaying
                ? <div className="waveform">{[1,2,3,4,5,6,7].map(i => <div key={i} className="waveform-bar" />)}</div>
                : 'Message vocal'}
            </div>
          </div>
          <button className="voice-btn mic" onClick={startRecording} title="Enregistrer une réponse">🎙</button>
        </motion.div>
      );
    }

    // Empty state
    return (
      <motion.div id="voice-capsule" animate={{ y: [0, -6, 3, -3, 0] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}>
        <div className="voice-info">
          <div className="voice-from">{CITIES[cityId].user}</div>
          <div className="voice-status">Laisser un message vocal…</div>
        </div>
        <button className="voice-btn mic" onClick={startRecording}>🎙</button>
      </motion.div>
    );
  };

  return (
    <main className="relative flex flex-col items-center justify-center w-full h-screen overflow-hidden overscroll-none touch-none">
      <WarpCanvas isDark={isDark} sunPos={celestialPos} />

      <div className="city-selector">
        <button className={`city-btn ${cityId === 'strasbourg' ? 'active' : ''}`} onClick={() => setCityId('strasbourg')}>Strasbourg</button>
        <button className={`city-btn ${cityId === 'pavlodar' ? 'active' : ''}`} onClick={() => setCityId('pavlodar')}>Pavlodar</button>
      </div>

      {renderVoiceCapsule()}

      <motion.div key={cityId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} id="user-focus">
        {CITIES[cityId].user}
      </motion.div>

      <div id="sky-area">
        <div id={isDark ? 'moon' : 'sun'} className="celestial" style={{ left: celestialPos.left, bottom: celestialPos.bottom }} />
        <div id="timeline">
          <AnimatePresence>
            {currentPrayerIdx !== -1 && currentPrayerIdx < 4 && !validated[cityId][currentPrayerIdx] && !snakeSmoke && (
              <motion.div
                id="snake"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 2, filter: 'blur(20px)' }}
                onClick={validateCurrent}
                style={{ left: `${(currentPrayerIdx + 0.5) * 100 / 5}%`, transform: 'translateX(-50%)', bottom: '90px' }}
              >
                Valider
              </motion.div>
            )}
          </AnimatePresence>
          {prayerData.map((prayer, i) => (
            <div key={i} className={`node ${currentPrayerIdx === i ? 'active-prière' : ''}`} onClick={() => handleManualToggle(i)}>
              {validated[cityId][i] && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="check-circle">✓</motion.div>
              )}
              <div className="label">{prayer.label}</div>
              <div className="time">{formatLocalTime(prayer.time, CITIES[cityId].offset)}</div>
            </div>
          ))}
        </div>
      </div>

      <div id="bottom-bar">
        <div id="clock">{formatLocalTime(currentTime, CITIES[cityId].offset)}</div>
        <div className="city-display">{CITIES[cityId].name}</div>
      </div>
    </main>
  );
}
