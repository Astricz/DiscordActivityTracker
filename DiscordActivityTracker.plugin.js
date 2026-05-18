/**
 * @name DiscordActivityTracker
 * @description Track your friends' Discord activity. See when they're online, their patterns, and full status history.
 * @version 2.1.0
 * @author Astricz
 */

module.exports = class ActivityTracker {
    getName()        { return "DiscordActivityTracker"; }
    getDescription() { return "Track friends' activity and see when they're usually online."; }
    getVersion()     { return "2.1.0"; }
    getAuthor()      { return "Astricz"; }

    _defaultOptions() {
        return {
            maxActivityLog: 2000,
            maxAvatarLog:   50,
            maxGameLog:     500,
            maxCustomLog:   200,
            maxNameLog:     100,
            showToasts:     true,
            retentionDays:  90,
            autoprune:      false,
        };
    }

    start() {
        this.trackedUsers    = BdApi.Data.load("ActivityTracker", "trackedUsers")    || [];
        this.activityLog     = BdApi.Data.load("ActivityTracker", "activityLog")     || {};
        this.avatarLog       = BdApi.Data.load("ActivityTracker", "avatarLog")       || {};
        this.nameLog         = BdApi.Data.load("ActivityTracker", "nameLog")         || {};
        this.customStatusLog = BdApi.Data.load("ActivityTracker", "customStatusLog") || {};
        this.gameLog         = BdApi.Data.load("ActivityTracker", "gameLog")         || {};
        this.options         = Object.assign(this._defaultOptions(), BdApi.Data.load("ActivityTracker", "options") || {});

        this._lastStatus       = {};
        this._lastAvatar       = {};
        this._lastName         = {};
        this._lastCustomStatus = {};
        this._lastGame         = {};
        this._lastPlatform     = {};
        this._sortKey          = "name";
        this._sortDir          = 1;
        this._activeTab        = {};

        BdApi.DOM.addStyle("ActivityTracker", this.getCSS());
        this.patchPresence();
        this.patchUserUpdates();
        this.injectButton();
        this.patchContextMenu();
        if (this.options.autoprune) this._pruneAll();
    }

    stop() {
        BdApi.Patcher.unpatchAll("ActivityTracker");
        BdApi.DOM.removeStyle("ActivityTracker");
        this._observer?.disconnect();
        document.getElementById("at-btn")?.remove();
        document.getElementById("at-modal-overlay")?.remove();
        this._ctxMenuPatch?.();
    }

    // ── Options / Settings Panel ───────────────────────────────────────────────

    saveOptions() {
        BdApi.Data.save("ActivityTracker", "options", this.options);
    }

    getSettingsPanel() {
        const wrap = document.createElement("div");
        wrap.style.cssText = "padding:12px;display:flex;flex-direction:column;gap:14px;font-family:var(--font-primary,sans-serif);color:var(--text-normal)";
        wrap.innerHTML = this._buildSettingsHTML();

        wrap.querySelectorAll(".at-opt-toggle").forEach(el => {
            el.addEventListener("change", () => {
                this.options[el.dataset.key] = el.checked;
                this.saveOptions();
            });
        });
        wrap.querySelectorAll(".at-opt-number").forEach(el => {
            el.addEventListener("change", () => {
                const val = parseInt(el.value, 10);
                if (!isNaN(val) && val > 0) { this.options[el.dataset.key] = val; this.saveOptions(); }
            });
        });
        wrap.querySelector("#at-opt-prune-now")?.addEventListener("click", () => {
            this._pruneAll();
            if (this.options.showToasts) BdApi.UI.showToast("Old data pruned.", { type: "success" });
        });
        return wrap;
    }

    _buildSettingsHTML() {
        const o = this.options;
        const toggle = (key, label, desc) => `
            <label class="at-opt-row">
                <div class="at-opt-info"><strong>${label}</strong><span>${desc}</span></div>
                <input type="checkbox" class="at-opt-toggle" data-key="${key}" ${o[key] ? "checked" : ""}/>
            </label>`;
        const number = (key, label, desc, min, max) => `
            <label class="at-opt-row">
                <div class="at-opt-info"><strong>${label}</strong><span>${desc}</span></div>
                <input type="number" class="at-opt-number" data-key="${key}" value="${o[key]}" min="${min}" max="${max}"
                    style="width:68px;background:var(--background-secondary);border:none;border-radius:4px;padding:5px 8px;color:var(--text-normal);font-size:13px;text-align:right"/>
            </label>`;
        return `
            <div class="at-opt-section">
                <div class="at-opt-title">General</div>
                ${toggle("showToasts", "Show Toasts", "Notifications when tracking starts or stops")}
                ${toggle("autoprune",  "Auto-Prune on Start", "Remove entries older than retention limit on plugin load")}
                ${number("retentionDays", "Retention Period", "Days to keep data when pruning", 1, 3650)}
            </div>
            <div class="at-opt-section">
                <div class="at-opt-title">Log Limits <span style="font-weight:400;text-transform:none;letter-spacing:0;opacity:0.6">per user</span></div>
                ${number("maxActivityLog", "Status Events",    "Max status change entries",  100, 10000)}
                ${number("maxAvatarLog",   "Avatar Snapshots", "Max avatar history entries",  10, 500)}
                ${number("maxGameLog",     "Game Sessions",    "Max game session entries",    50, 2000)}
                ${number("maxCustomLog",   "Custom Statuses",  "Max custom status entries",   50, 1000)}
                ${number("maxNameLog",     "Username Changes", "Max username history entries", 10, 500)}
            </div>
            <div class="at-opt-section">
                <div class="at-opt-title">Maintenance</div>
                <div style="padding:4px 0">
                    <button id="at-opt-prune-now"
                        style="background:none;border:1px solid #f23f43;color:#f23f43;border-radius:5px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.15s"
                        onmouseover="this.style.background='rgba(242,63,67,0.1)'" onmouseout="this.style.background='none'">
                        Prune Old Data Now
                    </button>
                </div>
            </div>`;
    }

    _pruneAll() {
        const cutoff = Date.now() - this.options.retentionDays * 86400000;
        this.trackedUsers.forEach(uid => {
            if (this.activityLog[uid])     this.activityLog[uid]     = this.activityLog[uid].filter(e => e.timestamp > cutoff);
            if (this.avatarLog[uid])       this.avatarLog[uid]       = this.avatarLog[uid].filter(e => e.timestamp > cutoff);
            if (this.nameLog[uid])         this.nameLog[uid]         = this.nameLog[uid].filter(e => e.timestamp > cutoff);
            if (this.customStatusLog[uid]) this.customStatusLog[uid] = this.customStatusLog[uid].filter(e => e.timestamp > cutoff);
            if (this.gameLog[uid])         this.gameLog[uid]         = this.gameLog[uid].filter(e => e.started > cutoff);
        });
        BdApi.Data.save("ActivityTracker", "activityLog",     this.activityLog);
        BdApi.Data.save("ActivityTracker", "avatarLog",       this.avatarLog);
        BdApi.Data.save("ActivityTracker", "nameLog",         this.nameLog);
        BdApi.Data.save("ActivityTracker", "customStatusLog", this.customStatusLog);
        BdApi.Data.save("ActivityTracker", "gameLog",         this.gameLog);
    }

    // ── Presence patching ──────────────────────────────────────────────────────

    patchPresence() {
        const PresenceStore = BdApi.Webpack.getStore("PresenceStore");
        if (!PresenceStore) return;

        BdApi.Patcher.after("ActivityTracker", PresenceStore, "getStatus", (_, [userId], ret) => {
            if (!this.trackedUsers.includes(userId)) return;
            const prev = this._lastStatus[userId];
            if (prev !== undefined && prev !== ret) this.logActivity(userId, ret);
            this._lastStatus[userId] = ret;
        });

        if (PresenceStore.getActivities) {
            BdApi.Patcher.after("ActivityTracker", PresenceStore, "getActivities", (_, [userId], activities) => {
                if (!this.trackedUsers.includes(userId) || !Array.isArray(activities)) return;
                const cs    = activities.find(a => a.type === 4);
                const csKey = cs ? `${cs.state || ""}|${cs.emoji?.name || ""}` : null;
                const prevCs = this._lastCustomStatus[userId];
                if (prevCs !== undefined && prevCs !== csKey) this.logCustomStatus(userId, cs);
                this._lastCustomStatus[userId] = csKey;
                const game    = activities.find(a => a.type === 0);
                const gameKey = game ? game.name : null;
                const prevGame = this._lastGame[userId];
                if (prevGame !== undefined && prevGame !== gameKey) this.logGame(userId, game, prevGame);
                this._lastGame[userId] = gameKey;
            });
        }

        if (PresenceStore.getClientStatus) {
            BdApi.Patcher.after("ActivityTracker", PresenceStore, "getClientStatus", (_, [userId], ret) => {
                if (!this.trackedUsers.includes(userId)) return;
                this._lastPlatform[userId] = Object.keys(ret || {}).filter(p => ret[p] && ret[p] !== "offline");
            });
        }
    }

    logActivity(userId, status) {
        if (!this.activityLog[userId]) this.activityLog[userId] = [];
        const platform = (this._lastPlatform?.[userId] || []).join(",") || null;
        this.activityLog[userId].push({ status, platform, timestamp: Date.now() });
        if (this.activityLog[userId].length > this.options.maxActivityLog)
            this.activityLog[userId] = this.activityLog[userId].slice(-this.options.maxActivityLog);
        BdApi.Data.save("ActivityTracker", "activityLog", this.activityLog);
        this.refreshModalIfOpen();
    }

    logCustomStatus(userId, activity) {
        if (!this.customStatusLog[userId]) this.customStatusLog[userId] = [];
        const entry = { text: activity?.state || null, emoji: activity?.emoji?.name || null, timestamp: Date.now() };
        const last  = this.customStatusLog[userId].slice(-1)[0];
        if (last && last.text === entry.text && last.emoji === entry.emoji) return;
        this.customStatusLog[userId].push(entry);
        if (this.customStatusLog[userId].length > this.options.maxCustomLog)
            this.customStatusLog[userId] = this.customStatusLog[userId].slice(-this.options.maxCustomLog);
        BdApi.Data.save("ActivityTracker", "customStatusLog", this.customStatusLog);
        this.refreshModalIfOpen();
    }

    logGame(userId, game, prevGameName) {
        if (!this.gameLog[userId]) this.gameLog[userId] = [];
        if (prevGameName) {
            const last = [...this.gameLog[userId]].reverse().find(e => e.name === prevGameName && !e.ended);
            if (last) { last.ended = Date.now(); last.durationMin = Math.round((last.ended - last.started) / 60000); }
        }
        if (game) this.gameLog[userId].push({ name: game.name, started: Date.now(), ended: null, durationMin: null });
        if (this.gameLog[userId].length > this.options.maxGameLog)
            this.gameLog[userId] = this.gameLog[userId].slice(-this.options.maxGameLog);
        BdApi.Data.save("ActivityTracker", "gameLog", this.gameLog);
        this.refreshModalIfOpen();
    }

    // ── Avatar / user update patching ─────────────────────────────────────────

    patchUserUpdates() {
        const UserStore = BdApi.Webpack.getStore("UserStore");
        if (!UserStore) return;
        this.trackedUsers.forEach(uid => {
            const user = UserStore.getUser(uid);
            if (user?.avatar) this._lastAvatar[uid] = user.avatar;
        });
        BdApi.Patcher.after("ActivityTracker", UserStore, "getUser", (_, [userId], user) => {
            if (!user || !this.trackedUsers.includes(userId)) return;
            const curAvatar = user.avatar || null;
            const prevAvatar = this._lastAvatar[userId];
            if (prevAvatar === undefined) { this._lastAvatar[userId] = curAvatar; }
            else if (curAvatar !== prevAvatar) { this._lastAvatar[userId] = curAvatar; this.logAvatar(userId, curAvatar, prevAvatar); }
            const curName  = user.globalName || user.username || null;
            const prevName = this._lastName[userId];
            if (prevName === undefined) { this._lastName[userId] = curName; }
            else if (curName && curName !== prevName) { this._lastName[userId] = curName; this.logName(userId, curName, prevName); }
        });
    }

    logAvatar(userId, newHash, oldHash) {
        if (!this.avatarLog[userId]) this.avatarLog[userId] = [];
        const last = this.avatarLog[userId][this.avatarLog[userId].length - 1];
        if (last && last.hash === newHash) return;
        this.avatarLog[userId].push({ hash: newHash, oldHash, timestamp: Date.now() });
        if (this.avatarLog[userId].length > this.options.maxAvatarLog)
            this.avatarLog[userId] = this.avatarLog[userId].slice(-this.options.maxAvatarLog);
        BdApi.Data.save("ActivityTracker", "avatarLog", this.avatarLog);
        this.refreshModalIfOpen();
    }

    logName(userId, newName, oldName) {
        if (!this.nameLog[userId]) this.nameLog[userId] = [];
        const last = this.nameLog[userId].slice(-1)[0];
        if (last && last.name === newName) return;
        this.nameLog[userId].push({ name: newName, oldName, timestamp: Date.now() });
        if (this.nameLog[userId].length > this.options.maxNameLog)
            this.nameLog[userId] = this.nameLog[userId].slice(-this.options.maxNameLog);
        BdApi.Data.save("ActivityTracker", "nameLog", this.nameLog);
        this.refreshModalIfOpen();
    }

    getAvatarHistory(userId) { return (this.avatarLog[userId] || []).slice().reverse(); }
    avatarUrl(userId, hash, size = 64) {
        if (!hash) return null;
        return `https://cdn.discordapp.com/avatars/${userId}/${hash}.webp?size=${size}`;
    }

    // ── Context menu ──────────────────────────────────────────────────────────

    patchContextMenu() {
        this._ctxMenuPatch = BdApi.ContextMenu.patch("user-context", (menu, { user }) => {
            if (!user?.id) return;
            const userId    = user.id;
            const isTracked = this.trackedUsers.includes(userId);
            menu.props.children.push(
                BdApi.ContextMenu.buildItem({ type: "separator" }),
                BdApi.ContextMenu.buildItem({
                    type: "toggle", label: "Track Activity", checked: isTracked,
                    action: () => {
                        if (isTracked) {
                            this.trackedUsers = this.trackedUsers.filter(id => id !== userId);
                            BdApi.Data.save("ActivityTracker", "trackedUsers", this.trackedUsers);
                            if (this.options.showToasts) BdApi.UI.showToast(`Stopped tracking ${user.globalName || user.username}`, { type: "info" });
                        } else {
                            this.trackedUsers.push(userId);
                            BdApi.Data.save("ActivityTracker", "trackedUsers", this.trackedUsers);
                            this._seedUser(userId, user);
                            if (this.options.showToasts) BdApi.UI.showToast(`Now tracking ${user.globalName || user.username}`, { type: "success" });
                        }
                        this.refreshModalIfOpen();
                    }
                })
            );
        });
    }

    _seedUser(userId, user) {
        const PS = BdApi.Webpack.getStore("PresenceStore");
        this._lastStatus[userId] = PS?.getStatus(userId) || "offline";
        this._lastAvatar[userId] = user?.avatar || null;
        this._lastName[userId]   = user?.globalName || user?.username || null;
        const acts = PS?.getActivities?.(userId) || [];
        const cs   = acts.find(a => a.type === 4);
        this._lastCustomStatus[userId] = cs ? `${cs.state || ""}|${cs.emoji?.name || ""}` : null;
        const game = acts.find(a => a.type === 0);
        this._lastGame[userId] = game ? game.name : null;
    }

    // ── Toolbar button ────────────────────────────────────────────────────────

    injectButton() { this._createBtn(); this._observeToolbar(); }

    _createBtn() {
        const btn = document.createElement("div");
        btn.id = "at-btn"; btn.title = "Activity Tracker";
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 4C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`;
        btn.onclick = () => this.openModal();
        this._btn = btn;
        this._tryInsert();
    }

    _tryInsert() {
        const toolbar = document.querySelector('[class*="toolbar_"]') || document.querySelector('[class*="toolbar-"]');
        if (!toolbar || document.getElementById("at-btn")) return;
        toolbar.insertBefore(this._btn, toolbar.firstChild);
    }

    _observeToolbar() {
        this._observer = new MutationObserver(() => { if (!document.getElementById("at-btn")) this._tryInsert(); });
        this._observer.observe(document.body, { childList: true, subtree: true });
    }

    // ── Data helpers ──────────────────────────────────────────────────────────

    getUserInfo(userId) {
        const US = BdApi.Webpack.getStore("UserStore");
        const PS = BdApi.Webpack.getStore("PresenceStore");
        return { user: US?.getUser(userId), status: PS?.getStatus(userId) || "offline" };
    }

    getStats(userId) {
        const logs = this.activityLog[userId] || [];
        if (logs.length === 0) return null;

        const hours = Array(24).fill(0).map(() => ({ online: 0, total: 0 }));
        const days  = Array(7).fill(0).map(() => ({ online: 0, total: 0 }));
        let sessions = 0, totalOnlineMs = 0, lastOnlineStart = null;
        let longestStreak = 0, currentStreak = 0, lastDay = null;

        logs.forEach(e => {
            const d    = new Date(e.timestamp);
            const isOn = ["online","idle","dnd"].includes(e.status);
            hours[d.getHours()].total++; days[d.getDay()].total++;
            if (isOn) { hours[d.getHours()].online++; days[d.getDay()].online++; }
            if (isOn && !lastOnlineStart) { lastOnlineStart = e.timestamp; sessions++; }
            if (!isOn && lastOnlineStart) { totalOnlineMs += e.timestamp - lastOnlineStart; lastOnlineStart = null; }
            if (isOn) {
                const dk = d.toDateString();
                if (!lastDay) { currentStreak = 1; lastDay = dk; }
                else if (lastDay !== dk) {
                    const prev = new Date(lastDay); prev.setDate(prev.getDate() + 1);
                    currentStreak = prev.toDateString() === dk ? currentStreak + 1 : 1;
                    lastDay = dk;
                }
                if (currentStreak > longestStreak) longestStreak = currentStreak;
            }
        });

        let longestSessionMin = 0, _ss = null;
        logs.forEach(e => {
            const isOn = ["online","idle","dnd"].includes(e.status);
            if (isOn && !_ss) _ss = e.timestamp;
            if (!isOn && _ss) { const d = Math.round((e.timestamp - _ss) / 60000); if (d > longestSessionMin) longestSessionMin = d; _ss = null; }
        });

        const avgSessionMin = sessions > 0 ? Math.round(totalOnlineMs / sessions / 60000) : 0;
        const peakHour      = hours.reduce((b, h, i) => h.online > hours[b].online ? i : b, 0);
        const dayNames      = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        const peakDay       = days.reduce((b, d, i) => d.online > days[b].online ? i : b, 0);
        const lastEntry     = [...logs].reverse().find(e => ["online","idle","dnd"].includes(e.status));
        const onlineCount   = logs.filter(e => ["online","idle","dnd"].includes(e.status)).length;
        const onlineRate    = Math.round((onlineCount / logs.length) * 100);

        let bestW = 0, bestC = 0;
        for (let i = 0; i < 24; i++) {
            const c = hours[i].online + hours[(i+1)%24].online + hours[(i+2)%24].online;
            if (c > bestC) { bestC = c; bestW = i; }
        }
        const tzOff = 14 - bestW;
        const tzLabel = tzOff === 0 ? "UTC" : `UTC${tzOff > 0 ? "+" : ""}${tzOff}`;

        return {
            hours, sessions, avgSessionMin, longestSessionMin,
            peakHour, peakDay: dayNames[peakDay], longestStreak,
            lastSeen: lastEntry?.timestamp || null, onlineRate,
            totalEvents: logs.length, tzLabel,
            daysSinceTracked: Math.round((Date.now() - logs[0].timestamp) / 86400000),
            firstSeen: logs[0].timestamp,
        };
    }

    // ── 30-day Heatmap ────────────────────────────────────────────────────────

    buildHeatmap(userId) {
        const logs     = this.activityLog[userId] || [];
        const now      = Date.now();
        const DAYS     = 30;
        const msPerDay = 86400000;

        // grid[dayIdx][hour] = count of online events
        const grid = Array.from({ length: DAYS }, () => Array(24).fill(0));
        const dayDates = [];
        for (let d = DAYS - 1; d >= 0; d--) dayDates.push(new Date(now - d * msPerDay));

        logs.forEach(e => {
            if (!["online","idle","dnd"].includes(e.status)) return;
            const age = now - e.timestamp;
            if (age > DAYS * msPerDay) return;
            const di = DAYS - 1 - Math.floor(age / msPerDay);
            if (di < 0 || di >= DAYS) return;
            grid[di][new Date(e.timestamp).getHours()]++;
        });

        const maxVal = Math.max(...grid.flat(), 1);
        const cellW = 12, cellH = 10, gapX = 2, gapY = 1;
        const padTop = 16, padLeft = 24, padBottom = 20;
        const svgW = padLeft + DAYS * (cellW + gapX);
        const svgH = padTop + 24 * (cellH + gapY) + padBottom;

        // Cells
        let cells = "";
        for (let d = 0; d < DAYS; d++) {
            for (let h = 0; h < 24; h++) {
                const val = grid[d][h];
                const alpha = val === 0 ? 0.07 : 0.18 + (val / maxVal) * 0.82;
                const x = padLeft + d * (cellW + gapX);
                const y = padTop  + h * (cellH + gapY);
                const ds = dayDates[d].toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
                const hs = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h-12}pm`;
                cells += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="2"
                    fill="rgba(88,101,242,${alpha.toFixed(2)})"
                    data-tip="${ds} ${hs} — ${val} event${val !== 1 ? "s" : ""}"/>`;
            }
        }

        // Hour labels (every 3h, on left)
        let hourSVG = "";
        for (let h = 0; h < 24; h++) {
            if (h % 3 !== 0) continue;
            const y = padTop + h * (cellH + gapY) + cellH / 2 + 3;
            const lbl = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h-12}p`;
            hourSVG += `<text x="${padLeft - 4}" y="${y}" text-anchor="end" font-size="8" fill="var(--at-muted)">${lbl}</text>`;
        }

        // Date labels (bottom, show date on Mon or 1st and 15th)
        let dateSVG = "";
        for (let d = 0; d < DAYS; d++) {
            const date = dayDates[d];
            const dom  = date.getDate();
            if (d === 0 || date.getDay() === 1 || dom === 15) {
                const x = padLeft + d * (cellW + gapX) + cellW / 2;
                const y = padTop  + 24 * (cellH + gapY) + 12;
                dateSVG += `<text x="${x}" y="${y}" text-anchor="middle" font-size="8" fill="var(--at-muted)">${dom}</text>`;
            }
        }

        // Month label for context
        const midDate   = dayDates[Math.floor(DAYS / 2)];
        const monthStr  = midDate.toLocaleDateString([], { month: "long", year: "numeric" });

        return `
            <div class="at-heatmap-wrap">
                <div class="at-heatmap-header">
                    <span class="at-heatmap-title">30-Day Activity Heatmap</span>
                    <span class="at-heatmap-month">${monthStr}</span>
                </div>
                <div class="at-heatmap-svg-wrap">
                    <svg class="at-heatmap-svg" width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
                        ${hourSVG}${cells}${dateSVG}
                    </svg>
                </div>
                <div class="at-heatmap-legend">
                    <span class="at-heatmap-legend-lbl">Less</span>
                    ${[0.07, 0.25, 0.45, 0.65, 0.85, 1.0].map(a =>
                        `<div style="width:10px;height:10px;border-radius:2px;background:rgba(88,101,242,${a})"></div>`
                    ).join("")}
                    <span class="at-heatmap-legend-lbl">More</span>
                </div>
                <div class="at-heatmap-tooltip" id="at-heatmap-tip"></div>
            </div>`;
    }

    // ── Modal ──────────────────────────────────────────────────────────────────

    refreshModalIfOpen() {
        const ov = document.getElementById("at-modal-overlay");
        if (ov) this.renderModal(ov.dataset.activeUser || null);
    }

    openModal(activeUserId = null) { this.renderModal(activeUserId); }

    renderModal(activeUserId = null) {
        document.getElementById("at-modal-overlay")?.remove();

        const overlay = document.createElement("div");
        overlay.id = "at-modal-overlay";
        overlay.dataset.activeUser = activeUserId || "";
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        const modal = document.createElement("div");
        modal.className = "at-modal";
        modal.innerHTML = this.buildModalHTML(activeUserId);
        const dark = document.documentElement.classList.contains("theme-dark") || !document.documentElement.classList.contains("theme-light");
        modal.dataset.atTheme = dark ? "dark" : "light";
        overlay.appendChild(modal);
        (document.getElementById("app-mount") || document.body).appendChild(overlay);

        this._bindModalEvents(modal, activeUserId);
        this._bindHeatmapTooltips(modal);
    }

    _bindModalEvents(modal, activeUserId) {
        modal.querySelector("#at-add-btn")?.addEventListener("click", () => {
            const input  = modal.querySelector("#at-user-input");
            const userId = input.value.trim();
            if (!userId || this.trackedUsers.includes(userId)) return;
            const user = BdApi.Webpack.getStore("UserStore")?.getUser(userId);
            if (!user) { BdApi.UI.showToast("User not found — use their User ID.", { type: "error" }); return; }
            this.trackedUsers.push(userId);
            BdApi.Data.save("ActivityTracker", "trackedUsers", this.trackedUsers);
            this._seedUser(userId, user);
            input.value = "";
            this.renderModal(userId);
        });

        modal.querySelector("#at-user-input")?.addEventListener("keydown", e => {
            if (e.key === "Enter") modal.querySelector("#at-add-btn")?.click();
        });

        modal.querySelectorAll(".at-user-row").forEach(row => {
            row.addEventListener("click", e => {
                if (e.target.closest("button")) return;
                const uid = row.dataset.userId;
                this.renderModal(uid === activeUserId ? null : uid);
            });
        });

        modal.querySelectorAll(".at-tab-btn").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                this._activeTab[btn.dataset.userId] = btn.dataset.tab;
                this.renderModal(activeUserId);
            });
        });

        modal.querySelectorAll(".at-remove-btn").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const uid = btn.dataset.userId;
                this.trackedUsers = this.trackedUsers.filter(id => id !== uid);
                BdApi.Data.save("ActivityTracker", "trackedUsers", this.trackedUsers);
                this.renderModal(activeUserId === uid ? null : activeUserId);
            });
        });

        modal.querySelectorAll(".at-clear-btn").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const uid = btn.dataset.userId;
                ["activityLog","avatarLog","nameLog","customStatusLog","gameLog"].forEach(k => delete this[k][uid]);
                ["_lastStatus","_lastAvatar","_lastName","_lastCustomStatus","_lastGame"].forEach(k => delete this[k][uid]);
                ["activityLog","avatarLog","nameLog","customStatusLog","gameLog"].forEach(k => BdApi.Data.save("ActivityTracker", k, this[k]));
                this.renderModal(activeUserId);
            });
        });

        modal.querySelectorAll(".at-export-btn").forEach(btn => {
            btn.addEventListener("click", e => { e.stopPropagation(); this.exportUser(btn.dataset.userId); });
        });

        modal.querySelectorAll(".at-sort-btn").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const key = btn.dataset.sortKey;
                if (this._sortKey === key) { this._sortDir *= -1; } else { this._sortKey = key; this._sortDir = 1; }
                this.renderModal(activeUserId);
            });
        });
    }

    _bindHeatmapTooltips(modal) {
        const tip = modal.querySelector("#at-heatmap-tip");
        if (!tip) return;
        modal.querySelectorAll(".at-heatmap-svg rect[data-tip]").forEach(rect => {
            rect.addEventListener("mouseenter", () => { tip.textContent = rect.dataset.tip; tip.style.display = "block"; });
            rect.addEventListener("mousemove", e => {
                const wrap = modal.querySelector(".at-heatmap-wrap");
                if (!wrap) return;
                const wrapR   = wrap.getBoundingClientRect();
                const tipW    = tip.offsetWidth || 160;
                const spaceR  = wrapR.right - e.clientX;
                const offsetX = spaceR < tipW + 16 ? -(tipW + 10) : 10;
                tip.style.left = (e.clientX - wrapR.left + offsetX) + "px";
                tip.style.top  = (e.clientY - wrapR.top  - 32) + "px";
            });
            rect.addEventListener("mouseleave", () => { tip.style.display = "none"; });
        });
    }

    // ── Sort ──────────────────────────────────────────────────────────────────

    getSortedUsers() {
        const SO = { online: 0, idle: 1, dnd: 2, offline: 3 };
        const US = BdApi.Webpack.getStore("UserStore");
        const PS = BdApi.Webpack.getStore("PresenceStore");
        return [...this.trackedUsers].sort((a, b) => {
            const ua = US?.getUser(a), ub = US?.getUser(b);
            const na = (ua ? (ua.globalName || ua.username) : a).toLowerCase();
            const nb = (ub ? (ub.globalName || ub.username) : b).toLowerCase();
            const sa = this.getStats(a), sb = this.getStats(b);
            const sta = PS?.getStatus(a) || "offline", stb = PS?.getStatus(b) || "offline";
            let diff = 0;
            switch (this._sortKey) {
                case "name":     diff = na.localeCompare(nb); break;
                case "status":   diff = (SO[sta] ?? 3) - (SO[stb] ?? 3); break;
                case "activity": diff = (sa?.totalEvents || 0) - (sb?.totalEvents || 0); break;
                case "sessions": diff = (sa?.sessions || 0) - (sb?.sessions || 0); break;
                case "lastseen": diff = (sa?.lastSeen || 0) - (sb?.lastSeen || 0); break;
                case "rate":     diff = (sa?.onlineRate || 0) - (sb?.onlineRate || 0); break;
            }
            return diff * this._sortDir;
        });
    }

    // ── Export ────────────────────────────────────────────────────────────────

    exportUser(userId) {
        const { user } = this.getUserInfo(userId);
        const name = user ? (user.globalName || user.username) : userId;
        const blob = new Blob([JSON.stringify({
            userId, username: name, exportedAt: new Date().toISOString(),
            activityLog: this.activityLog[userId] || [],
            avatarLog: this.avatarLog[userId] || [],
            nameLog: this.nameLog[userId] || [],
            customStatusLog: this.customStatusLog[userId] || [],
            gameLog: this.gameLog[userId] || [],
            stats: this.getStats(userId),
        }, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `activity-tracker-${name.replace(/[^a-z0-9]/gi,"_")}-${Date.now()}.json`;
        a.click(); URL.revokeObjectURL(url);
        if (this.options.showToasts) BdApi.UI.showToast(`Exported data for ${name}`, { type: "success" });
    }

    // ── HTML builders ─────────────────────────────────────────────────────────

    buildModalHTML(activeUserId) {
        const sorted = this.getSortedUsers();
        const sortOpts = [
            { key: "name", label: "Name" }, { key: "status", label: "Status" },
            { key: "activity", label: "Events" }, { key: "sessions", label: "Sessions" },
            { key: "lastseen", label: "Last Seen" }, { key: "rate", label: "Online %" },
        ];
        const sortBar = `<div class="at-sort-bar">
            <span class="at-sort-label">Sort</span>
            ${sortOpts.map(o => `<button class="at-sort-btn${this._sortKey===o.key?" at-sort-active":""}" data-sort-key="${o.key}">
                ${o.label}${this._sortKey===o.key?(this._sortDir===1?" ↑":" ↓"):""}
            </button>`).join("")}
        </div>`;

        return `
            <div class="at-header">
                <div class="at-title-row">
                    <svg width="25" height="25" viewBox="0 0 24 24" style="flex-shrink:0">
                        <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 4C7 4 2.73 7.11 1 11.5 2.73 15.89 7 19 12 19s9.27-3.11 11-7.5C21.27 7.11 17 4 12 4zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>
                    </svg>
                    <span class="at-title">Activity Tracker</span>
                    <span class="at-count">${this.trackedUsers.length}</span>
                </div>
                <button class="at-close-btn" onclick="document.getElementById('at-modal-overlay').remove()">✕</button>
            </div>
            <div class="at-body">
                <div class="at-add-row">
                    <input id="at-user-input" class="at-input" placeholder="Add user by ID…"/>
                    <button id="at-add-btn" class="at-add-btn-el">Add</button>
                </div>
                ${this.trackedUsers.length > 1 ? sortBar : ""}
                <div class="at-user-list">
                    ${this.trackedUsers.length === 0
                        ? `<div class="at-empty">No users tracked yet.<br/>Right-click someone or paste their ID above.</div>`
                        : sorted.map(uid => this._buildUserRow(uid, activeUserId)).join("")}
                </div>
            </div>`;
    }

    _buildUserRow(uid, activeUserId) {
        const { user, status } = this.getUserInfo(uid);
        const name = user ? (user.globalName || user.username) : uid;
        const tag  = user?.discriminator && user.discriminator !== "0" ? `#${user.discriminator}` : "";
        const avatar = user?.avatar
            ? `<img src="https://cdn.discordapp.com/avatars/${uid}/${user.avatar}.webp?size=40" class="at-avatar"/>`
            : `<div class="at-avatar at-avatar-ph">${(name[0]||"?").toUpperCase()}</div>`;
        const isExpanded = uid === activeUserId;
        const stats      = this.getStats(uid);
        const tab        = this._activeTab[uid] || "overview";

        const PS         = BdApi.Webpack.getStore("PresenceStore");
        const cs         = PS?.getClientStatus?.(uid) || {};
        const platforms  = Object.keys(cs).filter(p => cs[p] && cs[p] !== "offline");
        const pIcons     = { desktop: "🖥️", mobile: "📱", web: "🌐" };
        const acts       = PS?.getActivities?.(uid) || [];
        const liveCs     = acts.find(a => a.type === 4);
        const liveGame   = acts.find(a => a.type === 0);

        let expandedHTML = "";
        if (isExpanded) {
            const tabs    = ["overview", "heatmap", "history", "avatars"];
            const tabBar  = `<div class="at-tabs">${tabs.map(t =>
                `<button class="at-tab-btn${tab===t?" at-tab-active":""}" data-user-id="${uid}" data-tab="${t}">${t.charAt(0).toUpperCase()+t.slice(1)}</button>`
            ).join("")}</div>`;

            let content = "";
            if (tab === "overview") content = this._buildOverviewTab(uid, stats, platforms, pIcons, liveCs, liveGame);
            if (tab === "heatmap")  content = this.buildHeatmap(uid) + this._buildHourlyChart(uid, stats);
            if (tab === "history")  content = this._buildHistoryTab(uid);
            if (tab === "avatars")  content = this._buildAvatarsTab(uid);

            expandedHTML = `<div class="at-expanded">
                ${tabBar}
                <div class="at-tab-content">${content}</div>
                <div class="at-danger-row">
                    <button class="at-export-btn" data-user-id="${uid}">Export JSON</button>
                    <button class="at-clear-btn" data-user-id="${uid}">Clear History</button>
                </div>
            </div>`;
        }

        return `<div class="at-user-row${isExpanded?" at-expanded-row":""}" data-user-id="${uid}">
            <div class="at-row-header">
                <div class="at-user-info">
                    <div class="at-avatar-wrap">
                        ${avatar}
                        <span class="at-status-pip" style="background:${this.statusColor(status)}"></span>
                    </div>
                    <div class="at-user-text">
                        <span class="at-username">${name}<span class="at-tag">${tag}</span></span>
                        <span class="at-status-label">${this.statusLabel(status)}${stats?` · ${stats.onlineRate}% online`:""}</span>
                    </div>
                </div>
                <div class="at-row-actions">
                    <span class="at-chevron">${isExpanded?"▲":"▼"}</span>
                    <button class="at-remove-btn" data-user-id="${uid}" title="Stop tracking">✕</button>
                </div>
            </div>
            ${expandedHTML}
        </div>`;
    }

    _buildOverviewTab(uid, stats, platforms, pIcons, liveCs, liveGame) {
        if (!stats) return `<div class="at-log-empty" style="padding:12px 0">No data yet — status changes are logged in real time as they happen.</div>`;
        const platStr  = platforms.map(p => pIcons[p] || p).join(" ") || null;
        const liveCsStr = liveCs ? `${liveCs.emoji?.name ? liveCs.emoji.name+" " : ""}${liveCs.state||""}`.trim() : null;
        return `
            <div class="at-stats-grid">
                <div class="at-stat"><div class="at-stat-val">${stats.onlineRate}%</div><div class="at-stat-key">Online Rate</div></div>
                <div class="at-stat"><div class="at-stat-val">${stats.sessions}</div><div class="at-stat-key">Sessions</div></div>
                <div class="at-stat"><div class="at-stat-val">${this.formatDuration(stats.avgSessionMin)}</div><div class="at-stat-key">Avg Session</div></div>
                <div class="at-stat"><div class="at-stat-val">${this.formatDuration(stats.longestSessionMin)}</div><div class="at-stat-key">Longest</div></div>
                <div class="at-stat"><div class="at-stat-val">${this.formatHour(stats.peakHour)}</div><div class="at-stat-key">Peak Hour</div></div>
                <div class="at-stat"><div class="at-stat-val">${stats.peakDay}</div><div class="at-stat-key">Peak Day</div></div>
                <div class="at-stat"><div class="at-stat-val">${stats.tzLabel}</div><div class="at-stat-key">Est. Timezone</div></div>
                <div class="at-stat"><div class="at-stat-val">${stats.daysSinceTracked}d</div><div class="at-stat-key">Tracked For</div></div>
                <div class="at-stat"><div class="at-stat-val">${stats.totalEvents}</div><div class="at-stat-key">Events</div></div>
            </div>
            <div class="at-meta-row">
                ${stats.lastSeen ? `<span>Last seen <strong>${this.formatTime(stats.lastSeen)}</strong></span>` : ""}
                ${stats.firstSeen ? `<span>Since <strong>${this.formatFullTime(stats.firstSeen)}</strong></span>` : ""}
                ${platStr ? `<span>${platStr}</span>` : ""}
                ${liveCsStr ? `<span title="Custom status">💬 ${liveCsStr}</span>` : ""}
                ${liveGame ? `<span>🎮 ${liveGame.name}</span>` : ""}
            </div>`;
    }

    _buildHistoryTab(uid) {
        const sec = (title, html) => `<div class="at-section-title">${title}</div>${html}`;
        const logs  = (this.activityLog[uid] || []).slice(-40).reverse();
        const games = (this.gameLog[uid] || []).slice().reverse().slice(0, 15);
        const csl   = (this.customStatusLog[uid] || []).slice().reverse().slice(0, 15);
        const names = (this.nameLog[uid] || []).slice().reverse();

        const statusLog = !logs.length
            ? `<div class="at-log-empty">No changes recorded yet.</div>`
            : `<div class="at-log">${logs.map(e => `
                <div class="at-log-entry">
                    <span class="at-log-dot" style="background:${this.statusColor(e.status)}"></span>
                    <span class="at-log-status">${this.statusLabel(e.status)}</span>
                    <span class="at-log-time">${this.formatTime(e.timestamp)}</span>
                    <span class="at-log-full">${this.formatFullTime(e.timestamp)}</span>
                </div>`).join("")}</div>`;

        const gameLog = !games.length
            ? `<div class="at-log-empty">No game activity recorded.</div>`
            : `<div class="at-log">${games.map(e => {
                const dur = e.durationMin != null ? ` · ${this.formatDuration(e.durationMin)}` : "";
                return `<div class="at-log-entry">
                    <span class="at-log-dot" style="background:#5865f2"></span>
                    <span class="at-log-status at-ellipsis">${e.name}</span>
                    <span class="at-log-time">${this.formatTime(e.started)}${dur}</span>
                    <span class="at-log-full">${this.formatFullTime(e.started)}</span>
                </div>`;}).join("")}</div>`;

        const csLog = !csl.length
            ? `<div class="at-log-empty">No custom status changes recorded.</div>`
            : `<div class="at-log">${csl.map(e => {
                const d = [e.emoji, e.text].filter(Boolean).join(" ") || "(cleared)";
                return `<div class="at-log-entry">
                    <span class="at-log-status at-ellipsis">${d}</span>
                    <span class="at-log-time">${this.formatTime(e.timestamp)}</span>
                    <span class="at-log-full">${this.formatFullTime(e.timestamp)}</span>
                </div>`;}).join("")}</div>`;

        const nameLog = !names.length
            ? `<div class="at-log-empty">No username changes recorded.</div>`
            : `<div class="at-log">${names.map(e => `
                <div class="at-log-entry">
                    <span class="at-log-status at-ellipsis">${e.name}</span>
                    <span class="at-log-time">${this.formatTime(e.timestamp)}</span>
                    <span class="at-log-full">${this.formatFullTime(e.timestamp)}</span>
                </div>`).join("")}</div>`;

        return sec("Status Changes", statusLog)
             + sec("Games & Apps", gameLog)
             + sec("Custom Status", csLog)
             + sec("Usernames", nameLog);
    }

    _buildAvatarsTab(uid) {
        const history = this.getAvatarHistory(uid);
        if (!history.length) return `<div class="at-log-empty" style="padding:8px 0">No avatar changes recorded yet.</div>`;
        return `<div class="at-pfp-grid">
            ${history.map(e => {
                const url = this.avatarUrl(uid, e.hash);
                return `<div class="at-pfp-entry" title="${this.formatFullTime(e.timestamp)}">
                    ${url
                        ? `<img class="at-pfp-img" src="${url}" loading="lazy"/>`
                        : `<div class="at-pfp-img at-pfp-removed">removed</div>`}
                    <div class="at-pfp-time">${this.formatTime(e.timestamp)}</div>
                </div>`;
            }).join("")}
        </div>`;
    }

    _buildHourlyChart(uid, stats) {
        if (!stats) return "";
        const maxOnline = Math.max(...stats.hours.map(h => h.online), 1);
        const bars = stats.hours.map((h, i) => {
            const pct   = Math.round((h.online / maxOnline) * 100);
            const lbl   = [0, 6, 12, 18].includes(i)
                ? (i === 0 ? "12a" : i === 6 ? "6a" : i === 12 ? "12p" : "6p")
                : "";
            const tip   = `${this.formatHour(i)}: ${h.online} online / ${h.total} total`;
            return `<div class="at-bar-wrap" title="${tip}">
                <div class="at-bar" style="height:${Math.max(pct, 2)}%"></div>
                <div class="at-bar-label">${lbl}</div>
            </div>`;
        }).join("");

        return `
            <div class="at-section-title" style="margin-top:14px">Hourly Pattern Average</div>
            <div class="at-chart">${bars}</div>`;
    }

    // ── Formatters ────────────────────────────────────────────────────────────

    formatTime(ts) {
        const m = Math.floor((Date.now()-ts)/60000), h = Math.floor(m/60), d = Math.floor(m/1440);
        if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
        if (h < 24) return `${h}h ago`; if (d < 7) return `${d}d ago`;
        return new Date(ts).toLocaleDateString();
    }
    formatFullTime(ts) { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
    formatHour(h) { if (h===0) return "12am"; if (h<12) return `${h}am`; if (h===12) return "12pm"; return `${h-12}pm`; }
    formatDuration(min) {
        if (!min) return "0m"; if (min < 60) return `${min}m`;
        const h = Math.floor(min/60), m = min%60; return m ? `${h}h ${m}m` : `${h}h`;
    }
    statusColor(s) { return {online:"#23a55a",idle:"#f0b232",dnd:"#f23f43",offline:"#80848e"}[s]||"#80848e"; }
    statusLabel(s) { return {online:"Online",idle:"Idle",dnd:"Do Not Disturb",offline:"Offline"}[s]||s; }

    // ── CSS ───────────────────────────────────────────────────────────────────

    getCSS() { return `
        #at-btn {
            display:flex;align-items:center;justify-content:center;
            width:32px;height:32px;border-radius:4px;cursor:pointer;
            color:var(--interactive-normal);transition:color .15s,background .15s;flex-shrink:0;
        }
        #at-btn:hover { color:var(--interactive-hover);background:var(--background-modifier-hover); }

        #at-modal-overlay {
            position:fixed;inset:0;background:rgb(0 0 0/.7);z-index:10000;
            display:flex;align-items:center;justify-content:center;
        }

        .at-modal {
            background-color:var(--modal-background,var(--background-floating));
            border:1px solid var(--border-subtle,transparent);
            border-radius:10px;width:500px;max-height:82vh;
            display:flex;flex-direction:column;overflow:hidden;
            box-shadow:var(--shadow-high);
            font-family:var(--font-primary,'gg sans',sans-serif);color:var(--text-normal)!important;
        }
        .at-modal[data-at-theme="dark"]  { --at-hi:#f2f3f5;--at-text:#dbdee1;--at-muted:#949ba4; }
        .at-modal[data-at-theme="light"] { --at-hi:#060607;--at-text:#313338;--at-muted:#5c5e66; }

        .at-header { display:flex;align-items:center;justify-content:space-between;padding:14px 16px 0; }
        .at-title-row {display:flex; align-items:center; gap:7px; color:var(--at-hi);}
        .at-title { font-size:15px;font-weight:700;color:var(--at-hi); }
        .at-count {
            font-size:11px;color:var(--at-muted);
            background:var(--background-modifier-accent);
            padding:1px 7px;border-radius:10px;font-weight:600;
        }
        .at-close-btn {
            background:none;border:none;color:var(--at-muted);
            font-size:16px;cursor:pointer;padding:2px;line-height:1;
            transition:color .1s;border-radius:3px;
        }
        .at-close-btn:hover { color:var(--at-hi); }

        .at-body { display:flex;flex-direction:column;flex:1;overflow:hidden; }
        .at-add-row {
            display:flex;align-items:center;gap:8px;
            padding:10px 16px;border-bottom:1px solid var(--background-modifier-accent);
        }
        .at-input {
            flex:1;background:var(--background-secondary);border:none;border-radius:4px;
            color:var(--at-text);padding:6px 10px;font-size:13px;outline:none;
        }
        .at-input::placeholder { color:var(--at-muted); }
        .at-add-btn-el {
            background:none;border:none;color:#5865f2;
            font-size:13px;font-weight:700;cursor:pointer;padding:0;transition:color .1s;
        }
        .at-add-btn-el:hover { color:#4752c4; }

        .at-sort-bar {
            display:flex;align-items:center;gap:3px;flex-wrap:wrap;
            padding:5px 16px;border-bottom:1px solid var(--background-modifier-accent);
        }
        .at-sort-label { font-size:10px;color:var(--at-muted);font-weight:700;margin-right:2px;text-transform:uppercase;letter-spacing:.05em; }
        .at-sort-btn {
            background:none;border:1px solid transparent;border-radius:3px;
            padding:1px 6px;font-size:11px;font-weight:500;
            color:var(--at-muted);cursor:pointer;transition:all .1s;white-space:nowrap;
        }
        .at-sort-btn:hover { color:var(--at-text);border-color:var(--at-muted); }
        .at-sort-btn.at-sort-active { color:#5865f2;border-color:#5865f2;background:rgba(88,101,242,.1); }

        .at-user-list { overflow-y:auto;flex:1;padding:2px 0; }
        .at-empty { color:var(--at-muted);font-size:13px;text-align:center;padding:28px 16px;line-height:1.8; }

        .at-user-row {
            cursor:pointer;border-bottom:1px solid var(--background-modifier-accent);transition:background .1s;
        }
        .at-user-row:last-child { border-bottom:none; }
        .at-user-row:hover { background:var(--background-modifier-hover); }
        .at-expanded-row,.at-expanded-row:hover { background:var(--background-secondary); }

        .at-row-header { display:flex;align-items:center;justify-content:space-between;padding:8px 14px;gap:8px; }
        .at-user-info { display:flex;align-items:center;gap:9px;flex:1;min-width:0; }
        .at-avatar-wrap { position:relative;flex-shrink:0; }
        .at-avatar { width:32px;height:32px;border-radius:50%;object-fit:cover;display:block; }
        .at-avatar-ph {
            width:32px;height:32px;border-radius:50%;background:var(--background-modifier-accent);
            display:flex;align-items:center;justify-content:center;color:var(--at-text);font-weight:700;font-size:12px;
        }
        .at-status-pip {
            position:absolute;bottom:0;right:0;width:9px;height:9px;border-radius:50%;
            border:2px solid var(--background-primary);
        }
        .at-expanded-row .at-status-pip { border-color:var(--background-secondary); }

        .at-user-text { display:flex;flex-direction:column;min-width:0; }
        .at-username { color:var(--at-hi);font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
        .at-tag { color:var(--at-muted);font-weight:400; }
        .at-status-label { color:var(--at-muted);font-size:11px;margin-top:1px; }

        .at-row-actions { display:flex;align-items:center;gap:4px;flex-shrink:0; }
        .at-chevron { color:var(--at-muted);font-size:7px;margin-right:2px; }
        .at-remove-btn {
            background:none;border:none;cursor:pointer;color:var(--at-muted);
            font-size:13px;line-height:1;padding:2px 4px;border-radius:3px;
            transition:color .1s;opacity:0;
        }
        .at-user-row:hover .at-remove-btn { opacity:1; }
        .at-remove-btn:hover { color:#f23f43; }

        .at-expanded { padding:0 0 10px; }

        /* Tabs */
        .at-tabs {
            display:flex;padding:0 14px;
            border-bottom:1px solid var(--background-modifier-accent);
        }
        .at-tab-btn {
            background:none;border:none;border-bottom:2px solid transparent;
            padding:7px 10px;font-size:12px;font-weight:600;color:var(--at-muted);
            cursor:pointer;transition:all .1s;margin-bottom:-1px;
        }
        .at-tab-btn:hover { color:var(--at-text); }
        .at-tab-btn.at-tab-active { color:#5865f2;border-bottom-color:#5865f2; }

        .at-tab-content { padding:10px 14px 2px; }

        .at-section-title {
            font-size:10px;font-weight:700;letter-spacing:.06em;
            text-transform:uppercase;color:var(--at-muted);margin:10px 0 5px;
        }

        .at-stats-grid {
            display:grid;grid-template-columns:repeat(3,1fr);gap:1px;
            background:var(--background-modifier-accent);border-radius:6px;overflow:hidden;margin-bottom:6px;
        }
        .at-stat { background:var(--background-primary);padding:7px;text-align:center; }
        .at-stat-val { font-size:16px;font-weight:700;color:var(--at-hi); }
        .at-stat-key { font-size:9px;color:var(--at-muted);margin-top:1px;text-transform:uppercase;letter-spacing:.04em; }

        .at-meta-row {
            display:flex;flex-wrap:wrap;gap:4px 12px;
            font-size:11px;color:var(--at-muted);margin:4px 0;
        }
        .at-meta-row strong { color:var(--at-text);font-weight:600; }

        .at-log { display:flex;flex-direction:column;max-height:160px;overflow-y:auto; }
        .at-log-empty { color:var(--at-muted);font-size:12px;padding:4px 0; }
        .at-log-entry {
            display:flex;align-items:center;gap:7px;padding:3px 0;
            border-bottom:1px solid var(--background-modifier-accent);
        }
        .at-log-entry:last-child { border-bottom:none; }
        .at-log-dot { width:6px;height:6px;border-radius:50%;flex-shrink:0; }
        .at-log-status {
            color:var(--at-text);font-size:12px;font-weight:500;
            width:100px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        }
        .at-ellipsis { width:auto!important;max-width:160px; }
        .at-log-time { color:var(--at-muted);font-size:11px;flex:1; }
        .at-log-full { color:var(--at-muted);font-size:10px;flex-shrink:0;opacity:.55; }

        /* Heatmap */
        .at-heatmap-wrap { position:relative;padding:4px 0 8px; }
        .at-heatmap-header { display:flex;align-items:baseline;gap:8px;margin-bottom:8px; }
        .at-heatmap-title { font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--at-muted); }
        .at-heatmap-month { font-size:11px;color:var(--at-muted);opacity:.7; }
        .at-heatmap-svg-wrap { overflow-x:auto;padding-bottom:2px; }
        .at-heatmap-svg { display:block;cursor:crosshair;overflow:visible; }
        .at-heatmap-svg rect { transition:opacity .1s; }
        .at-heatmap-svg rect:hover { opacity:.7; }
        .at-heatmap-legend { display:flex;align-items:center;gap:5px;margin-top:6px; }
        .at-heatmap-legend-lbl { font-size:10px;color:var(--at-muted); }
        .at-heatmap-tooltip {
            display:none;position:absolute;background:var(--background-floating);
            border:1px solid var(--background-modifier-accent);border-radius:4px;
            padding:4px 8px;font-size:11px;color:var(--at-text);
            pointer-events:none;white-space:nowrap;z-index:10;
            box-shadow:0 2px 8px rgba(0,0,0,.3);
        }

        /* Hourly bar chart */
        .at-chart {
            display:flex;align-items:flex-end;height:56px;gap:2px;
            padding:0 0 18px;position:relative;
        }
        .at-bar-wrap {
            flex:1;display:flex;flex-direction:column;
            align-items:center;justify-content:flex-end;
            height:100%;position:relative;cursor:default;
        }
        .at-bar {
            width:100%;background:#5865f2;
            border-radius:2px 2px 0 0;min-height:1px;opacity:.75;
            transition:opacity .1s;
        }
        .at-bar-wrap:hover .at-bar { opacity:1; }
        .at-bar-label { position:absolute;bottom:-14px;font-size:8px;color:var(--at-muted);white-space:nowrap; }

        /* Custom Scrollbars */
        .at-user-list, .at-log, .at-heatmap-svg-wrap, .at-pfp-grid {
            scrollbar-width:thin;
            scrollbar-color:var(--scrollbar-thin-thumb,rgba(255,255,255,.1)) transparent;
        }
        .at-user-list::-webkit-scrollbar,
        .at-log::-webkit-scrollbar,
        .at-heatmap-svg-wrap::-webkit-scrollbar,
        .at-pfp-grid::-webkit-scrollbar { width:3px;height:3px; }
        .at-user-list::-webkit-scrollbar-track,
        .at-log::-webkit-scrollbar-track,
        .at-heatmap-svg-wrap::-webkit-scrollbar-track,
        .at-pfp-grid::-webkit-scrollbar-track { background:transparent;margin:4px 0; }
        .at-user-list::-webkit-scrollbar-thumb,
        .at-log::-webkit-scrollbar-thumb,
        .at-heatmap-svg-wrap::-webkit-scrollbar-thumb,
        .at-pfp-grid::-webkit-scrollbar-thumb {
            background:var(--scrollbar-thin-thumb,rgba(255,255,255,.12));
            border-radius:99px;min-height:32px;
        }
        .at-user-list:hover::-webkit-scrollbar-thumb,
        .at-log:hover::-webkit-scrollbar-thumb,
        .at-heatmap-svg-wrap:hover::-webkit-scrollbar-thumb,
        .at-pfp-grid:hover::-webkit-scrollbar-thumb {
            background:var(--scrollbar-thin-thumb,rgba(255,255,255,.2));
        }
        .at-modal[data-at-theme="light"] .at-user-list::-webkit-scrollbar-thumb,
        .at-modal[data-at-theme="light"] .at-log::-webkit-scrollbar-thumb,
        .at-modal[data-at-theme="light"] .at-heatmap-svg-wrap::-webkit-scrollbar-thumb,
        .at-modal[data-at-theme="light"] .at-pfp-grid::-webkit-scrollbar-thumb { background:rgba(0,0,0,.15); }
        .at-modal[data-at-theme="light"] .at-user-list:hover::-webkit-scrollbar-thumb,
        .at-modal[data-at-theme="light"] .at-log:hover::-webkit-scrollbar-thumb,
        .at-modal[data-at-theme="light"] .at-heatmap-svg-wrap:hover::-webkit-scrollbar-thumb,
        .at-modal[data-at-theme="light"] .at-pfp-grid:hover::-webkit-scrollbar-thumb { background:rgba(0,0,0,.3); }

        /* Avatar grid scrollable */
        .at-pfp-grid { max-height:200px;overflow-y:auto; }
        .at-pfp-entry { display:flex;flex-direction:column;align-items:center;gap:3px; }
        .at-pfp-img {
            width:48px;height:48px;border-radius:50%;object-fit:cover;
            transition:opacity .15s,transform .15s;
            border:2px solid var(--background-modifier-accent);
        }
        .at-pfp-entry:hover .at-pfp-img { opacity:.8;transform:scale(1.05); }
        .at-pfp-removed {
            width:48px;height:48px;border-radius:50%;background:var(--background-modifier-accent);
            display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--at-muted);text-align:center;
        }
        .at-pfp-time { font-size:9px;color:var(--at-muted);text-align:center;max-width:52px;line-height:1.2; }

        .at-danger-row { margin:8px 14px 0;display:flex;justify-content:flex-end;gap:12px; }
        .at-export-btn {
            background:none;border:none;cursor:pointer;color:#5865f2;
            font-size:11px;padding:0;transition:color .1s;font-weight:600;
        }
        .at-export-btn:hover { color:#4752c4; }
        .at-clear-btn {
            background:none;border:none;cursor:pointer;color:var(--at-muted);
            font-size:11px;padding:0;transition:color .1s;
        }
        .at-clear-btn:hover { color:#f23f43; }

        /* Settings panel */
        .at-opt-section { display:flex;flex-direction:column;gap:2px; }
        .at-opt-title {
            font-size:11px;font-weight:700;letter-spacing:.06em;
            text-transform:uppercase;color:var(--text-muted);margin-bottom:5px;
        }
        .at-opt-row {
            display:flex;align-items:center;justify-content:space-between;
            padding:8px 10px;border-radius:5px;cursor:pointer;
            background:var(--background-secondary);transition:background .1s;gap:12px;
        }
        .at-opt-row:hover { background:var(--background-modifier-hover); }
        .at-opt-info { display:flex;flex-direction:column;gap:1px;flex:1; }
        .at-opt-info strong { font-size:13px;color:var(--text-normal);font-weight:600; }
        .at-opt-info span { font-size:11px;color:var(--text-muted); }
    `; }
};
