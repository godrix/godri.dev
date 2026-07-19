import { fetchCalendarEvents } from "@/lib/eink/calendar";
import {
  formatEventDay,
  formatEventTime,
  getClockSnapshot,
} from "@/lib/eink/clock";
import {
  getEinkConfig,
  type EinkQueryParams,
} from "@/lib/eink/config";
import { fetchNews } from "@/lib/eink/news";
import { quoteForDate } from "@/lib/eink/quote";
import { fetchWeather } from "@/lib/eink/weather";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams: Promise<EinkQueryParams>;
};

export default async function EinkPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const config = getEinkConfig(params);
  const now = new Date();
  const clock = getClockSnapshot(now, config.timeZone);
  const quote = quoteForDate(clock.dateKey);

  const [weather, events, news] = await Promise.all([
    fetchWeather(config.lat, config.lon, config.timeZone),
    fetchCalendarEvents(config.icalUrl, now, config.timeZone),
    fetchNews(config.rssUrls, 4),
  ]);

  return (
    <>
      <meta httpEquiv="refresh" content={String(config.refreshSeconds)} />
      {/*
        Hold the Kindle rotated 90° clockwise (home button / charging side
        toward you). Browser chrome stays on the physical top edge — it
        cannot be hidden; the stage is sized to the remaining viewport.
      */}
      <div className="eink-stage">
        <div className="eink-root">
          <header className="eink-masthead">
            <table className="eink-masthead-inner" cellSpacing={0} cellPadding={0}>
              <tbody>
                <tr>
                  <td>
                    <p className="eink-brand">godri.dev / eink</p>
                    <p className="eink-time">{clock.time}</p>
                  </td>
                  <td>
                    <p className="eink-date">{clock.dateLabel}</p>
                  </td>
                </tr>
              </tbody>
            </table>
          </header>

          <hr className="eink-rule" />

          <table className="eink-split" cellSpacing={0} cellPadding={0}>
            <tbody>
              <tr>
                <td>
                  <h2 className="eink-mod-head">Clima · {config.cityLabel}</h2>
                  <div className="eink-mod-body">
                    {weather ? (
                      <>
                        <p className="eink-temp">
                          {weather.temperature}
                          <span className="eink-temp-unit">°C</span>
                        </p>
                        <p className="eink-wx-desc">{weather.description}</p>
                        <div className="eink-wx-range">
                          <span className="eink-pill">máx {weather.high}°</span>
                          <span className="eink-pill">mín {weather.low}°</span>
                        </div>
                      </>
                    ) : (
                      <p className="eink-muted">clima indisponível</p>
                    )}
                  </div>
                </td>
                <td>
                  <h2 className="eink-mod-head">Quote do dia</h2>
                  <div className="eink-mod-body">
                    <blockquote className="eink-quote">
                      <span className="eink-quote-mark" aria-hidden="true">
                        “
                      </span>
                      {quote.text}
                      <div className="eink-quote-author">— {quote.author}</div>
                    </blockquote>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <table
            className="eink-split eink-split-tall"
            cellSpacing={0}
            cellPadding={0}
          >
            <tbody>
              <tr>
                <td>
                  <h2 className="eink-mod-head">Agenda</h2>
                  <div className="eink-mod-body">
                    {events === null ? (
                      <p className="eink-muted">agenda indisponível</p>
                    ) : events.length === 0 ? (
                      <p className="eink-muted">
                        {config.icalUrl ? "nada nas próximas 48h" : "sem agenda"}
                      </p>
                    ) : (
                      <table className="eink-list">
                        <tbody>
                          {events.slice(0, 4).map((event, i) => (
                            <tr key={`${event.start.toISOString()}-${i}`}>
                              <td className="eink-idx">
                                {String(i + 1).padStart(2, "0")}
                              </td>
                              <td>
                                <p className="eink-when">
                                  {formatEventDay(
                                    event.start,
                                    now,
                                    config.timeZone,
                                  )}{" "}
                                  ·{" "}
                                  {formatEventTime(
                                    event.start,
                                    event.allDay,
                                    config.timeZone,
                                  )}
                                </p>
                                <p className="eink-title">{event.summary}</p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </td>
                <td>
                  <h2 className="eink-mod-head">Notícias</h2>
                  <div className="eink-mod-body eink-news">
                    {news && news.length > 0 ? (
                      <table className="eink-list">
                        <tbody>
                          {news.map((item, i) => (
                            <tr key={`${item.title}-${i}`}>
                              <td>
                                <p className="eink-title">{item.title}</p>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="eink-muted">notícias indisponíveis</p>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <p className="eink-footer">
            refresh {config.refreshSeconds}s · {config.timeZone} · gire 90° →
          </p>
        </div>
      </div>
    </>
  );
}
