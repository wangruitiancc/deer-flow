import SunCalc from "suncalc";

export const SOLAR_CITIES = [
  { id: "shanghai", label: "上海", latitude: 31.23, longitude: 121.47 },
  { id: "beijing", label: "北京", latitude: 39.9, longitude: 116.4 },
  { id: "guangzhou", label: "广州", latitude: 23.13, longitude: 113.26 },
  { id: "chengdu", label: "成都", latitude: 30.57, longitude: 104.07 },
  { id: "hongkong", label: "香港", latitude: 22.32, longitude: 114.17 },
] as const;
export type AppearanceMode = "light" | "dark" | "system" | "solar";
export type SolarCityId = (typeof SOLAR_CITIES)[number]["id"];
export const APPEARANCE_KEY = "matrix-law:appearance:v1";
export const APPEARANCE_EVENT = "matrix-law:appearance-change";
export type AppearancePreference = { mode: AppearanceMode; city: SolarCityId };

export function parseAppearance(
  value: string | null,
): AppearancePreference | null {
  try {
    const parsed = JSON.parse(
      value ?? "null",
    ) as Partial<AppearancePreference> | null;
    if (
      parsed &&
      ["light", "dark", "system", "solar"].includes(parsed.mode ?? "") &&
      SOLAR_CITIES.some((city) => city.id === parsed.city)
    )
      return parsed as AppearancePreference;
  } catch {
    /* Optional non-sensitive display preferences. */
  }
  return null;
}

export function solarAppearance(
  now: Date,
  cityId: SolarCityId,
): "light" | "dark" {
  const city =
    SOLAR_CITIES.find((item) => item.id === cityId) ?? SOLAR_CITIES[0];
  // All supported cities use UTC+8. Anchor local noon to avoid date-boundary
  // ambiguity when the browser runs in a different time zone.
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const noon = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      4,
    ),
  );
  const times = SunCalc.getTimes(noon, city.latitude, city.longitude);
  if (
    !Number.isFinite(times.sunrise.getTime()) ||
    !Number.isFinite(times.sunset.getTime())
  )
    return "dark";
  return now >= times.sunrise && now < times.sunset ? "light" : "dark";
}
