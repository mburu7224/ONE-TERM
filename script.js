const firebaseConfig = {
    apiKey: "AIzaSyD_AnGX-RO7zfM_rCBopJmdv3BOVE4V-_o",
    authDomain: "media-app-a702b.firebaseapp.com",
    projectId: "media-app-a702b",
    storageBucket: "media-app-a702b.firebasestorage.app",
    messagingSenderId: "60484045851",
    appId: "1:60484045851:web:f1bb588c2d5edc177ffcbe",
    measurementId: "G-LPBXF7MLWF"
};

const ADMIN_EMAIL = "";

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, doc, setDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-firestore.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, setPersistence, browserLocalPersistence, updateProfile } from "https://www.gstatic.com/firebasejs/11.9.0/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const contentCollectionRef = collection(db, "content_items");
const launchpadPluginsCollectionRef = collection(db, "LaunchpadPlugins");

async function initializeAuthSessionPersistence() {
    try {
        await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
        console.warn('Failed to enforce Firebase auth persistence:', e);
    }
}
initializeAuthSessionPersistence();

const SETTINGS_DOC_ID = "app_settings";

async function signInWithGoogle() {
    try {
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
        
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        await loadProfileFromBackend(user);
        
        console.log('Google sign-in successful:', user.email);
        
        return { success: true, message: `Welcome, ${user.displayName || user.email}!` };
    } catch (error) {
        console.error('Google sign-in error:', error);
        return { success: false, message: error.message };
    }
}

async function signOutUser() {
    try {
        await signOut(auth);
        console.log('User signed out');
        return { success: true, message: 'Signed out successfully' };
    } catch (error) {
        console.error('Sign out error:', error);
        return { success: false, message: error.message };
    }
}

async function isCurrentUserAdmin() {
    const user = auth.currentUser;
    if (!ADMIN_EMAIL || !user || !user.email) {
        return false;
    }
    return user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

async function isYouTubeSyncCompleted() {
    try {
        const settingsDoc = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
        if (settingsDoc.exists()) {
            return settingsDoc.data().youtubeSyncCompleted === true;
        }
        return false;
    } catch (error) {
        console.error("Error checking sync status:", error);
        return false;
    }
}

async function markYouTubeSyncCompleted() {
    try {
        await setDoc(doc(db, "settings", SETTINGS_DOC_ID), {
            youtubeSyncCompleted: true,
            syncCompletedAt: new Date()
        }, { merge: true });
        console.log("YouTube sync marked as completed");
    } catch (error) {
        console.error("Error marking sync as completed:", error);
    }
}

async function shouldShowConnectYouTubeButton() {
    const isAdmin = await isCurrentUserAdmin();
    const syncCompleted = await isYouTubeSyncCompleted();
    
    return isAdmin && !syncCompleted;
}

async function updateConnectYouTubeButtonVisibility() {
    const connectBtn = document.getElementById("connectYoutube");
    const btnContainer = document.querySelector(".youtube-btn-container");
    
    if (!connectBtn || !btnContainer) return;
    
    const shouldShow = await shouldShowConnectYouTubeButton();
    
    if (shouldShow) {
        btnContainer.style.display = "block";
    } else {
        btnContainer.style.display = "none";
    }
}

let activeSection = 'home';
let currentSearchTerm = '';
let currentFilterDate = null;
let autoplayEnabled = true;
let currentPlaylist = [];
let launchpadPluginsUnsubscribe = null;
let launchpadPluginsCache = [];
let launchpadActivePluginId = null;
let launchpadSearchTerm = '';
let launchpadViewerHideTimer = null;
const HOME_PAGE_SIZE = 12;
const SECTION_PAGE_SIZE = 9;
let homeVisibleCount = HOME_PAGE_SIZE;
let homeDocsCache = [];
let homeUnsubscribe = null;
let homeSearchTerm = '';
let currentWatchDoc = null;
let currentWatchList = [];
let currentWatchSidebarIds = new Set();
let pendingWatchVideoId = new URLSearchParams(window.location.search).get('v');
const sectionState = {};

window.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey || !event.deltaY) return;
    const scrollRoot = document.scrollingElement || document.documentElement;
    const beforeTop = scrollRoot.scrollTop;

    requestAnimationFrame(() => {
        if (scrollRoot.scrollTop === beforeTop) {
            window.scrollBy({ top: event.deltaY, left: event.deltaX, behavior: 'auto' });
        }
    });
}, { passive: true, capture: true });

function getSectionState(section) {
    if (!sectionState[section]) {
        sectionState[section] = {
            docs: [],
            searchTerm: '',
            filterDate: null,
            visibleCount: SECTION_PAGE_SIZE,
            unsubscribe: null
        };
    }
    return sectionState[section];
}

function getTimestampMillis(docItem) {
    const data = docItem && docItem.data ? docItem.data : {};
    if (data.eventDate) {
        const eventTime = data.eventTime || '00:00';
        const eventDate = new Date(`${data.eventDate}T${eventTime}`);
        if (!Number.isNaN(eventDate.getTime())) return eventDate.getTime();
    }
    if (data.timestamp && typeof data.timestamp.toDate === 'function') {
        return data.timestamp.toDate().getTime();
    }
    if (data.createdAt) {
        const createdDate = new Date(data.createdAt);
        if (!Number.isNaN(createdDate.getTime())) return createdDate.getTime();
    }
    return 0;
}

function sortByDateDesc(a, b) {
    return getTimestampMillis(b) - getTimestampMillis(a);
}

function getDisplayDate(docItem) {
    const data = docItem && docItem.data ? docItem.data : {};
    if (data.eventDate) return data.eventDate;
    if (data.timestamp && typeof data.timestamp.toDate === 'function') {
        return data.timestamp.toDate().toISOString().slice(0, 10);
    }
    return 'No Date';
}

function formatDateLabel(dateKey) {
    if (!dateKey || dateKey === 'No Date') return 'Content without a specific date';
    const date = new Date(`${dateKey}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateKey;
    return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function createLoadMoreButton(remainingCount, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'load-more-btn';
    button.innerHTML = `<i class="fas fa-chevron-down" aria-hidden="true"></i> Load more (${remainingCount})`;
    button.addEventListener('click', onClick);
    return button;
}

function notifyUser(isSuccess, message) {
    const modal = document.getElementById('registration-modal');
    const modalIcon = document.getElementById('registration-modal-icon');
    const modalTitle = document.getElementById('registration-modal-title');
    const modalMessage = document.getElementById('registration-modal-message');
    const modalClose = document.getElementById('registration-modal-close');

    if (!modal || !modalIcon || !modalTitle || !modalMessage || !modalClose) {
        alert((isSuccess ? 'Success: ' : 'Error: ') + message);
        return;
    }

    modalIcon.className = 'registration-modal-icon ' + (isSuccess ? 'success' : 'error');
    modalTitle.textContent = isSuccess ? 'Saved' : 'Action failed';
    modalMessage.textContent = message;
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    modalClose.onclick = () => {
        modal.setAttribute('aria-hidden', 'true');
        modal.style.display = 'none';
    };

    const overlay = modal.querySelector('.registration-modal-overlay');
    if (overlay) overlay.onclick = modalClose.onclick;
}

function setSidebarOpen(isOpen) {
    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const menuButtons = document.querySelectorAll('#launchpadViewerMenuBtn');

    if (sidebarWrapper) {
        sidebarWrapper.classList.toggle('active', Boolean(isOpen));
    }

    if (sidebarOverlay) {
        sidebarOverlay.classList.toggle('active', Boolean(isOpen));
    }

    menuButtons.forEach((button) => {
        button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        button.classList.toggle('is-open', Boolean(isOpen));
    });
}

function toggleSidebar() {
    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    setSidebarOpen(!(sidebarWrapper && sidebarWrapper.classList.contains('active')));
}

function closeSidebar() {
    setSidebarOpen(false);
}

function closeWatchView() {
    const theater = document.getElementById('theaterContainer');
    const grid = document.getElementById('homeVideoGrid');
    const loadMoreMount = document.getElementById('homeLoadMoreMount');
    const sectionStrip = document.querySelector('#home-section .section-strip');
    const playerContainer = getPlayerContainer();

    if (theater) {
        theater.classList.add('hidden');
        theater.style.display = 'none';
    }

    if (grid) grid.style.display = '';
    if (loadMoreMount) loadMoreMount.style.display = '';
    if (sectionStrip) sectionStrip.style.display = '';
    if (playerContainer) playerContainer.innerHTML = '';
    renderPlayerDetails(null);
    updateWatchUrl(null);
    currentPlaylist = [];
    currentWatchDoc = null;
    currentWatchList = [];
    currentWatchSidebarIds = new Set();
}

function goHomeDefault() {
    pauseAllMedia();
    closeWatchView();
    closeLaunchpadViewer();

    activeSection = 'home';
    currentSearchTerm = '';
    homeSearchTerm = '';
    currentFilterDate = null;

    document.getElementById('searchInput') && (document.getElementById('searchInput').value = '');
    document.getElementById('eventDateFilter') && (document.getElementById('eventDateFilter').value = '');
    document.getElementById('clearDateFilter')?.classList.add('hidden');

    document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
    document.getElementById('home-section')?.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    document.querySelector('.nav-item[data-section="home"]')?.classList.add('active');

    loadHomeVideos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const term = (searchInput?.value || '').trim();
    currentSearchTerm = term;

    if (activeSection === 'launchpad') {
        loadLaunchpadPlugins(term);
        return;
    }

    if (activeSection !== 'home') {
        loadContentFirebase(activeSection, term, currentFilterDate);
        return;
    }

    closeWatchView();
    homeSearchTerm = term;
    homeVisibleCount = HOME_PAGE_SIZE;
    renderHomeVideos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildVideoShareUrl(docItem) {
    const id = encodeURIComponent(docItem?.id || '');
    const base = `${window.location.origin}${window.location.pathname}`;
    return id ? `${base}?v=${id}` : window.location.href;
}

function getVideoKey(docItem) {
    const data = docItem?.data || {};
    const youtubeId = data.url ? getYouTubeVideoId(data.url) : '';
    return youtubeId || data.url || docItem?.id || data.title || '';
}

function getUniqueRelatedDocs(selectedDoc) {
    const seen = new Set([getVideoKey(selectedDoc), selectedDoc?.id].filter(Boolean));
    const sourceDocs = currentWatchList.length ? currentWatchList : homeDocsCache;
    const uniqueDocs = [];

    sourceDocs.forEach((docItem) => {
        const key = getVideoKey(docItem);
        if (!key || seen.has(key) || seen.has(docItem.id)) return;
        seen.add(key);
        if (docItem.id) seen.add(docItem.id);
        uniqueDocs.push(docItem);
    });

    return uniqueDocs;
}

function updateWatchUrl(docItem) {
    const url = new URL(window.location.href);
    if (docItem?.id) {
        url.searchParams.set('v', docItem.id);
    } else {
        url.searchParams.delete('v');
    }
    window.history.replaceState({}, '', url);
}

function openShareModal(docItem) {
    const shareModal = document.getElementById('shareModal');
    const shareInput = document.getElementById('shareVideoLink');
    if (!shareModal || !shareInput) return;
    shareInput.value = buildVideoShareUrl(docItem || currentWatchDoc);
    shareModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => shareInput.select(), 0);
}

function closeShareModal() {
    const shareModal = document.getElementById('shareModal');
    if (!shareModal) return;
    shareModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

async function copyShareLink() {
    const shareInput = document.getElementById('shareVideoLink');
    if (!shareInput) return;
    const value = shareInput.value;
    try {
        await navigator.clipboard.writeText(value);
        notifyUser(true, 'Link copied.');
    } catch (error) {
        shareInput.select();
        document.execCommand('copy');
        notifyUser(true, 'Link copied.');
    }
}

// ---------------- MPESA FRONTEND BRIDGE ----------------
// This section provides a small, drop-in bridge to send support payments
// to the backend endpoint POST /mpesa/pay. It expects a form with id
// `mpesaSupportForm` and input/select ids: `supportPhone`, `supportAmount`,
// `supportCategory` (GENERAL_SUPPORT|PROJECT_SPECIFIC), `supportMethod` (paybill|till),
// and optional `supportProject` for project selection.

function start90SecondCountdown(containerEl, onComplete) {
    let remaining = 90;
    const countdownEl = containerEl.querySelector('.mpesa-countdown') || containerEl.querySelector('#mpesaCountdown');
    const timer = setInterval(() => {
        remaining -= 1;
        if (countdownEl) countdownEl.textContent = `${remaining}s`;
        if (remaining <= 0) {
            clearInterval(timer);
            if (typeof onComplete === 'function') onComplete();
        }
    }, 1000);
    return () => clearInterval(timer);
}

async function sendMpesaRequest(payload) {
    try {
        const resp = await fetch('/mpesa/pay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        return data;
    } catch (err) {
        console.error('sendMpesaRequest error', err);
        throw err;
    }
}

function attachMpesaSupportFormBridge() {
    const form = document.getElementById('mpesaSupportForm');
    if (!form) return; // nothing to attach

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = document.getElementById('supportPhone')?.value?.trim();
        const amount = Number(document.getElementById('supportAmount')?.value);
        const category = document.getElementById('supportCategory')?.value || 'GENERAL_SUPPORT';
        const method = document.getElementById('supportMethod')?.value || 'paybill';
        const projectName = document.getElementById('supportProject')?.value || null;

        if (!phone || !amount || isNaN(amount) || amount <= 0) {
            notifyUser(false, 'Please enter a valid phone number and amount.');
            return;
        }

        // Immediately hide form inputs and show listening state UI if present
        const formContainer = form.closest('.mpesa-form-container') || form;
        const listening = document.querySelector('.mpesa-listening') || document.getElementById('mpesaListening');
        if (formContainer) formContainer.style.display = 'none';
        if (listening) listening.style.display = 'flex';

        try {
            const payload = { phone, amount, category, method, projectName };
            const result = await sendMpesaRequest(payload);
            if (result && result.success) {
                // start 90s countdown in the listening UI
                const listeningContainer = listening || document.body;
                const onComplete = () => {
                    if (listeningContainer) listeningContainer.style.display = 'none';
                    notifyUser(false, 'STK Push listening timed out. Please try again.');
                };
                start90SecondCountdown(listeningContainer, onComplete);
            } else {
                // backend returned failure; show error and restore form
                notifyUser(false, result && result.error ? JSON.stringify(result.error) : 'Payment initiation failed');
                if (formContainer) formContainer.style.display = '';
                if (listening) listening.style.display = 'none';
            }
        } catch (err) {
            notifyUser(false, 'Connection error initiating payment.');
            if (formContainer) formContainer.style.display = '';
            if (listening) listening.style.display = 'none';
        }
    });
}

// Expose initializer for pages that dynamically render the modal
window.initMpesaSupportBridge = attachMpesaSupportFormBridge;

// Attempt auto-attach on load
document.addEventListener('DOMContentLoaded', () => {
    try { attachMpesaSupportFormBridge(); } catch (e) { /* ignore */ }
});


function downloadCurrentVideo() {
    const item = currentWatchDoc?.data || {};
    const url = item.url || '';
    if (!url) {
        notifyUser(false, 'No downloadable media found.');
        return;
    }

    const youtubeId = getYouTubeVideoId(url);
    if (youtubeId) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
    }

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(item.title || 'media').replace(/[^\w.-]+/g, '-')}`;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

/**
 * Pause all playing media on the page (HTML5 video/audio and YouTube iframes).
 * This is called when navigation changes to ensure media stops when leaving a page.
 */
function pauseAllMedia() {
    // Pause native media elements
    document.querySelectorAll('video, audio').forEach(m => {
        try { m.pause(); } catch (e) { /* ignore */ }
    });

    // Post a pause command to YouTube iframes that have enablejsapi enabled
    document.querySelectorAll('iframe').forEach(iframe => {
        try {
            const src = iframe.src || '';
            if (src.includes('youtube.com/embed')) {
                // Send pause command via postMessage for YouTube Player API
                iframe.contentWindow && iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
                // Ensure the iframe won't autoplay again by removing autoplay param if present
                try {
                    if (iframe.src && iframe.src.indexOf('autoplay=1') !== -1) {
                        iframe.src = iframe.src.replace('autoplay=1', 'autoplay=0');
                        iframe.setAttribute('data-autoplay-disabled', '1');
                    }
                } catch (e) { /* ignore potential security exceptions */ }
            }
        } catch (e) { /* ignore cross-origin issues gracefully */ }
    });
}

/**
 * Returns the DOM element that should host the persistent fixed player.
 * Falls back to section-scoped containers if the fixed container isn't present.
 */
function getPlayerContainer() {
    // Use the section-scoped main player view as the persistent player container
    const mainPlayerView = document.getElementById('mainPlayerView');
    if (mainPlayerView) return mainPlayerView;
    // Fallback to hero player
    const hero = document.getElementById('heroPlayerContent');
    if (hero) return hero;
    return null;
}

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const navItems = document.querySelectorAll('.nav-item');
    const searchInput = document.getElementById('searchInput');
    const eventDateFilterInput = document.getElementById('eventDateFilter');
    const clearDateFilterButton = document.getElementById('clearDateFilter');
    const mainHeader = document.querySelector('.main-header');
    const mainContentWrapper = document.querySelector('.main-content-wrapper');
    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    const contentSections = document.querySelectorAll('.content-section');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const activeSectionTitle = document.getElementById('activeSectionTitle');
    const topbarLogo = document.querySelector('.topbar-logo');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            if (window.innerWidth <= 1024) {
                toggleSidebar();
                const isOpen = sidebarWrapper && sidebarWrapper.classList.contains('active');
                sidebarToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                return;
            }

            const collapsed = document.body.classList.toggle('sidebar-collapsed');
            sidebarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
    }

    topbarLogo?.addEventListener('click', goHomeDefault);
    topbarLogo?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            goHomeDefault();
        }
    });

    // --- Mobile Hamburger Menu Toggle ---
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeSidebar);
    }
    
    // Close sidebar when clicking nav items on mobile
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 1024 || document.body.classList.contains('launchpad-plugin-active')) {
                closeSidebar();
            }
        });
    });

    // --- Joker (Settings) overlay logic (full-screen split) ---
    const settingsGear = document.getElementById('settingsGear');
    const jokerScreen = document.getElementById('joker-screen');
    const jokerBackPortal = document.getElementById('jokerBackPortal');
    const jokerBackPortalMobile = document.getElementById('jokerBackPortalMobile');
    const jokerActionArea = document.getElementById('jokerActionArea');

    function showJoker() {
        if (!jokerScreen) return;
        const autoplaySettingState = document.getElementById('autoplaySettingState');
        if (autoplaySettingState) autoplaySettingState.textContent = autoplayEnabled ? 'On' : 'Off';
        updateThemeSettingState();
        jokerScreen.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
    function hideJoker() {
        if (!jokerScreen) return;
        jokerScreen.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        settingsGear && settingsGear.focus();
    }

    settingsGear && settingsGear.addEventListener('click', (e) => {
        e.preventDefault();
        showJoker();
    });
    
    // Desktop back button
    jokerBackPortal && jokerBackPortal.addEventListener('click', (e) => {
        e.preventDefault();
        hideJoker();
    });
    
    // Mobile back button
    jokerBackPortalMobile && jokerBackPortalMobile.addEventListener('click', (e) => {
        e.preventDefault();
        hideJoker();
    });

    document.querySelectorAll('[data-close-settings]').forEach((element) => {
        element.addEventListener('click', hideJoker);
    });

    document.getElementById('autoplaySetting')?.addEventListener('click', () => {
        autoplayEnabled = !autoplayEnabled;
        const autoplaySettingState = document.getElementById('autoplaySettingState');
        if (autoplaySettingState) autoplaySettingState.textContent = autoplayEnabled ? 'On' : 'Off';
    });

    function updateThemeSettingState() {
        const themeSettingState = document.getElementById('themeSettingState');
        if (themeSettingState) {
            themeSettingState.textContent = document.body.classList.contains('dark-mode') ? 'Dark mode' : 'Light mode';
        }
    }

    const savedTheme = localStorage.getItem('ruiruTheme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
    updateThemeSettingState();

    document.getElementById('darkModeSetting')?.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('ruiruTheme', isDark ? 'dark' : 'light');
        updateThemeSettingState();
    });

    document.getElementById('qualitySetting')?.addEventListener('click', () => {
        showRegistrationModal(true, 'Playback quality is set to Auto.');
    });

    document.getElementById('aboutSetting')?.addEventListener('click', () => {
        showRegistrationModal(true, 'Ruiru Media House media viewer.');
    });

    document.querySelectorAll('[data-close-share]').forEach((element) => {
        element.addEventListener('click', closeShareModal);
    });

    document.getElementById('copyShareLink')?.addEventListener('click', copyShareLink);

    document.addEventListener('click', (event) => {
        const shareButton = event.target.closest('.watch-share-btn');
        if (shareButton) {
            openShareModal(currentWatchDoc);
            return;
        }

        const downloadButton = event.target.closest('.watch-download-btn');
        if (downloadButton) {
            downloadCurrentVideo();
        }
    });

    // Commands in Joker overlay (right-side buttons)
    document.querySelectorAll('.joker-cmd[data-action]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            const action = ev.currentTarget.dataset.action;
            settingsState.currentAction = action;
            updateJokerMenu(ev.currentTarget);
            renderJokerDetails(action);
        });
    });

    // Mobile icon row click handlers
    document.querySelectorAll('.joker-mobile-icon-container[data-action]').forEach(icon => {
        icon.addEventListener('click', (ev) => {
            const action = ev.currentTarget.dataset.action;
            settingsState.currentAction = action;
            
            // Sync desktop buttons
            const desktopBtn = document.querySelector(`.joker-cmd[data-action="${action}"]`);
            updateJokerMenu(desktopBtn);
            
            // Render details
            renderJokerDetails(action);
        });
    });

    function clearJokerDetails() {
        if (!jokerActionArea) return;
        jokerActionArea.innerHTML = '';
    }

    // Joker Details Renderer (main function)
    function renderJokerDetails(action) {
        if (!jokerActionArea) return;
        clearJokerDetails();
        
        const container = document.createElement('div');
        container.className = 'joker-action ' + 'joker-action-' + action;
        
        switch(action) {
            case 'profile':
                container.appendChild(renderProfileSection());
                break;
            case 'customization':
                container.appendChild(renderCustomizationSection());
                break;
            case 'security':
                container.appendChild(renderSecuritySection());
                break;
            case 'login':
            case 'register':
                renderAuthForm(container, action);
                break;
            default:
                container.innerHTML = '<h2><i class="fas fa-cog"></i> Settings</h2><p>Select an option from the menu.</p>';
        }
        
        jokerActionArea.appendChild(container);
    }
    
    // Fallback auth form for when main renderer isn't loaded
    function renderAuthFormFallback(action) {
        if (!jokerActionArea) return;
        clearJokerDetails();
        const container = document.createElement('div');
        container.className = 'joker-action ' + 'joker-action-' + action;
        
        const fieldEmail = document.createElement('div');
        fieldEmail.className = 'field';
        const lblEmail = document.createElement('label'); lblEmail.textContent = 'Enter email';
        const inpEmail = document.createElement('input'); inpEmail.type = 'email'; inpEmail.name = 'email'; inpEmail.id = 'joker-email'; inpEmail.autocomplete = 'email'; inpEmail.placeholder = 'your@email.com';
        fieldEmail.appendChild(lblEmail); fieldEmail.appendChild(inpEmail);

        const fieldUser = document.createElement('div');
        fieldUser.className = 'field';
        const lblUser = document.createElement('label'); lblUser.textContent = 'Enter username';
        const inpUser = document.createElement('input'); inpUser.type = 'text'; inpUser.name = 'username'; inpUser.id = 'joker-username'; inpUser.autocomplete = 'username'; inpUser.placeholder = 'username';
        fieldUser.appendChild(lblUser); fieldUser.appendChild(inpUser);

        const fieldPass = document.createElement('div');
        fieldPass.className = 'field';
        const lblPass = document.createElement('label'); lblPass.textContent = 'Enter password';
        const inpPass = document.createElement('input'); inpPass.type = 'password'; inpPass.name = 'password'; inpPass.id = 'joker-password'; inpPass.autocomplete = 'new-password'; inpPass.placeholder = 'password';
        fieldPass.appendChild(lblPass); fieldPass.appendChild(inpPass);

        container.appendChild(fieldEmail);
        container.appendChild(fieldUser);
        container.appendChild(fieldPass);
        
        const submit = document.createElement('button'); 
        submit.textContent = action === 'login' ? 'Login' : 'Register';
        submit.className = 'joker-submit';
        submit.addEventListener('click', (e) => { e.preventDefault(); alert('Please wait for page to fully load...'); });
        
        container.appendChild(submit);
        jokerActionArea.appendChild(container);
    }

    // --- Registration Modal Function ---
    function showRegistrationModal(isSuccess, message) {
        const modal = document.getElementById('registration-modal');
        const modalIcon = document.getElementById('registration-modal-icon');
        const modalTitle = document.getElementById('registration-modal-title');
        const modalMessage = document.getElementById('registration-modal-message');
        const modalClose = document.getElementById('registration-modal-close');
        
        if (!modal || !modalIcon || !modalTitle || !modalMessage || !modalClose) {
            // Fallback alert if modal elements not found
            alert((isSuccess ? 'Success: ' : 'Error: ') + message);
            return;
        }
        
        // Set modal content
        modalIcon.className = 'registration-modal-icon ' + (isSuccess ? 'success' : 'error');
        modalTitle.textContent = isSuccess ? 'Saved' : 'Action failed';
        modalMessage.textContent = message;
        
        // Show modal
        modal.setAttribute('aria-hidden', 'false');
        modal.style.display = 'flex';
        
        // Close modal on button click
        modalClose.onclick = () => {
            modal.setAttribute('aria-hidden', 'true');
            modal.style.display = 'none';
            
            // If registration was successful, close joker screen and switch to login
            if (isSuccess) {
                hideJoker();
                // Switch to login action
                const loginBtn = document.querySelector('.joker-cmd[data-action="login"]');
                if (loginBtn) {
                    loginBtn.click();
                }
            }
        };
        
        // Close modal on overlay click
        const overlay = modal.querySelector('.registration-modal-overlay');
        if (overlay) {
            overlay.onclick = modalClose.onclick;
        }
    }

    // --- Navigation and Content Switching Logic ---
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            // Pause any playing media immediately when navigating
            pauseAllMedia();
            const targetSectionId = e.currentTarget.dataset.section + '-section';
            const targetSectionName = e.currentTarget.dataset.section;
            const targetLabel = e.currentTarget.textContent.trim();

            if (targetSectionName === 'home') {
                goHomeDefault();
                return;
            }

            activeSection = targetSectionName;
            closeWatchView();
            if (activeSectionTitle) activeSectionTitle.textContent = targetLabel;
            searchInput.value = ''; // Clear search input visually
            currentSearchTerm = ''; // Reset search term state
            homeSearchTerm = '';
            eventDateFilterInput.value = ''; // Clear date filter visually
            currentFilterDate = null; // Reset date filter state
            clearDateFilterButton.classList.add('hidden');

            // Update active navigation item
            navItems.forEach(nav => nav.classList.remove('active'));
            e.currentTarget.classList.add('active');

            // Show/hide content sections
            contentSections.forEach(section => section.classList.remove('active'));
            const targetSection = document.getElementById(targetSectionId);
            if (targetSection) {
                targetSection.classList.add('active');
                // Auto-close sidebar on mobile after selection
                if (window.innerWidth <= 768 && sidebarWrapper.classList.contains('active')) {
                    sidebarWrapper.classList.remove('active');
                }
            }

            if (activeSection !== 'launchpad') {
                closeLaunchpadViewer();
            }

            // Load content for the selected section
            if (activeSection === 'home') {
                loadHomeVideos();
            } else if (activeSection === 'launchpad') {
                loadLaunchpadPlugins(currentSearchTerm);
            } else {
                loadContentFirebase(activeSection, currentSearchTerm, currentFilterDate);
            }
        });
    });

    // --- Search Functionality ---
    document.querySelector('.search-icon')?.addEventListener('click', performSearch);
    searchInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            performSearch();
        }
    });

    searchInput.addEventListener('input', () => {
        currentSearchTerm = searchInput.value.trim();
        if (activeSection === 'launchpad') {
            loadLaunchpadPlugins(currentSearchTerm);
        } else if (activeSection === 'home') {
            homeSearchTerm = currentSearchTerm;
            homeVisibleCount = HOME_PAGE_SIZE;
            renderHomeVideos();
        } else if (activeSection !== 'home') {
            loadContentFirebase(activeSection, currentSearchTerm, currentFilterDate);
        }
    });

    // --- Event Date Filter Functionality ---
    eventDateFilterInput.addEventListener('change', (e) => {
        currentFilterDate = e.target.value; // YYYY-MM-DD format
        if (currentFilterDate) {
            clearDateFilterButton.classList.remove('hidden');
        } else {
            clearDateFilterButton.classList.add('hidden');
        }

        if (activeSection !== 'home' && activeSection !== 'launchpad') {
            loadContentFirebase(activeSection, currentSearchTerm, currentFilterDate);
        }
    });

    clearDateFilterButton.addEventListener('click', () => {
        eventDateFilterInput.value = '';
        currentFilterDate = null;
        clearDateFilterButton.classList.add('hidden');
        if (activeSection !== 'home' && activeSection !== 'launchpad') {
            loadContentFirebase(activeSection, currentSearchTerm, currentFilterDate);
        }
    });

    // --- Dynamic Header Height Adjustment for Mobile (to prevent content overlap) ---
    const adjustMainContentMargin = () => {
        if (window.innerWidth <= 768) {
            // Calculate actual height of the main header
            const headerHeight = mainHeader.offsetHeight;
            mainContentWrapper.style.marginTop = `${headerHeight}px`;
        } else {
            mainContentWrapper.style.marginTop = ''; // Reset for desktop
        }
    };

    // Adjust on load and resize
    adjustMainContentMargin();
    window.addEventListener('resize', adjustMainContentMargin);

    // Initialize draggable resizers for desktop
    initResizers();


    // --- Initial Page Load ---
    // Simulate clicking the home nav item to load initial content
    const initialNavItem = document.querySelector('.nav-item[data-section="home"]');
    if (initialNavItem) {
        initialNavItem.click();
    }
    // Also ensure home videos are loaded on initial load
    showOfflineBannerIfNeeded();
    loadHomeVideos();
    
    // Initialize autoplay functionality
    initializeAutoplay();

    // Initialize Launchpad viewer controls
    initializeLaunchpadViewer();
    
    initJokerSettings();
});

