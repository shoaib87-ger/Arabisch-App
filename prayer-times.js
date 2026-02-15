/**
 * prayer-times.js — Gebetszeiten für Hamburg via Aladhan API
 * Live-Daten + Countdown bis zum nächsten Gebet
 */

const PrayerTimes = {
    data: null,
    countdownInterval: null,
    city: 'Hamburg',
    country: 'Germany',
    method: 3, // Muslim World League

    // Prayer names in display order
    prayers: [
        { key: 'Fajr', name: 'Fajr', icon: '🌅', nameAr: 'الفجر' },
        { key: 'Sunrise', name: 'Sunrise', icon: '☀️', nameAr: 'الشروق' },
        { key: 'Dhuhr', name: 'Dhuhr', icon: '🕛', nameAr: 'الظهر' },
        { key: 'Asr', name: 'Asr', icon: '🌤️', nameAr: 'العصر' },
        { key: 'Maghrib', name: 'Maghrib', icon: '🌅', nameAr: 'المغرب' },
        { key: 'Isha', name: 'Isha', icon: '🌙', nameAr: 'العشاء' },
    ],

    /**
     * Fetch today's prayer times from Aladhan API
     */
    async fetch() {
        const url = `https://api.aladhan.com/v1/timingsByCity?city=${this.city}&country=${this.country}&method=${this.method}`;

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();

            if (json.code === 200 && json.data) {
                this.data = json.data;
                localStorage.setItem('prayerTimesCache', JSON.stringify({
                    data: json.data,
                    date: new Date().toDateString()
                }));
                return json.data;
            }
            throw new Error('API Error');
        } catch (err) {
            console.error('❌ Prayer Times Error:', err);
            // Try cache
            const cached = localStorage.getItem('prayerTimesCache');
            if (cached) {
                const parsed = JSON.parse(cached);
                this.data = parsed.data;
                return parsed.data;
            }
            return null;
        }
    },

    /**
     * Get next prayer and time remaining
     */
    getNextPrayer() {
        if (!this.data) return null;

        const now = new Date();
        const timings = this.data.timings;

        for (const prayer of this.prayers) {
            if (prayer.key === 'Sunrise') continue; // Sunrise is not a prayer

            const [h, m] = timings[prayer.key].split(':').map(Number);
            const prayerTime = new Date();
            prayerTime.setHours(h, m, 0, 0);

            if (prayerTime > now) {
                const diff = prayerTime - now;
                return {
                    prayer,
                    time: timings[prayer.key],
                    remaining: this.formatCountdown(diff)
                };
            }
        }

        // All prayers passed, next is Fajr tomorrow
        const [h, m] = timings['Fajr'].split(':').map(Number);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(h, m, 0, 0);
        const diff = tomorrow - now;

        return {
            prayer: this.prayers[0],
            time: timings['Fajr'],
            remaining: this.formatCountdown(diff),
            tomorrow: true
        };
    },

    formatCountdown(ms) {
        const totalSec = Math.floor(ms / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;
        return { hours, mins, secs, text: `${hours}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s` };
    },

    /**
     * Render the prayer times view
     */
    async render(container) {
        container.innerHTML = `
            <div class="prayer-loading">
                <div class="prayer-loading-spinner"></div>
                <p>Gebetszeiten werden geladen...</p>
            </div>
        `;

        const data = await this.fetch();

        if (!data) {
            container.innerHTML = `
                <div class="prayer-error">
                    <p>⚠️ Gebetszeiten konnten nicht geladen werden.</p>
                    <button class="btn btn-primary btn-small" onclick="PrayerTimes.render(document.getElementById('prayerContent'))">
                        🔄 Erneut versuchen
                    </button>
                </div>
            `;
            return;
        }

        const timings = data.timings;
        const hijri = data.date.hijri;
        const gregorian = data.date.gregorian;
        const next = this.getNextPrayer();

        container.innerHTML = `
            <div class="prayer-header-card">
                <button class="prayer-back-btn" onclick="renderIslamTab()">‹ Zurück</button>
                <div class="prayer-mosque-icon">🕌</div>
                <h2>Gebetszeiten</h2>
                <p class="prayer-city">${this.city}, ${this.country}</p>
                <p class="prayer-hijri-date">${hijri.day}. ${hijri.month.ar} ${hijri.year} هـ</p>
                <p class="prayer-greg-date">${gregorian.day}. ${gregorian.month.en} ${gregorian.year}</p>
            </div>

            ${next ? `
            <div class="next-prayer-card">
                <div class="next-prayer-label">Nächstes Gebet</div>
                <div class="next-prayer-name">
                    <span class="next-prayer-icon">${next.prayer.icon}</span>
                    <span>${next.prayer.name}</span>
                    <span class="next-prayer-ar">${next.prayer.nameAr}</span>
                </div>
                <div class="next-prayer-time">${next.time}</div>
                <div class="countdown-display" id="prayerCountdown">
                    <div class="countdown-segment">
                        <span class="countdown-number" id="cdHours">${String(next.remaining.hours).padStart(2, '0')}</span>
                        <span class="countdown-label">Std</span>
                    </div>
                    <span class="countdown-separator">:</span>
                    <div class="countdown-segment">
                        <span class="countdown-number" id="cdMins">${String(next.remaining.mins).padStart(2, '0')}</span>
                        <span class="countdown-label">Min</span>
                    </div>
                    <span class="countdown-separator">:</span>
                    <div class="countdown-segment">
                        <span class="countdown-number" id="cdSecs">${String(next.remaining.secs).padStart(2, '0')}</span>
                        <span class="countdown-label">Sek</span>
                    </div>
                </div>
            </div>
            ` : ''}

            <div class="prayer-times-list">
                ${this.prayers.map(p => {
            const time = timings[p.key];
            const isNext = next && next.prayer.key === p.key;
            const isPast = this.isPast(time);
            return `
                        <div class="prayer-time-row ${isNext ? 'prayer-next' : ''} ${isPast ? 'prayer-past' : ''}">
                            <div class="prayer-time-left">
                                <span class="prayer-time-icon">${p.icon}</span>
                                <div>
                                    <div class="prayer-time-name">${p.name}</div>
                                    <div class="prayer-time-ar">${p.nameAr}</div>
                                </div>
                            </div>
                            <div class="prayer-time-value">${time}</div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;

        // Start countdown
        this.startCountdown();
    },

    isPast(timeStr) {
        const [h, m] = timeStr.split(':').map(Number);
        const now = new Date();
        return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
    },

    startCountdown() {
        if (this.countdownInterval) clearInterval(this.countdownInterval);

        this.countdownInterval = setInterval(() => {
            const next = this.getNextPrayer();
            if (!next) return;

            const h = document.getElementById('cdHours');
            const m = document.getElementById('cdMins');
            const s = document.getElementById('cdSecs');

            if (h) h.textContent = String(next.remaining.hours).padStart(2, '0');
            if (m) m.textContent = String(next.remaining.mins).padStart(2, '0');
            if (s) s.textContent = String(next.remaining.secs).padStart(2, '0');
        }, 1000);
    },

    stopCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    }
};
