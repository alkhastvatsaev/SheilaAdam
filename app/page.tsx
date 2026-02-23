"use client";

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { db } from '@/lib/firebase';
import { ref, onValue, set, get, push } from 'firebase/database';
import { getPrayerTimesForCity, CITIES, CityId } from '@/lib/athan';
import WarpCanvas from '@/components/WarpCanvas';
import { motion, AnimatePresence } from 'framer-motion';

type VoiceMessage = {
  audio: string; // base64 data URL
  from: string;
  timestamp: number;
};

export default function AthanPage() {
  // Identity: stored permanently on device
  const [identity, setIdentity] = useState<CityId | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('user_identity') as CityId | null;
      if (saved === 'strasbourg' || saved === 'pavlodar') return saved;
    }
    return null; // null = not yet chosen (first launch)
  });

  const [cityId, setCityId] = useState<CityId>(() => {
    if (typeof window !== 'undefined') {
      const identity = localStorage.getItem('user_identity') as CityId | null;
      if (identity === 'strasbourg' || identity === 'pavlodar') return identity;
      const saved = localStorage.getItem('preferred_city') as CityId | null;
      if (saved && (saved === 'strasbourg' || saved === 'pavlodar')) return saved;
    }
    return 'strasbourg';
  });
  const [validated, setValidated] = useState<Record<string, boolean[]>>({
    strasbourg: [false, false, false, false, false],
    pavlodar: [false, false, false, false, false]
  });
  const [voiceMessage, setVoiceMessage] = useState<VoiceMessage | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentPrayerIdx, setCurrentPrayerIdx] = useState(-1);
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [snakeSmoke, setSnakeSmoke] = useState(false);
  const [voiceHistory, setVoiceHistory] = useState<VoiceMessage[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push notification state
  const [isSubscribed, setIsSubscribed] = useState(false);
  const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

  // Register SW and check subscription
  useEffect(() => {
    if ('serviceWorker' in navigator && identity) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub);
        });
      });
    }
  }, [identity]);

  // Firebase: sync voice message
  useEffect(() => {
    if (!db) return;
    const vmRef = ref(db, 'voice_message');
    const unsub = onValue(vmRef, (snapshot) => {
      const val = snapshot.val();
      setVoiceMessage(val ?? null);
    });
    return () => unsub();
  }, []);

  // Firebase: sync voice history
  useEffect(() => {
    if (!db) return;
    const vhRef = ref(db, 'voice_history');
    const unsub = onValue(vhRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const history = Object.values(val) as VoiceMessage[];
        // Sort by newest first
        setVoiceHistory(history.sort((a, b) => b.timestamp - a.timestamp));
      }
    });
    return () => unsub();
  }, []);

  // Firebase: sync validations
  useEffect(() => {
    if (!db) return;
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
    if (!db) return;
    set(ref(db, 'validations'), {
      date: new Date().toDateString(),
      strasbourg: newValidations.strasbourg,
      pavlodar: newValidations.pavlodar
    });
  }, []);

  const chooseIdentity = (chosen: CityId) => {
    localStorage.setItem('user_identity', chosen);
    localStorage.setItem('preferred_city', chosen);
    setIdentity(chosen);
    setCityId(chosen);
    // Suggest notification after choice
    setTimeout(() => {
      if (confirm("Voulez-vous activer les notifications pour être prévenu quand l'autre laisse un message vocal ?")) {
        subscribeToNotifications(chosen);
      }
    }, 1000);
  };

  const handleCityChange = (newCity: CityId) => {
    setCityId(newCity);
    localStorage.setItem('preferred_city', newCity);
  };

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
    setMounted(true);
    return () => clearInterval(timer);
  }, [cityId]);

  // Push Notifications Logic
  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const subscribeToNotifications = async (userId: CityId) => {
    try {
      if (!('serviceWorker' in navigator)) {
        alert("Votre navigateur ne supporte pas les notifications.");
        return;
      }

      // Explicitly check for standalone mode on iOS
      const isStandalone = (navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
      if (!isStandalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
        alert("iOS nécessite que l'application soit ajoutée à l'écran d'accueil pour activer les notifications.");
        return;
      }

      // Step 1: Request permission
      let permission = Notification.permission;
      if (permission === 'default') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        alert("Les notifications ont été bloquées. Veuillez les autoriser dans les réglages de votre iPhone pour cette application.");
        return;
      }

      // Step 2: Get/Wait for Service Worker
      const registration = await navigator.serviceWorker.ready;
      
      // Step 3: Subscribe
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });

      // Store in Firebase
      if (db) {
        await set(ref(db, `push_subscriptions/${userId}`), subscription.toJSON());
      }
      setIsSubscribed(true);
      alert("Notifications activées avec succès ! 🔔");
    } catch (error: any) {
      console.error("Subscription failed", error);
      alert(`Erreur : ${error.message || "Inconnue"}. Essayez de fermer et rouvrir l'application.`);
    }
  };

  const notifyPartner = async () => {
    if (!identity || !db) return;
    const partnerId = identity === 'strasbourg' ? 'pavlodar' : 'strasbourg';
    const snapshot = await get(ref(db, `push_subscriptions/${partnerId}`));
    const subscription = snapshot.val();

    if (subscription) {
      await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription,
          title: "Nouveau message vocal ! 🎙",
          body: `${CITIES[identity].user} vient de vous laisser un message.`,
          url: '/'
        })
      });
    }
  };

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
          if (db) {
            set(ref(db, 'voice_message'), newMsg);
            push(ref(db, 'voice_history'), newMsg);
          }
          notifyPartner(); // Trigger push
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

  // Long press for history
  const startLongPress = () => {
    if (isRecording) return;
    longPressTimerRef.current = setTimeout(() => {
      setShowHistory(true);
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(50);
      }
    }, 1000); // 1 second - makes it very intentional and avoids drag conflict
  };

  const endLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
  };

  const playHistoryItem = (audioData: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(audioData);
    audioRef.current = audio;
    audio.play();
  };

  // SVG Icons
  const MicIcon = ({ size = 20, color = 'white' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );

  const BellIcon = ({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );

  const StopIcon = ({ size = 16, color = 'white' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );

  // Play icon SVG
  const PlayIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <polygon points="5,3 19,12 5,21" />
    </svg>
  );

  const renderHistoryOverlay = () => (
    <AnimatePresence>
      {showHistory && (
        <motion.div 
          id="history-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setShowHistory(false)}
        >
          <motion.div 
            id="history-content"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div id="history-header">
              <h2>Anciens vocaux</h2>
              <button className="close-btn" onClick={() => setShowHistory(false)}>×</button>
            </div>
            <div id="history-list">
              {voiceHistory.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', opacity: 0.5 }}>
                  Aucun message enregistré.
                </div>
              ) : (
                voiceHistory.map((msg, i) => (
                  <button key={i} className="history-item" onClick={() => playHistoryItem(msg.audio)}>
                    <div className="history-icon"><PlayIcon size={14} color="white" /></div>
                    <div className="history-details">
                      <div className="history-name">{msg.from}</div>
                      <div className="history-time">{new Date(msg.timestamp).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <div className="history-play">Écouter</div>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  const dragProps = {
    id: 'voice-capsule' as const,
    drag: 'y' as const,
    dragMomentum: false,
    dragElastic: 0.08,
    dragConstraints: { top: -200, bottom: 200 },
    whileTap: { cursor: 'grabbing' },
    style: { cursor: 'grab', touchAction: 'none' } as React.CSSProperties,
    onPointerDown: startLongPress,
    onPointerUp: endLongPress,
    onPointerLeave: endLongPress,
    onDragStart: endLongPress,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  const renderVoiceCapsule = () => {
    if (isRecording) {
      return (
        <motion.div {...dragProps}>
          <div className="voice-info">
            <div className="voice-from">{CITIES[cityId].user} • En cours</div>
            <div className="voice-status">
              <div className="waveform">
                {[1,2,3,4,5,6,7].map(i => <div key={i} className="waveform-bar" />)}
              </div>
            </div>
          </div>
          <span className="voice-timer" onPointerDown={e => e.stopPropagation()}>{formatTime(recordingTime)}</span>
          <button
            className="voice-btn recording"
            onPointerDown={e => e.stopPropagation()}
            onClick={stopRecording}
          >
            <StopIcon />
          </button>
        </motion.div>
      );
    }

    if (voiceMessage) {
      return (
        <motion.div {...dragProps}>
          <button
            className={`voice-btn ${isPlaying ? 'stop-play' : 'play'}`}
            onPointerDown={e => e.stopPropagation()}
            onClick={playMessage}
          >
            {isPlaying
              ? <StopIcon size={14} color="var(--text)" />
              : <PlayIcon size={14} color="var(--text)" />}
          </button>
          <div className="voice-info">
            <div className="voice-from">
              {voiceMessage.from} • {formatLocalTime(new Date(voiceMessage.timestamp), CITIES[cityId].offset)}
            </div>
            <div className="voice-status">
              {isPlaying
                ? <div className="waveform">{[1,2,3,4,5,6,7].map(i => <div key={i} className="waveform-bar" />)}</div>
                : 'Message vocal'}
            </div>
          </div>
          <button
            className="voice-btn mic"
            onPointerDown={e => e.stopPropagation()}
            onClick={startRecording}
            title="Enregistrer une réponse"
          >
            <MicIcon />
          </button>
        </motion.div>
      );
    }

    // Empty state
    return (
      <motion.div {...dragProps}>
        <div className="voice-info">
          <div className="voice-from">{CITIES[cityId].user}</div>
          <div className="voice-status">Laisser un message vocal…</div>
        </div>
        <button
          className="voice-btn mic"
          onPointerDown={e => e.stopPropagation()}
          onClick={startRecording}
        >
          <MicIcon />
        </button>
      </motion.div>
    );
  };

  return (
    <main className="relative flex flex-col items-center justify-center w-full h-[100dvh] overflow-hidden overscroll-none touch-none">
      <WarpCanvas isDark={isDark} sunPos={celestialPos} />

      {/* One-time identity onboarding overlay */}
      <AnimatePresence>
        {identity === null && (
          <motion.div
            id="onboarding"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              id="onboarding-inner"
            >
              <div id="onboarding-title">Qui es-tu ?</div>
              <div id="onboarding-sub">Cette app se souviendra de toi pour toujours.</div>
              <div id="onboarding-choices">
                <button className="identity-card" onClick={() => chooseIdentity('strasbourg')}>
                  <span className="identity-name">Adam</span>
                  <span className="identity-city">Strasbourg</span>
                </button>
                <button className="identity-card" onClick={() => chooseIdentity('pavlodar')}>
                  <span className="identity-name">Sheïla</span>
                  <span className="identity-city">Pavlodar</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="city-selector">
        <button className={`city-btn ${cityId === 'strasbourg' ? 'active' : ''}`} onClick={() => handleCityChange('strasbourg')}>Strasbourg</button>
        <button className={`city-btn ${cityId === 'pavlodar' ? 'active' : ''}`} onClick={() => handleCityChange('pavlodar')}>Pavlodar</button>
      </div>

      <AnimatePresence>
        {!isSubscribed && identity && (
          <motion.button 
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            whileHover={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => subscribeToNotifications(identity)}
            className="notif-btn"
          >
            <BellIcon />
          </motion.button>
        )}
      </AnimatePresence>

      {renderVoiceCapsule()}
      {renderHistoryOverlay()}

      <motion.div key={cityId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} id="user-focus">
        {CITIES[cityId].user}
      </motion.div>

      <div id="sky-area">
        {mounted && (
          <div id={isDark ? 'moon' : 'sun'} className="celestial" style={{ left: celestialPos.left, bottom: celestialPos.bottom }} />
        )}
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
        <div id="clock">{mounted ? formatLocalTime(currentTime, CITIES[cityId].offset) : '--:--'}</div>
        <div className="city-display">{CITIES[cityId].name}</div>
      </div>
    </main>
  );
}