// --- Resizer Logic ---
function initResizers() {
    // Only enable on desktop sizes
    if (window.innerWidth <= 768) return;

    const colResizer = document.getElementById('colResizer');
    const rowResizer = document.getElementById('rowResizer');
    const theater = document.getElementById('theaterContainer');
    const playerCol = document.querySelector('.player-column');
    const playlist = document.querySelector('.video-playlist-sidebar');
    const player = document.querySelector('.main-player-view');

    if (colResizer && theater && playerCol && playlist) {
        let dragging = false;
        let startX = 0;
        let startPlayerWidth = 0;
        const minPlayerPx = 360; // min width
        const minPlaylistPx = 240; // min playlist width

        const onMove = (clientX) => {
            const rect = theater.getBoundingClientRect();
            const containerWidth = rect.width;
            let newPlayerWidth = clientX - rect.left;
            // clamp
            newPlayerWidth = Math.max(minPlayerPx, Math.min(containerWidth - minPlaylistPx - 10, newPlayerWidth));
            // apply as flex-basis to player column
            playerCol.style.flex = `0 0 ${newPlayerWidth}px`;
            // playlist will take remaining space (flex-basis set)
            const playlistWidth = containerWidth - newPlayerWidth - 10; // 10px for resizer
            playlist.style.flex = `0 0 ${playlistWidth}px`;
        };

        const startDrag = (e) => {
            dragging = true;
            startX = (e.touches ? e.touches[0].clientX : e.clientX);
            startPlayerWidth = playerCol.getBoundingClientRect().width;
            document.body.style.userSelect = 'none';
            window.addEventListener('mousemove', colMouseMove);
            window.addEventListener('touchmove', colTouchMove, { passive: false });
            window.addEventListener('mouseup', stopColDrag);
            window.addEventListener('touchend', stopColDrag);
        };

        const colMouseMove = (ev) => { if (!dragging) return; ev.preventDefault(); onMove(ev.clientX); };
        const colTouchMove = (ev) => { if (!dragging) return; ev.preventDefault(); onMove(ev.touches[0].clientX); };

        const stopColDrag = () => {
            dragging = false;
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', colMouseMove);
            window.removeEventListener('touchmove', colTouchMove);
            window.removeEventListener('mouseup', stopColDrag);
            window.removeEventListener('touchend', stopColDrag);
        };

        colResizer.addEventListener('mousedown', startDrag);
        colResizer.addEventListener('touchstart', startDrag, { passive: true });
    }

    if (rowResizer && player) {
        let draggingH = false;
        let startY = 0;
        let startPlayerH = 0;
        let startDetailsH = 0;
        const minPlayerH = 160;
        const minDetailsH = 60;
        const maxSumH = Math.round(window.innerHeight * 0.9);

        const onMoveH = (clientY) => {
            const delta = clientY - startY; // positive when dragging down
            let newTotal = startPlayerH + startDetailsH + delta;
            newTotal = Math.max(minPlayerH + minDetailsH, Math.min(maxSumH, newTotal));
            const scale = newTotal / (startPlayerH + startDetailsH);
            let newPlayer = Math.max(minPlayerH, Math.round(startPlayerH * scale));
            let newDetails = Math.max(minDetailsH, Math.round(startDetailsH * scale));
            // clamp to ensure sum equals newTotal (adjust rounding error)
            const sumNow = newPlayer + newDetails;
            if (sumNow !== newTotal) {
                const diff = newTotal - sumNow;
                newPlayer += diff; // bias to player for visibility
            }
            document.documentElement.style.setProperty('--prince-height', `${newPlayer}px`);
            document.documentElement.style.setProperty('--player-details-height', `${newDetails}px`);
        };

        const startDragH = (e) => {
            draggingH = true;
            startY = (e.touches ? e.touches[0].clientY : e.clientY);
            startPlayerH = player.getBoundingClientRect().height;
            const detailsEl = document.getElementById('playerDetails');
            startDetailsH = detailsEl ? detailsEl.getBoundingClientRect().height : 120;
            document.body.style.userSelect = 'none';
            rowResizer.classList.add('active');
            window.addEventListener('mousemove', rowMouseMove);
            window.addEventListener('touchmove', rowTouchMove, { passive: false });
            window.addEventListener('mouseup', stopRowDrag);
            window.addEventListener('touchend', stopRowDrag);
        };

        const rowMouseMove = (ev) => { if (!draggingH) return; ev.preventDefault(); onMoveH(ev.clientY); };
        const rowTouchMove = (ev) => { if (!draggingH) return; ev.preventDefault(); onMoveH(ev.touches[0].clientY); };

        const stopRowDrag = () => {
            draggingH = false;
            document.body.style.userSelect = '';
            rowResizer.classList.remove('active');
            window.removeEventListener('mousemove', rowMouseMove);
            window.removeEventListener('touchmove', rowTouchMove);
            window.removeEventListener('mouseup', stopRowDrag);
            window.removeEventListener('touchend', stopRowDrag);
        };

        // Double-click toggles details position (top/bottom)
        rowResizer.addEventListener('dblclick', (ev) => {
            const playerColEl = document.querySelector('.player-column');
            if (!playerColEl) return;
            playerColEl.classList.toggle('details-top');
        });

        rowResizer.addEventListener('mousedown', startDragH);
        rowResizer.addEventListener('touchstart', startDragH, { passive: true });
    }
}

// Keep track of original welcome position so we can restore it
const _welcomeOriginal = { parent: null, next: null };

function moveWelcomeIntoBoundary() {
    const welcome = document.querySelector('.welcome-card');
    const wrapper = document.getElementById('boundaryWelcomeWrapper');
    if (!welcome || !wrapper) return;
    if (!_welcomeOriginal.parent) {
        _welcomeOriginal.parent = welcome.parentNode;
        _welcomeOriginal.next = welcome.nextSibling;
    }
    // move the welcome card into the boundary wrapper
    wrapper.innerHTML = '';
    wrapper.appendChild(welcome);
}

function restoreWelcomeFromBoundary() {
    const welcome = document.querySelector('.welcome-card');
    if (!welcome || !_welcomeOriginal.parent) return;
    // move it back to its original location
    _welcomeOriginal.parent.insertBefore(welcome, _welcomeOriginal.next);
    _welcomeOriginal.parent = null;
    _welcomeOriginal.next = null;
}

/**
 * Loads all videos for the home page (no category filter), sorted by timestamp (newest first).
 */
const OFFLINE_CACHE_VERSION = 1;
const OFFLINE_CACHE_KEY = 'ruiruOfflineContentCache.v' + OFFLINE_CACHE_VERSION;

function isOfflineModeForced() {
    return localStorage.getItem('ruiruOfflineMode') === '1';
}

function isAppOffline() {
    return (typeof navigator !== 'undefined' && navigator.onLine === false) || isOfflineModeForced();
}

function getSectionDocsCacheKey(section) {
    return `ruiruOfflineSection.${section}`;
}

function persistSectionDocsToCache(section, docs) {
    try {
        const payload = {
            updatedAt: Date.now(),
            docs: (docs || []).map(d => ({ id: d.id, data: d.data }))
        };
        localStorage.setItem(getSectionDocsCacheKey(section), JSON.stringify(payload));

        // also persist a combined index for quick offline fallback
        const existing = getCombinedIndexCache();
        existing[section] = { count: (docs || []).length, updatedAt: payload.updatedAt };
        localStorage.setItem(OFFLINE_CACHE_KEY, JSON.stringify({
            index: existing,
            version: OFFLINE_CACHE_VERSION
        }));
    } catch (e) {
        console.warn('Failed to persist offline cache for section:', section, e);
    }
}

function getCombinedIndexCache() {
    try {
        const raw = localStorage.getItem(OFFLINE_CACHE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && parsed.index ? parsed.index : {};
    } catch {
        return {};
    }
}

function loadSectionDocsFromCache(section) {
    try {
        const raw = localStorage.getItem(getSectionDocsCacheKey(section));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.docs)) return null;
        return parsed.docs;
    } catch (e) {
        console.warn('Failed to load offline cache for section:', section, e);
        return null;
    }
}

function showOfflineBannerIfNeeded() {
    let banner = document.getElementById('offlineBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offlineBanner';
        banner.style.position = 'fixed';
        banner.style.top = '8px';
        banner.style.left = '50%';
        banner.style.transform = 'translateX(-50%)';
        banner.style.zIndex = '25000';
        banner.style.background = 'rgba(0,0,0,0.75)';
        banner.style.color = '#fff';
        banner.style.border = '1px solid rgba(255,255,255,0.2)';
        banner.style.padding = '10px 14px';
        banner.style.borderRadius = '999px';
        banner.style.fontWeight = '700';
        banner.style.fontSize = '13px';
        banner.style.display = 'none';
        banner.style.backdropFilter = 'blur(10px)';
        banner.innerHTML = 'Offline mode: showing cached content (videos may not play).';
        document.body.appendChild(banner);
    }

    const offline = isAppOffline();
    banner.style.display = offline ? 'block' : 'none';
}

function loadHomeVideosOfflineFallback() {
    const grid = document.getElementById('homeVideoGrid');
    if (!grid) return;

    const cachedDocs = loadSectionDocsFromCache('home');
    if (cachedDocs && cachedDocs.length) {
        homeDocsCache = cachedDocs
            .filter(d => (d.data.isArchived === false || d.data.isArchived === undefined))
            .sort(sortByDateDesc);
        renderHomeVideos();
        return;
    }

    grid.innerHTML = '<p class="text-center-message">Offline: no cached videos available yet. Connect to the internet once to load and cache content.</p>';
}

function loadHomeVideos() {
    const grid = document.getElementById('homeVideoGrid');

    if (!grid) return;
    homeVisibleCount = HOME_PAGE_SIZE;

    // Offline fallback: load last cached home items.
    if (isAppOffline()) {
        loadHomeVideosOfflineFallback();
        return;
    }

    if (homeUnsubscribe) {
        renderHomeVideos();
        return;
    }

    grid.innerHTML = '<p class="text-center-message">Loading videos...</p>';

    // Keep one live listener, then render page-sized chunks so the DOM and media do not load at once.
    homeUnsubscribe = onSnapshot(contentCollectionRef, (snapshot) => {
        const docs = [];
        snapshot.forEach(docSnap => docs.push({ id: docSnap.id, data: docSnap.data() }));

        homeDocsCache = docs
            .filter(d => (d.data.isArchived === false || d.data.isArchived === undefined))
            .sort(sortByDateDesc);

        // Cache for offline browsing
        persistSectionDocsToCache('home', homeDocsCache);

        renderHomeVideos();
    }, (err) => {
        console.error('Error loading home videos:', err);
        grid.innerHTML = '<p class="text-center-message">Error loading videos.</p>';
    });
}


function renderHomeVideos() {
    const grid = document.getElementById('homeVideoGrid');
    const playlistGrid = document.getElementById('playlistGrid');
    const loadMoreMount = document.getElementById('homeLoadMoreMount');
    if (!grid) return;

    grid.innerHTML = '';
    if (playlistGrid) playlistGrid.innerHTML = '';
    if (loadMoreMount) loadMoreMount.innerHTML = '';

    const filteredDocs = homeSearchTerm
        ? homeDocsCache.filter((docItem) => {
            const item = docItem.data || {};
            const term = homeSearchTerm.toLowerCase();
            return (item.title && item.title.toLowerCase().includes(term)) ||
                (item.description && item.description.toLowerCase().includes(term)) ||
                (item.topic && item.topic.toLowerCase().includes(term)) ||
                (item.by && item.by.toLowerCase().includes(term)) ||
                (item.category && item.category.toLowerCase().includes(term));
        })
        : homeDocsCache;

    if (filteredDocs.length === 0) {
        grid.innerHTML = '<p class="text-center-message">No videos available.</p>';
        return;
    }

    if (pendingWatchVideoId) {
        const targetDoc = homeDocsCache.find(doc => doc.id === pendingWatchVideoId);
        pendingWatchVideoId = null;
        if (targetDoc) {
            openTheaterWithVideo(targetDoc, homeDocsCache);
            return;
        }
    }

    const visibleDocs = filteredDocs.slice(0, homeVisibleCount);
    visibleDocs.forEach((docItem) => {
        const thumb = renderHomeThumbnail(docItem);
        thumb.addEventListener('click', () => {
            openTheaterWithVideo(docItem, filteredDocs);
        });
        grid.appendChild(thumb);
    });

    const remaining = filteredDocs.length - visibleDocs.length;
    if (remaining > 0 && loadMoreMount) {
        loadMoreMount.appendChild(createLoadMoreButton(remaining, () => {
            homeVisibleCount += HOME_PAGE_SIZE;
            renderHomeVideos();
        }));
    }
}

