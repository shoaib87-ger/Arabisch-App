/**
 * quiz.js — Quiz-Engine: Multiple Choice mit intelligenten Distraktoren
 * Unterstützt DE→AR und AR→DE
 */

const QuizEngine = {
    // Session state
    session: {
        catId: null,
        direction: 'de-ar', // 'de-ar' or 'ar-de'
        questions: [],
        currentIdx: 0,
        correctCount: 0,
        wrongCount: 0,
        answered: false,
    },

    /**
     * Start a quiz session
     * @param {string} catId - Category/Chapter ID
     * @param {string} direction - 'de-ar' or 'ar-de'
     */
    start(catId, direction) {
        const allCards = AppState.cards.filter(c => c.cat === catId);

        if (allCards.length < 2) {
            showToast('⚠️ Mindestens 2 Karten für Quiz nötig!', 'warning');
            return false;
        }

        // Get unique word pairs (deduplicate front-back swaps)
        const wordPairs = this.getUniqueWordPairs(allCards);

        if (wordPairs.length < 2) {
            showToast('⚠️ Nicht genug einzigartige Wörter!', 'warning');
            return false;
        }

        // Generate questions
        const questions = this.generateQuestions(wordPairs, direction);

        this.session = {
            catId,
            direction,
            questions,
            currentIdx: 0,
            correctCount: 0,
            wrongCount: 0,
            answered: false,
        };

        this.renderQuestion();
        return true;
    },

    /**
     * Get unique DE-AR word pairs from cards
     */
    getUniqueWordPairs(cards) {
        const pairMap = new Map();

        cards.forEach(card => {
            let de, ar;
            if (card.frontLang === 'de') {
                de = card.front;
                ar = card.back;
            } else {
                de = card.back;
                ar = card.front;
            }

            const key = `${de}|${ar}`;
            if (!pairMap.has(key)) {
                pairMap.set(key, { de, ar, ex: card.ex, id: card.id || key, score: card.score || 0 });
            }
        });

        return Array.from(pairMap.values());
    },

    /**
     * Generate quiz questions with distractors
     */
    generateQuestions(pairs, direction) {
        // Shuffle pairs
        const shuffled = [...pairs].sort(() => Math.random() - 0.5);

        // Limit to 10 questions max per session
        const questionPairs = shuffled.slice(0, Math.min(10, pairs.length));

        return questionPairs.map(pair => {
            // Question text and correct answer
            const questionText = direction === 'de-ar' ? pair.de : pair.ar;
            const correctAnswer = direction === 'de-ar' ? pair.ar : pair.de;
            const questionLang = direction === 'de-ar' ? 'de' : 'ar';
            const answerLang = direction === 'de-ar' ? 'ar' : 'de';

            // Generate distractors from same chapter
            const distractors = this.pickDistractors(pairs, pair, direction);

            // Build options: correct + distractors
            const options = [
                { text: correctAnswer, correct: true },
                ...distractors.map(d => ({ text: d, correct: false }))
            ];

            // Shuffle options
            options.sort(() => Math.random() - 0.5);

            return {
                pair,
                questionText,
                correctAnswer,
                questionLang,
                answerLang,
                options,
                correctIdx: options.findIndex(o => o.correct),
            };
        });
    },

    /**
     * Pick 3 intelligent distractors from the same chapter
     */
    pickDistractors(allPairs, currentPair, direction) {
        // Get all possible answers except the correct one
        const pool = allPairs
            .filter(p => p !== currentPair)
            .map(p => direction === 'de-ar' ? p.ar : p.de);

        // Shuffle and take up to 3
        const shuffled = pool.sort(() => Math.random() - 0.5);
        const distractors = shuffled.slice(0, 3);

        // If not enough distractors, pad with modified versions
        while (distractors.length < 3) {
            const fake = direction === 'de-ar' ? '—' : '—';
            distractors.push(fake + ' ' + (distractors.length + 1));
        }

        return distractors;
    },

    /**
     * Handle answer selection
     */
    answer(selectedIdx) {
        if (this.session.answered) return;
        this.session.answered = true;

        const q = this.session.questions[this.session.currentIdx];
        const isCorrect = selectedIdx === q.correctIdx;

        if (isCorrect) {
            this.session.correctCount++;
            Stats.trackActivity('quiz_correct');
            this.updateCardScore(q.pair, true);
        } else {
            this.session.wrongCount++;
            Stats.trackActivity('quiz_wrong');
            this.updateCardScore(q.pair, false);
        }

        // Check if daily goal just met
        Stats.checkGoalMet();

        // Show feedback
        this.showFeedback(selectedIdx, q.correctIdx, isCorrect);

        // Auto-advance after delay
        setTimeout(() => {
            this.session.currentIdx++;
            this.session.answered = false;

            if (this.session.currentIdx < this.session.questions.length) {
                this.renderQuestion();
            } else {
                this.showResult();
            }
        }, isCorrect ? 1000 : 2000);
    },

    /**
     * Update card score in AppState
     */
    updateCardScore(pair, correct) {
        // Find matching cards and update score
        AppState.cards.forEach(card => {
            let de, ar;
            if (card.frontLang === 'de') { de = card.front; ar = card.back; }
            else { de = card.back; ar = card.front; }

            if (de === pair.de && ar === pair.ar) {
                if (!card.score) card.score = 0;
                if (!card.correctCount) card.correctCount = 0;
                if (!card.wrongCount) card.wrongCount = 0;

                if (correct) {
                    card.score = Math.min((card.score || 0) + 1, 5);
                    card.correctCount++;
                } else {
                    card.score = Math.max((card.score || 0) - 1, 0);
                    card.wrongCount++;
                }
                card.lastSeen = Date.now();
            }
        });

        Storage.save();
    },

    /**
     * Show answer feedback (color buttons)
     */
    showFeedback(selectedIdx, correctIdx, isCorrect) {
        const buttons = document.querySelectorAll('.quiz-answer-btn');

        buttons.forEach((btn, i) => {
            btn.classList.add('disabled');

            if (i === correctIdx) {
                btn.classList.add(isCorrect ? 'correct' : 'reveal');
            } else if (i === selectedIdx && !isCorrect) {
                btn.classList.add('wrong');
            }
        });
    },

    /**
     * Render current question
     */
    renderQuestion() {
        const q = this.session.questions[this.session.currentIdx];
        const total = this.session.questions.length;
        const current = this.session.currentIdx + 1;
        const pct = Math.round((this.session.currentIdx / total) * 100);

        const cat = AppState.categories.find(c => c.id === this.session.catId);
        const catName = cat ? cat.name : '';
        const catIcon = cat ? cat.icon : '📖';

        const labels = ['A', 'B', 'C', 'D'];

        const isQuestionAr = q.questionLang === 'ar';
        const isAnswerAr = q.answerLang === 'ar';

        const questionLabel = this.session.direction === 'de-ar'
            ? 'Wie heißt das auf Arabisch?'
            : 'Was bedeutet dieses Wort?';

        const learnArea = document.getElementById('learnArea');
        learnArea.innerHTML = `
            <div class="quiz-container">
                <div class="learn-chapter-header">
                    <button class="back-btn" onclick="showLearnModes()">←</button>
                    <h3>${catIcon} ${escapeHtml(catName)} — Quiz</h3>
                </div>

                <div class="quiz-progress">
                    <div class="quiz-progress-bar">
                        <div class="quiz-progress-fill" style="width: ${pct}%"></div>
                    </div>
                    <div class="quiz-progress-text">${current}/${total}</div>
                </div>

                <div class="quiz-question-card">
                    <div class="quiz-question-label">${questionLabel}</div>
                    <div class="quiz-question-text ${isQuestionAr ? 'ar' : ''}">${escapeHtml(q.questionText)}</div>
                </div>

                <div class="quiz-answers">
                    ${q.options.map((opt, i) => `
                        <button class="quiz-answer-btn" onclick="QuizEngine.answer(${i})">
                            <span class="answer-label">${labels[i]}</span>
                            <span class="answer-text ${isAnswerAr ? 'ar' : ''}">${escapeHtml(opt.text)}</span>
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    },

    /**
     * Show quiz result screen
     */
    showResult() {
        const { correctCount, wrongCount, questions } = this.session;
        const total = questions.length;
        const pct = Math.round((correctCount / total) * 100);

        let emoji, message;
        if (pct === 100) { emoji = '🏆'; message = 'Perfekt! Alle richtig!'; }
        else if (pct >= 80) { emoji = '🌟'; message = 'Ausgezeichnet!'; }
        else if (pct >= 60) { emoji = '👍'; message = 'Gut gemacht!'; }
        else if (pct >= 40) { emoji = '💪'; message = 'Weiter üben!'; }
        else { emoji = '📚'; message = 'Noch viel zu lernen!'; }

        const cat = AppState.categories.find(c => c.id === this.session.catId);
        const catName = cat ? cat.name : '';

        const learnArea = document.getElementById('learnArea');
        learnArea.innerHTML = `
            <div class="quiz-result">
                <div class="quiz-result-icon">${emoji}</div>
                <h3>${message}</h3>
                <div class="score-text">${correctCount} / ${total}</div>
                <div class="details">
                    ✅ ${correctCount} richtig · ❌ ${wrongCount} falsch<br>
                    Genauigkeit: ${pct}%
                </div>
                <button class="btn btn-primary mb-sm" onclick="QuizEngine.start('${this.session.catId}', '${this.session.direction}')">
                    🔄 Nochmal spielen
                </button>
                <button class="btn btn-secondary mb-sm" onclick="showLearnModes()">
                    ← Zurück zu ${escapeHtml(catName)}
                </button>
                <button class="btn btn-secondary" onclick="switchTab('stats')">
                    📊 Statistik ansehen
                </button>
            </div>
        `;
    }
};
