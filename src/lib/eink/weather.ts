export type WeatherSnapshot = {
  temperature: number;
  high: number;
  low: number;
  description: string;
};

const WMO_PT: Record<number, string> = {
  0: "Céu limpo",
  1: "Principalmente limpo",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Neblina",
  48: "Neblina gelada",
  51: "Garoa leve",
  53: "Garoa",
  55: "Garoa forte",
  61: "Chuva leve",
  63: "Chuva",
  65: "Chuva forte",
  71: "Neve leve",
  73: "Neve",
  75: "Neve forte",
  80: "Pancadas leves",
  81: "Pancadas",
  82: "Pancadas fortes",
  95: "Trovoada",
  96: "Trovoada com granizo",
  99: "Trovoada com granizo",
};

export function describeWmoCode(code: number): string {
  return WMO_PT[code] ?? `Código ${code}`;
}

type OpenMeteoResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
};

export function parseOpenMeteo(data: OpenMeteoResponse): WeatherSnapshot | null {
  const temp = data.current?.temperature_2m;
  const code = data.current?.weather_code;
  const high = data.daily?.temperature_2m_max?.[0];
  const low = data.daily?.temperature_2m_min?.[0];

  if (
    typeof temp !== "number" ||
    typeof code !== "number" ||
    typeof high !== "number" ||
    typeof low !== "number"
  ) {
    return null;
  }

  return {
    temperature: Math.round(temp),
    high: Math.round(high),
    low: Math.round(low),
    description: describeWmoCode(code),
  };
}

export async function fetchWeather(
  lat: number,
  lon: number,
  timeZone = "America/Sao_Paulo",
): Promise<WeatherSnapshot | null> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    url.searchParams.set("timezone", timeZone);
    url.searchParams.set("forecast_days", "1");

    const res = await fetch(url.toString(), {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenMeteoResponse;
    return parseOpenMeteo(data);
  } catch {
    return null;
  }
}
