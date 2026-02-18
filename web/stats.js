/**
 * stats.js — Statistik-Modul: Tagesfortschritt, Streak, Kapitel-Progress
 */

const Stats = {
    data: {
        dailyGoal: 20,
        streak: 0,
        lastActiveDate: null,
        history: {}
    },

    load() {
        try {
            const saved = localStorage.getItem('stats');
            if (saved) {
                this.data = { ...this.data, ...JSON.parse(saved) };
            }
            this.checkStreak();
        } catch (e) {
            console.error('Stats load error:', e);
        }
    },

    save() {
        try {
            localStorage.setItem('stats', JSON.stringify(this.data));
        } catch (e) {
            console.error('Stats save error:', e);
        }
    },

    // Get today's date string
    today() {
        return new Date().toISOString().split('T')[0];
    },

    // Ensure today's entry exists
    ensureToday() {
        const d = this.today();
        if (!this.data.history[d]) {
            this.data.history[d] = { learned: 0, quiz: 0, correct: 0 };
        }
        return this.data.history[d];
    },

    // Track a learning activity
    trackActivity(type) {
        const entry = this.ensureToday();

        if (type === 'flashcard') {
            entry.learned++;
        } else if (type === 'quiz_correct') {
            entry.quiz++;
            entry.correct++;
            entry.learned++;
        } else if (type === 'quiz_wrong') {
            entry.quiz++;
            entry.learned++;
        }

        this.data.lastActiveDate = this.today();
        this.checkStreak();
        this.save();
    },

    // Check and update streak
    checkStreak() {
        const today = this.today();
        const last = this.data.lastActiveDate;

        if (!last) {
            this.data.streak = 0;
            return;
        }

        const lastDate = new Date(last);
        const todayDate = new Date(today);
        const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            // Still today — check if goal met
            const todayEntry = this.data.history[today];
            if (todayEntry && todayEntry.learned >= this.data.dailyGoal) {
                // Goal met today
                if (this.data.streak === 0 || last !== today) {
                    // Don't double-count
                }
            }
        } else if (diffDays === 1) {
            // Yesterday was active — streak continues
            const yesterdayEntry = this.data.history[last];
            if (yesterdayEntry && yesterdayEntry.learned >= this.data.dailyGoal) {
                // Yesterday's goal was met, streak is valid
            } else {
                // Yesterday didn't meet goal — streak breaks
                this.data.streak = 0;
            }
        } else if (diffDays > 1) {
            // Missed days — streak breaks
            this.data.streak = 0;
        }
    },

    // Update streak when daily goal is met
    checkGoalMet() {
        const today = this.today();
        const entry = this.data.history[today];
        if (entry && entry.learned >= this.data.dailyGoal) {
            // Check if we already counted this day
            if (this.data.lastStreakDate !== today) {
                this.data.streak++;
                this.data.lastStreakDate = today;
                this.save();
                return true; // Goal just met!
            }
        }
        return false;
    },

    // Get today's learned count
    getTodayCount() {
        const entry = this.data.history[this.today()];
        return entry ? entry.learned : 0;
    },

    // Get chapter progress (% of cards with score >= 3)
    getChapterProgress(catId, cards) {
        const catCards = cards.filter(c => c.cat === catId);
        if (catCards.length === 0) return { total: 0, mastered: 0, pct: 0 };
        const mastered = catCards.filter(c => (c.score || 0) >= 3).length;
        return {
            total: catCards.length,
            mastered: mastered,
            pct: Math.round((mastered / catCards.length) * 100)
        };
    },

    // Render full statistics view
    render(categories, cards) {
        const area = document.getElementById('statsArea');
        if (!area) return;

        const todayCount = this.getTodayCount();
        const goal = this.data.dailyGoal;
        const pct = Math.min(100, Math.round((todayCount / goal) * 100));
        const circumference = 2 * Math.PI * 48;
        const offset = circumference - (pct / 100) * circumference;

        const todayEntry = this.data.history[this.today()] || { learned: 0, quiz: 0, correct: 0 };
        const accuracy = todayEntry.quiz > 0 ? Math.round((todayEntry.correct / todayEntry.quiz) * 100) : 0;

        let chapterHTML = '';
        categories.forEach(cat => {
            const prog = this.getChapterProgress(cat.id, cards);
            chapterHTML += `
                <div class="chapter-progress-item">
                    <div class="chapter-progress-icon">${cat.icon}</div>
                    <div class="chapter-progress-info">
                        <div class="chapter-progress-name">${cat.name}</div>
                        <div class="chapter-progress-bar">
                            <div class="chapter-progress-fill" style="width: ${prog.pct}%"></div>
                        </div>
                    </div>
                    <div class="chapter-progress-pct">${prog.pct}%</div>
                </div>
            `;
        });

        area.innerHTML = `
            <div class="stats-container">
                <div class="stats-header">
                    <h3>📊 Deine Statistik</h3>
                    <p>Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                </div>

                <!-- Daily Progress Ring -->
                <div class="daily-ring-container">
                    <div class="daily-ring">
                        <svg viewBox="0 0 108 108">
                            <circle class="daily-ring-bg" cx="54" cy="54" r="48" />
                            <circle class="daily-ring-fill" cx="54" cy="54" r="48"
                                stroke-dasharray="${circumference}"
                                stroke-dashoffset="${offset}" />
                        </svg>
                        <div class="daily-ring-text">
                            <div class="daily-ring-number">${todayCount}</div>
                            <div class="daily-ring-label">von ${goal}</div>
                        </div>
                    </div>
                    <div class="daily-goal-text">
                        ${pct >= 100 ? '🎉 Tagesziel erreicht!' : `Noch ${goal - todayCount} Wörter bis zum Ziel`}
                    </div>

                    <!-- Streak -->
                    <div class="streak-badge ${this.data.streak > 0 ? '' : 'inactive'}">
                        🔥 ${this.data.streak} Tag${this.data.streak !== 1 ? 'e' : ''} Streak
                    </div>
                </div>

                <!-- Today's Details -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
                    <div style="background: var(--bg-light); padding: 14px; border-radius: var(--radius); text-align: center; border: 1px solid var(--border);">
                        <div style="font-size: 22px; font-weight: 800; color: var(--gold);">${todayEntry.quiz}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">Quiz-Fragen</div>
                    </div>
                    <div style="background: var(--bg-light); padding: 14px; border-radius: var(--radius); text-align: center; border: 1px solid var(--border);">
                        <div style="font-size: 22px; font-weight: 800; color: ${accuracy >= 70 ? 'var(--success)' : 'var(--danger)'};">${accuracy}%</div>
                        <div style="font-size: 12px; color: var(--text-secondary); font-weight: 500;">Genauigkeit</div>
                    </div>
                </div>

                <!-- Chapter Progress -->
                <h4 style="font-size: 15px; font-weight: 700; margin-bottom: 10px; color: var(--text-primary);">📖 Kapitel-Fortschritt</h4>
                <div class="chapter-progress-list">
                    ${chapterHTML || '<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">Noch keine Kapitel angelegt</p>'}
                </div>
            </div>
        `;
    }
};