/**
 * Open a Split Theater layout: left large sticky player (75vw), right scrollable playlist (25vw).
 */
function openSplitTheater(selectedDoc, allDocs) {
    const homeSection = document.getElementById('home-section');
    const grid = document.getElementById('homeVideoGrid');
    const welcomeCard = document.querySelector('.welcome-card');

    if (!homeSection || !grid) return;

    // Remove existing theater-mode if present
    const existing = document.querySelector('.theater-mode');
    if (existing) existing.remove();

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'theater-mode';

    const mainPlayer = document.createElement('div');
    mainPlayer.className = 'main-player';
    mainPlayer.id = 'splitMainPlayer';

    const sidebarList = document.createElement('div');
    sidebarList.className = 'sidebar-list';
    sidebarList.id = 'splitSidebarList';

    wrapper.appendChild(mainPlayer);
    wrapper.appendChild(sidebarList);

    // Insert wrapper before the grid so it appears above/beside it
    homeSection.insertBefore(wrapper, grid);

    // Hide welcome card and grid (grid thumbnails will be shown in playlist-right)
    if (welcomeCard) welcomeCard.style.display = 'none';
    grid.style.display = 'none';

    // Add close button to main player
    const closeBtn = createCloseButton('Close');
    closeBtn.addEventListener('click', () => {
        // remove theater
        wrapper.remove();
        // restore welcome and grid
        if (welcomeCard) welcomeCard.style.display = '';
        grid.style.display = '';
        // slight scroll to top of restored grid
        setTimeout(() => { window.scrollTo({ top: grid.getBoundingClientRect().top + window.scrollY - (document.querySelector('.main-header') ? document.querySelector('.main-header').offsetHeight : 0) - 8, behavior: 'smooth' }); }, 40);
    });
    mainPlayer.appendChild(closeBtn);

    // Populate main player with selected
    populateSplitPlayer(selectedDoc, mainPlayer);

    // Populate sidebar with remaining videos
    sidebarList.innerHTML = '';
    allDocs.forEach(doc => {
        if (doc.id === selectedDoc.id) return;
        const item = renderPlaylistThumb(doc);
        item.classList.add('sidebar-item');
        item.addEventListener('click', () => {
            populateSplitPlayer(doc, mainPlayer);
            // on mobile ensure player is visible
            setTimeout(() => {
                const headerOffset = document.querySelector('.main-header') ? document.querySelector('.main-header').offsetHeight : 0;
                const topPos = mainPlayer.getBoundingClientRect().top + window.scrollY - headerOffset - 8;
                window.scrollTo({ top: topPos, behavior: 'smooth' });
            }, 40);
        });
        sidebarList.appendChild(item);
    });

    // Ensure playlist can scroll vertically (CSS handles overflow-y)

    // Scroll to top so the player-left is visible
    setTimeout(() => {
        const headerOffset = document.querySelector('.main-header') ? document.querySelector('.main-header').offsetHeight : 0;
        const topPos = wrapper.getBoundingClientRect().top + window.scrollY - headerOffset - 8;
        window.scrollTo({ top: topPos, behavior: 'smooth' });
    }, 60);
}

function renderPlaylistThumb(docItem) {
    const item = docItem.data;
    const container = document.createElement('div');
    container.className = 'sidebar-item';

    const ytId = item.url ? getYouTubeVideoId(item.url) : null;
    const thumb = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : (item.thumbnailUrl || 'https://via.placeholder.com/320x180.png?text=No+Thumb');

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'sidebar-thumb';
    thumbDiv.innerHTML = `<img src="${thumb}" alt="${item.title || 'Video'}" loading="lazy">`;

    const textDiv = document.createElement('div');
    textDiv.className = 'sidebar-text';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title || 'Untitled';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = item.category ? item.category : (item.eventDate ? new Date(item.eventDate).toLocaleDateString() : (item.by || ''));

    textDiv.appendChild(title);
    textDiv.appendChild(meta);

    container.appendChild(thumbDiv);
    container.appendChild(textDiv);
    return container;
}

function populateSplitPlayer(docItem, containerEl) {
    const item = docItem.data;
    // Prefer the global fixed player if available, unless a specific container is provided
    const target = containerEl || getPlayerContainer();
    if (!target) return;
    target.innerHTML = '';

    const ytId = item.url ? getYouTubeVideoId(item.url) : null;
    if (ytId) {
        const iframe = document.createElement('iframe');
        const origin = encodeURIComponent(window.location && window.location.origin ? window.location.origin : '');
        iframe.src = `https://www.youtube.com/embed/${ytId}?rel=0&enablejsapi=1&origin=${origin}&autoplay=1`;
        iframe.setAttribute('data-yt-id', ytId);
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        target.appendChild(iframe);
    } else if (item.url && item.url.match(/\.(mp4|webm|ogg)$/i)) {
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true; 
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.height = '100%';
        target.appendChild(video);
    } else if (item.url && item.url.match(/\.(mp3|wav|aac)$/i)) {
        const audioWrap = document.createElement('div');
        audioWrap.style.padding = '12px';
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.autoplay = true;
        audioWrap.appendChild(audio);
        target.appendChild(audioWrap);
    } else if (item.url && item.url.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.title || '';
        img.style.width = '100%';
        img.style.height = 'auto';
        target.appendChild(img);
    } else {
        target.innerHTML = `<div style="padding:20px;color:#fff;">Unable to play this content.</div>`;
    }
    // If a global player details area exists (desktop), populate title + description there
    try {
        const details = document.getElementById('playerDetails');
        if (details) {
            if (window.innerWidth > 768) {
                details.innerHTML = `<h3>${escapeHtml(item.title || 'Untitled')}</h3><p>${escapeHtml(item.description || '')}</p>`;
            } else {
                details.innerHTML = '';
            }
        }
    } catch (e) { /* ignore */ }
}

/**
 * Open the large hero player at the top of the home section with the selected video.
 * Hides the welcome card and scrolls the hero into view. Rebuilds the grid to show remaining videos.
 */
function openHeroWithVideo(selectedDoc, allDocs) {
    const heroContainer = document.getElementById('home-hero-player-container');
    const heroContent = document.getElementById('heroPlayerContent');
    const grid = document.getElementById('homeVideoGrid');
    const welcomeCard = document.querySelector('.welcome-card');

    if (!heroContainer || !heroContent || !grid) return;

    // Show hero, hide welcome card
    heroContainer.style.display = 'block';
    if (welcomeCard) welcomeCard.style.display = 'none';

    // Populate hero
    populateHeroPlayer(selectedDoc);

    // Add close button to hero container
    // remove existing close if present
    const existingClose = heroContainer.querySelector('.theater-close-btn');
    if (existingClose) existingClose.remove();
    const heroClose = createCloseButton('Close');
    heroClose.addEventListener('click', () => {
        // hide hero and restore welcome/grid
        heroContainer.style.display = 'none';
        if (welcomeCard) welcomeCard.style.display = '';
        // reload home videos to ensure grid repopulated
        loadHomeVideos();
        heroContent.innerHTML = '';
        const details = document.getElementById('playerDetails'); if (details) details.innerHTML = '';
    });
    heroContainer.appendChild(heroClose);

    // Rebuild grid with remaining videos (exclude selected)
    grid.innerHTML = '';
    allDocs.forEach(doc => {
        if (doc.id === selectedDoc.id) return;
        const thumb = renderHomeThumbnail(doc);
        thumb.addEventListener('click', () => openHeroWithVideo(doc, allDocs));
        grid.appendChild(thumb);
    });

    // Scroll hero into view (accounting for sticky header)
    setTimeout(() => {
        const headerOffset = document.querySelector('.main-header') ? document.querySelector('.main-header').offsetHeight : 0;
        const topPos = heroContainer.getBoundingClientRect().top + window.scrollY - headerOffset - 8;
        window.scrollTo({ top: topPos, behavior: 'smooth' });
    }, 60);
}

function populateHeroPlayer(docItem) {
    const heroContent = document.getElementById('heroPlayerContent');
    if (!heroContent) return;
    const item = docItem.data;
    heroContent.innerHTML = '';

    const ytId = item.url ? getYouTubeVideoId(item.url) : null;
    if (ytId) {
        const iframe = document.createElement('iframe');
        const origin = encodeURIComponent(window.location && window.location.origin ? window.location.origin : '');
        iframe.src = `https://www.youtube.com/embed/${ytId}?rel=0&enablejsapi=1&origin=${origin}&autoplay=1`;
        iframe.setAttribute('data-yt-id', ytId);
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        heroContent.appendChild(iframe);
    } else if (item.url && item.url.match(/\.(mp4|webm|ogg)$/i)) {
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        heroContent.appendChild(video);
    } else if (item.url && item.url.match(/\.(mp3|wav|aac)$/i)) {
        const audioWrap = document.createElement('div');
        audioWrap.style.padding = '12px';
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.autoplay = true;
        audioWrap.appendChild(audio);
        heroContent.appendChild(audioWrap);
    } else if (item.url && item.url.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.title || '';
        heroContent.appendChild(img);
    } else {
        heroContent.innerHTML = `<div style="padding:20px;color:#fff;">Unable to play this content.</div>`;
    }
    // Populate desktop-only player details under the main player if present
    try {
        const details = document.getElementById('playerDetails');
        if (details) {
            if (window.innerWidth > 768) {
                details.innerHTML = `<h3>${escapeHtml(item.title || 'Untitled')}</h3><p>${escapeHtml(item.description || '')}</p>`;
            } else {
                details.innerHTML = '';
            }
        }
    } catch (e) { /* ignore */ }
}

function renderHomeThumbnail(docItem) {
    const item = docItem.data;
    const wrapper = document.createElement('div');
    wrapper.className = 'thumbnail-item';

    // Choose thumbnail: if youtube id, use youtube thumbnail, else try to use url (if image) or placeholder
    let thumbUrl = '';
    const ytId = item.url ? getYouTubeVideoId(item.url) : null;
    if (ytId) {
        thumbUrl = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    } else if (item.thumbnailUrl) {
        thumbUrl = item.thumbnailUrl;
    } else {
        thumbUrl = 'https://via.placeholder.com/480x270.png?text=No+Thumbnail';
    }

    wrapper.innerHTML = `
        <img src="${thumbUrl}" alt="${item.title || 'Video'}" loading="lazy">
        <div class="thumb-meta">
            <div class="content-item-date">${formatDateLabel(getDisplayDate(docItem))}</div>
            <strong>${item.title || 'Untitled'}</strong>
            <p>${item.description || 'No description provided.'}</p>
            <div class="meta-sub">${item.by ? item.by : item.category || ''}</div>
        </div>
    `;
    return wrapper;
}

function openTheaterWithVideo(selectedDoc, allDocs) {
    const theater = document.getElementById('theaterContainer');
    const grid = document.getElementById('homeVideoGrid');
    const loadMoreMount = document.getElementById('homeLoadMoreMount');
    const sectionStrip = document.querySelector('#home-section .section-strip');

    if (!theater) return;

    if (sectionStrip) sectionStrip.style.display = 'none';
    if (grid) grid.style.display = 'none';
    if (loadMoreMount) loadMoreMount.style.display = 'none';
    theater.classList.remove('hidden');
    theater.style.display = 'flex';

    currentPlaylist = allDocs;
    currentWatchList = allDocs;

    const playerContainer = getPlayerContainer();
    if (!playerContainer) return;
    playWatchVideo(selectedDoc, false);

    const existingClose = playerContainer.querySelector('.theater-close-btn');
    if (existingClose) existingClose.remove();
    const closeBtn = createCloseButton('Close');
    closeBtn.addEventListener('click', () => {
        theater.classList.add('hidden');
        theater.style.display = 'none';
        if (grid) grid.style.display = '';
        if (loadMoreMount) loadMoreMount.style.display = '';
        if (sectionStrip) sectionStrip.style.display = '';
        playerContainer.innerHTML = '';
        renderPlayerDetails(null);
        currentPlaylist = [];
        currentWatchDoc = null;
        currentWatchSidebarIds = new Set();
    });
    playerContainer.appendChild(closeBtn);

    setTimeout(() => {
        const headerOffset = document.querySelector('.main-header')?.offsetHeight || 0;
        const topPos = theater.getBoundingClientRect().top + window.scrollY - headerOffset;
        window.scrollTo({ top: topPos, behavior: 'smooth' });
    }, 40);
}

function playWatchVideo(docItem, shouldScroll = true) {
    const playerContainer = getPlayerContainer();
    if (!playerContainer) return;

    renderWatchSidebar(docItem);
    populateMainPlayer(docItem);
    playerContainer.dataset.currentVideoId = docItem.id;
    updatePlaylistHighlight(docItem.id);

    if (shouldScroll) {
        const theater = document.getElementById('theaterContainer');
        const headerOffset = document.querySelector('.main-header')?.offsetHeight || 0;
        if (theater) {
            window.scrollTo({
                top: theater.getBoundingClientRect().top + window.scrollY - headerOffset,
                behavior: 'smooth'
            });
        }
    }
}

function renderWatchSidebar(selectedDoc) {
    const playlistGrid = document.getElementById('playlistGrid');
    if (!playlistGrid) return;

    const sidebarDocs = getUniqueRelatedDocs(selectedDoc).slice(0, 10);
    currentWatchSidebarIds = new Set(sidebarDocs.map(doc => doc.id));
    playlistGrid.innerHTML = '';

    sidebarDocs.forEach((docItem) => {
        const playlistItem = renderPlaylistItem(docItem);
        playlistItem.dataset.videoId = docItem.id;
        playlistItem.addEventListener('click', () => playWatchVideo(docItem));
        playlistGrid.appendChild(playlistItem);
    });
}

function renderPlaylistItem(docItem) {
    const item = docItem.data;
    const row = document.createElement('div');
    row.className = 'playlist-item';

    const ytId = item.url ? getYouTubeVideoId(item.url) : null;
    const thumb = ytId ? `https://i.ytimg.com/vi/${ytId}/default.jpg` : (item.thumbnailUrl || 'https://via.placeholder.com/120x90.png?text=No+Thumb');

    row.innerHTML = `
        <img src="${thumb}" alt="${item.title}" loading="lazy">
        <div class="playlist-meta">
            <div class="title">${item.title || 'Untitled'}</div>
            <div class="sub">${item.by || item.category || ''}</div>
        </div>
    `;
    return row;
}

