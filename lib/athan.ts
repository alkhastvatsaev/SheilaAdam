import { Coordinates, CalculationMethod, PrayerTimes, SunnahTimes } from 'adhan';

export const CITIES = {
  strasbourg: {
    name: 'Strasbourg',
    user: 'Adam',
    coords: new Coordinates(48.5734, 7.7521),
    offset: 1,
  },
  pavlodar: {
    name: 'Pavlodar',
    user: 'Sheïla',
    coords: new Coordinates(52.2873, 76.9674),
    offset: 5,
  },
};

export function getPrayerTimesForCity(cityId: keyof typeof CITIES, date: Date = new Date()) {
  const city = CITIES[cityId];
  const params = CalculationMethod.MuslimWorldLeague();
  const prayerTimes = new PrayerTimes(city.coords, date, params);
  
  return {
    fajr: prayerTimes.fajr,
    dhuhr: prayerTimes.dhuhr,
    asr: prayerTimes.asr,
    maghrib: prayerTimes.maghrib,
    isha: prayerTimes.isha,
  };
}

export type CityId = keyof typeof CITIES;
