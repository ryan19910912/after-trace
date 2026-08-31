import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createWatchRule,
  deleteWatchRule,
  fetchSports,
  fetchVenues,
  fetchWatchRules,
  searchAvailability,
  updateWatchRule,
  type AvailabilitySlot,
  type SportOption,
  type VenueOption,
  type WatchRule,
} from './api';
import {
  disableWebPush,
  enableWebPush,
  ensureRadarIdentity,
  reconcileWebPush,
  syncServiceWorkerIdentity,
} from './pwa';

type Props = { apiBaseUrl: string };

const WEEKDAYS = [
  { value: 0, label: '日' },
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
] as const;

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function queryValue(name: string, fallback = '') {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function watchTime(value: string | null) {
  return value ? value.slice(0, 5) : '不限';
}

function sourceFreshness(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '最近已同步';
  const ageMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (ageMinutes < 1) return '剛剛同步';
  if (ageMinutes < 60) return `${ageMinutes} 分鐘前同步`;
  const ageHours = Math.floor(ageMinutes / 60);
  return `${ageHours} 小時前同步`;
}

function watchDays(days: number[] | null) {
  if (!days || days.length === 0) return '每天';
  return days.map((day) => `週${WEEKDAYS.find((item) => item.value === day)?.label ?? day}`).join('、');
}

export function App({ apiBaseUrl }: Props) {
  const [sports, setSports] = useState<SportOption[]>([]);
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [venuesReady, setVenuesReady] = useState(false);
  const [sport, setSport] = useState(() => queryValue('sport'));
  const [venueId, setVenueId] = useState(() => queryValue('venueId'));
  const [city, setCity] = useState(() => queryValue('city', '臺北市'));
  const [district, setDistrict] = useState(() => queryValue('district'));
  const [date, setDate] = useState(() => queryValue('date', todayLocal()));
  const [start, setStart] = useState(() => queryValue('start', '18:00'));
  const [end, setEnd] = useState(() => queryValue('end', '22:00'));
  const [radarDateTo, setRadarDateTo] = useState(() => queryValue('date', todayLocal()));
  const [radarDaysOfWeek, setRadarDaysOfWeek] = useState<number[]>([]);
  const [editingWatchId, setEditingWatchId] = useState<number | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [identityToken, setIdentityToken] = useState<string | null>(null);
  const [watches, setWatches] = useState<WatchRule[]>([]);
  const [radarBusy, setRadarBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const autoSearch = useMemo(() => queryValue('radar') === '1', []);

  useEffect(() => {
    void fetchSports(apiBaseUrl)
      .then((items) => {
        setSports(items);
        setSport((current) => current || items[0]?.code || '');
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '無法載入運動項目'));
  }, [apiBaseUrl]);

  useEffect(() => {
    if (!sport) {
      setVenues([]);
      setVenuesReady(false);
      return;
    }

    let cancelled = false;
    setVenuesReady(false);
    void fetchVenues(apiBaseUrl, sport)
      .then((items) => {
        if (cancelled) return;
        setVenues(items);
        setVenueId((currentVenueId) => {
          const matchedVenue = currentVenueId
            ? items.find((venue) => String(venue.id) === currentVenueId)
            : undefined;

          if (matchedVenue) {
            setCity(matchedVenue.city);
            return currentVenueId;
          }

          setCity((currentCity) => {
            if (currentCity && items.some((venue) => venue.city === currentCity)) return currentCity;
            if (items.some((venue) => venue.city === '臺北市')) return '臺北市';
            return items[0]?.city || currentCity;
          });
          return '';
        });
        setVenuesReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '無法載入場館');
      });

    return () => { cancelled = true; };
  }, [apiBaseUrl, sport]);

  useEffect(() => {
    let cancelled = false;
    void ensureRadarIdentity(apiBaseUrl)
      .then(async (token) => {
        if (cancelled) return;
        setIdentityToken(token);
        await syncServiceWorkerIdentity(token, apiBaseUrl);
        const [rules, enabled] = await Promise.all([
          fetchWatchRules(apiBaseUrl, token),
          reconcileWebPush(apiBaseUrl, token).catch(() => false),
        ]);
        if (cancelled) return;
        setWatches(rules);
        setPushEnabled(enabled);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Radar 身分初始化失敗');
      });
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  const cityOptions = useMemo(
    () => [...new Set(venues.map((venue) => venue.city))].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [venues],
  );

  const visibleVenues = useMemo(
    () => city ? venues.filter((venue) => venue.city === city) : venues,
    [venues, city],
  );

  const selectedVenue = useMemo(
    () => venues.find((venue) => String(venue.id) === venueId),
    [venues, venueId],
  );

  async function performSearch() {
    if (!sport) return;
    setLoading(true);
    setError(null);
    try {
      const result = await searchAvailability(apiBaseUrl, {
        sport,
        venueId: venueId ? Number(venueId) : undefined,
        city: selectedVenue?.city || city || undefined,
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

  useEffect(() => {
    if (!autoSearch || searched || !sport || sports.length === 0 || !venuesReady) return;
    if (venueId && !selectedVenue) return;
    void performSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSearch, searched, sport, sports.length, venuesReady, venueId, selectedVenue]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await performSearch();
  }

  async function refreshWatches(token = identityToken) {
    if (!token) return;
    setWatches(await fetchWatchRules(apiBaseUrl, token));
  }

  async function enableNotifications() {
    if (!identityToken) return;
    setPushBusy(true);
    setError(null);
    try {
      const result = await enableWebPush(apiBaseUrl, identityToken);
      if (result.status === 'ENABLED') {
        setPushEnabled(true);
        setNotice('空位通知已開啟。');
      } else if (result.status === 'DENIED') {
        setNotice('瀏覽器沒有允許通知；Radar 仍會保留，你可以之後再開啟。');
      } else if (result.status === 'NOT_CONFIGURED') {
        setNotice('Radar 已可建立，但伺服器的 Web Push 金鑰尚未設定。');
      } else {
        setNotice('這個瀏覽器目前不支援 Web Push。iPhone 請先把網站加入主畫面後再開啟通知。');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知開啟失敗');
    } finally {
      setPushBusy(false);
    }
  }

  async function turnOffNotifications() {
    if (!identityToken) return;
    setPushBusy(true);
    try {
      await disableWebPush(apiBaseUrl, identityToken);
      setPushEnabled(false);
      setNotice('已關閉這個瀏覽器的空位通知。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '通知關閉失敗');
    } finally {
      setPushBusy(false);
    }
  }

  function toggleRadarDay(day: number) {
    setRadarDaysOfWeek((current) => current.includes(day)
      ? current.filter((value) => value !== day)
      : [...current, day].sort((a, b) => a - b));
  }

  function cancelRadarEdit() {
    setEditingWatchId(null);
    setRadarDateTo(date);
    setRadarDaysOfWeek([]);
  }

  async function saveRadar() {
    if (!identityToken || !sport || !date || !city) return;
    if (radarDateTo && radarDateTo < date) {
      setError('Radar 結束日期不能早於開始日期。');
      return;
    }

    setRadarBusy(true);
    setError(null);
    setNotice(null);
    const radarInput = {
      venueIds: venueId ? [Number(venueId)] : [],
      dateFrom: date,
      dateTo: radarDateTo || date,
      daysOfWeek: radarDaysOfWeek,
      startTime: start || null,
      endTime: end || null,
      city: selectedVenue?.city || city,
      district: district.trim() || null,
    };

    try {
      if (editingWatchId) {
        await updateWatchRule(apiBaseUrl, identityToken, editingWatchId, radarInput);
        setNotice('Radar 條件已更新；新的啟用邊界會避免把修改前的舊空位重新通知。');
      } else {
        await createWatchRule(apiBaseUrl, identityToken, `web:${crypto.randomUUID()}`, {
          sport,
          enabled: true,
          ...radarInput,
        });
        setNotice('Radar 已建立。符合日期、星期與時段的空位重新出現時會進入通知流程。');
      }
      await refreshWatches(identityToken);
      setEditingWatchId(null);
      if (!pushEnabled) await enableNotifications();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Radar 儲存失敗');
    } finally {
      setRadarBusy(false);
    }
  }

  function beginEditWatch(rule: WatchRule) {
    if (rule.venueIds.length > 1) {
      setNotice('這組 Radar 同時指定多個場館，目前請先用暫停/刪除管理；Web 編輯器暫不會縮窄它的多場館條件。');
      return;
    }
    setEditingWatchId(rule.id);
    setSport(rule.sportCode);
    setCity(rule.city);
    setDistrict(rule.district ?? '');
    setVenueId(rule.venueIds[0] ? String(rule.venueIds[0]) : '');
    setDate(rule.dateFrom ?? todayLocal());
    setRadarDateTo(rule.dateTo ?? rule.dateFrom ?? todayLocal());
    setRadarDaysOfWeek(rule.daysOfWeek ?? []);
    setStart(rule.startTime?.slice(0, 5) ?? '');
    setEnd(rule.endTime?.slice(0, 5) ?? '');
    setNotice('已把 Radar 條件帶回編輯區；修改後按「更新 Radar」。');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function toggleWatch(rule: WatchRule) {
    if (!identityToken) return;
    setRadarBusy(true);
    try {
      await updateWatchRule(apiBaseUrl, identityToken, rule.id, { enabled: !rule.enabled });
      await refreshWatches(identityToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Radar 更新失敗');
    } finally {
      setRadarBusy(false);
    }
  }

  async function removeWatch(rule: WatchRule) {
    if (!identityToken) return;
    setRadarBusy(true);
    try {
      await deleteWatchRule(apiBaseUrl, identityToken, rule.id);
      await refreshWatches(identityToken);
      if (editingWatchId === rule.id) cancelRadarEdit();
      setNotice('Radar 已刪除。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Radar 刪除失敗');
    } finally {
      setRadarBusy(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AFTERTRACE</p>
          <h1>找到真的能訂的運動場地</h1>
          <p className="hero-copy">跨場館查即時空位。現在沒位，就開 Radar；一有符合條件的空位，直接通知你回來看並前往官方預約。</p>
        </div>
        <div className="status-pill">Web / PWA · Radar</div>
      </section>

      <section className="search-card">
        <form onSubmit={submit} className="search-grid">
          <label>
            <span>運動</span>
            <select value={sport} onChange={(event) => { setSport(event.target.value); setVenueId(''); setSearched(false); setEditingWatchId(null); }}>
              {sports.length === 0 && <option value="">尚無資料</option>}
              {sports.map((item) => <option value={item.code} key={item.id}>{item.name}</option>)}
            </select>
          </label>

          <label>
            <span>縣市</span>
            <select
              value={city}
              onChange={(event) => {
                setCity(event.target.value);
                setVenueId('');
                setDistrict('');
                setSearched(false);
              }}
            >
              {cityOptions.length === 0 && <option value={city}>{city || '尚無資料'}</option>}
              {cityOptions.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>

          <label>
            <span>場館</span>
            <select value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              <option value="">全部場館</option>
              {visibleVenues.map((venue) => (
                <option value={venue.id} key={venue.id}>{venue.district ? `${venue.district}｜` : ''}{venue.name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>行政區</span>
            <input value={district} onChange={(event) => setDistrict(event.target.value)} placeholder="例如：大安區" />
          </label>

          <label>
            <span>搜尋日期 / Radar 起日</span>
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); if (!editingWatchId) setRadarDateTo(event.target.value); }} required />
          </label>

          <label>
            <span>開始時間</span>
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>

          <label>
            <span>結束時間</span>
            <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>

          <button type="submit" disabled={loading || !sport || !city} className="primary-button">
            {loading ? '搜尋中…' : '搜尋空位'}
          </button>
        </form>
        {error && <p className="error-message">{error}</p>}
        {notice && <p className="notice-message">{notice}</p>}
      </section>

      <section className="radar-overview">
        <div>
          <p className="eyebrow">RADAR</p>
          <h2>{editingWatchId ? '編輯 Radar' : '空位出現再叫我'}</h2>
          <p>Radar 只監控公開空位，不會替你登入、搶位或付款。可設定日期區間與星期條件。</p>
          <div className="search-grid">
            <label>
              <span>Radar 結束日期</span>
              <input type="date" min={date} value={radarDateTo} onChange={(event) => setRadarDateTo(event.target.value)} />
            </label>
            <fieldset>
              <legend>星期（不選＝每天）</legend>
              <div className="radar-actions">
                {WEEKDAYS.map((item) => (
                  <label key={item.value}>
                    <input
                      type="checkbox"
                      checked={radarDaysOfWeek.includes(item.value)}
                      onChange={() => toggleRadarDay(item.value)}
                    />
                    週{item.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
        <div className="radar-actions">
          <span className={pushEnabled ? 'push-state enabled' : 'push-state'}>
            {pushEnabled ? '通知已開啟' : '通知未開啟'}
          </span>
          <button type="button" className="primary-button" disabled={radarBusy || !identityToken || !sport || !city} onClick={() => void saveRadar()}>
            {radarBusy ? '儲存中…' : editingWatchId ? '更新 Radar' : '建立 Radar'}
          </button>
          {editingWatchId && (
            <button type="button" className="secondary-button" disabled={radarBusy} onClick={cancelRadarEdit}>取消編輯</button>
          )}
          {pushEnabled ? (
            <button type="button" className="secondary-button" disabled={pushBusy} onClick={() => void turnOffNotifications()}>
              關閉通知
            </button>
          ) : (
            <button type="button" className="secondary-button" disabled={pushBusy || !identityToken} onClick={() => void enableNotifications()}>
              {pushBusy ? '設定中…' : '開啟通知'}
            </button>
          )}
        </div>
      </section>

      <section className="results-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">AVAILABLE NOW</p>
            <h2>可預約時段</h2>
          </div>
          {searched && <span>{slots.length} 筆</span>}
        </div>

        {!searched && <div className="empty-state">選好運動、縣市、日期與時段後開始搜尋。</div>}
        {searched && slots.length === 0 && (
          <div className="empty-state radar-empty">
            <strong>目前沒有符合條件的空位。</strong>
            <span>可以直接用目前的運動、場館、日期、星期與時間建立 Radar。</span>
            <button type="button" className="primary-button inline-button" disabled={radarBusy || !identityToken} onClick={() => void saveRadar()}>
              {radarBusy ? '建立中…' : '有空位通知我'}
            </button>
          </div>
        )}

        <div className="result-list">
          {slots.map((slot) => {
            const bookingUrl = slot.bookingUrl || selectedVenue?.bookingUrl || null;
            const place = [slot.city, slot.district].filter(Boolean).join(' · ');
            return (
              <article className="slot-card" key={slot.slotId}>
                <div>
                  <p className="slot-meta">{place} · {slot.sportName}</p>
                  <h3>{slot.venueName}</h3>
                  <p>{slot.courtName ?? '場地'}｜{slot.useDate}｜{slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}</p>
                  {slot.price && <p className="price">NT$ {slot.price}</p>}
                  <p className="slot-meta">資料來源：{slot.sourceName} · {sourceFreshness(slot.sourceLastSuccessAt)}</p>
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

        {searched && slots.length > 0 && (
          <div className="keep-watching">
            <span>想等更多時段或有人取消？</span>
            <button type="button" className="secondary-button" disabled={radarBusy || !identityToken} onClick={() => void saveRadar()}>
              追蹤這組條件
            </button>
          </div>
        )}
      </section>

      <section className="watches-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MY RADARS</p>
            <h2>我的 Radar</h2>
          </div>
          <span>{watches.length} 組</span>
        </div>

        {watches.length === 0 ? (
          <div className="empty-state">還沒有 Radar。搜尋不到空位時可以直接建立。</div>
        ) : (
          <div className="watch-list">
            {watches.map((rule) => {
              const area = [rule.city, rule.district].filter(Boolean).join(' · ');
              return (
                <article className={`watch-card${rule.enabled ? '' : ' paused'}`} key={rule.id}>
                  <div>
                    <p className="slot-meta">{rule.enabled ? '監控中' : '已暫停'} · {rule.sportName}</p>
                    <h3>{rule.venueIds.length ? `指定 ${rule.venueIds.length} 個場館` : area}</h3>
                    <p>{rule.dateFrom ?? '不限日期'}{rule.dateTo && rule.dateTo !== rule.dateFrom ? ` ～ ${rule.dateTo}` : ''}｜{watchDays(rule.daysOfWeek)}｜{watchTime(rule.startTime)}–{watchTime(rule.endTime)}</p>
                  </div>
                  <div className="watch-actions">
                    <button type="button" className="secondary-button" disabled={radarBusy || rule.venueIds.length > 1} onClick={() => beginEditWatch(rule)}>
                      編輯
                    </button>
                    <button type="button" className="secondary-button" disabled={radarBusy} onClick={() => void toggleWatch(rule)}>
                      {rule.enabled ? '暫停' : '恢復'}
                    </button>
                    <button type="button" className="danger-button" disabled={radarBusy} onClick={() => void removeWatch(rule)}>
                      刪除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