function renderPlayerDetails(docItem) {
    const details = document.getElementById('playerDetails');
    if (!details) return;
    if (!docItem) {
        currentWatchDoc = null;
        details.innerHTML = '';
        return;
    }

    currentWatchDoc = docItem;
    const item = docItem.data || {};
    const meta = [
        formatDateLabel(getDisplayDate(docItem)),
        item.by,
        item.category
    ].filter(Boolean).join(' · ');

    details.innerHTML = `
        <h1>${escapeHtml(item.title || 'Untitled')}</h1>
        <div class="watch-meta">${escapeHtml(meta)}</div>
        <div class="watch-actions">
            <button class="watch-action-btn watch-share-btn" type="button">
                <i class="fas fa-share" aria-hidden="true"></i> Share
            </button>
            <button class="watch-action-btn watch-download-btn" type="button">
                <i class="fas fa-download" aria-hidden="true"></i> Download
            </button>
            <button id="saveVideoBtn" class="watch-action-btn watch-save-btn" type="button">
                <span class="icon">🔖</span>
                <span class="btn-text">Save</span>
            </button>
        </div>
        <p>${escapeHtml(item.description || 'No description provided.')}</p>
        ${item.topic ? `<div class="watch-topic">Topic: ${escapeHtml(item.topic)}</div>` : ''}
        <section class="watch-more-section" aria-label="More videos">
            <h2>More videos</h2>
            <div class="watch-more-grid" id="watchMoreGrid"></div>
        </section>
    `;
    renderWatchMoreGrid(docItem);

    // --- Save button state & handler ---
    try {
        const saveBtn = document.getElementById('saveVideoBtn');
        const itemUrl = (item && (item.url || item.fileUrl || item.source)) || '';

        function setSavedUI() {
            if (!saveBtn) return;
            saveBtn.classList.add('saved-active');
            const txt = saveBtn.querySelector('.btn-text');
            if (txt) txt.textContent = 'Saved';
        }

        function setUnsavedUI() {
            if (!saveBtn) return;
            saveBtn.classList.remove('saved-active');
            const txt = saveBtn.querySelector('.btn-text');
            if (txt) txt.textContent = 'Save';
        }

        // Local storage helpers moved to localstorage.js — use global APIs
        function isSaved(url) {
            if (!url) return false;
            try {
                const list = (typeof getSavedVideos === 'function') ? getSavedVideos() : (window.getSavedVideos ? window.getSavedVideos() : []);
                return list.some(i => i && i.url === url);
            } catch (e) { return false; }
        }

        // Initialize state based on localStorage unified list
        if (isSaved(itemUrl)) setSavedUI(); else setUnsavedUI();

        // Attach click handler to save metadata locally and maintain savedVideos array
        if (saveBtn) {
            saveBtn.onclick = function () {
                if (!itemUrl) {
                    notifyUser(false, 'No video URL found to save.');
                    return;
                }
                try {
                    // Attempt to capture the active player's thumbnail/poster image.
                    let thumbnailUrl = '';
                    try {
                        const player = getPlayerContainer();
                        if (player) {
                            const vid = player.querySelector('video');
                            if (vid) {
                                thumbnailUrl = vid.getAttribute('poster') || vid.dataset.poster || '';
                            }
                            if (!thumbnailUrl) {
                                const overlayImg = player.querySelector('img.player-poster, img.player-thumb, .player-poster img, .player-thumb img, img[data-role="poster"], img.thumbnail-item img');
                                if (overlayImg) thumbnailUrl = overlayImg.src || overlayImg.getAttribute('src') || '';
                            }
                        }
                    } catch (e) { /* ignore DOM access errors */ }

                    // Fallback to metadata or YouTube generated thumbnail
                    if (!thumbnailUrl) thumbnailUrl = item.thumbnailUrl || '';
                    if (!thumbnailUrl && item.url) {
                        const yt = getYouTubeVideoId(item.url);
                        if (yt) thumbnailUrl = `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
                    }

                    // Ensure metadata contains thumbnail for consistency across the app
                    if (thumbnailUrl && (!item.thumbnailUrl || item.thumbnailUrl !== thumbnailUrl)) {
                        try { item.thumbnailUrl = thumbnailUrl; } catch (e) { /* ignore */ }
                    }

                    const payload = {
                        id: item.id || item.videoId || item.url || String(Date.now()),
                        title: item.title || '',
                        url: itemUrl,
                        metadata: item,
                        thumbnailUrl: thumbnailUrl || '',
                        savedAt: Date.now()
                    };
                    try {
                        if (typeof saveVideoToDevice === 'function') saveVideoToDevice(payload);
                        else if (window.saveVideoToDevice) window.saveVideoToDevice(payload);
                    } catch (e) { /* ignore */ }
                    // Visual feedback: add green state and update text
                    saveBtn.classList.add('saved-active');
                    const txt = saveBtn.querySelector('.btn-text');
                    if (txt) txt.textContent = 'Saved';
                    notifyUser(true, 'Video saved locally.');
                } catch (err) {
                    console.error('Save video error', err);
                    notifyUser(false, 'Unable to save video.');
                }
            };
        }
    } catch (e) {
        console.warn('Save button setup failed', e);
    }
}

function renderWatchMoreGrid(selectedDoc) {
    const grid = document.getElementById('watchMoreGrid');
    if (!grid) return;
    grid.innerHTML = '';

    const relatedDocs = getUniqueRelatedDocs(selectedDoc)
        .filter(doc => !currentWatchSidebarIds.has(doc.id));

    relatedDocs.forEach((docItem) => {
        const card = renderWatchMoreCard(docItem);
        card.addEventListener('click', () => {
            playWatchVideo(docItem);
        });
        grid.appendChild(card);
    });
}

// ---------------- Saved Videos Library ----------------
function renderSavedVideosLibrary() {
    const container = document.getElementById('savedVideosLibraryContainer');
    if (!container) return;
    const saved = (typeof getSavedVideos === 'function') ? getSavedVideos() : (window.getSavedVideos ? window.getSavedVideos() : []);
    container.innerHTML = '';

    if (!saved.length) {
        const empty = document.createElement('div');
        empty.className = 'saved-empty-state';
        empty.innerHTML = `<div style="padding:40px;text-align:center;color:#444;">You haven't saved any videos yet. Click the 'Save' button under any video to bookmark it here!</div>`;
        container.appendChild(empty);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'saved-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
    grid.style.gap = '14px';

    saved.forEach((entry, idx) => {
        const meta = entry.metadata || {};
        const url = entry.url || '';
        const title = entry.title || meta.title || 'Untitled';
        const date = meta.eventDate || meta.createdAt || '';
        const category = meta.category || meta.by || '';

        const card = document.createElement('div');
        card.className = 'saved-card';
        card.style.background = '#fff';
        card.style.border = '1px solid var(--border-color)';
        card.style.borderRadius = '12px';
        card.style.overflow = 'hidden';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';

        const thumb = document.createElement('div');
        thumb.className = 'saved-thumb';
        thumb.style.height = '140px';
        thumb.style.background = '#f3f4f6';
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';
        const img = document.createElement('img');
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.alt = title;
        img.className = 'video-thumbnail-img';
        img.loading = 'lazy';
        // Prefer the explicit saved thumbnailUrl, then metadata, then YouTube fallback, then placeholder
        const thumbUrl = entry.thumbnailUrl || meta.thumbnailUrl || (entry.url && getYouTubeVideoId(entry.url) ? `https://i.ytimg.com/vi/${getYouTubeVideoId(entry.url)}/hqdefault.jpg` : 'https://via.placeholder.com/480x270.png?text=No+Thumbnail');
        img.src = thumbUrl;
        thumb.appendChild(img);

        const body = document.createElement('div');
        body.style.padding = '12px';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '8px';

        const h = document.createElement('div');
        h.style.fontWeight = '700';
        h.style.fontSize = '0.95rem';
        h.textContent = title;

        const sub = document.createElement('div');
        sub.style.fontSize = '0.85rem';
        sub.style.color = '#666';
        sub.textContent = [date, category].filter(Boolean).join(' · ');

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '8px';
        actions.style.marginTop = 'auto';

        const watchBtn = document.createElement('button');
        watchBtn.type = 'button';
        watchBtn.className = 'watch-now-btn watch-action-btn';
        watchBtn.textContent = '▶️ Watch Now';
        watchBtn.onclick = () => {
            // Mirror the exact native flow: force UI switch, reset scroll, then call native player loader.
            try {
                // Pause any other media first to avoid overlapping audio
                try { pauseAllMedia(); } catch (e) { /* ignore */ }

                // Ensure content sections are hidden and theater is visible
                document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
                // Update nav active state (clear saved tab highlight)
                document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));

                // Show theater container exactly like Home does
                const theater = document.getElementById('theaterContainer');
                if (theater) {
                    theater.classList.remove('hidden');
                    theater.style.display = 'flex';
                }

                // Reset page scroll so the player is visible at top of viewport (same as native behavior)
                try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
            } catch (e) { console.warn('Failed to perform view switch for saved video', e); }

            // Build a canonical docItem that mirrors the shape used across the app
            const savedList = (typeof getSavedVideos === 'function') ? getSavedVideos() : (window.getSavedVideos ? window.getSavedVideos() : []);
            const docData = Object.assign({}, (entry.metadata || {}));
            docData.url = entry.url || docData.url;
            if (entry.thumbnailUrl) docData.thumbnailUrl = entry.thumbnailUrl;
            if (entry.title) docData.title = entry.title;
            const docItem = { id: entry.id || entry.url || `saved_${idx}`, data: docData };

            // Build an array of docs in the same shape so the native player can set the playlist
            const allDocs = savedList.map((e) => ({ id: e.id || e.url || String(e.savedAt || ''), data: Object.assign({}, (e.metadata || {}), { url: e.url, thumbnailUrl: e.thumbnailUrl, title: e.title }) }));

            // Finally, call the native theater loader so everything behaves exactly like Home.
            if (typeof openTheaterWithVideo === 'function') {
                openTheaterWithVideo(docItem, allDocs);
            } else if (typeof playWatchVideo === 'function') {
                playWatchVideo(docItem);
            }
        };

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-saved-btn watch-action-btn';
        removeBtn.textContent = '🗑️ Remove';
        removeBtn.onclick = () => {
            try {
                if (typeof removeVideoFromDevice === 'function') removeVideoFromDevice(url);
                else if (window.removeVideoFromDevice) window.removeVideoFromDevice(url);
            } catch (e) { /* ignore */ }
            // If the currently displayed video matches the removed one, remove saved-active from button
            const saveBtn = document.getElementById('saveVideoBtn');
            if (saveBtn && saveBtn.classList.contains('saved-active')) {
                const currentUrl = (window.currentWatchDoc && window.currentWatchDoc.data && (window.currentWatchDoc.data.url || '')) || '';
                if (currentUrl === url) {
                    saveBtn.classList.remove('saved-active');
                    const txt = saveBtn.querySelector('.btn-text'); if (txt) txt.textContent = 'Save';
                }
            }
            renderSavedVideosLibrary();
        };

        actions.appendChild(watchBtn);
        actions.appendChild(removeBtn);

        body.appendChild(h);
        body.appendChild(sub);
        body.appendChild(actions);

        card.appendChild(thumb);
        card.appendChild(body);

        grid.appendChild(card);
    });

    container.appendChild(grid);
}

// Wire sidebar saved nav button to reuse navigation flow
document.addEventListener('DOMContentLoaded', () => {
    const savedNav = document.getElementById('savedVideosNavBtn');
    if (!savedNav) return;
    savedNav.addEventListener('click', (e) => {
        e.preventDefault();
        try { pauseAllMedia(); } catch (e) { /* ignore */ }
        try { closeWatchView(); } catch (e) { /* ignore */ }

        // Local references (query inside this handler to avoid cross-scope issues)
        const navItems = document.querySelectorAll('.nav-item, .nav-link');
        const searchInput = document.getElementById('searchInput');
        const eventDateFilterInput = document.getElementById('eventDateFilter');
        const clearDateFilterButton = document.getElementById('clearDateFilter');
        const sidebarWrapper = document.querySelector('.sidebar-wrapper');
        const activeSectionTitle = document.getElementById('activeSectionTitle');

        if (activeSectionTitle) activeSectionTitle.textContent = 'Saved Videos';
        if (searchInput) searchInput.value = '';
        window.currentSearchTerm = '';
        window.homeSearchTerm = '';
        if (eventDateFilterInput) eventDateFilterInput.value = '';
        window.currentFilterDate = null;
        if (clearDateFilterButton) clearDateFilterButton.classList.add('hidden');

        // Move active nav styling to Saved Videos tab
        navItems.forEach(nav => nav.classList.remove('active'));
        savedNav.classList.add('active');

        // Hide other content sections and show saved section
        document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
        const savedSection = document.getElementById('saved-videos-section');
        if (savedSection) savedSection.classList.add('active');

        // Hide player/theater to show list view
        const theater = document.getElementById('theaterContainer');
        if (theater) theater.classList.add('hidden');

        // Auto-close sidebar on mobile
        if (window.innerWidth <= 768 && sidebarWrapper && sidebarWrapper.classList.contains('active')) {
            sidebarWrapper.classList.remove('active');
        }

        // Immediately fetch device-local saved videos and render
        try {
            if (typeof renderSavedVideosLibrary === 'function') renderSavedVideosLibrary();
        } catch (e) { console.warn('Failed to render saved videos', e); }
    });
});

function renderWatchMoreCard(docItem) {
    const item = docItem.data || {};
    const card = document.createElement('button');
    card.className = 'watch-more-card';
    card.type = 'button';

    const youtubeId = item.url ? getYouTubeVideoId(item.url) : null;
    const thumb = youtubeId
        ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
        : (item.thumbnailUrl || 'https://via.placeholder.com/320x180.png?text=Video');

    card.innerHTML = `
        <img src="${thumb}" alt="${escapeHtml(item.title || 'Video')}" loading="lazy">
        <span>${escapeHtml(item.title || 'Untitled')}</span>
        <small>${escapeHtml(item.by || item.category || formatDateLabel(getDisplayDate(docItem)))}</small>
    `;
    return card;
}

function populateMainPlayer(docItem) {
    const target = getPlayerContainer();
    if (!target) return;
    const item = docItem.data;
    target.innerHTML = '';
    renderPlayerDetails(docItem);
    updateWatchUrl(docItem);

    const ytId = item.url ? getYouTubeVideoId(item.url) : null;
    if (ytId) {
        const iframe = document.createElement('iframe');
        const origin = encodeURIComponent(window.location && window.location.origin ? window.location.origin : '');
        iframe.src = `https://www.youtube.com/embed/${ytId}?rel=0&enablejsapi=1&origin=${origin}&autoplay=1`;
        iframe.setAttribute('data-yt-id', ytId);
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        target.appendChild(iframe);

        // Setup autoplay for YouTube videos
        console.log('Setting up autoplay for YouTube video:', ytId);
        setupAutoplay(iframe, docItem.id);
    } else if (item.url && item.url.match(/\.(mp4|webm|ogg)$/i)) {
        const video = document.createElement('video');
        video.src = item.url;
        video.controls = true;
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.height = '100%';

        // Setup autoplay for HTML5 videos
        video.addEventListener('ended', () => {
            console.log('HTML5 video ended, autoplay enabled:', autoplayEnabled);
            if (autoplayEnabled) {
                playNextVideo(docItem.id);
            }
        });

        target.appendChild(video);
    } else if (item.url && item.url.match(/\.(mp3|wav|aac)$/i)) {
        const audio = document.createElement('audio');
        audio.src = item.url;
        audio.controls = true;
        audio.autoplay = true;

        // Setup autoplay for audio
        audio.addEventListener('ended', () => {
            console.log('Audio ended, autoplay enabled:', autoplayEnabled);
            if (autoplayEnabled) {
                playNextVideo(docItem.id);
            }
        });

        target.appendChild(audio);
    } else if (item.url && item.url.match(/\.(png|jpg|jpeg|gif|webp)$/i)) {
        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.title || '';
        img.style.width = '100%';
        img.style.height = 'auto';
        target.appendChild(img);
    } else {
        target.innerHTML = `<div style="padding:20px;color:#fff;">Unable to play this content.</div>`;
    }
}

// --- Helper Functions ---

/**
 * Extracts YouTube video ID from various YouTube URL formats.
 * @param {string} url - The YouTube URL.
 * @returns {string|null} The YouTube video ID or null if not found.
 */
function getYouTubeVideoId(url) {
    let videoId = null;
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|)([\w-]{11})(?:\S+)?/;
    const match = url.match(regex);
    if (match && match[1]) {
        videoId = match[1];
    }
    return videoId;
}

// Basic HTML escape to prevent injection when inserting text into details
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"'`=\/]/g, function (s) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;','=':'&#61;','/':'&#47;'})[s];
    });
}

// Create a standardized close button for theater modes
function createCloseButton(label = 'Close') {
    const btn = document.createElement('button');
    btn.className = 'theater-close-btn';
    btn.type = 'button';
    btn.textContent = label;
    return btn;
}

function normalizeLaunchpadUrl(rawUrl) {
    if (!rawUrl) return '';
    let url = rawUrl.trim();
    if (
        (url.startsWith('"') && url.endsWith('"')) ||
        (url.startsWith("'") && url.endsWith("'"))
    ) {
        url = url.slice(1, -1).trim();
    }
    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.toString();
    } catch (error) {
        return '';
    }
}

