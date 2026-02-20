/**
 * ===== QIBLA FINDER =====
 * Compass-based Qibla direction finder
 * Default: Hamburg, Germany → Kaaba, Makkah
 */

const QiblaFinder = {
    // Kaaba coordinates (WGS84)
    KAABA_LAT: 21.422487,
    KAABA_LON: 39.826206,

    // Default location: Hamburg
    DEFAULT_LAT: 53.551086,
    DEFAULT_LON: 9.993682,

    // State
    isOpen: false,
    currentLat: null,
    currentLon: null,
    qiblaBearing: null,
    currentHeading: null,
    hasPermission: false,
    sensorAvailable: true,
    animFrameId: null,
    smoothedHeading: null,
    locationName: 'Hamburg',
    usingGPS: false,

    // ===== MATH FUNCTIONS =====

    /** Compute Qibla bearing from a given lat/lon to Kaaba */
    computeQiblaBearing(lat, lon) {
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const lat1 = toRad(lat);
        const lon1 = toRad(lon);
        const lat2 = toRad(this.KAABA_LAT);
        const lon2 = toRad(this.KAABA_LON);
        const dLon = lon2 - lon1;
        const x = Math.sin(dLon) * Math.cos(lat2);
        const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        let bearing = toDeg(Math.atan2(x, y));
        return (bearing + 360) % 360;
    },

    /** Get heading from DeviceOrientation event */
    getHeadingFromDeviceOrientation(event) {
        // iOS Safari uses webkitCompassHeading
        if (event.webkitCompassHeading !== undefined) {
            return event.webkitCompassHeading;
        }
        // Android/others use alpha (but it's relative to device orientation)
        if (event.alpha !== null) {
            // alpha goes counter-clockwise, compass is clockwise
            return (360 - event.alpha) % 360;
        }
        return null;
    },

    /** Smallest angular difference (signed, -180..+180) */
    angularDifference(a, b) {
        let diff = ((b - a + 180) % 360 + 360) % 360 - 180;
        return diff;
    },

    /** Smooth heading with low-pass filter */
    smoothHeading(newHeading) {
        if (this.smoothedHeading === null) {
            this.smoothedHeading = newHeading;
            return newHeading;
        }
        // Use angular interpolation to avoid jumps at 0°/360°
        const diff = this.angularDifference(this.smoothedHeading, newHeading);
        const alpha = 0.15; // Smoothing factor
        this.smoothedHeading = (this.smoothedHeading + alpha * diff + 360) % 360;
        return this.smoothedHeading;
    },

    // ===== LIFECYCLE =====

    /** Open the Qibla Finder overlay */
    open() {
        this.isOpen = true;
        this.currentLat = this.DEFAULT_LAT;
        this.currentLon = this.DEFAULT_LON;
        this.locationName = 'Hamburg';
        this.usingGPS = false;
        this.smoothedHeading = null;
        this.qiblaBearing = this.computeQiblaBearing(this.currentLat, this.currentLon);

        const overlay = document.getElementById('qiblaOverlay');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        this.renderUI();
        this.requestSensorPermission();
    },

    /** Close the Qibla Finder */
    close() {
        this.isOpen = false;
        const overlay = document.getElementById('qiblaOverlay');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
        this.stopListening();
    },

    // ===== SENSOR HANDLING =====

    /** Request device orientation permission (iOS needs explicit click) */
    async requestSensorPermission() {
        // Check if DeviceOrientationEvent is available
        if (!window.DeviceOrientationEvent) {
            this.sensorAvailable = false;
            this.renderFallback();
            return;
        }

        // iOS 13+ requires explicit permission
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // Show permission button
            this.showPermissionPrompt();
        } else {
            // Android / older iOS — just listen
            this.startListening();
        }
    },

    /** Show iOS permission prompt */
    showPermissionPrompt() {
        const prompt = document.getElementById('qiblaPermissionPrompt');
        if (prompt) prompt.style.display = 'flex';
    },

    /** Handle iOS permission request (must be called from user click) */
    async handlePermissionClick() {
        const prompt = document.getElementById('qiblaPermissionPrompt');
        try {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                this.hasPermission = true;
                if (prompt) prompt.style.display = 'none';
                this.startListening();
            } else {
                this.sensorAvailable = false;
                if (prompt) prompt.style.display = 'none';
                this.renderFallback();
            }
        } catch (err) {
            console.error('Sensor permission error:', err);
            this.sensorAvailable = false;
            if (prompt) prompt.style.display = 'none';
            this.renderFallback();
        }
    },

    /** Start listening to device orientation */
    startListening() {
        this.hasPermission = true;
        this._orientationHandler = (e) => this._onOrientation(e);
        window.addEventListener('deviceorientation', this._orientationHandler, true);

        // Start render loop
        this._renderLoop();

        // Hide fallback if visible
        const fb = document.getElementById('qiblaFallback');
        if (fb) fb.style.display = 'none';

        // Check if sensor actually gives data (timeout)
        this._sensorTimeout = setTimeout(() => {
            if (this.currentHeading === null && this.isOpen) {
                this.sensorAvailable = false;
                this.renderFallback();
            }
        }, 3000);
    },

    /** Stop listening */
    stopListening() {
        if (this._orientationHandler) {
            window.removeEventListener('deviceorientation', this._orientationHandler, true);
            this._orientationHandler = null;
        }
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        if (this._sensorTimeout) {
            clearTimeout(this._sensorTimeout);
            this._sensorTimeout = null;
        }
    },

    /** Handle orientation event */
    _onOrientation(event) {
        const heading = this.getHeadingFromDeviceOrientation(event);
        if (heading !== null) {
            this.currentHeading = heading;
            // Clear timeout — sensor works
            if (this._sensorTimeout) {
                clearTimeout(this._sensorTimeout);
                this._sensorTimeout = null;
            }
        }
    },

    /** Render loop for smooth animation */
    _renderLoop() {
        if (!this.isOpen) return;

        if (this.currentHeading !== null && this.qiblaBearing !== null) {
            const smoothed = this.smoothHeading(this.currentHeading);
            const delta = Math.abs(this.angularDifference(smoothed, this.qiblaBearing));
            const isAligned = delta <= 15;

            // Rotate compass rose opposite to heading
            const compassRose = document.getElementById('qiblaCompassRose');
            if (compassRose) {
                compassRose.style.transform = `rotate(${-smoothed}deg)`;
            }

            // Position Qibla indicator on the compass
            const indicator = document.getElementById('qiblaIndicator');
            if (indicator) {
                const indicatorAngle = this.qiblaBearing - smoothed;
                indicator.style.transform = `rotate(${indicatorAngle}deg)`;
            }

            // Update delta display
            const deltaEl = document.getElementById('qiblaDelta');
            if (deltaEl) {
                deltaEl.textContent = `${Math.round(delta)}°`;
            }

            const deltaLabel = document.getElementById('qiblaDeltaLabel');
            if (deltaLabel) {
                deltaLabel.textContent = isAligned ? '✅ Qibla-Richtung!' : 'Abweichung';
            }

            // Color feedback
            const compass = document.getElementById('qiblaCompassContainer');
            if (compass) {
                compass.classList.toggle('aligned', isAligned);
                compass.classList.toggle('not-aligned', !isAligned);
            }

            // Update heading display
            const headingEl = document.getElementById('qiblaHeading');
            if (headingEl) {
                headingEl.textContent = `${Math.round(smoothed)}°`;
            }
        }

        this.animFrameId = requestAnimationFrame(() => this._renderLoop());
    },

    // ===== GPS =====

    /** Use device GPS for more accurate location */
    async useGPS() {
        const btn = document.getElementById('qiblaGPSBtn');
        if (btn) btn.textContent = '📡 Standort wird ermittelt...';

        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 10000
                });
            });
            this.currentLat = pos.coords.latitude;
            this.currentLon = pos.coords.longitude;
            this.usingGPS = true;
            this.locationName = `${pos.coords.latitude.toFixed(3)}°N, ${pos.coords.longitude.toFixed(3)}°E`;
            this.qiblaBearing = this.computeQiblaBearing(this.currentLat, this.currentLon);

            // Update bearing display
            const bearingEl = document.getElementById('qiblaBearingValue');
            if (bearingEl) bearingEl.textContent = `${this.qiblaBearing.toFixed(1)}°`;

            const locEl = document.getElementById('qiblaLocation');
            if (locEl) locEl.textContent = `📍 ${this.locationName}`;

            if (btn) btn.textContent = '✅ GPS aktiv';
            btn.disabled = true;

        } catch (err) {
            console.error('GPS error:', err);
            if (btn) btn.textContent = '❌ GPS nicht verfügbar';
            setTimeout(() => { if (btn) btn.textContent = '📍 Standort nutzen'; }, 2000);
        }
    },

    // ===== UI RENDERING =====

    /** Main UI render */
    renderUI() {
        const content = document.getElementById('qiblaContent');
        if (!content) return;

        const bearing = this.qiblaBearing.toFixed(1);

        content.innerHTML = `
            <!-- Compass -->
            <div class="qibla-compass-container" id="qiblaCompassContainer">
                <div class="qibla-compass">
                    <!-- Compass Rose -->
                    <div class="qibla-compass-rose" id="qiblaCompassRose">
                        <svg viewBox="0 0 300 300" class="compass-svg">
                            <!-- Outer ring -->
                            <circle cx="150" cy="150" r="140" fill="none" stroke="rgba(200,149,46,0.3)" stroke-width="2"/>
                            <circle cx="150" cy="150" r="120" fill="none" stroke="rgba(200,149,46,0.15)" stroke-width="1"/>

                            <!-- Tick marks -->
                            ${this._generateTicks()}

                            <!-- Cardinal directions -->
                            <text x="150" y="30" text-anchor="middle" class="compass-cardinal compass-north">N</text>
                            <text x="270" y="155" text-anchor="middle" class="compass-cardinal">O</text>
                            <text x="150" y="280" text-anchor="middle" class="compass-cardinal">S</text>
                            <text x="30" y="155" text-anchor="middle" class="compass-cardinal">W</text>

                            <!-- North indicator triangle -->
                            <polygon points="150,45 145,58 155,58" fill="#e74c3c" class="north-triangle"/>
                        </svg>
                    </div>

                    <!-- Qibla direction indicator (always points to Qibla relative to compass) -->
                    <div class="qibla-indicator" id="qiblaIndicator">
                        <div class="qibla-arrow">
                            <svg viewBox="0 0 60 60" class="kaaba-icon-svg">
                                <rect x="15" y="15" width="30" height="30" rx="3" fill="#1a1a1a" stroke="#c8952e" stroke-width="2"/>
                                <rect x="24" y="28" width="12" height="17" rx="1" fill="#c8952e"/>
                                <line x1="15" y1="22" x2="45" y2="22" stroke="#c8952e" stroke-width="1.5"/>
                            </svg>
                        </div>
                    </div>

                    <!-- Center dot -->
                    <div class="qibla-center-dot"></div>

                    <!-- Phone direction indicator (top) -->
                    <div class="qibla-phone-indicator">▲</div>
                </div>
            </div>

            <!-- iOS Permission Prompt -->
            <div class="qibla-permission-prompt" id="qiblaPermissionPrompt" style="display: none;">
                <button class="qibla-permission-btn" onclick="QiblaFinder.handlePermissionClick()">
                    🧭 Kompass aktivieren
                </button>
                <p class="qibla-permission-hint">Erlaubt den Zugriff auf den Bewegungssensor</p>
            </div>

            <!-- Fallback (no sensor) -->
            <div class="qibla-fallback" id="qiblaFallback" style="display: none;">
                <div class="qibla-fallback-icon">🧭</div>
                <p>Sensor nicht verfügbar</p>
                <p class="qibla-fallback-hint">Qibla-Richtung: <strong>${bearing}°</strong> von Norden</p>
                <div class="qibla-static-arrow" style="transform: rotate(${this.qiblaBearing}deg)">↑</div>
            </div>

            <!-- Info Bar -->
            <div class="qibla-info-bar">
                <div class="qibla-info-item">
                    <span class="qibla-info-label">Qibla</span>
                    <span class="qibla-info-value" id="qiblaBearingValue">${bearing}°</span>
                </div>
                <div class="qibla-info-item qibla-delta-item">
                    <span class="qibla-info-label" id="qiblaDeltaLabel">Abweichung</span>
                    <span class="qibla-info-value qibla-delta-value" id="qiblaDelta">—</span>
                </div>
                <div class="qibla-info-item">
                    <span class="qibla-info-label">Heading</span>
                    <span class="qibla-info-value" id="qiblaHeading">—</span>
                </div>
            </div>

            <!-- Location -->
            <div class="qibla-location-bar">
                <span id="qiblaLocation">📍 ${this.locationName}</span>
                <button class="qibla-gps-btn" id="qiblaGPSBtn" onclick="QiblaFinder.useGPS()">📍 Standort nutzen</button>
            </div>
        `;
    },

    /** Generate compass tick marks */
    _generateTicks() {
        let ticks = '';
        for (let i = 0; i < 360; i += 5) {
            const isMain = i % 30 === 0;
            const r1 = isMain ? 105 : 110;
            const r2 = 118;
            const rad = (i - 90) * Math.PI / 180;
            const x1 = 150 + r1 * Math.cos(rad);
            const y1 = 150 + r1 * Math.sin(rad);
            const x2 = 150 + r2 * Math.cos(rad);
            const y2 = 150 + r2 * Math.sin(rad);
            const sw = isMain ? 2 : 0.8;
            const color = isMain ? 'rgba(200,149,46,0.7)' : 'rgba(200,149,46,0.25)';
            ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${sw}"/>`;
        }
        return ticks;
    },

    /** Show fallback UI (no sensor) */
    renderFallback() {
        const prompt = document.getElementById('qiblaPermissionPrompt');
        if (prompt) prompt.style.display = 'none';
        const fb = document.getElementById('qiblaFallback');
        if (fb) fb.style.display = 'flex';
    }
};
