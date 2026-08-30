import { FormEvent, useEffect, useMemo, useState } from 'react';
import { fetchSports, fetchVenues, searchAvailability, type AvailabilitySlot, type SportOption, type VenueOption } from './api';

type Props = { apiBaseUrl: string };

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function App({ apiBaseUrl }: Props) {
  const [sports, setSports] = useState<SportOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [sport, setSport] = useState('');
  const [venueId, setVenueId] = useState('');
  const [district, setDistrict] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('22:00');
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    void fetchSports(apiBaseUrl)
      .then((items) => {
        setSports(items);
        if (items.length && !sport) setSport(items[0].code);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '無法載入運動項目'));
  }, [apiBaseUrl]);

  useEffect(() => {
    void fetchVenues(apiBaseUrl, sport || undefined)
      .then((items) => setVenues(items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '無法載入場館'));
    setVenueId('');
  }, [apiBaseUrl, sport]);

  const selectedVenue = useMemo(
    () => venues.find((venue) => String(venue.id) === venueId),
    [venues, venueId],
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await searchAvailability(apiBaseUrl, {
        sport: sport || undefined,
        venueId: venueId ? Number(venueId) : undefined,
        district: district.trim() || undefined,
        date: date || undefined,
        start: start || undefined,
        end: end || undefined,
      });
      setSlots(result);
      setSearched(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '搜尋失敗');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AFTERTRACE</p>
          <h1>找到真的能訂的運動場地</h1>
          <p className="hero-copy">跨場館查詢公開預約空位。現在先把搜尋底座做好，下一階段會接上空位 Radar 與 Web Push。</p>
        </div>
        <div className="status-pill">Web / PWA first</div>
      </section>

      <section className="search-card">
        <form onSubmit={submit} className="search-grid">
          <label>
            <span>運動</span>
            <select value={sport} onChange={(event) => setSport(event.target.value)}>
              {sports.length === 0 && <option value="">尚無資料</option>}
              {sports.map((item) => <option value={item.code} key={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label>
            <span>場館</span>
            <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              <option value="">全部場館</option>
              {venues.map((venue) => (
                <option value={venue.id} key={venue.id}>{venue.district ? `${venue.district}｜` : ''}{venue.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>行政區</span>
            <input value={district} onChange={(event) => setDistrict(event.target.value)} placeholder="例如：大安區" />
          </label>

          <label>
            <span>日期</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>

          <label>
            <span>開始時間</span>
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>

          <label>
            <span>結束時間</span>
            <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>

          <button type="submit" disabled={loading || !sport} className="primary-button">
            {loading ? '搜尋中…' : '搜尋空位'}
          </button>
        </form>
        {error && <p className="error-message">{error}</p>}
      </section>

      <section className="results-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AVAILABLE NOW</p>
            <h2>可預約時段</h2>
          </div>
          {searched && <span>{slots.length} 筆</span>}
        </div>

        {!searched && <div className="empty-state">選好運動、日期與時段後開始搜尋。</div>}
        {searched && slots.length === 0 && (
          <div className="empty-state">
            <strong>目前沒有符合條件的空位。</strong>
            <span>Radar 功能完成後，這裡會可以直接建立追蹤。</span>
          </div>
        )}

        <div className="result-list">
          {slots.map((slot) => {
            const bookingUrl = slot.externalBookingRef || slot.bookingUrl || selectedVenue?.bookingUrl || null;
            return (
              <article className="slot-card" key={slot.slotId}>
                <div>
                  <p className="slot-meta">{slot.district ?? '臺北市'} · {slot.sportName}</p>
                  <h3>{slot.venueName}</h3>
                  <p>{slot.courtName ?? '場地'}｜{slot.useDate}｜{slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}</p>
                  {slot.price && <p className="price">NT$ {slot.price}</p>}
                </div>
                {bookingUrl ? (
                  <a className="booking-link" href={bookingUrl} target="_blank" rel="noreferrer">前往官方預約</a>
                ) : (
                  <span className="booking-link disabled">官方連結同步中</span>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
