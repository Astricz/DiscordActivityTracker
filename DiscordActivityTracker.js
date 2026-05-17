/**
 * @name ActivityTracker
 * @description Track your friends' Discord activity with a beautiful UI. Shows online/offline patterns over time.
 * @version 1.0.0
 * @author Astricz
 */
 
module.exports = class ActivityTracker {
    getName() { return "ActivityTracker"; }
    getDescription() { return "Track friends' activity and see when they're usually online."; }
    getVersion() { return "1.0.0"; }
    getAuthor() { return "you"; }
 
    start() {
        this.trackedUsers = BdApi.Data.load("ActivityTracker", "trackedUsers") || [];
        this.activityLog = BdApi.Data.load("ActivityTracker", "activityLog") || {};
        this.presenceHandler = this.handlePresenceUpdate.bind(this);
        BdApi.DOM.addStyle("ActivityTracker", this.getCSS());
        this.patchPresence();
        this.addToolbarButton();
    }
 
    stop() {
        BdApi.Patcher.unpatchAll("ActivityTracker");
        BdApi.DOM.removeStyle("ActivityTracker");
        document.getElementById("at-toolbar-btn")?.remove();
        document.getElementById("at-modal-overlay")?.remove();
    }
 
    patchPresence() {
        const PresenceStore = BdApi.Webpack.getStore("PresenceStore");
        if (!PresenceStore) return;
 
        BdApi.Patcher.after("ActivityTracker", PresenceStore, "getStatus", (_, [userId], ret) => {
            if (!this.trackedUsers.includes(userId)) return;
            const prev = this._lastStatus?.[userId];
            if (prev !== undefined && prev !== ret) {
                this.logActivity(userId, ret);
            }
            if (!this._lastStatus) this._lastStatus = {};
            this._lastStatus[userId] = ret;
        });
    }
 
    logActivity(userId, status) {
        if (!this.activityLog[userId]) this.activityLog[userId] = [];
        this.activityLog[userId].push({ status, timestamp: Date.now() });
        // Keep only last 1000 entries per user
        if (this.activityLog[userId].length > 1000) {
            this.activityLog[userId] = this.activityLog[userId].slice(-1000);
        }
        BdApi.Data.save("ActivityTracker", "activityLog", this.activityLog);
        this.refreshModalIfOpen();
    }
 
    addToolbarButton() {
        const toolbar = document.querySelector('[class*="toolbar"]');
        if (!toolbar) {
            setTimeout(() => this.addToolbarButton(), 2000);
            return;
        }
        const btn = document.createElement("div");
        btn.id = "at-toolbar-btn";
        btn.title = "Activity Tracker";
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>`;
        btn.onclick = () => this.openModal();
        toolbar.appendChild(btn);
    }
 
    getUserInfo(userId) {
        const UserStore = BdApi.Webpack.getStore("UserStore");
        const PresenceStore = BdApi.Webpack.getStore("PresenceStore");
        const user = UserStore?.getUser(userId);
        const status = PresenceStore?.getStatus(userId) || "offline";
        return { user, status };
    }
 
    getHourlyPattern(userId) {
        const logs = this.activityLog[userId] || [];
        const hours = Array(24).fill(0).map(() => ({ online: 0, offline: 0 }));
        logs.forEach(entry => {
            const hour = new Date(entry.timestamp).getHours();
            if (entry.status === "online" || entry.status === "idle" || entry.status === "dnd") {
                hours[hour].online++;
            } else {
                hours[hour].offline++;
            }
        });
        return hours;
    }
 
    getRecentActivity(userId) {
        const logs = this.activityLog[userId] || [];
        return logs.slice(-20).reverse();
    }
 
    formatTime(ts) {
        return new Date(ts).toLocaleString();
    }
 
    statusColor(status) {
        return { online: "#23a55a", idle: "#f0b232", dnd: "#f23f43", offline: "#80848e" }[status] || "#80848e";
    }
 
    refreshModalIfOpen() {
        const modal = document.getElementById("at-modal-overlay");
        if (modal) {
            const activeUserId = modal.dataset.activeUser;
            this.renderModal(activeUserId);
        }
    }
 
    openModal(activeUserId = null) {
        document.getElementById("at-modal-overlay")?.remove();
        this.renderModal(activeUserId);
    }
 
    renderModal(activeUserId = null) {
        document.getElementById("at-modal-overlay")?.remove();
 
        const overlay = document.createElement("div");
        overlay.id = "at-modal-overlay";
        overlay.dataset.activeUser = activeUserId || "";
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
 
        const modal = document.createElement("div");
        modal.className = "at-modal";
        modal.innerHTML = this.buildModalHTML(activeUserId);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
 
        // Wire up events
        modal.querySelector("#at-add-btn")?.addEventListener("click", () => {
            const input = modal.querySelector("#at-user-input");
            const userId = input.value.trim();
            if (!userId || this.trackedUsers.includes(userId)) return;
            // Validate user exists
            const UserStore = BdApi.Webpack.getStore("UserStore");
            const user = UserStore?.getUser(userId);
            if (!user) {
                BdApi.UI.showToast("User not found. Make sure you're using their User ID.", { type: "error" });
                return;
            }
            this.trackedUsers.push(userId);
            BdApi.Data.save("ActivityTracker", "trackedUsers", this.trackedUsers);
            if (!this._lastStatus) this._lastStatus = {};
            const PresenceStore = BdApi.Webpack.getStore("PresenceStore");
            this._lastStatus[userId] = PresenceStore?.getStatus(userId) || "offline";
            input.value = "";
            this.renderModal(userId);
        });
 
        modal.querySelectorAll(".at-user-row").forEach(row => {
            row.addEventListener("click", () => {
                const uid = row.dataset.userId;
                this.renderModal(uid === activeUserId ? null : uid);
            });
        });
 
        modal.querySelectorAll(".at-remove-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const uid = btn.dataset.userId;
                this.trackedUsers = this.trackedUsers.filter(id => id !== uid);
                BdApi.Data.save("ActivityTracker", "trackedUsers", this.trackedUsers);
                this.renderModal(activeUserId === uid ? null : activeUserId);
            });
        });
    }
 
    buildModalHTML(activeUserId) {
        const userRows = this.trackedUsers.map(uid => {
            const { user, status } = this.getUserInfo(uid);
            const name = user ? (user.globalName || user.username) : uid;
            const avatar = user?.avatar
                ? `<img src="https://cdn.discordapp.com/avatars/${uid}/${user.avatar}.webp?size=32" class="at-avatar"/>`
                : `<div class="at-avatar at-avatar-placeholder">${name[0]?.toUpperCase()}</div>`;
            const isExpanded = uid === activeUserId;
            const logs = this.getRecentActivity(uid);
            const pattern = this.getHourlyPattern(uid);
            const maxVal = Math.max(...pattern.map(h => h.online + h.offline), 1);
 
            const expandedHTML = isExpanded ? `
                <div class="at-expanded">
                    <div class="at-section-title">Hourly Activity Pattern</div>
                    <div class="at-chart">
                        ${pattern.map((h, i) => {
                            const total = h.online + h.offline;
                            const onlinePct = total ? (h.online / maxVal) * 100 : 0;
                            const label = i === 0 ? "12a" : i === 6 ? "6a" : i === 12 ? "12p" : i === 18 ? "6p" : i % 6 === 0 ? `${i}` : "";
                            return `<div class="at-bar-wrap" title="${i}:00 — ${h.online} online events">
                                <div class="at-bar" style="height:${onlinePct}%"></div>
                                <div class="at-bar-label">${label}</div>
                            </div>`;
                        }).join("")}
                    </div>
                    <div class="at-section-title">Recent Activity</div>
                    <div class="at-log">
                        ${logs.length === 0 ? `<div class="at-log-empty">No activity recorded yet. Activity is captured as status changes happen.</div>` :
                            logs.map(e => `
                            <div class="at-log-entry">
                                <span class="at-log-dot" style="background:${this.statusColor(e.status)}"></span>
                                <span class="at-log-status">${e.status}</span>
                                <span class="at-log-time">${this.formatTime(e.timestamp)}</span>
                            </div>`).join("")}
                    </div>
                </div>` : "";
 
            return `<div class="at-user-row ${isExpanded ? "at-expanded-row" : ""}" data-user-id="${uid}">
                <div class="at-user-info">
                    ${avatar}
                    <span class="at-status-dot" style="background:${this.statusColor(status)}"></span>
                    <span class="at-username">${name}</span>
                    <span class="at-status-label">${status}</span>
                </div>
                <div class="at-row-actions">
                    <span class="at-expand-icon">${isExpanded ? "▲" : "▼"}</span>
                    <button class="at-remove-btn" data-user-id="${uid}" title="Stop tracking">✕</button>
                </div>
                ${expandedHTML}
            </div>`;
        }).join("");
 
        return `
            <div class="at-header">
                <span class="at-title">Activity Tracker</span>
                <button class="at-close-btn" onclick="document.getElementById('at-modal-overlay').remove()">✕</button>
            </div>
            <div class="at-body">
                <div class="at-add-row">
                    <input id="at-user-input" class="at-input" placeholder="Paste User ID..." />
                    <button id="at-add-btn" class="at-add-btn-el">Track</button>
                </div>
                <div class="at-hint">Right-click a user → Copy User ID to get their ID</div>
                <div class="at-user-list">
                    ${this.trackedUsers.length === 0
                        ? `<div class="at-empty">No users tracked yet. Add someone above.</div>`
                        : userRows}
                </div>
            </div>
        `;
    }
 
    getCSS() {
        return `
            #at-toolbar-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border-radius: 8px;
                cursor: pointer;
                color: var(--interactive-normal);
                transition: background 0.15s, color 0.15s;
            }
            #at-toolbar-btn:hover { background: var(--background-modifier-hover); color: var(--interactive-hover); }
 
            #at-modal-overlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.6);
                z-index: 9999;
                display: flex; align-items: center; justify-content: center;
                backdrop-filter: blur(4px);
            }
 
            .at-modal {
                background: #1e1f22;
                border: 1px solid #2e2f34;
                border-radius: 16px;
                width: 520px;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 24px 64px rgba(0,0,0,0.5);
                font-family: 'gg sans', 'Noto Sans', sans-serif;
            }
 
            .at-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 18px 20px 14px;
                border-bottom: 1px solid #2e2f34;
            }
 
            .at-title {
                font-size: 16px; font-weight: 700;
                color: #fff; letter-spacing: 0.01em;
            }
 
            .at-close-btn {
                background: none; border: none;
                color: #80848e; font-size: 16px;
                cursor: pointer; padding: 4px 8px;
                border-radius: 6px; transition: background 0.1s, color 0.1s;
            }
            .at-close-btn:hover { background: #2e2f34; color: #fff; }
 
            .at-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
 
            .at-add-row { display: flex; gap: 8px; margin-bottom: 6px; }
 
            .at-input {
                flex: 1; background: #2b2d31; border: 1px solid #3e4046;
                border-radius: 8px; color: #fff; padding: 8px 12px;
                font-size: 14px; outline: none; transition: border 0.15s;
            }
            .at-input:focus { border-color: #5865f2; }
            .at-input::placeholder { color: #4e5058; }
 
            .at-add-btn-el {
                background: #5865f2; color: #fff; border: none;
                border-radius: 8px; padding: 8px 16px;
                font-size: 14px; font-weight: 600;
                cursor: pointer; transition: background 0.15s;
            }
            .at-add-btn-el:hover { background: #4752c4; }
 
            .at-hint { font-size: 11px; color: #4e5058; margin-bottom: 14px; }
 
            .at-user-list { display: flex; flex-direction: column; gap: 6px; }
 
            .at-empty { color: #4e5058; font-size: 14px; text-align: center; padding: 24px 0; }
 
            .at-user-row {
                background: #2b2d31; border-radius: 10px;
                cursor: pointer; transition: background 0.15s;
                border: 1px solid transparent;
                overflow: hidden;
            }
            .at-user-row:hover { background: #32353b; }
            .at-expanded-row { border-color: #5865f2; }
 
            .at-user-info {
                display: flex; align-items: center;
                gap: 10px; padding: 10px 14px;
                pointer-events: none;
            }
 
            .at-row-actions {
                display: flex; align-items: center; gap: 8px;
                position: absolute; right: 34px;
                margin-top: -36px;
            }
 
            .at-user-row { position: relative; }
 
            .at-expand-icon { color: #80848e; font-size: 10px; pointer-events: none; }
 
            .at-avatar {
                width: 32px; height: 32px;
                border-radius: 50%; object-fit: cover;
            }
            .at-avatar-placeholder {
                background: #5865f2; display: flex;
                align-items: center; justify-content: center;
                color: #fff; font-weight: 700; font-size: 14px;
            }
 
            .at-status-dot {
                width: 10px; height: 10px;
                border-radius: 50%; flex-shrink: 0;
            }
 
            .at-username { color: #fff; font-size: 14px; font-weight: 600; flex: 1; }
            .at-status-label { color: #80848e; font-size: 12px; text-transform: capitalize; }
 
            .at-remove-btn {
                background: none; border: none;
                color: #4e5058; font-size: 13px;
                cursor: pointer; padding: 2px 6px;
                border-radius: 4px; transition: background 0.1s, color 0.1s;
                pointer-events: all;
            }
            .at-remove-btn:hover { background: #f23f4322; color: #f23f43; }
 
            .at-expanded { padding: 0 14px 14px; border-top: 1px solid #3e4046; margin-top: 0; }
 
            .at-section-title {
                font-size: 11px; font-weight: 700; color: #80848e;
                text-transform: uppercase; letter-spacing: 0.08em;
                margin: 14px 0 8px;
            }
 
            .at-chart {
                display: flex; align-items: flex-end;
                height: 60px; gap: 2px;
                background: #1e1f22; border-radius: 8px;
                padding: 8px 6px 20px;
                position: relative;
            }
 
            .at-bar-wrap {
                flex: 1; display: flex; flex-direction: column;
                align-items: center; justify-content: flex-end;
                height: 100%; position: relative;
            }
 
            .at-bar {
                width: 100%; background: #5865f2;
                border-radius: 3px 3px 0 0;
                min-height: 2px;
                transition: height 0.3s;
            }
 
            .at-bar-label {
                position: absolute; bottom: -16px;
                font-size: 9px; color: #4e5058;
                white-space: nowrap;
            }
 
            .at-log { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
 
            .at-log-empty { color: #4e5058; font-size: 13px; padding: 8px 0; }
 
            .at-log-entry {
                display: flex; align-items: center; gap: 8px;
                padding: 5px 8px; background: #1e1f22;
                border-radius: 6px;
            }
 
            .at-log-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
 
            .at-log-status { color: #fff; font-size: 12px; font-weight: 600; width: 56px; text-transform: capitalize; }
 
            .at-log-time { color: #4e5058; font-size: 11px; }
        `;
    }
};