function extractLaunchpadGoogleDriveFileId(rawUrl) {
    if (!rawUrl) return '';
    const raw = String(rawUrl).trim();
    const candidates = /^https?:\/\//i.test(raw) ? [raw] : [`https://${raw}`];

    for (const candidate of candidates) {
        try {
            const parsed = new URL(candidate);
            const pathname = decodeURIComponent(parsed.pathname || '');

            const fromQuery =
                parsed.searchParams.get('id') ||
                parsed.searchParams.get('fileId') ||
                '';
            if (fromQuery) return fromQuery.trim();

            const fileMatch = pathname.match(/\/file\/d\/([^/?#]+)/i);
            if (fileMatch?.[1]) return fileMatch[1];

            const genericMatch = pathname.match(/\/d\/([^/?#]+)/i);
            if (genericMatch?.[1]) return genericMatch[1];
        } catch (error) {
            // Fall through to regex fallback.
        }
    }

    const fallbackMatches = [
        raw.match(/\/file\/d\/([^/?#]+)/i),
        raw.match(/\/d\/([^/?#]+)/i),
        raw.match(/[?&]id=([^&?#]+)/i)
    ];
    for (const match of fallbackMatches) {
        if (match?.[1]) {
            return decodeURIComponent(match[1]).trim();
        }
    }

    return '';
}

function normalizeLaunchpadImageUrl(rawUrl) {
    const normalized = normalizeLaunchpadUrl(rawUrl);
    if (!normalized) return '';

    try {
        const parsed = new URL(normalized);
        const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        const isGoogleDriveHost =
            hostname === 'drive.google.com' ||
            hostname === 'docs.google.com' ||
            hostname.endsWith('.googleusercontent.com');
        if (!isGoogleDriveHost) return normalized;

        const fileId = extractLaunchpadGoogleDriveFileId(normalized) || extractLaunchpadGoogleDriveFileId(rawUrl);
        if (!fileId) {
            console.warn('Could not extract Google Drive file id from Launchpad image URL:', rawUrl);
            return normalized;
        }
        return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
    } catch (error) {
        return normalized;
    }
}

function getLaunchpadGoogleDriveImageFallbackUrls(rawUrl, normalizedUrl = '') {
    const fileId =
        extractLaunchpadGoogleDriveFileId(normalizedUrl) ||
        extractLaunchpadGoogleDriveFileId(rawUrl);
    if (!fileId) return [];

    const encodedId = encodeURIComponent(fileId);
    const candidates = [
        normalizedUrl || normalizeLaunchpadImageUrl(rawUrl),
        `https://drive.google.com/thumbnail?id=${encodedId}&sz=w1200`,
        `https://lh3.googleusercontent.com/d/${encodedId}=s1200`,
        `https://drive.google.com/uc?export=download&id=${encodedId}`
    ];

    const unique = [];
    const seen = new Set();
    candidates.forEach((candidate) => {
        const normalizedCandidate = normalizeLaunchpadUrl(candidate);
        if (!normalizedCandidate || seen.has(normalizedCandidate)) return;
        seen.add(normalizedCandidate);
        unique.push(normalizedCandidate);
    });

    return unique;
}

function launchpadHostLabel(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, '');
    } catch (error) {
        return 'Unknown Host';
    }
}

function initializeLaunchpadViewer() {
    const menuBtn = document.getElementById('launchpadViewerMenuBtn');
    const closeBtn = document.getElementById('launchpadCloseBtn');
    if (menuBtn && !menuBtn.dataset.bound) {
        menuBtn.dataset.bound = 'true';
        menuBtn.addEventListener('click', toggleSidebar);
    }
    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', () => {
            closeLaunchpadViewer();
        });
    }
}

function setLaunchpadFocusMode(isFocused) {
    const section = document.getElementById('launchpad-section');
    const container = document.getElementById('launchpad-container');
    const viewer = document.getElementById('launchpad-viewer');
    if (!section || !container || !viewer) return;

    if (launchpadViewerHideTimer) {
        clearTimeout(launchpadViewerHideTimer);
        launchpadViewerHideTimer = null;
    }

    if (isFocused) {
        document.body.classList.add('launchpad-plugin-active');
        viewer.classList.remove('hidden');
        container.setAttribute('aria-hidden', 'true');
        closeSidebar();
        requestAnimationFrame(() => {
            section.classList.add('plugin-open');
        });
        return;
    }

    document.body.classList.remove('launchpad-plugin-active');
    section.classList.remove('plugin-open');
    container.removeAttribute('aria-hidden');
    closeSidebar();
    launchpadViewerHideTimer = setTimeout(() => {
        if (!section.classList.contains('plugin-open')) {
            viewer.classList.add('hidden');
        }
    }, 320);
}

function closeLaunchpadViewer() {
    const viewer = document.getElementById('launchpad-viewer');
    const iframe = document.getElementById('launchpadIframe');
    if (!viewer || !iframe) return;

    setLaunchpadFocusMode(false);
    iframe.src = 'about:blank';
    launchpadActivePluginId = null;

    document.querySelectorAll('.launchpad-card').forEach((card) => {
        card.classList.remove('active');
    });
}

function openLaunchpadPlugin(plugin) {
    const viewer = document.getElementById('launchpad-viewer');
    const iframe = document.getElementById('launchpadIframe');
    const title = document.getElementById('launchpadViewerTitle');
    const host = document.getElementById('launchpadViewerHost');
    const icon = document.getElementById('launchpadViewerIcon');

    if (!viewer || !iframe || !title || !host || !icon) return;

    const pluginUrl = plugin.projectUrl || plugin.url || '';
    const pluginTitle = plugin.title || plugin.name || '';
    const pluginImage = normalizeLaunchpadImageUrl(plugin.imageUrl || plugin.image || '');
    const normalizedUrl = normalizeLaunchpadUrl(pluginUrl);
    if (!normalizedUrl) {
        console.warn('Invalid Launchpad plugin URL:', pluginUrl);
        return;
    }

    launchpadActivePluginId = plugin.id;

    title.textContent = pluginTitle || 'Untitled Plugin';
    host.textContent = launchpadHostLabel(normalizedUrl);
    icon.onerror = null;
    if (pluginImage) {
        const fallbackQueue = getLaunchpadGoogleDriveImageFallbackUrls(plugin.imageUrl || plugin.image || '', pluginImage);
        const initialSrc = normalizeLaunchpadUrl(pluginImage);
        const retryQueue = fallbackQueue.filter((candidate) => candidate !== initialSrc);
        icon.src = pluginImage;
        icon.onerror = () => {
            if (retryQueue.length) {
                const nextUrl = retryQueue.shift();
                console.warn('[Launchpad][Viewer] Retrying icon image with Google Drive fallback URL.', {
                    pluginId: plugin.id,
                    previousUrl: icon.currentSrc || pluginImage,
                    retryUrl: nextUrl
                });
                icon.src = nextUrl;
                return;
            }

            console.error('[Launchpad][Viewer] Failed to load plugin icon image.', {
                pluginId: plugin.id,
                imageUrl: pluginImage,
                note: 'Possible causes: invalid URL, Google Drive permissions, CORS/host restrictions.'
            });
            icon.onerror = null;
            icon.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2272%22 height=%2272%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23eef2f6%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 font-size=%2232%22 fill=%22%236b7280%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3E%2B%3C/text%3E%3C/svg%3E';
        };
    } else {
        icon.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2272%22 height=%2272%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23eef2f6%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 font-size=%2232%22 fill=%22%236b7280%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22%3E%2B%3C/text%3E%3C/svg%3E';
    }

    setLaunchpadFocusMode(true);
    iframe.src = normalizedUrl;
    try {
        viewer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        // Ignore scroll issues in older/embedded browsers.
    }

    document.querySelectorAll('.launchpad-card').forEach((card) => {
        const isActive = card.dataset.pluginId === plugin.id;
        card.classList.toggle('active', isActive);
    });
}

function renderLaunchpadCards(filteredPlugins) {
    const container = document.getElementById('launchpad-container');
    if (!container) return;

    container.innerHTML = '';

    if (!filteredPlugins.length) {
        const noDataText = launchpadSearchTerm
            ? `No Launchpad plugins match "${escapeHtml(launchpadSearchTerm)}".`
            : 'No Launchpad plugins available yet.';
        container.innerHTML = `<p class="text-center-message">${noDataText}</p>`;
        return;
    }

    filteredPlugins.forEach((plugin) => {
        const pluginTitle = plugin.title || plugin.name || '';
        const pluginImage = normalizeLaunchpadImageUrl(plugin.imageUrl || plugin.image || '');
        const pluginUrl = plugin.projectUrl || plugin.url || '';
        console.debug('[Launchpad][Frontend][Render] Plugin image URL:', {
            pluginId: plugin.id,
            storedImageUrl: plugin.imageUrl || plugin.image || '',
            normalizedImageUrl: pluginImage
        });
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'launchpad-card';
        button.dataset.pluginId = plugin.id;

        const mediaHtml = pluginImage
            ? `<img src="${escapeHtml(pluginImage)}" alt="${escapeHtml(pluginTitle || 'Plugin icon')}">`
            : '<i class="fas fa-book"></i>';

        const hostLabel = launchpadHostLabel(pluginUrl);
        button.innerHTML = `
            <div class="launchpad-card-media">${mediaHtml}</div>
            <h3>${escapeHtml(pluginTitle || 'Untitled Plugin')}</h3>
            <p>${escapeHtml(hostLabel)}</p>
        `;

        const cardImage = button.querySelector('.launchpad-card-media img');
        if (cardImage) {
            const fallbackQueue = getLaunchpadGoogleDriveImageFallbackUrls(plugin.imageUrl || plugin.image || '', pluginImage);
            const initialSrc = normalizeLaunchpadUrl(pluginImage);
            const retryQueue = fallbackQueue.filter((candidate) => candidate !== initialSrc);
            cardImage.addEventListener('error', () => {
                if (retryQueue.length) {
                    const nextUrl = retryQueue.shift();
                    console.warn('[Launchpad][Frontend] Retrying card image with Google Drive fallback URL.', {
                        pluginId: plugin.id,
                        previousUrl: cardImage.currentSrc || pluginImage,
                        retryUrl: nextUrl
                    });
                    cardImage.src = nextUrl;
                    return;
                }

                console.error('[Launchpad][Frontend] Launchpad card image failed to load.', {
                    pluginId: plugin.id,
                    imageUrl: pluginImage,
                    note: 'Possible causes: invalid URL, Google Drive file not shared publicly, or host/CORS restrictions.'
                });
                const mediaNode = button.querySelector('.launchpad-card-media');
                if (mediaNode) {
                    mediaNode.innerHTML = '<i class="fas fa-book"></i>';
                }
            });
        }

        button.addEventListener('click', () => {
            openLaunchpadPlugin(plugin);
        });

        if (plugin.id === launchpadActivePluginId) {
            button.classList.add('active');
        }

        container.appendChild(button);
    });
}

function applyLaunchpadFilter(searchTerm = '') {
    launchpadSearchTerm = searchTerm || '';
    const normalizedSearch = launchpadSearchTerm.toLowerCase();
    const filtered = launchpadPluginsCache.filter((plugin) => {
        const pluginTitle = plugin.title || plugin.name || '';
        const pluginUrl = plugin.projectUrl || plugin.url || '';
        const hostLabel = launchpadHostLabel(pluginUrl);
        return !normalizedSearch ||
            pluginTitle.toLowerCase().includes(normalizedSearch) ||
            pluginUrl.toLowerCase().includes(normalizedSearch) ||
            hostLabel.toLowerCase().includes(normalizedSearch);
    });

    renderLaunchpadCards(filtered);
}

function loadLaunchpadPlugins(searchTerm = '') {
    const container = document.getElementById('launchpad-container');
    if (!container) return;

    launchpadSearchTerm = searchTerm || '';

    if (!launchpadPluginsUnsubscribe) {
        container.innerHTML = '<p class="text-center-message">Loading Launchpad plugins...</p>';

        const publicPluginsQuery = query(
            launchpadPluginsCollectionRef,
            where("visibility", "==", "public")
        );

        launchpadPluginsUnsubscribe = onSnapshot(publicPluginsQuery, (snapshot) => {
            launchpadPluginsCache = [];

            snapshot.forEach((docSnapshot) => {
                const data = docSnapshot.data() || {};
                const normalizedImageUrl = normalizeLaunchpadImageUrl(data.imageUrl || data.image || '');
                if (normalizedImageUrl) {
                    console.debug('[Launchpad][Frontend][Snapshot] Normalized imageUrl from Firestore:', {
                        pluginId: docSnapshot.id,
                        imageUrl: normalizedImageUrl
                    });
                }
                launchpadPluginsCache.push({
                    id: docSnapshot.id,
                    title: data.title || data.name || '',
                    name: data.title || data.name || '',
                    imageUrl: normalizedImageUrl,
                    image: normalizedImageUrl,
                    projectUrl: normalizeLaunchpadUrl(data.projectUrl || data.url || '') || (data.projectUrl || data.url || ''),
                    url: normalizeLaunchpadUrl(data.projectUrl || data.url || '') || (data.projectUrl || data.url || ''),
                    visibility: (data.visibility || '').toLowerCase(),
                    createdBy: data.createdBy || '',
                    timestamp: data.timestamp || null
                });
            });

            launchpadPluginsCache.sort((a, b) => {
                const tsA = a.timestamp ? a.timestamp.toDate() : new Date(0);
                const tsB = b.timestamp ? b.timestamp.toDate() : new Date(0);
                return tsB - tsA;
            });

            applyLaunchpadFilter(launchpadSearchTerm);

            if (launchpadActivePluginId) {
                const activePlugin = launchpadPluginsCache.find((item) => item.id === launchpadActivePluginId);
                if (!activePlugin) {
                    closeLaunchpadViewer();
                }
            }
        }, (error) => {
            console.error('Error loading Launchpad plugins:', error);
            container.innerHTML = '<p class="text-center-message">Error loading Launchpad plugins.</p>';
        });
    } else {
        applyLaunchpadFilter(launchpadSearchTerm);
    }
}

/**
 * Loads and displays content for a specific section from Firestore.
 * Includes search, sorting, and handles compatibility with old documents.
 * @param {string} section - The content category (e.g., 'sermons').
 * @param {string} searchTerm - The search term to filter by.
 * @param {string} [filterDate=null] - Optional date string (YYYY-MM-DD) to filter content by eventDate.
 */
function loadContentFirebase(section, searchTerm = '', filterDate = null) {
    if (section === 'launchpad') {
        loadLaunchpadPlugins(searchTerm);
        return;
    }

    const contentContainer = document.getElementById(`${section}-container`);
    if (!contentContainer) {
        console.warn(`Content container for section "${section}" not found.`);
        return;
    }

    const state = getSectionState(section);
    const filtersChanged = state.searchTerm !== searchTerm || state.filterDate !== filterDate;
    state.searchTerm = searchTerm;
    state.filterDate = filterDate;
    if (filtersChanged) state.visibleCount = SECTION_PAGE_SIZE;

    if (state.unsubscribe) {
        renderSectionContent(section);
        return;
    }

    contentContainer.innerHTML = '<p class="text-center-message">Loading content...</p>';

    const q = query(contentCollectionRef, where("category", "==", section));

    state.unsubscribe = onSnapshot(q, (snapshot) => {
        const docs = [];
        snapshot.forEach(docSnapshot => {
            docs.push({ id: docSnapshot.id, data: docSnapshot.data() });
        });

        state.docs = docs
            .filter(docItem => docItem.data.isArchived === false || docItem.data.isArchived === undefined)
            .sort(sortByDateDesc);

        renderSectionContent(section);

    }, (error) => {
        console.error("Error fetching documents from Firestore: ", error);
        contentContainer.innerHTML = '<p class="text-center-message">Error loading content. Please check your internet connection and Firebase rules.</p>';
    });
}

function getFilteredSectionDocs(section) {
    const state = getSectionState(section);
    let filteredDocs = state.docs;
    if (state.searchTerm) {
        const lowerSearchTerm = state.searchTerm.toLowerCase();
        filteredDocs = filteredDocs.filter(docItem => {
            const item = docItem.data;
            return (item.title && item.title.toLowerCase().includes(lowerSearchTerm)) ||
                   (item.description && item.description.toLowerCase().includes(lowerSearchTerm)) ||
                   (item.topic && item.topic.toLowerCase().includes(lowerSearchTerm)) ||
                   (item.by && item.by.toLowerCase().includes(lowerSearchTerm));
        });
    }

    if (state.filterDate) {
        filteredDocs = filteredDocs.filter(docItem => docItem.data.eventDate === state.filterDate);
    }

    return filteredDocs;
}

function renderSectionContent(section) {
    const state = getSectionState(section);
    const contentContainer = document.getElementById(`${section}-container`);
    const loadMoreMount = document.getElementById(`${section}-load-more`);
    if (!contentContainer) return;

    const filteredDocs = getFilteredSectionDocs(section);
    const visibleDocs = filteredDocs.slice(0, state.visibleCount);

    contentContainer.innerHTML = '';
    if (loadMoreMount) loadMoreMount.innerHTML = '';

    if (filteredDocs.length === 0) {
        const message = `No content found in this category${state.searchTerm ? ` for "${state.searchTerm}"` : ''}${state.filterDate ? ` on ${formatDateLabel(state.filterDate)}` : ''}.`;
        contentContainer.innerHTML = `<p class="text-center-message">${message}</p>`;
        return;
    }

    visibleDocs.forEach(docItem => {
        renderContentItem(docItem, contentContainer, { section, list: filteredDocs });
    });

    const remaining = filteredDocs.length - visibleDocs.length;
    if (remaining > 0 && loadMoreMount) {
        loadMoreMount.appendChild(createLoadMoreButton(remaining, () => {
            state.visibleCount += SECTION_PAGE_SIZE;
            renderSectionContent(section);
        }));
    }

    populateVideoGrid(section, visibleDocs);
}

/**
 * Populate video grid for any media section (sermons, entertainment, bible-study, events)
 * Similar to loadHomeVideos but for other sections
 */
function populateVideoGrid(section, docs) {
    const grid = document.getElementById(`${section}VideoGrid`);
    if (!grid) return;
    
    grid.innerHTML = '';
    
    if (docs.length === 0) {
        grid.innerHTML = '<p class="text-center-message">No videos available.</p>';
        return;
    }
    
    docs.forEach((docItem) => {
        const thumb = renderHomeThumbnail(docItem);
        thumb.addEventListener('click', () => {
            openTheaterMode(section, docItem, docs);
        });
        grid.appendChild(thumb);
    });
}

/**
 * Renders a single content item into the specified container.
 * @param {Object} docItem - The document object from Firestore ({id, data}).
 * @param {HTMLElement} container - The DOM element to append the content item to.
 */
function renderContentItem(docItem, container, opts = {}) {
    const item = docItem.data;
    const contentItemDiv = document.createElement('div');
    contentItemDiv.classList.add('content-item');

    const youtubeId = item.url ? getYouTubeVideoId(item.url) : null;
    const thumbUrl = youtubeId
        ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
        : (item.thumbnailUrl || (item.url && item.url.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? item.url : 'https://via.placeholder.com/640x360.png?text=Media'));
    const dateLabel = formatDateLabel(getDisplayDate(docItem));

    contentItemDiv.innerHTML = `
        <div class="content-item-media">
            <img src="${thumbUrl}" alt="${item.title || 'Media thumbnail'}" loading="lazy">
            <span class="play-badge"><i class="fas fa-play" aria-hidden="true"></i></span>
        </div>
        <div class="content-item-date">${dateLabel}</div>
        <h3>${item.title}</h3>
        <p>${item.description || 'No description provided.'}</p>
        <div class="metadata">
            ${item.eventDate ? `<strong>Date:</strong> ${new Date(item.eventDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}<br>` : ''}
            ${item.eventTime ? `<strong>Time:</strong> ${item.eventTime}<br>` : ''}
            ${item.topic ? `<strong>Topic:</strong> ${item.topic}<br>` : ''}
            ${item.by ? `<strong>By:</strong> ${item.by}<br>` : ''}
        </div>
    `;
    container.appendChild(contentItemDiv);

    // Attach standardized click handler to open theater mode for this section
    try {
        const sectionName = opts.section || null;
        const listDocs = opts.list || null;
        contentItemDiv.addEventListener('click', (ev) => {
            // Prevent clicks on embedded media from triggering theater
            const tag = ev.target && ev.target.tagName ? ev.target.tagName.toLowerCase() : '';
            if (['iframe', 'video', 'audio', 'a', 'button'].includes(tag)) return;
            if (sectionName && listDocs) {
                document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));
                document.getElementById('home-section')?.classList.add('active');
                document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
                document.querySelector('.nav-item[data-section="home"]')?.classList.add('active');
                activeSection = 'home';
                openTheaterWithVideo(docItem, listDocs);
            } else {
                openSplitTheater(docItem, listDocs || [docItem]);
            }
        });
    } catch (e) {
        console.warn('Failed to attach theater click handler', e);
    }
}

/**
 * Open theater mode scoped to a specific section (e.g., 'sermons').
 * Left: large sticky player (70-75%). Right: YouTube-style sidebar showing only the videos from the provided list.
 */
function openTheaterMode(section, selectedDoc, listDocs) {
    const sectionEl = document.getElementById(`${section}-section`);
    const contentContainer = document.getElementById(`${section}-container`);
    if (!sectionEl || !contentContainer) return;

    // Remove any existing theater-mode inside this section
    const existing = sectionEl.querySelector('.theater-mode');
    if (existing) existing.remove();

    // Create wrapper and parts
    const wrapper = document.createElement('div');
    wrapper.className = 'theater-mode';

    const mainPlayer = document.createElement('div');
    mainPlayer.className = 'main-player';
    const sidebar = document.createElement('div');
    sidebar.className = 'sidebar-list';

    wrapper.appendChild(mainPlayer);
    wrapper.appendChild(sidebar);

    // Insert wrapper after welcome-card (if present), otherwise at top
    const welcomeCard = sectionEl.querySelector('.welcome-card');
    if (welcomeCard && welcomeCard.nextSibling) {
        sectionEl.insertBefore(wrapper, welcomeCard.nextSibling);
    } else {
        sectionEl.insertBefore(wrapper, sectionEl.firstChild);
    }

    // Hide the existing content container (we'll show the sidebar list instead)
    contentContainer.style.display = 'none';
    
    // Also hide the video grid when in theater mode
    const videoGrid = sectionEl.querySelector('.home-video-grid');
    if (videoGrid) videoGrid.style.display = 'none';

    // Populate main player with selected
    populateSplitPlayer(selectedDoc, mainPlayer);

    // Populate sidebar with other videos from listDocs
    sidebar.innerHTML = '';
    listDocs.forEach(doc => {
        if (doc.id === selectedDoc.id) return;
        const item = renderPlaylistThumb(doc);
        item.classList.add('sidebar-item');
        item.addEventListener('click', () => {
            // swap into main player
            populateSplitPlayer(doc, mainPlayer);
            // update active highlight
            Array.from(sidebar.querySelectorAll('.sidebar-item')).forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            // ensure player visible on small screens
            setTimeout(() => {
                const headerOffset = document.querySelector('.main-header') ? document.querySelector('.main-header').offsetHeight : 0;
                const topPos = mainPlayer.getBoundingClientRect().top + window.scrollY - headerOffset - 8;
                window.scrollTo({ top: topPos, behavior: 'smooth' });
            }, 40);
        });
        sidebar.appendChild(item);
    });

    // Add close button to main player for this section-scoped theater
    const existingClose = mainPlayer.querySelector('.theater-close-btn');
    if (existingClose) existingClose.remove();
    const closeBtn = createCloseButton('Close');
    closeBtn.addEventListener('click', () => {
        // remove wrapper
        wrapper.remove();
        // restore original content container
        contentContainer.style.display = '';
        // restore video grid
        const videoGrid = sectionEl.querySelector('.home-video-grid');
        if (videoGrid) videoGrid.style.display = '';
        // scroll to the section top
        setTimeout(() => {
            const headerOffset = document.querySelector('.main-header') ? document.querySelector('.main-header').offsetHeight : 0;
            const topPos = sectionEl.getBoundingClientRect().top + window.scrollY - headerOffset - 8;
            window.scrollTo({ top: topPos, behavior: 'smooth' });
        }, 40);
    });
    mainPlayer.appendChild(closeBtn);

    // initial highlight for selected (if present in sidebar not possible since excluded) - add selected to top of sidebar optionally
}

// ============================================
// ============================================

// Settings state management
const settingsState = {
    currentAction: 'profile',
    customization: {
        // Accent Colors
        primaryColor: '#3498db',
        secondaryColor: '#2c3e50',
        accentColor: '#f39c12',
        successColor: '#27ae60',
        errorColor: '#e74c3c',
        
        // Background Colors
        mainBg: '#f0f2f5',
        queenBg: '#ffffff',
        sidebarBg: '#2c3e50',
        cardBg: '#ffffff',
        playerBg: '#000000',
        
        // Text Colors
        textColor: '#333333',
        sidebarText: '#ffffff',
        textSecondary: '#666666',
        
        // Border & UI Colors
        borderColor: '#dddddd',
        inputBg: '#f8f9fa',
        searchBg: '#000000',
        
        // Display Options
        darkMode: false,
        animations: true,
        compactMode: false,
        
        // Layout Size
        sidebarWidth: 280,
        
        // Typography
        fontFamily: "'Inter', sans-serif",
        fontSize: 16
    },
    
    // Profile data
    profile: {
        name: '',
        email: '',
        ministry: '',
        bio: '',
        avatar: '',
        socialLinks: {
            website: '',
            youtube: '',
            instagram: '',
            twitter: '',
            facebook: ''
        }
    }
};

const LEGACY_PROFILE_STORAGE_KEY = 'ruiruProfile';
const GUEST_PROFILE_STORAGE_KEY = 'ruiruProfileGuest';

function getEmptyProfileState() {
    return {
        name: '',
        email: '',
        ministry: '',
        bio: '',
        avatar: '',
        socialLinks: {
            website: '',
            youtube: '',
            instagram: '',
            twitter: '',
            facebook: ''
        }
    };
}

// Load settings from localStorage
function loadSettings() {
    const saved = localStorage.getItem('ruiruMediaHouseSettings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            settingsState.customization = { ...settingsState.customization, ...parsed };
            applyCustomization();
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
    }
}

// Save settings to localStorage
function saveSettings() {
    localStorage.setItem('ruiruMediaHouseSettings', JSON.stringify(settingsState.customization));
    showSavedIndicator();
}

// Show saved indicator
function showSavedIndicator() {
    let indicator = document.querySelector('.saved-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.className = 'saved-indicator';
        indicator.innerHTML = '<i class="fas fa-check-circle"></i> Settings saved!';
        document.body.appendChild(indicator);
    }
    indicator.classList.add('show');
    setTimeout(() => {
        indicator.classList.remove('show');
    }, 2500);
}

// Apply customization to the live mirror
function applyCustomization() {
    const mirror = document.querySelector('.customization-mirror');
    const root = document.documentElement;
    const custom = settingsState.customization;
    
    // Apply all colors to CSS variables
    root.style.setProperty('--primary-color', custom.primaryColor);
    root.style.setProperty('--secondary-color', custom.secondaryColor);
    root.style.setProperty('--accent-color', custom.accentColor);
    root.style.setProperty('--success-color', custom.successColor);
    root.style.setProperty('--error-color', custom.errorColor);
    
    root.style.setProperty('--background-color', custom.mainBg);
    root.style.setProperty('--card-background', custom.cardBg);
    root.style.setProperty('--text-color', custom.textColor);
    root.style.setProperty('--text-secondary', custom.textSecondary);
    root.style.setProperty('--border-color', custom.borderColor);
    root.style.setProperty('--input-background', custom.inputBg);
    
    // Update mirror preview
    if (mirror) {
        mirror.style.setProperty('--queen-bg', custom.queenBg);
        mirror.style.setProperty('--sidebar-bg', custom.sidebarBg);
        mirror.style.setProperty('--sidebar-text', custom.sidebarText);
        mirror.style.setProperty('--player-bg', custom.playerBg);
        mirror.style.setProperty('--card-bg', custom.cardBg);
        mirror.style.setProperty('--text-color', custom.textColor);
    }
    
    // Apply to main page elements
    const mainHeader = document.querySelector('.main-header');
    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    const mainContentWrapper = document.querySelector('.main-content-wrapper');
    const heroPlayer = document.querySelector('.hero-player-content');
    const searchBar = document.querySelector('.search-bar');
    const contentSections = document.querySelectorAll('.content-section');
    
    if (mainHeader) mainHeader.style.background = custom.queenBg;
    if (sidebarWrapper) sidebarWrapper.style.background = custom.sidebarBg;
    if (mainContentWrapper) mainContentWrapper.style.background = custom.mainBg;
    if (heroPlayer) heroPlayer.style.background = custom.playerBg;
    if (searchBar) searchBar.style.background = custom.searchBg;
    
    contentSections.forEach(section => {
        if (section) section.style.background = custom.cardBg;
    });
    
    // Apply font settings
    if (custom.fontFamily) {
        document.body.style.fontFamily = custom.fontFamily;
    }
    if (custom.fontSize) {
        document.body.style.fontSize = custom.fontSize + 'px';
    }
    
    // Dark mode
    if (custom.darkMode) {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    
    // Save settings
    saveSettings();
}

// Update Joker menu active state
function updateJokerMenu(activeBtn) {
    // Desktop buttons
    document.querySelectorAll('.joker-cmd').forEach(btn => btn.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');
    
    // Mobile icons - sync with desktop
    const action = activeBtn ? activeBtn.dataset.action : null;
    if (action) {
        document.querySelectorAll('.joker-mobile-icon-container').forEach(icon => {
            icon.classList.remove('active');
            if (icon.dataset.action === action) {
                icon.classList.add('active');
            }
        });
    }
}

// Render Profile Section
function renderProfileSection() {
    const container = document.createElement('div');
    container.className = 'joker-action profile-section';
    container.innerHTML = `
        <h2><i class="fas fa-user"></i> Profile Settings</h2>
        
        <!-- Avatar Section -->
        <div class="avatar-upload">
            <div class="avatar-preview" id="avatarPreview">JD</div>
            <div>
                <input type="file" id="avatarInput" accept="image/*" style="display:none;">
                <button class="avatar-btn" id="avatarUploadBtn">Upload Photo</button>
                <p style="font-size:0.85em;color:#888;margin-top:8px;">JPG, PNG or GIF. Maximum allowed file size is 3MB.</p>
            </div>
        </div>
        
        <!-- Basic Info -->
        <div class="field">
            <label>Display Name</label>
            <input type="text" id="profileName" placeholder="Your display name">
        </div>
        <div class="field">
            <label>Email</label>
            <input type="email" id="profileEmail" placeholder="your@email.com">
        </div>
        <div class="field">
            <label>Ministry / Church Affiliation</label>
            <input type="text" id="profileMinistry" placeholder="Your church or ministry name">
        </div>
        <div class="field">
            <label>Bio</label>
            <textarea id="profileBio" rows="4" placeholder="Tell us about yourself..."></textarea>
        </div>
        
        <!-- Social Media Links -->
        <h3 style="margin-top:24px;margin-bottom:16px;font-size:1.1em;"><i class="fas fa-share-alt"></i> Social Media</h3>
        <div class="social-links">
            <div class="field social-field">
                <label><i class="fas fa-globe"></i> Website</label>
                <input type="url" id="socialWebsite" placeholder="https://yourwebsite.com">
            </div>
            <div class="field social-field">
                <label><i class="fab fa-youtube"></i> YouTube</label>
                <input type="url" id="socialYoutube" placeholder="https://youtube.com/@yourchannel">
            </div>
            <div class="field social-field">
                <label><i class="fab fa-instagram"></i> Instagram</label>
                <input type="url" id="socialInstagram" placeholder="https://instagram.com/yourusername">
            </div>
            <div class="field social-field">
                <label><i class="fab fa-twitter"></i> Twitter / X</label>
                <input type="url" id="socialTwitter" placeholder="https://twitter.com/yourusername">
            </div>
            <div class="field social-field">
                <label><i class="fab fa-facebook"></i> Facebook</label>
                <input type="url" id="socialFacebook" placeholder="https://facebook.com/yourpage">
            </div>
        </div>
        
        <button class="joker-submit" onclick="saveProfile()">Save Profile</button>
    `;
    
    // Add event listeners after DOM is ready
    setTimeout(() => {
        // Load saved profile data
        loadProfile();
        
        // Avatar upload button
        const avatarInput = document.getElementById('avatarInput');
        const avatarUploadBtn = document.getElementById('avatarUploadBtn');
        
        if (avatarUploadBtn && avatarInput) {
            avatarUploadBtn.addEventListener('click', () => {
                avatarInput.click();
            });
            
            avatarInput.addEventListener('change', (e) => {
                handleAvatarUpload(e.target);
            });
        }
        
        // Update avatar preview when name changes (if no avatar)
        const nameInput = document.getElementById('profileName');
        const avatarPreview = document.getElementById('avatarPreview');
        
        if (nameInput && avatarPreview && !settingsState.profile.avatar) {
            nameInput.addEventListener('input', (e) => {
                if (e.target.value && !settingsState.profile.avatar) {
                    avatarPreview.textContent = e.target.value.charAt(0).toUpperCase();
                }
            });
        }
    }, 0);
    
    return container;
}

function renderCustomizationSection() {
    const container = document.createElement('div');
    container.className = 'joker-action';
    container.innerHTML = `
        <h2><i class="fas fa-palette"></i> Customization Studio</h2>
        <div class="customization-studio">
            <div class="customization-controls">
                <h3><i class="fas fa-sliders-h"></i> Theme Colors</h3>
                
                <!-- Background Colors -->
                <div class="control-group">
                    <h4><i class="fas fa-square-full"></i> Background Colors</h4>
                    <div class="color-picker-wrapper">
                        <label>Main Background</label>
                        <input type="color" id="colorMainBg" value="${settingsState.customization.mainBg || '#f0f2f5'}">
                        <span class="color-value">${settingsState.customization.mainBg || '#f0f2f5'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Header Background</label>
                        <input type="color" id="colorQueenBg" value="${settingsState.customization.queenBg}">
                        <span class="color-value">${settingsState.customization.queenBg}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Sidebar Background</label>
                        <input type="color" id="colorSidebarBg" value="${settingsState.customization.sidebarBg}">
                        <span class="color-value">${settingsState.customization.sidebarBg}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Card Background</label>
                        <input type="color" id="colorCardBg" value="${settingsState.customization.cardBg || '#ffffff'}">
                        <span class="color-value">${settingsState.customization.cardBg || '#ffffff'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Player Background</label>
                        <input type="color" id="colorPlayerBg" value="${settingsState.customization.playerBg}">
                        <span class="color-value">${settingsState.customization.playerBg}</span>
                    </div>
                </div>
                
                <!-- Text Colors -->
                <div class="control-group">
                    <h4><i class="fas fa-font"></i> Text Colors</h4>
                    <div class="color-picker-wrapper">
                        <label>Main Text</label>
                        <input type="color" id="colorText" value="${settingsState.customization.textColor || '#333333'}">
                        <span class="color-value">${settingsState.customization.textColor || '#333333'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Sidebar Text</label>
                        <input type="color" id="colorSidebarText" value="${settingsState.customization.sidebarText || '#ffffff'}">
                        <span class="color-value">${settingsState.customization.sidebarText || '#ffffff'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Secondary Text</label>
                        <input type="color" id="colorTextSecondary" value="${settingsState.customization.textSecondary || '#666666'}">
                        <span class="color-value">${settingsState.customization.textSecondary || '#666666'}</span>
                    </div>
                </div>
                
                <!-- Accent Colors -->
                <div class="control-group">
                    <h4><i class="fas fa-star"></i> Accent Colors</h4>
                    <div class="color-picker-wrapper">
                        <label>Primary Color</label>
                        <input type="color" id="colorPrimary" value="${settingsState.customization.primaryColor}">
                        <span class="color-value">${settingsState.customization.primaryColor}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Secondary Color</label>
                        <input type="color" id="colorSecondary" value="${settingsState.customization.secondaryColor}">
                        <span class="color-value">${settingsState.customization.secondaryColor}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Accent/Highlight</label>
                        <input type="color" id="colorAccent" value="${settingsState.customization.accentColor || '#f39c12'}">
                        <span class="color-value">${settingsState.customization.accentColor || '#f39c12'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Success Color</label>
                        <input type="color" id="colorSuccess" value="${settingsState.customization.successColor || '#27ae60'}">
                        <span class="color-value">${settingsState.customization.successColor || '#27ae60'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Error Color</label>
                        <input type="color" id="colorError" value="${settingsState.customization.errorColor || '#e74c3c'}">
                        <span class="color-value">${settingsState.customization.errorColor || '#e74c3c'}</span>
                    </div>
                </div>
                
                <!-- Border & UI Colors -->
                <div class="control-group">
                    <h4><i class="fas fa-border-all"></i> Border & UI Colors</h4>
                    <div class="color-picker-wrapper">
                        <label>Border Color</label>
                        <input type="color" id="colorBorder" value="${settingsState.customization.borderColor || '#dddddd'}">
                        <span class="color-value">${settingsState.customization.borderColor || '#dddddd'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Input Background</label>
                        <input type="color" id="colorInputBg" value="${settingsState.customization.inputBg || '#f8f9fa'}">
                        <span class="color-value">${settingsState.customization.inputBg || '#f8f9fa'}</span>
                    </div>
                    <div class="color-picker-wrapper">
                        <label>Search Bar</label>
                        <input type="color" id="colorSearchBg" value="${settingsState.customization.searchBg || '#000000'}">
                        <span class="color-value">${settingsState.customization.searchBg}</span>
                    </div>
                </div>
                
                <!-- Display Options -->
                <div class="control-group">
                    <h4><i class="fas fa-display"></i> Display Options</h4>
                    <div class="toggle-wrapper">
                        <label>Dark Mode</label>
                        <label class="toggle-switch">
                            <input type="checkbox" id="toggleDarkMode" ${settingsState.customization.darkMode ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="toggle-wrapper">
                        <label>Animations</label>
                        <label class="toggle-switch">
                            <input type="checkbox" id="toggleAnimations" ${settingsState.customization.animations !== false ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="toggle-wrapper">
                        <label>Compact Mode</label>
                        <label class="toggle-switch">
                            <input type="checkbox" id="toggleCompact" ${settingsState.customization.compactMode ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                
                <!-- Layout Size -->
                <div class="control-group">
                    <h4><i class="fas fa-expand"></i> Layout Size</h4>
                    <div class="range-wrapper">
                        <label>Sidebar Width: <span class="range-value" id="sidebarWidthValue">${settingsState.customization.sidebarWidth || 280}px</span></label>
                        <input type="range" id="rangeSidebarWidth" min="200" max="400" value="${settingsState.customization.sidebarWidth || 280}">
                    </div>
                </div>
                
                <!-- Font Settings -->
                <div class="control-group">
                    <h4><i class="fas fa-font"></i> Typography</h4>
                    <div class="field">
                        <label>Font Family</label>
                        <select id="fontFamily">
                            <option value="'Inter', sans-serif" ${settingsState.customization.fontFamily === "'Inter', sans-serif" ? 'selected' : ''}>Inter (Default)</option>
                            <option value="'Arial', sans-serif" ${settingsState.customization.fontFamily === "'Arial', sans-serif" ? 'selected' : ''}>Arial</option>
                            <option value="'Helvetica', sans-serif" ${settingsState.customization.fontFamily === "'Helvetica', sans-serif" ? 'selected' : ''}>Helvetica</option>
                            <option value="'Georgia', serif" ${settingsState.customization.fontFamily === "'Georgia', serif" ? 'selected' : ''}>Georgia</option>
                            <option value="'Times New Roman', serif" ${settingsState.customization.fontFamily === "'Times New Roman', serif" ? 'selected' : ''}>Times New Roman</option>
                            <option value="'Courier New', monospace" ${settingsState.customization.fontFamily === "'Courier New', monospace" ? 'selected' : ''}>Courier New</option>
                        </select>
                    </div>
                    <div class="range-wrapper">
                        <label>Font Size: <span class="range-value" id="fontSizeValue">${settingsState.customization.fontSize || 16}px</span></label>
                        <input type="range" id="rangeFontSize" min="12" max="24" value="${settingsState.customization.fontSize || 16}">
                    </div>
                </div>
                
                <button class="joker-submit" onclick="saveCustomization()">Apply & Save</button>
                <button class="joker-submit" style="background:#95a5a6;margin-left:8px;" onclick="resetCustomization()">Reset to Default</button>
            </div>
            
            <div class="customization-mirror">
                <div class="mirror-header">
                    <span style="font-weight:bold;color:#333;">Ruiru Media House</span>
                    <div style="display:flex;gap:8px;">
                        <span style="width:32px;height:32px;background:#ddd;border-radius:50%;"></span>
                    </div>
                </div>
                <div class="mirror-sidebar"></div>
                <div class="mirror-content">
                    <div class="mirror-hero">
                        <i class="fas fa-play-circle" style="font-size:3em;opacity:0.7;"></i>
                    </div>
                    <div style="background:#fff;padding:16px;border-radius:8px;margin-bottom:12px;">
                        <h4 style="margin:0 0 8px 0;">Welcome Title</h4>
                        <p style="margin:0;color:#666;font-size:0.9em;">This is a preview of your content area...</p>
                    </div>
                </div>
                <div class="mirror-label">Live Preview</div>
            </div>
        </div>
    `;
    
    // Add color picker listeners
    setTimeout(() => {
        document.querySelectorAll('.color-picker-wrapper input[type="color"]').forEach(picker => {
            picker.addEventListener('input', (e) => {
                e.target.nextElementSibling.textContent = e.target.value;
                updateLivePreview();
            });
        });
        
        document.querySelectorAll('.toggle-wrapper input[type="checkbox"]').forEach(toggle => {
            toggle.addEventListener('change', updateLivePreview);
        });
        
        document.getElementById('rangeSidebarWidth')?.addEventListener('input', (e) => {
            document.getElementById('sidebarWidthValue').textContent = e.target.value + 'px';
            updateLivePreview();
        });
        
        document.getElementById('rangeFontSize')?.addEventListener('input', (e) => {
            document.getElementById('fontSizeValue').textContent = e.target.value + 'px';
            updateLivePreview();
        });
        
        document.getElementById('fontFamily')?.addEventListener('change', updateLivePreview);
    }, 0);
    
    return container;
}

// Update live preview based on controls
function updateLivePreview() {
    const custom = settingsState.customization;
    
    // Background Colors
    custom.mainBg = document.getElementById('colorMainBg')?.value || custom.mainBg;
    custom.queenBg = document.getElementById('colorQueenBg')?.value || custom.queenBg;
    custom.sidebarBg = document.getElementById('colorSidebarBg')?.value || custom.sidebarBg;
    custom.cardBg = document.getElementById('colorCardBg')?.value || custom.cardBg;
    custom.playerBg = document.getElementById('colorPlayerBg')?.value || custom.playerBg;
    
    // Text Colors
    custom.textColor = document.getElementById('colorText')?.value || custom.textColor;
    custom.sidebarText = document.getElementById('colorSidebarText')?.value || custom.sidebarText;
    custom.textSecondary = document.getElementById('colorTextSecondary')?.value || custom.textSecondary;
    
    // Accent Colors
    custom.primaryColor = document.getElementById('colorPrimary')?.value || custom.primaryColor;
    custom.secondaryColor = document.getElementById('colorSecondary')?.value || custom.secondaryColor;
    custom.accentColor = document.getElementById('colorAccent')?.value || custom.accentColor;
    custom.successColor = document.getElementById('colorSuccess')?.value || custom.successColor;
    custom.errorColor = document.getElementById('colorError')?.value || custom.errorColor;
    
    // Border & UI Colors
    custom.borderColor = document.getElementById('colorBorder')?.value || custom.borderColor;
    custom.inputBg = document.getElementById('colorInputBg')?.value || custom.inputBg;
    custom.searchBg = document.getElementById('colorSearchBg')?.value || custom.searchBg;
    
    // Display Options
    custom.darkMode = document.getElementById('toggleDarkMode')?.checked || false;
    custom.animations = document.getElementById('toggleAnimations')?.checked || true;
    custom.compactMode = document.getElementById('toggleCompact')?.checked || false;
    
    // Layout Size
    custom.sidebarWidth = document.getElementById('rangeSidebarWidth')?.value || 280;
    
    // Typography
    custom.fontFamily = document.getElementById('fontFamily')?.value || custom.fontFamily;
    custom.fontSize = document.getElementById('rangeFontSize')?.value || 16;
    
    applyCustomization();
}

// Render Security Section
function renderSecuritySection() {
    const container = document.createElement('div');
    container.className = 'joker-action security-section';
    container.innerHTML = `
        <h2><i class="fas fa-shield-alt"></i> Security Settings</h2>
        
        <div class="security-item">
            <div class="security-info">
                <h4>Two-Factor Authentication</h4>
                <p>Add an extra layer of security to your account</p>
            </div>
            <div class="security-status inactive">
                <i class="fas fa-times-circle"></i> Disabled
            </div>
        </div>
        
        <div class="security-item">
            <div class="security-info">
                <h4>Login Notifications</h4>
                <p>Get notified when someone logs into your account</p>
            </div>
            <div class="security-status active">
                <i class="fas fa-check-circle"></i> Active
            </div>
        </div>
        
        <div class="security-item">
            <div class="security-info">
                <h4>Session Management</h4>
                <p>View and manage your active sessions</p>
            </div>
            <button style="padding:8px 16px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;cursor:pointer;">Manage</button>
        </div>
        
        <div class="field" style="margin-top:24px;">
            <label>Current Password</label>
            <input type="password" id="securityCurrentPass" placeholder="Enter current password">
        </div>
        <div class="field">
            <label>New Password</label>
            <input type="password" id="securityNewPass" placeholder="Enter new password">
        </div>
        <div class="field">
            <label>Confirm Password</label>
            <input type="password" id="securityConfirmPass" placeholder="Confirm new password">
        </div>
        
        <button class="joker-submit" onclick="updateSecurity()">Update Password</button>
    `;
    return container;
}

// Save Profile
function saveProfile() {
    const authenticatedEmail = auth.currentUser?.email || '';
    const profile = {
        name: document.getElementById('profileName')?.value || '',
        email: authenticatedEmail || document.getElementById('profileEmail')?.value || '',
        ministry: document.getElementById('profileMinistry')?.value || '',
        bio: document.getElementById('profileBio')?.value || '',
        avatar: settingsState.profile.avatar || '',
        socialLinks: {
            website: document.getElementById('socialWebsite')?.value || '',
            youtube: document.getElementById('socialYoutube')?.value || '',
            instagram: document.getElementById('socialInstagram')?.value || '',
            twitter: document.getElementById('socialTwitter')?.value || '',
            facebook: document.getElementById('socialFacebook')?.value || ''
        }
    };
    
    settingsState.profile = profile;
    persistProfileToLocalStorage();
    updateProfileAvatarUI(profile.avatar || '');
    persistProfileToBackend(profile.avatar || '');
    
    showSavedIndicator();
}

// Reset Customization to Defaults
function resetCustomization() {
    settingsState.customization = {
        primaryColor: '#3498db',
        secondaryColor: '#2c3e50',
        accentColor: '#f39c12',
        successColor: '#27ae60',
        errorColor: '#e74c3c',
        mainBg: '#f0f2f5',
        queenBg: '#ffffff',
        sidebarBg: '#2c3e50',
        cardBg: '#ffffff',
        playerBg: '#000000',
        textColor: '#333333',
        sidebarText: '#ffffff',
        textSecondary: '#666666',
        borderColor: '#dddddd',
        inputBg: '#f8f9fa',
        searchBg: '#000000',
        darkMode: false,
        animations: true,
        compactMode: false,
        sidebarWidth: 280,
        fontFamily: "'Inter', sans-serif",
        fontSize: 16
    };
    
    // Re-render customization section
    renderJokerDetails('customization');
    applyCustomization();
    showSavedIndicator();
}

// Load Profile from localStorage
function loadProfile() {
    if (auth.currentUser) {
        applyProfileStateToForm();
        return;
    }

    let parsed = null;
    const savedGuest = localStorage.getItem(GUEST_PROFILE_STORAGE_KEY);
    if (savedGuest) {
        try {
            parsed = JSON.parse(savedGuest);
        } catch (e) {
            console.warn('Failed to parse guest profile cache:', e);
        }
    } else {
        // One-time migration path for older guests (email intentionally excluded).
        const legacy = localStorage.getItem(LEGACY_PROFILE_STORAGE_KEY);
        if (legacy) {
            try {
                parsed = JSON.parse(legacy);
            } catch (e) {
                console.warn('Failed to parse legacy profile cache:', e);
            }
            localStorage.removeItem(LEGACY_PROFILE_STORAGE_KEY);
        }
    }

    if (parsed) {
        settingsState.profile = {
            ...getEmptyProfileState(),
            ...settingsState.profile,
            ...parsed,
            email: '',
            socialLinks: {
                ...getEmptyProfileState().socialLinks,
                ...settingsState.profile.socialLinks,
                ...(parsed.socialLinks || {})
            }
        };
    }

    applyProfileStateToForm();
}

// Apply avatar to visible profile UI surfaces
function updateProfileAvatarUI(avatarRef) {
    document.querySelectorAll('#avatarPreview, .avatar-preview').forEach((avatarPreview) => {
        if (avatarRef) {
            avatarPreview.style.backgroundImage = `url(${avatarRef})`;
            avatarPreview.style.backgroundSize = 'cover';
            avatarPreview.style.backgroundPosition = 'center';
            avatarPreview.style.backgroundRepeat = 'no-repeat';
            avatarPreview.textContent = '';
        } else {
            avatarPreview.style.backgroundImage = '';
            avatarPreview.style.backgroundSize = '';
            avatarPreview.style.backgroundPosition = '';
            avatarPreview.style.backgroundRepeat = '';
            if (settingsState.profile.name) {
                avatarPreview.textContent = settingsState.profile.name.charAt(0).toUpperCase();
            }
        }
    });

    // Mirror avatar in header/profile chips if present.
    document.querySelectorAll('.profile-circle').forEach((el) => {
        if (avatarRef) {
            el.style.backgroundImage = `url(${avatarRef})`;
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
            el.style.backgroundRepeat = 'no-repeat';
            el.textContent = '';
        } else {
            el.style.backgroundImage = '';
            el.style.backgroundSize = '';
            el.style.backgroundPosition = '';
            el.style.backgroundRepeat = '';
        }
    });
}

function applyProfileStateToForm() {
    const nameField = document.getElementById('profileName');
    const emailField = document.getElementById('profileEmail');
    const ministryField = document.getElementById('profileMinistry');
    const bioField = document.getElementById('profileBio');

    if (nameField) nameField.value = settingsState.profile.name || '';
    if (emailField) emailField.value = auth.currentUser?.email || settingsState.profile.email || '';
    if (ministryField) ministryField.value = settingsState.profile.ministry || '';
    if (bioField) bioField.value = settingsState.profile.bio || '';

    updateProfileAvatarUI(settingsState.profile.avatar || '');

    const socialFields = ['website', 'youtube', 'instagram', 'twitter', 'facebook'];
    socialFields.forEach(field => {
        const input = document.getElementById(`social${field.charAt(0).toUpperCase() + field.slice(1)}`);
        if (input && settingsState.profile.socialLinks) {
            input.value = settingsState.profile.socialLinks[field] || '';
        }
    });
}

function resetProfileState() {
    settingsState.profile = getEmptyProfileState();
    applyProfileStateToForm();
}

function persistProfileToLocalStorage() {
    if (auth.currentUser) {
        localStorage.removeItem(GUEST_PROFILE_STORAGE_KEY);
        localStorage.removeItem(LEGACY_PROFILE_STORAGE_KEY);
        return;
    }

    const guestProfile = {
        name: settingsState.profile.name || '',
        ministry: settingsState.profile.ministry || '',
        bio: settingsState.profile.bio || '',
        avatar: settingsState.profile.avatar || '',
        socialLinks: {
            ...getEmptyProfileState().socialLinks,
            ...(settingsState.profile.socialLinks || {})
        }
    };

    localStorage.setItem(GUEST_PROFILE_STORAGE_KEY, JSON.stringify(guestProfile));
}

async function persistProfileToBackend(avatarRef) {
    if (!auth?.currentUser) return avatarRef;

    const resolvedAvatar = avatarRef || settingsState.profile.avatar || '';
    const resolvedEmail = auth.currentUser.email || settingsState.profile.email || '';
    const resolvedName = settingsState.profile.name || auth.currentUser.displayName || '';
    const safeSocial = {
        ...getEmptyProfileState().socialLinks,
        ...(settingsState.profile.socialLinks || {})
    };

    settingsState.profile = {
        ...getEmptyProfileState(),
        ...settingsState.profile,
        name: resolvedName,
        email: resolvedEmail,
        avatar: resolvedAvatar,
        socialLinks: safeSocial
    };

    try {
        const userRef = doc(db, "users", auth.currentUser.uid);
        const payload = {
            uid: auth.currentUser.uid,
            email: resolvedEmail,
            username: resolvedName,
            avatar: resolvedAvatar,
            profile: {
                ...settingsState.profile,
                avatar: resolvedAvatar,
                email: resolvedEmail,
                name: resolvedName,
                socialLinks: safeSocial
            },
            profileUpdatedAt: new Date().toISOString()
        };
        await setDoc(userRef, payload, { merge: true });
    } catch (e) {
        console.warn('Failed to sync profile to backend:', e);
    }
    return resolvedAvatar;
}

async function loadProfileFromBackend(user) {
    if (!user) return;
    try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = snap.exists() ? (snap.data() || {}) : {};
        const backendProfile = (data.profile && typeof data.profile === 'object') ? data.profile : {};
        const baseProfile = getEmptyProfileState();

        settingsState.profile = {
            ...baseProfile,
            ...settingsState.profile,
            ...backendProfile,
            name: backendProfile.name || data.username || user.displayName || settingsState.profile.name || '',
            email: user.email || backendProfile.email || data.email || settingsState.profile.email || '',
            avatar: backendProfile.avatar || data.avatar || user.photoURL || settingsState.profile.avatar || '',
            socialLinks: {
                ...baseProfile.socialLinks,
                ...settingsState.profile.socialLinks,
                ...(backendProfile.socialLinks || {})
            }
        };

        await persistProfileToBackend(settingsState.profile.avatar);
        localStorage.removeItem(GUEST_PROFILE_STORAGE_KEY);
        localStorage.removeItem(LEGACY_PROFILE_STORAGE_KEY);
        applyProfileStateToForm();
    } catch (e) {
        console.warn('Failed to load profile from backend:', e);
    }
}

async function dataUrlToAvatarFile(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const ext = (blob.type && blob.type.includes('png')) ? 'png' : 'jpg';
    const mime = blob.type || 'image/jpeg';
    return new File([blob], `profile-cropped-${Date.now()}.${ext}`, { type: mime });
}

function replaceAvatarInputFile(file) {
    const avatarInput = document.getElementById('avatarInput');
    if (!avatarInput || !file || typeof DataTransfer === 'undefined') return;
    try {
        const dt = new DataTransfer();
        dt.items.add(file);
        avatarInput.files = dt.files;
    } catch (e) {
        console.warn('Failed to replace avatar input file:', e);
    }
}

function resolveAvatarUploadRef(uploadResult, fallbackRef) {
    if (!uploadResult) return fallbackRef;
    if (typeof uploadResult === 'string') return uploadResult;
    if (typeof uploadResult === 'object') {
        return uploadResult.url || uploadResult.avatarUrl || uploadResult.imageUrl || uploadResult.path || fallbackRef;
    }
    return fallbackRef;
}

async function uploadAvatarViaExistingPipeline(croppedFile, fallbackRef) {
    const existingUpload =
        window.uploadProfileAvatar ||
        window.uploadAvatar ||
        window.uploadProfileImage ||
        window.handleProfileImageUpload;

    if (typeof existingUpload !== 'function') {
        return fallbackRef;
    }

    try {
        const uploadResult = await existingUpload(croppedFile);
        return resolveAvatarUploadRef(uploadResult, fallbackRef);
    } catch (e) {
        console.warn('Existing avatar upload handler failed; falling back to local image ref:', e);
        return fallbackRef;
    }
}

// Handle avatar upload - Opens crop modal instead of direct upload
function handleAvatarUpload(input) {
    const file = input.files[0];
    if (file) {
        if (file.size > 3 * 1024 * 1024) {
            alert('Maximum allowed file size is 3MB.');
            return;
        }
        
        // Store the file for later use after crop
        window.pendingAvatarFile = file;
        
        // Read the file and open the crop modal
        const reader = new FileReader();
        reader.onload = function(e) {
            window.pendingAvatarDataUrl = e.target.result;
            openImageCropModal(e.target.result);
        };
        reader.readAsDataURL(file);
    }
}

// Image Crop Modal State
const cropState = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    dragPointerId: null,
    startX: 0,
    startY: 0,
    imageWidth: 0,
    imageHeight: 0,
    renderWidth: 0,
    renderHeight: 0,
    containerWidth: 0,
    containerHeight: 0,
    teardown: null
};

// Open the image crop modal
function openImageCropModal(imageSrc) {
    // Remove existing modal if any
    const existingModal = document.getElementById('imageCropModalOverlay');
    if (existingModal) {
        if (typeof cropState.teardown === 'function') {
            cropState.teardown();
            cropState.teardown = null;
        }
        existingModal.remove();
    }
    
    // Reset crop state
    cropState.scale = 1;
    cropState.translateX = 0;
    cropState.translateY = 0;
    cropState.isDragging = false;
    cropState.dragPointerId = null;
    cropState.renderWidth = 0;
    cropState.renderHeight = 0;
    
    // Create modal HTML - clear inside circle, blurry outside
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'imageCropModalOverlay';
    modalOverlay.className = 'image-crop-modal-overlay';
    modalOverlay.innerHTML = `
        <div class="image-crop-modal">
            <h3>Adjust Your Photo</h3>
            <div class="crop-main-container" id="cropMainContainer">
                <!-- Blur layer behind - shows blurry version outside circle -->
                <div class="crop-blur-effect" id="cropBlurEffect">
                    <img src="${imageSrc}" id="cropBlurImage" alt="">
                </div>
                <!-- Main draggable image area -->
                <div class="crop-image-area" id="cropImageArea">
                    <img src="${imageSrc}" class="crop-main-image" id="cropMainImage" alt="Crop preview">
                </div>
                <!-- Radial gradient overlay to create blur effect outside circle -->
                <div class="crop-blur-overlay" id="cropBlurOverlay"></div>
                <!-- Circular frame border -->
                <div class="crop-circle-border" id="cropCircleBorder"></div>
            </div>
            <div class="zoom-control">
                <label>
                    Zoom
                    <span id="zoomValue">100%</span>
                </label>
                <input type="range" class="zoom-slider" id="zoomSlider" 
                    min="0" max="500" step="1" value="100">
            </div>
            <div class="crop-buttons">
                <button class="crop-btn cancel" id="cropCancelBtn">Cancel</button>
                <button class="crop-btn save" id="cropSaveBtn">Save Photo</button>
            </div>
            <p class="crop-hint"></p>
        </div>
    `;
    
    document.body.appendChild(modalOverlay);
    
    // Initialize the crop functionality
    initializeCropModal();
}

// Initialize crop modal interactions
function initializeCropModal() {
    const container = document.getElementById('cropImageArea');
    const image = document.getElementById('cropMainImage');
    const mainContainer = document.getElementById('cropMainContainer');
    const blurImage = document.getElementById('cropBlurImage');
    const circleBorder = document.getElementById('cropCircleBorder');
    const zoomSlider = document.getElementById('zoomSlider');
    const zoomValue = document.getElementById('zoomValue');
    const cancelBtn = document.getElementById('cropCancelBtn');
    const saveBtn = document.getElementById('cropSaveBtn');
    const modalOverlay = document.getElementById('imageCropModalOverlay');
    
    if (!container || !image || !mainContainer || !zoomSlider || !zoomValue || !cancelBtn || !saveBtn || !modalOverlay) {
        return;
    }
    
    const syncContainerMetrics = function() {
        cropState.containerWidth = mainContainer.clientWidth || mainContainer.offsetWidth || 500;
        cropState.containerHeight = mainContainer.clientHeight || mainContainer.offsetHeight || 350;
    };
    syncContainerMetrics();
    
    // Initialize image position when it loads
    const initImage = function() {
        cropState.imageWidth = image.naturalWidth;
        cropState.imageHeight = image.naturalHeight;
        
        if (!cropState.imageWidth || !cropState.imageHeight) return;
        
        syncContainerMetrics();
        const circleDiameter = (circleBorder && circleBorder.offsetWidth) || 200;
        
        // Base fit: image always covers the crop circle at 100% zoom.
        const baseScale = Math.max(
            circleDiameter / cropState.imageWidth,
            circleDiameter / cropState.imageHeight
        );
        cropState.renderWidth = cropState.imageWidth * baseScale;
        cropState.renderHeight = cropState.imageHeight * baseScale;
        
        cropState.scale = 1;
        zoomSlider.value = 100;
        zoomValue.textContent = '100%';
        
        // Center the image
        cropState.translateX = (cropState.containerWidth - cropState.renderWidth) / 2;
        cropState.translateY = (cropState.containerHeight - cropState.renderHeight) / 2;
        
        image.style.width = `${cropState.renderWidth}px`;
        image.style.height = `${cropState.renderHeight}px`;
        if (blurImage) {
            blurImage.style.width = `${cropState.renderWidth}px`;
            blurImage.style.height = `${cropState.renderHeight}px`;
        }
        
        updateImageTransform();
    };
    
    if (image.complete) {
        initImage();
    } else {
        image.onload = initImage;
    }
    
    // Drag functionality (mouse + touch via pointer events)
    const startDrag = function(e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        cropState.isDragging = true;
        cropState.dragPointerId = e.pointerId;
        
        const clientX = e.clientX;
        const clientY = e.clientY;
        
        cropState.startX = clientX - cropState.translateX;
        cropState.startY = clientY - cropState.translateY;
        
        mainContainer.style.cursor = 'grabbing';
        if (mainContainer.setPointerCapture) {
            mainContainer.setPointerCapture(e.pointerId);
        }
    };
    
    const doDrag = function(e) {
        if (!cropState.isDragging) return;
        if (cropState.dragPointerId !== null && e.pointerId !== cropState.dragPointerId) return;
        e.preventDefault();
        
        const clientX = e.clientX;
        const clientY = e.clientY;
        
        // Keep drag state independent from zoom state.
        cropState.translateX = clientX - cropState.startX;
        cropState.translateY = clientY - cropState.startY;
        
        updateImageTransform();
    };
    
    const endDrag = function(e) {
        if (cropState.dragPointerId !== null && e.pointerId !== cropState.dragPointerId) return;
        cropState.isDragging = false;
        cropState.dragPointerId = null;
        mainContainer.style.cursor = 'grab';
    };
    
    mainContainer.style.cursor = 'grab';
    container.addEventListener('pointerdown', startDrag);
    window.addEventListener('pointermove', doDrag, { passive: false });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    
    // Zoom updates scale only, preserving translateX/translateY.
    const onZoomInput = function() {
        const sliderValue = parseFloat(this.value);
        const newScale = Math.max(0.05, sliderValue / 100);
        const previousScale = cropState.scale || 1;
        if (!isFinite(newScale) || !isFinite(previousScale) || previousScale <= 0) return;
        
        const centerX = cropState.containerWidth / 2;
        const centerY = cropState.containerHeight / 2;
        
        const currentCenterX = cropState.translateX + (cropState.renderWidth * previousScale) / 2;
        const currentCenterY = cropState.translateY + (cropState.renderHeight * previousScale) / 2;
        
        const offsetX = currentCenterX - centerX;
        const offsetY = currentCenterY - centerY;
        
        const zoomRatio = newScale / previousScale;
        const newOffsetX = offsetX * zoomRatio;
        const newOffsetY = offsetY * zoomRatio;
        
        cropState.translateX = centerX - (cropState.renderWidth * newScale) / 2 + newOffsetX;
        cropState.translateY = centerY - (cropState.renderHeight * newScale) / 2 + newOffsetY;
        
        cropState.scale = newScale;
        zoomValue.textContent = `${Math.round(sliderValue)}%`;
        
        updateImageTransform();
    };
    zoomSlider.addEventListener('input', onZoomInput);
    
    // Cancel button
    const onCancel = function() {
        closeCropModal();
        const avatarInput = document.getElementById('avatarInput');
        if (avatarInput) {
            avatarInput.value = '';
        }
    };
    cancelBtn.addEventListener('click', onCancel);
    
    // Save button
    const onSave = async function() {
        const croppedDataUrl = cropImage();
        if (croppedDataUrl) {
            await applyCroppedAvatar(croppedDataUrl);
            closeCropModal();
        }
    };
    saveBtn.addEventListener('click', onSave);
    
    // Close on overlay click
    const onOverlayClick = function(e) {
        if (e.target === modalOverlay) {
            closeCropModal();
            const avatarInput = document.getElementById('avatarInput');
            if (avatarInput) {
                avatarInput.value = '';
            }
        }
    };
    modalOverlay.addEventListener('click', onOverlayClick);
    
    // ESC key to close
    const escHandler = function(e) {
        if (e.key === 'Escape') {
            closeCropModal();
            const avatarInput = document.getElementById('avatarInput');
            if (avatarInput) {
                avatarInput.value = '';
            }
        }
    };
    document.addEventListener('keydown', escHandler);
    
    const onWindowResize = function() {
        syncContainerMetrics();
    };
    window.addEventListener('resize', onWindowResize);
    
    cropState.teardown = function() {
        container.removeEventListener('pointerdown', startDrag);
        window.removeEventListener('pointermove', doDrag);
        window.removeEventListener('pointerup', endDrag);
        window.removeEventListener('pointercancel', endDrag);
        zoomSlider.removeEventListener('input', onZoomInput);
        cancelBtn.removeEventListener('click', onCancel);
        saveBtn.removeEventListener('click', onSave);
        modalOverlay.removeEventListener('click', onOverlayClick);
        document.removeEventListener('keydown', escHandler);
        window.removeEventListener('resize', onWindowResize);
    };
}

// Update image transform
function updateImageTransform() {
    const image = document.getElementById('cropMainImage');
    const blurImage = document.getElementById('cropBlurImage');
    
    if (image) {
        const transform = `translate(${cropState.translateX}px, ${cropState.translateY}px) scale(${cropState.scale})`;
        image.style.transform = transform;
        if (blurImage) {
            blurImage.style.transform = transform;
        }
    }
}

// Crop the image to a square (circular area)
function cropImage() {
    const image = document.getElementById('cropMainImage');
    const mainContainer = document.getElementById('cropMainContainer');
    const circleBorder = document.getElementById('cropCircleBorder');
    
    if (!image || !mainContainer) return null;
    
    const containerWidth = mainContainer.offsetWidth;
    const containerHeight = mainContainer.offsetHeight;
    const circleDiameter = (circleBorder && circleBorder.offsetWidth) || 200;
    const exportSize = 1024; // Preserve high detail in final avatar.
    
    // Create canvas for cropping
    const canvas = document.createElement('canvas');
    canvas.width = exportSize;
    canvas.height = exportSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Create circular clipping path
    ctx.beginPath();
    ctx.arc(exportSize / 2, exportSize / 2, exportSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    
    // Map the visible crop circle to the export canvas.
    const circleLeft = (containerWidth - circleDiameter) / 2;
    const circleTop = (containerHeight - circleDiameter) / 2;
    const scaleRatio = exportSize / circleDiameter;
    
    const imageScaledWidth = (cropState.renderWidth || cropState.imageWidth) * cropState.scale;
    const imageScaledHeight = (cropState.renderHeight || cropState.imageHeight) * cropState.scale;
    
    const imageX = (cropState.translateX - circleLeft) * scaleRatio;
    const imageY = (cropState.translateY - circleTop) * scaleRatio;
    const imageDisplayWidth = imageScaledWidth * scaleRatio;
    const imageDisplayHeight = imageScaledHeight * scaleRatio;
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Draw the image
    ctx.drawImage(
        image,
        imageX,
        imageY,
        imageDisplayWidth,
        imageDisplayHeight
    );
    
    // Return as data URL
    return canvas.toDataURL('image/jpeg', 0.92);
}

// Apply the cropped avatar
async function applyCroppedAvatar(croppedDataUrl) {
    if (!croppedDataUrl) return;

    let croppedFile = null;
    try {
        croppedFile = await dataUrlToAvatarFile(croppedDataUrl);
    } catch (e) {
        console.warn('Failed to convert cropped avatar to file:', e);
    }

    if (croppedFile) {
        replaceAvatarInputFile(croppedFile);
        window.pendingAvatarFile = croppedFile;
    }

    // Use existing upload flow if one exists; fallback to cropped data URL.
    const finalAvatarRef = croppedFile
        ? await uploadAvatarViaExistingPipeline(croppedFile, croppedDataUrl)
        : croppedDataUrl;

    settingsState.profile.avatar = finalAvatarRef;
    updateProfileAvatarUI(finalAvatarRef);
    persistProfileToLocalStorage();
    await persistProfileToBackend(finalAvatarRef);

    window.pendingAvatarDataUrl = finalAvatarRef;
}

// Close the crop modal
function closeCropModal() {
    if (typeof cropState.teardown === 'function') {
        cropState.teardown();
        cropState.teardown = null;
    }
    cropState.isDragging = false;
    cropState.dragPointerId = null;
    
    const modal = document.getElementById('imageCropModalOverlay');
    if (modal) {
        modal.remove();
    }
    
    // Clear pending data
    window.pendingAvatarFile = null;
    window.pendingAvatarDataUrl = null;
}

// Save Customization
function saveCustomization() {
    updateLivePreview();
    saveSettings();
}

// Update Security
function updateSecurity() {
    const currentPass = document.getElementById('securityCurrentPass')?.value;
    const newPass = document.getElementById('securityNewPass')?.value;
    const confirmPass = document.getElementById('securityConfirmPass')?.value;
    
    if (!currentPass || !newPass || !confirmPass) {
        alert('Please fill in all password fields');
        return;
    }
    
    if (newPass !== confirmPass) {
        alert('New passwords do not match');
        return;
    }
    
    showRegistrationModal(true, 'Password updated.');
    document.getElementById('securityCurrentPass').value = '';
    document.getElementById('securityNewPass').value = '';
    document.getElementById('securityConfirmPass').value = '';
}

// ============================================
// FIREBASE AUTHENTICATION
// ============================================

// Register user with Firebase
async function registerUser(email, username, password) {
    try {
        // Create user with email and password
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        const normalizedName = (username || '').trim();
        
        if (normalizedName) {
            try {
                await updateProfile(user, { displayName: normalizedName });
            } catch (e) {
                console.warn('Failed to set Firebase display name:', e);
            }
        }
        
        // Save additional user data to Firestore
        const userData = {
            uid: user.uid,
            email: user.email || email,
            username: normalizedName,
            avatar: user.photoURL || '',
            profile: {
                ...getEmptyProfileState(),
                name: normalizedName,
                email: user.email || email,
                avatar: user.photoURL || ''
            },
            createdAt: new Date().toISOString(),
            profileUpdatedAt: new Date().toISOString()
        };
        
        await setDoc(doc(db, "users", user.uid), userData, { merge: true });
        await loadProfileFromBackend(user);
        
        return { success: true, message: "Account created successfully! Welcome, " + (normalizedName || user.email) };
    } catch (error) {
        const errorCode = error.code;
        let errorMessage = error.message;
        
        if (errorCode === 'auth/email-already-in-use') {
            errorMessage = "This email is already registered. Please login instead.";
        } else if (errorCode === 'auth/invalid-email') {
            errorMessage = "Invalid email address format.";
        } else if (errorCode === 'auth/weak-password') {
            errorMessage = "Password should be at least 6 characters.";
        }
        
        return { success: false, message: errorMessage };
    }
}

// Login user with Firebase
async function loginUser(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        await loadProfileFromBackend(userCredential.user);
        return { success: true, message: "Login successful! Welcome back." };
    } catch (error) {
        const errorCode = error.code;
        let errorMessage = error.message;
        
        if (errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
            errorMessage = "Invalid email or password.";
        } else if (errorCode === 'auth/invalid-email') {
            errorMessage = "Invalid email address.";
        }
        
        return { success: false, message: errorMessage };
    }
}

// Logout user
async function logoutUser() {
    try {
        await signOut(auth);
        return { success: true, message: "Logged out successfully." };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

async function requestPasswordReset(email) {
    const normalizedEmail = (email || '').trim();
    if (!normalizedEmail) {
        return { success: false, message: 'Please enter your email address first.' };
    }

    try {
        await sendPasswordResetEmail(auth, normalizedEmail);
        return { success: true, message: 'Password reset link sent. Check your email inbox.' };
    } catch (error) {
        const errorCode = error.code;
        let errorMessage = error.message;
        if (errorCode === 'auth/user-not-found') {
            errorMessage = 'No account found with that email.';
        } else if (errorCode === 'auth/invalid-email') {
            errorMessage = 'Invalid email address.';
        }
        return { success: false, message: errorMessage };
    }
}

// Render Auth Form
function renderAuthForm(container, action) {
    const isLogin = action === 'login';
    
    container.innerHTML = `
        <h2><i class="fas fa-${isLogin ? 'sign-in-alt' : 'user-plus'}"></i> ${isLogin ? 'Login' : 'Register'}</h2>
        
        <!-- Google Sign-In Button -->
        <button class="google-signin-btn" id="googleSignInBtn" style="margin-bottom: 20px;">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" style="width:20px;height:20px;margin-right:10px;">
            Continue with Google
        </button>
        
        <div class="auth-divider" style="display:flex;align-items:center;margin:20px 0;color:#888;font-size:0.9em;">
            <span style="flex:1;border-bottom:1px solid #ddd;"></span>
            <span style="padding:0 10px;">or</span>
            <span style="flex:1;border-bottom:1px solid #ddd;"></span>
        </div>
        
        ${!isLogin ? `
        <div class="field">
            <label>Enter Email</label>
            <input type="email" id="authEmail" placeholder="Enter your email" required>
        </div>
        <div class="field">
            <label>Username</label>
            <input type="text" id="authUsername" placeholder="Choose a username" required>
        </div>
        <div class="field">
            <label>Enter Password</label>
            <input type="password" id="authPassword" placeholder="Create a password" required minlength="6">
        </div>
        <div class="field">
            <label>Confirm Password</label>
            <input type="password" id="authConfirmPassword" placeholder="Confirm your password" required minlength="6">
        </div>
        <button class="joker-submit" id="registerBtn">REGISTER</button>
        ` : `
        <div class="field">
            <label>Enter Email</label>
            <input type="email" id="authEmail" placeholder="Enter your email" required>
        </div>
        <div class="field">
            <label>Enter Password</label>
            <input type="password" id="authPassword" placeholder="Enter your password" required>
        </div>
        <button class="joker-submit" id="loginBtn">LOGIN</button>
        <p style="text-align:center;margin-top:16px;font-size:0.9em;">
            <a href="#" id="forgotPasswordLink" style="color:var(--primary-color);text-decoration:none;">Forgot Password?</a>
        </p>
        `}
    `;
    
    // Add Google Sign-In event listener
    document.getElementById('googleSignInBtn')?.addEventListener('click', async () => {
        const result = await signInWithGoogle();
        if (result.success) {
            alert(result.message);
            hideJoker();
        } else {
            alert('Google sign-in failed: ' + result.message);
        }
    });
    
    // Add event listeners
    if (isLogin) {
        document.getElementById('loginBtn')?.addEventListener('click', async () => {
            const email = document.getElementById('authEmail')?.value;
            const password = document.getElementById('authPassword')?.value;
            
            if (!email || !password) {
                alert('Please fill in all fields');
                return;
            }
            
            const result = await loginUser(email, password);
            alert(result.message);
            if (result.success) {
                hideJoker();
            }
        });

        document.getElementById('forgotPasswordLink')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const enteredEmail = document.getElementById('authEmail')?.value?.trim();
            const emailForReset = enteredEmail || window.prompt('Enter your account email for password reset:') || '';
            const result = await requestPasswordReset(emailForReset);
            alert(result.message);
        });
    } else {
        document.getElementById('registerBtn')?.addEventListener('click', async () => {
            const email = document.getElementById('authEmail')?.value;
            const username = document.getElementById('authUsername')?.value;
            const password = document.getElementById('authPassword')?.value;
            const confirmPassword = document.getElementById('authConfirmPassword')?.value;
            
            if (!email || !username || !password || !confirmPassword) {
                alert('Please fill in all fields');
                return;
            }
            
            if (password !== confirmPassword) {
                alert('Passwords do not match');
                return;
            }
            
            if (password.length < 6) {
                alert('Password must be at least 6 characters');
                return;
            }
            
            const result = await registerUser(email, username, password);
            alert(result.message);
            if (result.success) {
                hideJoker();
            }
        });
    }
}

// ============================================
// ============================================

// Initialize resize handles for an element
function initResizeHandles(element, options = {}) {
    if (!element) return;
    
    const defaultOptions = {
        minWidth: 100,
        minHeight: 60,
        maxWidth: null,
        maxHeight: null,
        onResize: null
    };
    
    const opts = { ...defaultOptions, ...options };
    
    element.classList.add('resizable');
    
    // Create handle elements
    const positions = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
    positions.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${pos}`;
        handle.dataset.position = pos;
        element.appendChild(handle);
        
        handle.addEventListener('mousedown', (e) => startResize(e, element, pos, opts));
        handle.addEventListener('touchstart', (e) => startResize(e, element, pos, opts), { passive: true });
    });
}

// Start resize operation
function startResize(e, element, position, options) {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const startWidth = element.offsetWidth;
    const startHeight = element.offsetHeight;
    const startLeft = element.offsetLeft;
    const startTop = element.offsetTop;
    
    element.classList.add('resizing');
    
    const onMove = (clientX, clientY) => {
        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;
        
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        if (position.includes('e')) newWidth = Math.max(options.minWidth, startWidth + deltaX);
        if (position.includes('w')) {
            newWidth = Math.max(options.minWidth, startWidth - deltaX);
            newLeft = startLeft + (startWidth - newWidth);
        }
        if (position.includes('s')) newHeight = Math.max(options.minHeight, startHeight + deltaY);
        if (position.includes('n')) {
            newHeight = Math.max(options.minHeight, startHeight - deltaY);
            newTop = startTop + (startHeight - newHeight);
        }
        
        if (options.maxWidth && newWidth > options.maxWidth) newWidth = options.maxWidth;
        if (options.maxHeight && newHeight > options.maxHeight) newHeight = options.maxHeight;
        
        element.style.width = newWidth + 'px';
        element.style.height = newHeight + 'px';
        if (position.includes('w')) element.style.left = newLeft + 'px';
        if (position.includes('n')) element.style.top = newTop + 'px';
        
        if (options.onResize) {
            options.onResize({ width: newWidth, height: newHeight, x: newLeft, y: newTop });
        }
    };
    
    const onEnd = () => {
        element.classList.remove('resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchend', onEnd);
        
        // Save new dimensions
        saveElementPosition(element);
    };
    
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchend', onEnd);
}

// ============================================
// ============================================

// Make element draggable
function makeDraggable(element, options = {}) {
    if (!element) return;
    
    element.classList.add('draggable');
    element.setAttribute('draggable', 'true');
    
    element.addEventListener('dragstart', (e) => {
        element.classList.add('dragging');
        e.dataTransfer.setData('text/plain', element.id || 'draggable-element');
        e.dataTransfer.effectAllowed = 'move';
        
        if (options.onDragStart) options.onDragStart(e);
    });
    
    element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
        if (options.onDragEnd) options.onDragEnd();
    });
}

// Initialize drop zone
function initDropZone(zone, options = {}) {
    if (!zone) return;
    
    zone.classList.add('drop-zone');
    if (!zone.id) zone.id = 'drop-zone-' + Date.now();
    
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
        if (options.onDragOver) options.onDragOver(e);
    });
    
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
        if (options.onDragLeave) options.onDragLeave();
    });
    
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        
        const data = e.dataTransfer.getData('text/plain');
        const draggable = document.querySelector(`.dragging`);
        
        if (draggable && zone !== draggable) {
            zone.appendChild(draggable);
            if (options.onDrop) options.onDrop(draggable, zone);
        }
        
        if (options.onComplete) options.onComplete();
    });
}

// ============================================
// ============================================

// Save element position and dimensions
function saveElementPosition(element) {
    if (!element) return;

    const id = element.id || 'unknown';
    const position = {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
        parentId: element.parentElement ? element.parentElement.id : null
    };

    let savedPositions = JSON.parse(localStorage.getItem('ruiruElementPositions') || '{}');
    savedPositions[id] = position;
    localStorage.setItem('ruiruElementPositions', JSON.stringify(savedPositions));
}

// Load element position
function loadElementPosition(element) {
    if (!element) return;
    
    const id = element.id || 'unknown';
    const savedPositions = JSON.parse(localStorage.getItem('ruiruElementPositions') || '{}');
    const position = savedPositions[id];
    
    if (position) {
        if (position.x !== undefined) element.style.left = position.x + 'px';
        if (position.y !== undefined) element.style.top = position.y + 'px';
        if (position.width) element.style.width = position.width + 'px';
        if (position.height) element.style.height = position.height + 'px';
        return true;
    }
    return false;
}

// Save all settings
function saveAllSettings() {
    saveSettings();
    
    // Save player dimensions
    const player = document.querySelector('.main-player-view, .hero-player-content');
    if (player) {
        saveElementPosition(player);
    }
}

// Load all settings on page load
function loadAllSettings() {
    loadSettings();

    // Load player positions
    document.querySelectorAll('.main-player-view, .hero-player-content').forEach(el => {
        loadElementPosition(el);
    });

    // Load draggable element positions
    const draggableElements = document.querySelectorAll('#player-title, #player-description');
    draggableElements.forEach(el => {
        loadElementPosition(el);
    });
}

function initJokerSettings() {
    loadProfile();
    const savedFacebookUrl = localStorage.getItem('ruiruFacebookUrl');
    if (savedFacebookUrl) {
        settingsState.profile.socialLinks.facebook = savedFacebookUrl;
    }
}

// Initialize drop zones for architect mode
function initDropZones() {
    // Create drop zones for different "houses"
    const houses = [
        { id: 'queen-drop', label: 'Queen (Header)', selector: '.main-header' },
        { id: 'prince-drop', label: 'Prince (Player)', selector: '.main-player-view, .hero-player-content' },
        { id: 'subjects-drop', label: 'Subjects (Playlist)', selector: '.video-playlist-sidebar' }
    ];

    houses.forEach(house => {
        const targetEl = document.querySelector(house.selector);
        if (targetEl) {
            initDropZone(targetEl, {
                onDrop: (draggedEl, dropZone) => {
                    // Move the dragged element to the drop zone
                    dropZone.appendChild(draggedEl);
                    saveElementPosition(draggedEl);
                },
                onDragOver: () => {
                    targetEl.classList.add('drop-zone-highlight');
                },
                onDragLeave: () => {
                    targetEl.classList.remove('drop-zone-highlight');
                }
            });
        }
    });
}

// Auto-save on page unload
window.addEventListener('beforeunload', () => {
    saveAllSettings();
});

// Global YouTube player instances
let youtubePlayers = {};

// Auto-play functions

/**
 * Initialize autoplay functionality
 * Should be called on page load
 */
function initializeAutoplay() {
    console.log('Initializing autoplay...');
    
    // Load saved autoplay setting from localStorage
    loadAutoplaySetting();
    
    // Add autoplay toggle to playlist header if playlist exists
    addAutoplayToggle();
    
    console.log('Autoplay initialized. Enabled:', autoplayEnabled);
}

function setupAutoplay(playerElement, currentVideoId) {
    if (!autoplayEnabled) {
        console.log('Autoplay disabled, skipping setup');
        return;
    }

    // Check if it's a YouTube iframe
    if (playerElement.tagName === 'IFRAME' && playerElement.src.includes('youtube.com')) {
        // Set current video ID on the player container for tracking
        const playerContainer = getPlayerContainer();
        if (playerContainer) {
            playerContainer.dataset.currentVideoId = currentVideoId;
        }
        // Initialize YouTube player for autoplay
        initializeYouTubePlayer(playerElement, currentVideoId);
    }
    // For HTML5 videos, the 'ended' event listener is already added in populateMainPlayer
}

function playNextVideo(currentVideoId) {
    if (!autoplayEnabled || currentPlaylist.length === 0) {
        console.log('Cannot play next: autoplayEnabled=', autoplayEnabled, 'playlist length=', currentPlaylist.length);
        return;
    }

    // Find current video index
    const currentIndex = currentPlaylist.findIndex(doc => doc.id === currentVideoId);
    if (currentIndex === -1) {
        console.log('Current video not found in playlist');
        return;
    }

    // Get next video (loop back to first)
    const nextIndex = (currentIndex + 1) % currentPlaylist.length;
    const nextVideo = currentPlaylist[nextIndex];
    
    console.log('Playing next video:', nextVideo.id);

    // Update player
    populateMainPlayer(nextVideo);
    const playerContainer = getPlayerContainer();
    if (playerContainer) {
        playerContainer.dataset.currentVideoId = nextVideo.id;
    }

    // Update playlist highlight
    updatePlaylistHighlight(nextVideo.id);
}

function updatePlaylistHighlight(videoId) {
    // Remove previous highlights
    document.querySelectorAll('.playlist-item').forEach(item => {
        item.classList.remove('playing');
    });

    // Highlight current video
    const currentItem = document.querySelector(`.playlist-item[data-video-id="${videoId}"]`);
    if (currentItem) {
        currentItem.classList.add('playing');
        currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Add autoplay toggle to playlist header
function addAutoplayToggle() {
    const playlistBoundary = document.querySelector('.playlist-boundary');
    if (!playlistBoundary) {
        console.log('Playlist boundary not found, skipping autoplay toggle');
        return;
    }

    // Check if toggle already exists
    if (playlistBoundary.querySelector('.autoplay-toggle')) {
        console.log('Autoplay toggle already exists');
        return;
    }

    const autoplayToggle = document.createElement('div');
    autoplayToggle.className = 'autoplay-toggle';
    autoplayToggle.innerHTML = `
        <button id="autoplayBtn" class="autoplay-btn ${autoplayEnabled ? 'active' : ''}" title="Toggle Auto-play">
            <i class="fas fa-play-circle"></i>
            <span>Auto-play</span>
        </button>
    `;

    // Insert at the top of the playlist boundary (fixed header position)
    playlistBoundary.insertBefore(autoplayToggle, playlistBoundary.firstChild);
    console.log('Autoplay toggle added');

    // Add event listener
    const btn = document.getElementById('autoplayBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            autoplayEnabled = !autoplayEnabled;
            btn.classList.toggle('active');
            localStorage.setItem('autoplayEnabled', autoplayEnabled);
            console.log('Autoplay toggled:', autoplayEnabled);
        });
    }
}

// Load autoplay setting
function loadAutoplaySetting() {
    const saved = localStorage.getItem('autoplayEnabled');
    if (saved !== null) {
        autoplayEnabled = saved === 'true';
        console.log('Loaded autoplay setting:', autoplayEnabled);
    } else {
        // Default to true if not set
        autoplayEnabled = true;
        console.log('Autoplay setting not found, defaulting to true');
    }
}

// YouTube API ready callback
function onYouTubeIframeAPIReady() {
    console.log('YouTube API ready');
    // This will be called when the API is loaded
}

// Make the callback global so YouTube API can call it
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

// Function to initialize YouTube player for autoplay
function initializeYouTubePlayer(iframe, currentVideoId) {
    if (!iframe || !iframe.getAttribute('data-yt-id')) {
        console.log('Invalid iframe or missing yt-id');
        return;
    }

    const ytId = iframe.getAttribute('data-yt-id');

    // Wait for YouTube API to be ready
    if (typeof YT === 'undefined' || !YT.Player) {
        console.log('YouTube API not ready, retrying...');
        setTimeout(() => initializeYouTubePlayer(iframe, currentVideoId), 100);
        return;
    }

    if (youtubePlayers[ytId]) {
        console.log('Player already exists for', ytId);
        // Update the video ID on existing player
        const playerContainer = getPlayerContainer();
        if (playerContainer) {
            playerContainer.dataset.currentVideoId = currentVideoId;
        }
        return;
    }

    try {
        console.log('Initializing YouTube player for', ytId, 'videoId:', currentVideoId);
        
        const player = new YT.Player(iframe, {
            events: {
                'onReady': (event) => {
                    console.log('YouTube player ready for', ytId);
                },
                'onStateChange': (event) => {
                    console.log('YouTube state change:', event.data, 'for', ytId);
                    // YT.PlayerState: UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5
                    if (event.data === 0 && autoplayEnabled) { // Video ended
                        // Get current video ID from player container (more reliable)
                        const playerContainer = getPlayerContainer();
                        const playingVideoId = playerContainer?.dataset.currentVideoId || currentVideoId;
                        console.log('Video ended, playing next for video:', playingVideoId);
                        playNextVideo(playingVideoId);
                    }
                },
                'onError': (event) => {
                    console.error('YouTube player error:', event.data, 'for', ytId);
                    // On error, try to play next video
                    if (autoplayEnabled) {
                        console.log('Error occurred, trying to play next video');
                        playNextVideo(currentVideoId);
                    }
                }
            }
        });
        youtubePlayers[ytId] = player;
    } catch (e) {
        console.warn('Failed to initialize YouTube player for', ytId, e);
    }
}

// -----------------------------
// Connect YouTube Button Logic (Admin Only)
// -----------------------------
const connectBtn = document.getElementById("connectYoutube");
if (connectBtn) {
  connectBtn.addEventListener("click", async () => {
    // Double-check admin status before allowing OAuth
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      alert("Access denied. Only admins can connect YouTube.");
      return;
    }
    
    const CLIENT_ID = "60484045851-nq8loe52iv5m66svlam52jj883pjgcld.apps.googleusercontent.com";
    const REDIRECT_URI = "https://insight-viewer.vercel.app/api/oauthCallback";
    const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
    const RESPONSE_TYPE = "code";
    const ACCESS_TYPE = "offline";

    const oauthURL = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPE}&response_type=${RESPONSE_TYPE}&access_type=${ACCESS_TYPE}`;

    // Redirect admin to Google OAuth page
    window.location.href = oauthURL;
  });
}

// -----------------------------
// YouTube Videos Fetch Button Logic
// -----------------------------
const fetchBtn = document.getElementById("fetchYoutubeVideos");
if (fetchBtn) {
  fetchBtn.addEventListener("click", async () => {
    // Double-check admin status before allowing fetch
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      alert("Access denied. Only admins can fetch YouTube videos.");
      return;
    }
    
    try {
      const response = await fetch("/api/fetchYouTubeVideos");
      const data = await response.json();
      
      if (data.success) {
        // Mark sync as completed after successful fetch
        await markYouTubeSyncCompleted();
        alert(`YouTube videos synced! Total fetched: ${data.count}`);
        
        // Hide the button after successful sync
        updateConnectYouTubeButtonVisibility();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      alert("Error fetching YouTube videos. Check console.");
    }
  });
}

// -----------------------------
// Auth State Change Listener
// -----------------------------
// Listen for auth state changes to update button visibility
onAuthStateChanged(auth, async (user) => {
  console.log("Auth state changed:", user ? user.email : "No user");
  
  // Update button visibility when auth state changes
  await updateConnectYouTubeButtonVisibility();
  if (user) {
    await loadProfileFromBackend(user);
  } else {
    resetProfileState();
    loadProfile();
  }
});

// -----------------------------
// Initialize Button Visibility on Page Load
// -----------------------------
async function initializeYouTubeButton() {
  // Wait a bit for auth to initialize
  setTimeout(async () => {
    await updateConnectYouTubeButtonVisibility();
  }, 1000);
}

// Run initialization
initializeYouTubeButton();

// -----------------------------
// Support Modal & STK Simulation
// -----------------------------
document.addEventListener('DOMContentLoaded', () => {
    const supportBtn = document.getElementById('supportBtn');
    const supportModal = document.getElementById('supportModal');
    const supportBackdrop = document.querySelector('.support-modal-backdrop');
    const supportPanel = document.querySelector('.support-modal-panel');
    const supportCloseButtons = document.querySelectorAll('[data-close-support], .support-modal-close');
    const supportTabs = document.querySelectorAll('.support-tab');
    const projectSelectRow = document.getElementById('projectSelectRow');
    const supportForm = document.getElementById('supportForm');
    const supportSubmit = document.getElementById('supportSubmit');
    const stkListening = document.getElementById('stkListening');
    const stkSecondsEl = document.getElementById('stkSeconds');
    const stkCancel = document.getElementById('stkCancel');

    let stkInterval = null;
    let stkSecondsRemaining = 90;
    let lastSupportPayload = null;

    function openSupportModal() {
        if (!supportModal) return;
        supportModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        // reset to default form view
        supportForm?.classList.remove('hidden');
        stkListening?.classList.add('hidden');
        stkSecondsRemaining = 90;
        stkSecondsEl && (stkSecondsEl.textContent = stkSecondsRemaining);
        projectSelectRow && projectSelectRow.classList.add('hidden');
        supportTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'general'));
        setTimeout(() => {
            const phone = document.getElementById('mpesaPhone');
            phone && phone.focus();
        }, 80);
    }

    function closeSupportModal() {
        if (!supportModal) return;
        supportModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        stopSTKSimulation();
    }

    function stopSTKSimulation() {
        if (stkInterval) {
            clearInterval(stkInterval);
            stkInterval = null;
        }
        stkSecondsRemaining = 90;
        stkSecondsEl && (stkSecondsEl.textContent = stkSecondsRemaining);
    }

    function startSTKSimulation(payload) {
        // hide form, show listening
        supportForm && supportForm.classList.add('hidden');
        stkListening && stkListening.classList.remove('hidden');
        stkSecondsRemaining = 90;
        stkSecondsEl && stkSecondsEl.textContent && (stkSecondsEl.textContent = stkSecondsRemaining);
        // store payload for demonstration (project vs general)
        lastSupportPayload = payload;
        console.log('Simulated STK push started (demo payload):', payload);

        stkInterval = setInterval(() => {
            stkSecondsRemaining -= 1;
            if (stkSecondsEl) stkSecondsEl.textContent = stkSecondsRemaining;
            if (stkSecondsRemaining <= 0) {
                stopSTKSimulation();
                // close modal when time expires
                closeSupportModal();
                alert('Session listening closed. Please try again if you still want to support us.');
            }
        }, 1000);
    }

    // Open modal
    supportBtn && supportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openSupportModal();
    });

    // Close handlers
    supportBackdrop && supportBackdrop.addEventListener('click', closeSupportModal);
    supportCloseButtons.forEach(btn => btn.addEventListener('click', closeSupportModal));

    // Tabs
    supportTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            supportTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            if (tab.dataset.tab === 'project') {
                projectSelectRow && projectSelectRow.classList.remove('hidden');
            } else {
                projectSelectRow && projectSelectRow.classList.add('hidden');
            }
        });
    });

    // Form submit
    supportForm && supportForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const phone = (document.getElementById('mpesaPhone')?.value || '').trim();
        const amount = (document.getElementById('mpesaAmount')?.value || '').trim();
        const project = (document.getElementById('projectSelect')?.value || '').trim();
        const activeTab = document.querySelector('.support-tab.active')?.dataset.tab || 'general';

        if (!phone || !amount) {
            alert('Please enter a phone number and amount.');
            return;
        }

        const payload = {
            phone, amount: Number(amount), workflow: activeTab,
            project: activeTab === 'project' ? project : 'general'
        };

        // For demo, start simulated STK push
        startSTKSimulation(payload);
    });

    // Cancel STK listening
    stkCancel && stkCancel.addEventListener('click', () => {
        stopSTKSimulation();
        // show form again
        stkListening && stkListening.classList.add('hidden');
        supportForm && supportForm.classList.remove('hidden');
    });
});
// Export functions for external use (if needed)
window.isCurrentUserAdmin = isCurrentUserAdmin;
window.isYouTubeSyncCompleted = isYouTubeSyncCompleted;
window.shouldShowConnectYouTubeButton = shouldShowConnectYouTubeButton;
window.updateConnectYouTubeButtonVisibility = updateConnectYouTubeButtonVisibility;
