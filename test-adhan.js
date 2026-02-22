const { Coordinates, CalculationMethod, PrayerTimes } = require('adhan');

const coords = new Coordinates(52.2873, 76.9674); // Pavlodar
const date = new Date(2026, 1, 23); // Feb 23
const params = CalculationMethod.MuslimWorldLeague();
const prayerTimes = new PrayerTimes(coords, date, params);

console.log('UTC Prayer Times for Pavlodar on Feb 23:');
console.log('Fajr:', prayerTimes.fajr.toISOString());
console.log('Dhuhr:', prayerTimes.dhuhr.toISOString());
console.log('Asr:', prayerTimes.asr.toISOString());
console.log('Maghrib:', prayerTimes.maghrib.toISOString());
console.log('Isha:', prayerTimes.isha.toISOString());
