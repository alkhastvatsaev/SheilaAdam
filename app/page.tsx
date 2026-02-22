"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { db } from '@/lib/firebase';
import { ref, onValue, set, update } from 'firebase/database';
import { getPrayerTimesForCity, CITIES, CityId } from '@/lib/athan';
import WarpCanvas from '@/components/WarpCanvas';
import { motion, AnimatePresence } from 'framer-motion';

export default function AthanPage() {
  const [cityId, setCityId] = useState<CityId>('strasbourg');
  const [validated, setValidated] = useState<Record<string, boolean[]>>({
    strasbourg: [false, false, false, false, false],
    pavlodar: [false, false, false, false, false]
  });
  const [loveMessage, setLoveMessage] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date()); // always raw UTC
  const [currentPrayerIdx, setCurrentPrayerIdx] = useState(-1);
  const [isDark, setIsDark] = useState(false);
  const [snakeSmoke, setSnakeSmoke] = useState(false);
  
  const msgInputRef = useRef<HTMLInputElement>(null);

  // Sync with Firebase
  useEffect(() => {
    // Love message sync
    const msgRef = ref(db, 'love_message');
    const unsubscribeMsg = onValue(msgRef, (snapshot) => {
      const val = snapshot.val();
      if (val !== null && document.activeElement !== msgInputRef.current) {
        setLoveMessage(val);
      }
    });

    // Validations sync
    const valRef = ref(db, 'validations');
    const unsubscribeVal = onValue(valRef, (snapshot) => {
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

    return () => {
      unsubscribeMsg();
      unsubscribeVal();
    };
  }, []);

  const saveValidations = useCallback((newValidations: Record<string, boolean[]>) => {
    update(ref(db, 'validations'), {
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

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date(); // raw UTC
      setCurrentTime(now); // store raw UTC, formatLocalTime handles display
      
      const prayers = getPrayerTimesForCity(cityId, now);
      const times = [prayers.fajr, prayers.dhuhr, prayers.asr, prayers.maghrib, prayers.isha];
      
      const nowTime = now.getTime();
      const isNight = nowTime < times[0].getTime() || nowTime > times[3].getTime();
      
      setIsDark(isNight);
      if (isNight) document.body.classList.add('dark');
      else document.body.classList.remove('dark');

      let lastIdx = -1;
      times.forEach((t, i) => {
        if (nowTime > t.getTime()) lastIdx = i;
      });
      setCurrentPrayerIdx(lastIdx);
    }, 1000);

    return () => clearInterval(timer);
  }, [cityId]);

  const nowReal = new Date();
  const prayers = getPrayerTimesForCity(cityId, nowReal);
  const prayerData = [
    { label: 'Fajr', time: prayers.fajr },
    { label: 'Dhuhr', time: prayers.dhuhr },
    { label: 'Asr', time: prayers.asr },
    { label: 'Maghrib', time: prayers.maghrib },
    { label: 'Isha', time: prayers.isha },
  ];

  // Celestial positions based on UTC timestamps
  const getCelestialPos = () => {
    const nowTime = nowReal.getTime();
    const times = [prayers.fajr.getTime(), prayers.dhuhr.getTime(), prayers.asr.getTime(), prayers.maghrib.getTime(), prayers.isha.getTime()];
    
    if (!isDark) {
      const p = (nowTime - times[0]) / (times[3] - times[0]);
      return { 
        left: `calc(${p * 100}% - 25px)`, 
        bottom: `${Math.sin(p * Math.PI) * 200 + 190}px` 
      };
    } else {
      let s = times[3], e = times[0];
      if (nowTime > times[3]) {
        // Next day Fajr
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        e = getPrayerTimesForCity(cityId, tomorrow).fajr.getTime();
      } else {
        // Today's Fajr vs Yesterday's Maghrib
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        s = getPrayerTimesForCity(cityId, yesterday).maghrib.getTime();
      }
      const p = (nowTime - s) / (e - s);
      return { 
        left: `calc(${p * 100}% - 25px)`, 
        bottom: `${Math.sin(p * Math.PI) * 200 + 190}px` 
      };
    }
  };

  const celestialPos = getCelestialPos();

  const getSnakePos = () => {
    if (currentPrayerIdx === -1 || currentPrayerIdx >= 4 || validated[cityId][currentPrayerIdx] || snakeSmoke) return null;
    const nowTime = nowReal.getTime();
    const progress = (nowTime - prayerData[currentPrayerIdx].time.getTime()) / 60000;
    const width = Math.min(progress * 1.5 + 40, 100); 
    
    return {
      left: `${(currentPrayerIdx + 0.5) * 20}%`,
      width: `${width}px`,
      top: `-45px`
    };
  };

  // Converts a UTC Date to HH:MM string for the given UTC offset (e.g. 5 for Pavlodar)
  const formatLocalTime = (utcDate: Date, utcOffset: number) => {
    const shifted = new Date(utcDate.getTime() + utcOffset * 3600000);
    const hours = shifted.getUTCHours().toString().padStart(2, '0');
    const minutes = shifted.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  return (
    <main className="relative flex flex-col items-center justify-center w-full h-screen overflow-hidden">
      <WarpCanvas isDark={isDark} sunPos={celestialPos} />

      <div className="city-selector">
        <button 
          className={`city-btn ${cityId === 'strasbourg' ? 'active' : ''}`}
          onClick={() => setCityId('strasbourg')}
        >Strasbourg</button>
        <button 
          className={`city-btn ${cityId === 'pavlodar' ? 'active' : ''}`}
          onClick={() => setCityId('pavlodar')}
        >Pavlodar</button>
      </div>

      <motion.div 
        key={cityId}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        id="user-focus"
      >
        {CITIES[cityId].user}
      </motion.div>

      <motion.div 
        id="message-cloud"
        animate={{ 
          y: [0, -10, 5, -5, 0],
          x: ["-50%", "-48%", "-52%", "-50%"]
        }}
        transition={{ 
          duration: 8, 
          repeat: Infinity, 
          ease: "easeInOut" 
        }}
        style={{ top: '100px', left: '50%' }}
      >
        <div className="cloud-body" />
        <input 
          ref={msgInputRef}
          type="text" 
          id="msg-input" 
          placeholder="..." 
          value={loveMessage}
          onChange={(e) => {
            setLoveMessage(e.target.value);
            set(ref(db, 'love_message'), e.target.value);
          }}
        />
      </motion.div>

      <div id="sky-area">
        <div 
          id={isDark ? "moon" : "sun"} 
          className="celestial" 
          style={{ 
            left: celestialPos.left, 
            bottom: celestialPos.bottom,
            display: 'block'
          }} 
        />
        
        <div id="timeline">
          <AnimatePresence>
            {currentPrayerIdx !== -1 && currentPrayerIdx < 4 && !validated[cityId][currentPrayerIdx] && !snakeSmoke && (
              <motion.div 
                id="snake"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 2, filter: 'blur(20px)' }}
                onClick={validateCurrent}
                style={{
                  left: `${(currentPrayerIdx + 0.5) * 100 / 5}%`,
                  transform: 'translateX(-50%)',
                  bottom: '120px' // Positioning above the nodes
                }}
              >
                Valider
              </motion.div>
            )}
          </AnimatePresence>

          {prayerData.map((prayer, i) => (
            <div 
              key={i} 
              className={`node ${currentPrayerIdx === i ? 'active-prière' : ''}`}
              onClick={() => handleManualToggle(i)}
            >
              {validated[cityId][i] && (
                <motion.div 
                  initial={{ scale: 0 }} 
                  animate={{ scale: 1 }} 
                  className="check-circle"
                >✓</motion.div>
              )}
              <div className="label">{prayer.label}</div>
              <div className="time">
                {formatLocalTime(prayer.time, CITIES[cityId].offset)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div id="bottom-bar">
        <div id="clock">
          {formatLocalTime(currentTime, CITIES[cityId].offset)}
        </div>
        <div className="city-display">{CITIES[cityId].name}</div>
      </div>
    </main>
  );
}
