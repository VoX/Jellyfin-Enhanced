/**
 * @file Implements core, non-playback features for Jellyfin Enhanced.
 */
(function(JE) {
    'use strict';

    // In-memory cache to avoid repeated fetches when data is unavailable or unchanged
    const WATCHPROGRESS_CACHE_TTL = 60 * 60 * 1000; // 1 hour
    const FILESIZE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
    const LANGUAGE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
    const watchProgressCache = new Map(); // Map<itemId, { progress: number, totalPlaybackTicks: number, totalRuntimeTicks: number, ts: number }>
    const fileSizeCache = new Map(); // Map<itemId, { size: number|null, unavailable: boolean, ts: number }>
    const audioLanguageCache = new Map(); // Map<itemId, { languages: Array, unavailable: boolean, ts: number }>

    /**
     * Converts bytes into a human-readable format (e.g., KB, MB, GB).
     * @param {number} bytes The size in bytes.
     * @returns {string} The human-readable file size.
     */
    function formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const formattedSize = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
        return `${formattedSize} ${sizes[i]}`;
    }

    /**
     * Shows notifications using Jellyfin's built-in notification system.
     * @param {string} message The message to display.
     * @param {string} [type='info'] The type of notification ('info', 'error', 'success').
     */
    const showNotification = (message, type = 'info') => {
        try {
            if (window.Dashboard?.alert) {
                window.Dashboard.alert(message);
            } else if (window.Emby?.Notifications) {
                window.Emby.Notifications.show({ title: message, type: type, timeout: 3000 });
            } else {
                console.log(`🪼 Jellyfin Enhanced: Notification (${type}): ${message}`);
            }
        } catch (e) {
            console.error("🪼 Jellyfin Enhanced: Failed to show notification", e);
        }
    };

    /**
     * Fetches a random item (Movie or Series) from the user's library.
     * @returns {Promise<object|null>} A promise that resolves to a random item or null.
     */
    async function getRandomItem() {
        const userId = ApiClient.getCurrentUserId();
        if (!userId) {
            console.error("🪼 Jellyfin Enhanced: User not logged in.");
            return null;
        }

        const itemTypes = [];
        if (JE.currentSettings.randomIncludeMovies) itemTypes.push('Movie');
        if (JE.currentSettings.randomIncludeShows) itemTypes.push('Series');
        const includeItemTypes = itemTypes.join(',');

        let apiUrl = ApiClient.getUrl(`/Users/${userId}/Items?IncludeItemTypes=${includeItemTypes}&Recursive=true&SortBy=Random&Limit=100&Fields=ExternalUrls`);

        try {
            const response = await ApiClient.ajax({ type: 'GET', url: apiUrl, dataType: 'json' });
            if (response && response.Items && response.Items.length > 0) {
                let items = response.Items;

                if (JE.currentSettings.randomUnwatchedOnly) {
                    items = items.filter(item => {
                        // For movies: check if not played
                        if (item.Type === 'Movie') {
                            return !item.UserData?.Played;
                        }
                        // For series: check if there are unplayed episodes
                        if (item.Type === 'Series') {
                            return item.UserData?.UnplayedItemCount > 0;
                        }
                        return false;
                    });
                    // If no unwatched items found, show error
                    if (items.length === 0) {
                        throw new Error('No unwatched items found in selected libraries.');
                    }
                }

                const randomIndex = Math.floor(Math.random() * items.length);
                return items[randomIndex];
            }
            throw new Error('No items found in selected libraries.');
        } catch (error) {
            console.error('🪼 Jellyfin Enhanced: Error fetching random item:', error);
            JE.toast(`${JE.icon(JE.IconName.ERROR)} ${error.message || 'Unknown error'}`, 2000);
            return null;
        }
    }

    /**
     * Navigates the browser to the details page of the given item.
     * @param {object} item The item to navigate to.
     */
    function navigateToItem(item) {
        if (item && item.Id) {
            if (window.Emby && window.Emby.Page && typeof window.Emby.Page.show === 'function') {
                const serverId = ApiClient.serverId();
                window.Emby.Page.show(`/details?id=${item.Id}${serverId ? `&serverId=${serverId}` : ''}`);
            } else if (window.Dashboard && typeof window.Dashboard.navigate === 'function') {
                window.Dashboard.navigate(`details.html?id=${item.Id}`);
            } else {
                // Fallback to hash navigation for older versions
                const serverId = ApiClient.serverId();
                const itemUrl = `#!/details?id=${item.Id}${serverId ? `&serverId=${serverId}` : ''}`;
                window.location.hash = itemUrl;
            }
            JE.toast(JE.t('toast_random_item_loaded'), 2000);
        } else {
            console.error('🪼 Jellyfin Enhanced: Invalid item object or ID:', item);
            JE.toast(JE.t('toast_generic_error'), 2000);
        }
    }

    /**
     * Creates and injects the "Random" button into the page header if enabled.
     */
    JE.addRandomButton = () => {
        if (!JE.currentSettings.randomButtonEnabled) {
            document.getElementById('randomItemButtonContainer')?.remove();
            return;
        }

        if (document.getElementById('randomItemButton')) return;

        const buttonContainer = document.createElement('div');
        buttonContainer.id = 'randomItemButtonContainer';

        const randomButton = document.createElement('button');
        randomButton.id = 'randomItemButton';
        randomButton.setAttribute('is', 'paper-icon-button-light');
        randomButton.className = 'headerButton headerButtonRight paper-icon-button-light';
        randomButton.title = JE.t('random_button_tooltip');
        randomButton.innerHTML = `<i class="material-icons">casino</i>`;

        randomButton.addEventListener('click', async () => {
            randomButton.disabled = true;
            randomButton.classList.add('loading');
            randomButton.innerHTML = '<i class="material-icons">hourglass_empty</i>';

            try {
                const item = await getRandomItem();
                if (item) {
                    navigateToItem(item);
                }
            } finally {
                setTimeout(() => {
                    if (document.getElementById(randomButton.id)) {
                        randomButton.disabled = false;
                        randomButton.classList.remove('loading');
                        randomButton.innerHTML = `<i class="material-icons">casino</i>`;
                    }
                }, 500);
            }
        });

        buttonContainer.appendChild(randomButton);
        const headerRight = document.querySelector('.headerRight');
        headerRight?.prepend(buttonContainer);
    };



    /**
     * Shows the total watch progress (in %) of an item (and its children) on its details page.
     * @param {string} itemId The ID of the item.
     * @param {HTMLElement} container The DOM element to append the info to.
     */
    async function displayWatchProgress(itemId, container) {
        // show itemMiscInfo if hidden like on season pages
        if (container.classList.contains('hide')) {
            container.classList.remove('hide')
        }

        const existing = container.querySelector('.mediaInfoItem-watchProgress');
        if (existing) {
            // If already rendered for this itemId, do nothing
            if (existing.dataset.itemId === itemId) return;
            // Different item now; replace the element
            existing.remove();
        }

        // Check cache first to avoid repeated network calls
        const now = Date.now();
        const cached = watchProgressCache.get(itemId);

        const placeholder = document.createElement('div');
        placeholder.className = 'mediaInfoItem mediaInfoItem-watchProgress';
        placeholder.dataset.itemId = itemId;
        placeholder.title = JE.t('watch_progress_tooltip');
        placeholder.style.display = 'flex';
        placeholder.style.verticalAlign = 'middle';
        placeholder.style.alignItems = 'center';
        placeholder.style.margin = '0 1em 0 0 !important';
        placeholder.style.cursor = 'pointer';
        const getWatchProgressDisplay = (watchProgress, mode) => {
            const safeTotal = Math.max(0, watchProgress.totalRuntimeTicks || 0);
            const safePlayed = Math.max(0, Math.min(safeTotal, watchProgress.totalPlaybackTicks || 0));

            if (mode === 'time') {
                return `${getTimeString(safePlayed)} / ${getTimeString(safeTotal)}`;
            }

            if (mode === 'remaining') {
                const remaining = Math.max(0, safeTotal - safePlayed);
                return `-${getTimeString(remaining)} / ${getTimeString(safeTotal)}`;
            }

            return `${watchProgress.progress}%`;
        };

        const persistWatchProgressMode = (mode) => {
            if (!window.JellyfinEnhanced) return;
            window.JellyfinEnhanced.currentSettings = window.JellyfinEnhanced.currentSettings || {};
            window.JellyfinEnhanced.currentSettings.watchProgressMode = mode;
            if (typeof window.JellyfinEnhanced.saveUserSettings === 'function') {
                window.JellyfinEnhanced.saveUserSettings('settings.json', window.JellyfinEnhanced.currentSettings);
            }
        };

        const nextWatchProgressMode = (currentMode) => {
            if (currentMode === 'percentage') return 'time';
            if (currentMode === 'time') return 'remaining';
            return 'percentage';
        };

        // onClick handler to toggle between percentage and time-based display
        placeholder.addEventListener('click', () => {
            const watchProgress = watchProgressCache.get(itemId);
            if (!watchProgress) return;

            const div = document.querySelector(`.mediaInfoItem-watchProgress[data-item-id="${itemId}"]`)
                .querySelector('.mediaInfoItem-watchProgress-value');
            if (!div) return;

            const currentMode = div.dataset.type || 'percentage';
            const newMode = nextWatchProgressMode(currentMode);
            div.dataset.type = newMode;
            div.innerHTML = getWatchProgressDisplay(watchProgress, newMode);
            persistWatchProgressMode(newMode);
        });
        // Show loading indicator
        placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">hourglass_empty</span> ...`;
        // Insert first so subsequent observer runs are triggered
        container.appendChild(placeholder);

        const getIconSpan = (progress) => {
            const circumference = 2 * Math.PI * 8; // radius = 8
            const offset = circumference - (progress / 100) * circumference;

            if (progress >= 100) {
                // Check circle for fully completed items
                return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" style="margin-right: 0.3em; display: inline-block; vertical-align: middle;">
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>
                    <path d="M9.5 15.5l-3-3 1.4-1.4L9.5 12.7l5.6-5.6 1.4 1.4z" fill="currentColor"/>
                </svg>`;
            }

            // For all other progress values (0-99%), use custom SVG
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" style="margin-right: 0.3em; display: inline-block; vertical-align: middle;">
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" opacity="0.2"/>
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"
                    style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset 0.3s ease;"/>
            </svg>`;
            return `${svg}`;
        }

        // Helper to get time string from ticks
        const getTimeString = (ticks) => {
            const seconds = ticks / 10_000_000;
            const totalMinutes = Math.floor(seconds / 60);
            const totalHours = Math.floor(totalMinutes / 60);
            const totalDays = Math.floor(totalHours / 24);
            const totalMonths = Math.floor(totalDays / 30);
            const totalYears = Math.floor(totalDays / 365);

            let result = '';
            const format = (window.JellyfinEnhanced?.currentSettings?.watchProgressTimeFormat || 'hours');
            if (format === 'hours') {
                // Show hours and minutes (or just minutes if under an hour)
                if (totalHours >= 1) {
                    result += `${totalHours}h`;
                    const minutes = totalMinutes % 60;
                    if (minutes > 0) result += ` ${minutes}m`;
                } else if (totalMinutes > 0) {
                    result = `${totalMinutes}m`;
                } else {
                    result = '0m';
                }
            } else {
                if (totalYears >= 1) {
                    result += `${totalYears}y`;
                    const months = Math.floor((totalDays % 365) / 30);
                    if (months > 0) result += ` ${months}mo`;
                } else if (totalMonths >= 1) {
                    result += `${totalMonths}mo`;
                    const days = totalDays % 30;
                    if (days > 0) result += ` ${days}d`;
                } else if (totalDays >= 1) {
                    result += `${totalDays}d`;
                    const hours = totalHours % 24;
                    if (hours > 0) result += ` ${hours}h`;
                } else if (totalHours >= 1) {
                    result += `${totalHours}h`;
                    const minutes = totalMinutes % 60;
                    if (minutes > 0) result += ` ${minutes}m`;
                } else if (totalMinutes > 0) {
                    result = `${totalMinutes}m`;
                } else {
                    result = '0m';
                }
            }

            return result;
        }

        const getWatchProgressValue = (watchProgress) => {
            const valueDiv = document.createElement('div');
            valueDiv.className = 'mediaInfoItem-watchProgress-value';
            const defaultMode = (window.JellyfinEnhanced?.currentSettings?.watchProgressMode || 'percentage');
            const resolvedMode = (defaultMode === 'time' || defaultMode === 'remaining') ? defaultMode : 'percentage';
            valueDiv.dataset.type = resolvedMode;
            valueDiv.innerHTML = getWatchProgressDisplay(watchProgress, resolvedMode);

            return valueDiv;
        }

        // Helper to render the 0 state
        const renderUnavailable = () => {
            placeholder.innerHTML = getIconSpan(0);
            placeholder.appendChild(getWatchProgressValue({ progress: 0, totalPlaybackTicks: 0, totalRuntimeTicks: 0 }));
        };

        // Use requestIdleCallback to defer the work and not block page rendering
        const performFetch = async () => {
            if (cached && (now - cached.ts) < WATCHPROGRESS_CACHE_TTL) {
                if (!cached.progress) {
                    renderUnavailable();
                    return;
                }
                placeholder.innerHTML = getIconSpan(cached.progress);
                placeholder.appendChild(getWatchProgressValue(cached));
                return;
            }

            try {
                const itemResult = await ApiClient.ajax({
                    type: 'GET',
                    url: ApiClient.getUrl(`/JellyfinEnhanced/watch-progress/${ApiClient.getCurrentUserId()}/${itemId}`),
                    dataType: 'json'
                });

                const watchProgress = {
                    progress: itemResult?.progress ?? 0,
                    totalPlaybackTicks: itemResult?.totalPlaybackTicks ?? 0,
                    totalRuntimeTicks: itemResult?.totalRuntimeTicks ?? 0,
                    ts: now
                };
                placeholder.innerHTML = getIconSpan(watchProgress.progress);
                placeholder.appendChild(getWatchProgressValue(watchProgress));

                watchProgressCache.set(itemId, watchProgress);
            } catch (error) {
                console.error('🪼 Jellyfin Enhanced: Error fetching watch progress for ID %s:', itemId, error);
                // Keep placeholder with 0 to prevent repeated calls
                renderUnavailable();
                watchProgressCache.set(itemId, { progress: 0, totalPlaybackTicks: 0, totalRuntimeTicks: 0, ts: now });
            }
        };

        // Defer to allow page to render first
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => performFetch(), { timeout: 2000 });
        } else {
            setTimeout(() => performFetch(), 0);
        }
    }

    /**
     * Shows the total file size of an item on its details page.
     * @param {string} itemId The ID of the item.
     * @param {HTMLElement} container The DOM element to append the info to.
     */
    async function displayItemSize(itemId, container) {
        const existing = container.querySelector('.mediaInfoItem-fileSize');
        if (existing) {
            // If already rendered for this itemId, do nothing
            if (existing.dataset.itemId === itemId) return;
            // Different item now; replace the element
            existing.remove();
        }

        // Check cache first to avoid repeated network calls
        const now = Date.now();
        const cached = fileSizeCache.get(itemId);

        const placeholder = document.createElement('div');
        placeholder.className = 'mediaInfoItem mediaInfoItem-fileSize';
        placeholder.dataset.itemId = itemId;
        placeholder.title = JE.t('file_size_tooltip');
        placeholder.style.display = 'flex';
        placeholder.style.alignItems = 'center';
        placeholder.style.margin = '0 1em 0 0 !important';
        // Show loading indicator
        placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">hourglass_empty</span> ...`;
        // Insert first so subsequent observer runs are triggered
        container.appendChild(placeholder);

        // Helper to render a dash (no data) but keep the element
        const renderUnavailable = () => {
            placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">save</span> -`;
        };

        // Use requestIdleCallback to defer the work and not block page rendering
        const performFetch = async () => {
            if (cached && (now - cached.ts) < FILESIZE_CACHE_TTL) {
                if (cached.unavailable || !cached.size) {
                    renderUnavailable();
                    return;
                }
                placeholder.style.verticalAlign = 'middle';
                placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">save</span>${formatSize(cached.size)}`;
                return;
            }

            try {
                const itemResult = await ApiClient.ajax({
                    type: 'GET',
                    url: ApiClient.getUrl(`/JellyfinEnhanced/file-size/${ApiClient.getCurrentUserId()}/${itemId}`),
                    dataType: 'json'
                });
                const totalSize = itemResult?.size ?? 0;

                if (totalSize > 0) {
                    placeholder.style.verticalAlign = 'middle';
                    placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">save</span>${formatSize(totalSize)}`;
                    fileSizeCache.set(itemId, { size: totalSize, unavailable: false, ts: now });
                } else {
                    renderUnavailable();
                    fileSizeCache.set(itemId, { size: null, unavailable: true, ts: now });
                }
            } catch (error) {
                console.error('🪼 Jellyfin Enhanced: Error fetching item size for ID %s:', itemId, error);
                // Keep placeholder with dash to prevent repeated calls
                renderUnavailable();
                fileSizeCache.set(itemId, { size: null, unavailable: true, ts: now });
            }
        };

        // Defer to allow page to render first
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => performFetch(), { timeout: 2000 });
        } else {
            setTimeout(() => performFetch(), 0);
        }
    }

    /**
     * A map of language names/codes to country codes for flag display.
     */
    const languageToCountryMap={English:"gb",eng:"gb",Japanese:"jp",jpn:"jp",Spanish:"es",spa:"es",French:"fr",fre:"fr",fra:"fr",German:"de",ger:"de",deu:"de",Italian:"it",ita:"it",Korean:"kr",kor:"kr",
                                Chinese:"cn",chi:"cn",zho:"cn",Russian:"ru",rus:"ru",Portuguese:"pt",por:"pt",Hindi:"in",hin:"in",Dutch:"nl",dut:"nl",nld:"nl",Arabic:"sa",ara:"sa",Bengali:"in",ben:"in",
                                Czech:"cz",ces:"cz",Danish:"dk",dan:"dk",Greek:"gr",ell:"gr",Finnish:"fi",fin:"fi",Hebrew:"il",heb:"il",Hungarian:"hu",hun:"hu",Indonesian:"id",ind:"id",Norwegian:"no",nor:"no",
                                Polish:"pl",pol:"pl",Persian:"ir",per:"ir",fas:"ir",Romanian:"ro",ron:"ro",rum:"ro",Swedish:"se",swe:"se",Thai:"th",tha:"th",Turkish:"tr",tur:"tr",Ukrainian:"ua",ukr:"ua",
                                Vietnamese:"vn",vie:"vn",Malay:"my",msa:"my",may:"my",Swahili:"ke",swa:"ke",Tagalog:"ph",tgl:"ph",Filipino:"ph",Tamil:"in",tam:"in",Telugu:"in",tel:"in",Marathi:"in",mar:"in",
                                Punjabi:"in",pan:"in",Urdu:"pk",urd:"pk",Gujarati:"in",guj:"in",Kannada:"in",kan:"in",Malayalam:"in",mal:"in",Sinhala:"lk",sin:"lk",Nepali:"np",nep:"np",Pashto:"af",pus:"af",
                                Kurdish:"iq",kur:"iq",Slovak:"sk",slk:"sk",Slovenian:"si",slv:"si",Serbian:"rs",srp:"rs",Croatian:"hr",hrv:"hr",Bulgarian:"bg",bul:"bg",Macedonian:"mk",mkd:"mk",Albanian:"al",
                                sqi:"al",Estonian:"ee",est:"ee",Latvian:"lv",lav:"lv",Lithuanian:"lt",lit:"lt",Icelandic:"is",isl:"is",Georgian:"ge",kat:"ge",Armenian:"am",hye:"am",Mongolian:"mn",mon:"mn",
                                Kazakh:"kz",kaz:"kz",Uzbek:"uz",uzb:"uz",Azerbaijani:"az",aze:"az",Belarusian:"by",bel:"by",Amharic:"et",amh:"et",Zulu:"za",zul:"za",Afrikaans:"za",afr:"za",Hausa:"ng",hau:"ng",
                                Yoruba:"ng",yor:"ng",Igbo:"ng",ibo:"ng",Brazilian:"br",bra:"br",Catalan:"es-ct",cat:"es-ct",ca:"es-ct",Galician:"es-ga",glg:"es-ga",gl:"es-ga",Basque:"es-pv",eus:"es-pv",baq:"es-pv",eu:"es-pv"};

    /**
     * Fetches the first episode of a series or season for language detection.
     * @param {string} userId The user ID.
     * @param {string} parentId The series or season ID.
     * @returns {Promise<object|null>} The first episode item or null.
     */
    async function fetchFirstEpisodeForLanguage(userId, parentId) {
        try {
            const response = await ApiClient.ajax({
                type: 'GET',
                url: ApiClient.getUrl('/Items', {
                    ParentId: parentId,
                    IncludeItemTypes: 'Episode',
                    Recursive: true,
                    SortBy: 'PremiereDate',
                    SortOrder: 'Ascending',
                    Limit: 1,
                    Fields: 'MediaStreams,MediaSources',
                    userId: userId
                }),
                dataType: 'json'
            });
            return response.Items?.[0] || null;
        } catch {
            return null;
        }
    }

    /**
     * Displays the audio languages of an item (and its children) on its details page.
     * @param {string} itemId The ID of the item.
     * @param {HTMLElement} container The DOM element to append the info to.
     */
    async function displayAudioLanguages(itemId, container) {
        // show itemMiscInfo if hidden like on season pages
        if (container.classList.contains('hide')) {
            container.classList.remove('hide')
        }

        const existing = container.querySelector('.mediaInfoItem-audioLanguage');
        if (existing) {
            // If already rendered for this itemId, do nothing
            if (existing.dataset.itemId === itemId) return;
            // Different item now, replace the element
            existing.remove();
        }

        const placeholder = document.createElement('div');
        placeholder.className = 'mediaInfoItem mediaInfoItem-audioLanguage';
        placeholder.dataset.itemId = itemId;
        placeholder.title = JE.t('audio_language_tooltip');
        placeholder.style.display = 'flex';
        placeholder.style.verticalAlign = 'middle';
        placeholder.style.alignItems = 'center';
        placeholder.style.margin = '0 1em 0 0 !important';
        // Show loading indicator
        placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">hourglass_empty</span> ...`;
        container.appendChild(placeholder);

        const applyLangStyles = (el) => {
            el.title = JE.t('audio_language_tooltip');
            el.style.display = 'flex';
            el.style.verticalAlign = 'middle';
            el.style.alignItems = 'center';
            el.style.flexDirection = 'row';
            el.style.justifyContent = 'center';
            el.style.flexWrap = 'wrap';
            el.style.textAlign = 'center';
            el.style.gap = '0.1em';
            try { el.style.setProperty('white-space', 'normal', 'important'); } catch (_) { el.style.whiteSpace = 'normal'; }
        };

        // Helper to render unavailable/no data with dash
        const renderUnavailable = () => {
            applyLangStyles(placeholder);
            placeholder.innerHTML = `<span class="material-icons" style="font-size: inherit; margin-right: 0.3em;">translate</span> -`;
        };

        // Helper to render language items with proper DOM elements
        const renderLanguages = (languages) => {
            // Clear the loading indicator
            placeholder.innerHTML = '';
            placeholder.style.display = 'flex';
            placeholder.style.alignItems = 'center';
            placeholder.style.gap = '0.5em';
            placeholder.title = JE.t('audio_language_tooltip');

            // Add icon
            const icon = document.createElement('span');
            icon.className = 'material-icons';
            icon.style.fontSize = 'inherit';
            icon.style.flexShrink = '0';
            icon.textContent = 'translate';
            placeholder.appendChild(icon);

            const scrollContainer = document.createElement('div');
            scrollContainer.className = 'audio-languages-container';
            scrollContainer.style.display = 'flex';
            scrollContainer.style.flexWrap = 'nowrap';
            scrollContainer.style.gap = '0.1em';
            scrollContainer.style.alignItems = 'center';
            scrollContainer.style.overflowY = 'hidden';

            if (languages.length > 3) { //if there are more than 3 languages, make it scrollable
                scrollContainer.style.overflowX = 'auto';
                scrollContainer.style.scrollBehavior = 'smooth';
                scrollContainer.style.whiteSpace = 'nowrap';
                scrollContainer.style.maxWidth = '20em';
                scrollContainer.style.paddingBottom = '2px';
                scrollContainer.style.touchAction = 'pan-x';
                scrollContainer.style.webkitOverflowScrolling = 'touch';

                // Hide scrollbar
                scrollContainer.style.scrollbarWidth = 'none';
                scrollContainer.style.msOverflowStyle = 'none';
                scrollContainer.style.overflowY = 'hidden';
                scrollContainer.addEventListener('wheel', (e) => {
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                        scrollContainer.scrollLeft += e.deltaY;
                        e.preventDefault();
                    }
                }, { passive: false });
                // Inject inline webkit scrollbar hide
                scrollContainer.style.setProperty('::-webkit-scrollbar', 'display: none');

                // Add indicator showing scrollable content
                const indicator = document.createElement('span');
                indicator.className = 'scroll-indicator';
                indicator.style.display = 'inline-block';
                indicator.style.opacity = '0.7';
                indicator.style.fontSize = '0.9em';
                indicator.textContent = '⇆';
                placeholder.appendChild(indicator);
            }

            languages.forEach((lang, index) => {
                // Create container span with data-lang attribute
                const langSpan = document.createElement('span');
                langSpan.className = 'audio-language-item';
                langSpan.dataset.lang = lang.code;
                langSpan.dataset.langName = lang.name;
                langSpan.style.whiteSpace = 'nowrap';

                const countryCode = languageToCountryMap[lang.name] || languageToCountryMap[lang.code];
                if (countryCode) {
                    const flag = document.createElement('img');
                    flag.src = `https://cdnjs.cloudflare.com/ajax/libs/flag-icons/7.2.1/flags/4x3/${countryCode.toLowerCase()}.svg`;
                    flag.alt = `${lang.name} flag`;
                    flag.style.width = '18px';
                    flag.style.marginRight = '0.3em';
                    flag.style.borderRadius = '2px';
                    langSpan.appendChild(flag);
                }

                const text = document.createTextNode(lang.name);
                langSpan.appendChild(text);

                scrollContainer.appendChild(langSpan);

                if (index < languages.length - 1) {
                    const separator = document.createElement('span');
                    separator.style.margin = '0 0.25em';
                    separator.textContent = ', ';
                    separator.style.whiteSpace = 'nowrap';
                    scrollContainer.appendChild(separator);
                }
            });

            placeholder.appendChild(scrollContainer);
        };

        // Use requestIdleCallback to defer the work and not block page rendering
        const performFetch = async () => {
            // Check cache first
            const now = Date.now();
            const cached = audioLanguageCache.get(itemId);
            if (cached && (now - cached.ts) < LANGUAGE_CACHE_TTL) {
                if (cached.unavailable || !cached.languages || cached.languages.length === 0) {
                    renderUnavailable();
                    return;
                }
                // Render from cache
                renderLanguages(cached.languages);
                return;
            }

            try {
                const userId = ApiClient.getCurrentUserId();
                const item = JE.helpers?.getItemCached
                    ? await JE.helpers.getItemCached(itemId, { userId })
                    : await ApiClient.getItem(userId, itemId);

                let sourceItem = item;

                // For Series/Season, fetch the first episode to get language info
                if (item.Type === 'Series' || item.Type === 'Season') {
                    const episode = await fetchFirstEpisodeForLanguage(userId, item.Id);
                    if (episode) {
                        sourceItem = episode;
                    } else {
                        // No episodes found
                        renderUnavailable();
                        audioLanguageCache.set(itemId, { languages: [], unavailable: true, ts: Date.now() });
                        return;
                    }
                }

                const languages = new Set();
                sourceItem?.MediaSources?.forEach(source => {
                    source.MediaStreams?.filter(stream => stream.Type === 'Audio').forEach(stream => {
                        const langCode = stream.Language;
                        if (langCode && !['und', 'root'].includes(langCode.toLowerCase())) {
                            try {
                                const langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(langCode);
                                languages.add(JSON.stringify({ name: langName, code: langCode }));
                            } catch (e) {
                                languages.add(JSON.stringify({ name: langCode.toUpperCase(), code: langCode }));
                            }
                        }
                    });
                });

                const uniqueLanguages = Array.from(languages).map(JSON.parse);
                if (uniqueLanguages.length > 0) {
                    renderLanguages(uniqueLanguages);
                    // Cache the successful result
                    audioLanguageCache.set(itemId, { languages: uniqueLanguages, unavailable: false, ts: Date.now() });
                } else {
                    renderUnavailable();
                    audioLanguageCache.set(itemId, { languages: [], unavailable: true, ts: Date.now() });
                }
            } catch (error) {
                console.error('🪼 Jellyfin Enhanced: Error fetching audio languages for %s:', itemId, error);
                renderUnavailable();
                audioLanguageCache.set(itemId, { languages: [], unavailable: true, ts: Date.now() });
            }
        };

        // Defer to allow page to render first
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(() => performFetch(), { timeout: 2000 });
        } else {
            setTimeout(() => performFetch(), 0);
        }
    }

    /**
     * Handle item details page display with debounced observer
     */
    // Cache the last item id and type to avoid repeated ApiClient calls
    let lastDetailsItemId = null;
    let lastDetailsItemType = null;
    let itemTypeFetchInProgress = null;

    // Types that support file size and watch progress
    const FEATURES_SUPPORTED_TYPES = ['Episode', 'Season', 'Series', 'Movie', 'BoxSet', 'Playlist'];
    // Types that support audio languages (excludes BoxSet and Playlist)
    const AUDIO_LANGUAGES_SUPPORTED_TYPES = ['Episode', 'Season', 'Series', 'Movie'];

    // Types that support hiding
    const HIDE_SUPPORTED_TYPES = ['Movie', 'Series', 'Episode', 'Season'];

    /**
     * Adds a "Hide" button to the item detail page action buttons area.
     * Supports Movies, Series, Episodes, and Seasons.
     * For Episodes: shows a choice dialog between hiding the episode or the entire show.
     * @param {string} itemId The item's Jellyfin ID.
     * @param {HTMLElement} visiblePage The visible detail page element.
     */
    function addHideContentButton(itemId, visiblePage) {
        if (!JE.hiddenContent) return;
        const settings = JE.hiddenContent.getSettings();
        if (!settings.enabled || !settings.showHideButtons) return;
        const isPerson = lastDetailsItemType === 'Person';
        if (isPerson) {
            if (!settings.showButtonCast) return;
        } else {
            if (settings.showButtonDetails === false) return;
            if (!HIDE_SUPPORTED_TYPES.includes(lastDetailsItemType)) return;
        }

        // Don't add duplicate
        if (visiblePage.querySelector('.je-detail-hide-btn')) return;

        const selectors = [
            '.detailButtons',
            '.itemActionsBottom',
            '.mainDetailButtons',
            '.detailButtonsContainer'
        ];
        let buttonContainer = null;
        for (const sel of selectors) {
            const found = visiblePage.querySelector(sel);
            if (found) {
                buttonContainer = found;
                break;
            }
        }
        if (!buttonContainer) return;

        const button = document.createElement('button');
        button.setAttribute('is', 'emby-button');
        button.className = 'button-flat detailButton emby-button je-detail-hide-btn';
        button.type = 'button';

        const hideLabel = JE.t('hidden_content_hide_button') !== 'hidden_content_hide_button'
            ? JE.t('hidden_content_hide_button')
            : 'Hide';
        const hiddenLabel = JE.t('hidden_content_already_hidden') !== 'hidden_content_already_hidden'
            ? JE.t('hidden_content_already_hidden')
            : 'Hidden';
        const unhideLabel = JE.t('hidden_content_unhide') !== 'hidden_content_unhide'
            ? JE.t('hidden_content_unhide')
            : 'Unhide';

        const content = document.createElement('div');
        content.className = 'detailButton-content';
        button.appendChild(content);

        function renderContent(text, iconName) {
            content.replaceChildren();
            const icon = document.createElement('span');
            icon.className = 'material-icons detailButton-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = iconName || 'visibility';
            content.appendChild(icon);
            if (text) {
                const textSpan = document.createElement('span');
                textSpan.className = 'detailButton-icon-text';
                textSpan.textContent = text;
                content.appendChild(textSpan);
            }
        }

        function setHiddenState() {
            button.classList.add('je-already-hidden');
            button.setAttribute('aria-label', hiddenLabel);
            button.title = hiddenLabel;
            renderContent('', 'visibility_off');

            button.onmouseenter = () => {
                button.title = unhideLabel;
            };
            button.onmouseleave = () => {
                button.title = hiddenLabel;
            };
            button.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                JE.hiddenContent.unhideItem(itemId);
                setHideState();
            };
        }

        function setHideState() {
            button.classList.remove('je-already-hidden');
            button.setAttribute('aria-label', hideLabel);
            button.title = hideLabel;
            renderContent('', 'visibility');
            button.onmouseenter = null;
            button.onmouseleave = null;
            button.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Get item name from the page title
                const nameEl = visiblePage.querySelector('.itemName, h1, h2, [class*="itemName"]');
                const itemName = nameEl?.textContent?.trim() || 'Unknown';

                // Fetch full item data for TMDb ID and episode/series metadata
                let tmdbId = '';
                let seriesId = '';
                let seriesName = '';
                let seasonNumber = null;
                let episodeNumber = null;
                try {
                    const userId = ApiClient.getCurrentUserId();
                    const item = JE.helpers?.getItemCached
                        ? await JE.helpers.getItemCached(itemId, { userId })
                        : await ApiClient.getItem(userId, itemId);
                    tmdbId = item?.ProviderIds?.Tmdb || '';
                    seriesId = item?.SeriesId || '';
                    seriesName = item?.SeriesName || '';
                    seasonNumber = item?.ParentIndexNumber != null ? item.ParentIndexNumber : null;
                    episodeNumber = item?.IndexNumber != null ? item.IndexNumber : null;
                } catch (err) {
                    console.warn('🪼 Jellyfin Enhanced: Could not fetch item metadata for hide button', err);
                }

                const isEpisode = lastDetailsItemType === 'Episode';
                const isSeason = lastDetailsItemType === 'Season';

                // Build base item data
                const baseItemData = {
                    itemId,
                    name: itemName,
                    type: lastDetailsItemType,
                    tmdbId,
                    seriesId,
                    seriesName,
                    seasonNumber,
                    episodeNumber
                };

                if (isEpisode && seriesId) {
                    // Episode on a detail page: show choice dialog
                    JE.hiddenContent.confirmAndHide(baseItemData, () => {
                        setHiddenState();
                    }, {
                        showEpisodeChoice: true,
                        onChooseShow: async () => {
                            // User chose to hide the entire show
                            let seriesTmdbId = '';
                            try {
                                const userId = ApiClient.getCurrentUserId();
                                const series = await ApiClient.getItem(userId, seriesId);
                                seriesTmdbId = series?.ProviderIds?.Tmdb || '';
                            } catch (err) {
                                console.warn('🪼 Jellyfin Enhanced: Could not fetch series metadata for hide-show action', err);
                            }
                            JE.hiddenContent.hideItem({
                                itemId: seriesId,
                                name: seriesName || itemName,
                                type: 'Series',
                                tmdbId: seriesTmdbId,
                                posterPath: ''
                            });
                            setHiddenState();
                        }
                    });
                } else if (isSeason && seriesId) {
                    // Season: hide with series metadata
                    JE.hiddenContent.confirmAndHide(baseItemData, () => {
                        setHiddenState();
                    });
                } else {
                    // Movie or Series: standard hide
                    JE.hiddenContent.confirmAndHide(baseItemData, () => {
                        setHiddenState();
                    });
                }
            };
        }

        if (JE.hiddenContent.isHidden(itemId)) {
            setHiddenState();
        } else {
            setHideState();
        }

        // Keep Jellyfin's overflow menu (three-dots) as the last action button.
        const moreButton = buttonContainer.querySelector('.btnMoreCommands');
        if (moreButton) {
            buttonContainer.insertBefore(button, moreButton);
        } else {
            buttonContainer.appendChild(button);
        }
    }

    const handleItemDetails = JE.helpers.debounce(() => {
        const visiblePage = document.querySelector('#itemDetailPage:not(.hide)');
        if (!visiblePage) return;

        const container = visiblePage.querySelector('.itemMiscInfo.itemMiscInfo-primary');
        if (!container) return;

        try {
            const itemId = new URLSearchParams(window.location.hash.split('?')[1]).get('id');
            if (!itemId) return;

            // Reset cache when navigating to a new item
            if (lastDetailsItemId !== itemId) {
                lastDetailsItemId = itemId;
                lastDetailsItemType = null;
            }

            // Fetch item type once per item to decide applicability
            if (!lastDetailsItemType) {
                if (!itemTypeFetchInProgress) {
                    const userId = ApiClient.getCurrentUserId();
                    itemTypeFetchInProgress = (JE.helpers?.getItemCached
                        ? JE.helpers.getItemCached(itemId, { userId })
                        : ApiClient.getItem(userId, itemId))
                        .then(item => {
                            lastDetailsItemType = item?.Type || null;
                            itemTypeFetchInProgress = null;
                            // Re-run once type is known to render features
                            handleItemDetails();
                        })
                        .catch(() => { itemTypeFetchInProgress = null; });
                }
                return;
            }

            // Add hide content button on detail pages (including Person pages)
            if (JE.hiddenContent) {
                addHideContentButton(itemId, visiblePage);
            }

            // Skip unsupported item types for media features
            if (!FEATURES_SUPPORTED_TYPES.includes(lastDetailsItemType)) {
                return;
            }

            if (JE?.currentSettings?.showWatchProgress) {
                displayWatchProgress(itemId, container);
            }
            if (JE?.currentSettings?.showFileSizes) {
                displayItemSize(itemId, container);
            }
            if (JE?.currentSettings?.showAudioLanguages && AUDIO_LANGUAGES_SUPPORTED_TYPES.includes(lastDetailsItemType)) {
                displayAudioLanguages(itemId, container);
            }
        } catch (e) {
        console.warn('🪼 Jellyfin Enhanced: Error in item details handler', e);
    }
    }, 100);

    // Create managed observer for item details
    JE.helpers.createObserver(
        'item-details-info',
        (mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' || mutation.type === 'attributes') {
                    handleItemDetails();
                }
            }
        },
        document.body,
        {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        }
    );

    /**
     * Non-destructive "Remove from Continue Watching": POST + optimistic DOM hide. Position preserved.
     * @param {string} itemId Jellyfin item ID.
     * @returns {Promise<boolean>}
     */
    async function removeFromContinueWatching(itemId) {
        const userId = ApiClient.getCurrentUserId();
        if (!userId || !itemId) {
            showNotification(JE.t('remove_continue_watching_error'), "error");
            return false;
        }

        // Flush pending HC save BEFORE the CW POST so a later debounce can't clobber the just-written entry.
        // If the flush fails the debounce is rescheduled inside flushPendingSave; abort the CW write so we
        // don't proceed on top of stale server state.
        try {
            await JE.hiddenContent?.flushPendingSave?.();
        } catch (e) {
            showNotification(JE.t('remove_continue_watching_error_api', { error: e?.statusText || JE.t('unknown_error') }), "error");
            return false;
        }

        try {
            await ApiClient.ajax({
                type: 'POST',
                url: ApiClient.getUrl(`/JellyfinEnhanced/continue-watching/hide/${itemId}`),
                data: '{}',
                contentType: 'application/json',
                dataType: 'json',
                headers: { 'Content-Type': 'application/json' }
            });

            try {
                document.querySelectorAll(`.card[data-id="${CSS.escape(itemId)}"]`).forEach(card => {
                    if (card.hasAttribute('data-positionticks')) {
                        card.style.display = 'none';
                    }
                });
            } catch (e) {
                console.warn('🪼 Jellyfin Enhanced: optimistic CW DOM-hide failed', e);
            }

            // Local-cache mirror only — server already wrote the canonical entry; a refetch would risk a clobber.
            try {
                JE.hiddenContent?.markScopedHidden?.(itemId, 'continuewatching');
            } catch (e) {
                console.warn('🪼 Jellyfin Enhanced: markScopedHidden mirror failed', e);
            }
            return true;
        } catch (error) {
            const errorMessage = error.responseJSON?.message
                || error.responseJSON?.Message
                || error.statusText
                || JE.t('unknown_error');
            showNotification(JE.t('remove_continue_watching_error_api', { error: errorMessage }), "error");
            return false;
        }
    }

    // Closes any open action sheet via dialog.close() / Escape; never synthetic mouse events (they reopen the sheet).
    function closeOpenActionSheet() {
        try {
            const dialogs = document.querySelectorAll('dialog[open]');
            let dispatched = false;
            for (const dlg of dialogs) {
                if (typeof dlg.close === 'function') {
                    try { dlg.close(); dispatched = true; } catch (e) { /* not a real dialog */ }
                }
            }
            if (dispatched) return true;

            // Escape-keydown fallback targets the sheet directly — dispatching on `document` is intercepted by JE's global shortcuts.
            const sheet = document.querySelector('.actionSheet, .actionsheet, dialog[open], .dialogContainer .dialog, .dialog.opened');
            if (sheet) {
                sheet.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                    bubbles: true, cancelable: true
                }));
            }
            return true;
        } catch (err) {
            console.warn('🪼 Jellyfin Enhanced: action sheet close failed', err);
            return false;
        }
    }

    /** Hides Continue Watching / Next Up rows whose visible-card count is zero so the title doesn't linger. */
    function hideEmptyHomeSections() {
        try {
            const sections = document.querySelectorAll('.verticalSection, .section, .homeSection');
            for (const section of sections) {
                const titleEl = section.querySelector('.sectionTitle, h2, .headerText, .sectionTitle-sectionTitle');
                const title = (titleEl?.textContent || '').toLowerCase().trim();
                const isCW = title.startsWith('continue watching');
                const isNextUp = title.startsWith('next up');
                if (!isCW && !isNextUp) continue;

                const cards = section.querySelectorAll('.card[data-positionticks], .card[data-id]');
                let visibleCount = 0;
                for (const card of cards) {
                    if (card.classList.contains('je-hidden')) continue;
                    if (card.style.display === 'none') continue;
                    visibleCount++;
                }
                if (visibleCount === 0) section.style.display = 'none';
            }
        } catch (err) {
            console.warn('🪼 Jellyfin Enhanced: hideEmptyHomeSections failed', err);
        }
    }
    JE.hideEmptyHomeSections = hideEmptyHomeSections;

    /**
     * Creates the "Remove" button for the context menu action sheet.
     * @param {string} itemId The ID of the item.
     * @returns {HTMLElement} The created button element.
     */
    function createRemoveButton(itemId) {
        const button = document.createElement('button');
        button.setAttribute('is', 'emby-button');
        button.className = 'listItem listItem-button actionSheetMenuItem emby-button remove-continue-watching-button';
        button.dataset.id = 'remove-continue-watching';
        button.innerHTML = `
            <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons" aria-hidden="true">visibility_off</span>
            <div class="listItemBody actionsheetListItemBody"><div class="listItemBodyText actionSheetItemText">${JE.t('remove_button_text')}</div></div>
        `;

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const buttonTextElem = button.querySelector('.actionSheetItemText');
            const buttonIconElem = button.querySelector('.material-icons');
            const originalText = buttonTextElem.textContent;
            const originalIcon = buttonIconElem.textContent;

            button.disabled = true;
            buttonTextElem.textContent = JE.t('remove_button_removing');
            buttonIconElem.textContent = 'hourglass_empty';

            const success = await removeFromContinueWatching(itemId);

            if (success) {
                // Restore button visuals BEFORE close — a stuck sheet under odd themes is better than a stuck "Removing..." label.
                button.disabled = false;
                buttonTextElem.textContent = originalText;
                buttonIconElem.textContent = originalIcon;

                const closed = closeOpenActionSheet();
                showNotification(JE.t('remove_continue_watching_success'), closed ? "success" : "info");

                hideEmptyHomeSections();
            } else {
                button.disabled = false;
                buttonTextElem.textContent = originalText;
                buttonIconElem.textContent = originalIcon;
            }
        });

        return button;
    }

    /**
     * Adds the "Remove from Continue Watching" button to the action sheet if applicable.
     */
    JE.addRemoveButton = () => {
        if (!JE.currentSettings.removeContinueWatchingEnabled || !JE.state.isContinueWatchingContext) {
            return;
        }

        const actionSheetContent = document.querySelector('.actionSheetContent .actionSheetScroller');
        if (!actionSheetContent || actionSheetContent.querySelector('[data-id="remove-continue-watching"]')) {
            return;
        }

        const itemId = JE.state.currentContextItemId;
        if (!itemId) return;

        // Reset context flags after use
        JE.state.isContinueWatchingContext = false;
        JE.state.currentContextItemId = null;

        const removeButton = createRemoveButton(itemId);
        const insertionPoint = actionSheetContent.querySelector('[data-id="playallfromhere"]')
            || actionSheetContent.querySelector('[data-id="resume"]')
            || actionSheetContent.querySelector('[data-id="play"]');

        if (insertionPoint) {
            insertionPoint.after(removeButton);
        } else {
            actionSheetContent.appendChild(removeButton);
        }
    };

    // ── Download as VLC playlist ──────────────────────────────────────────────
    // Adds "Download as VLC playlist" to the Movie/Episode details "..." action
    // sheet (a single stream), and a multi-track playlist to the Season ("...") and
    // Series ("...") sheets: a Season exports just that season, a Series the whole
    // show. Each entry points at the item's download URL (api_key included) — the
    // same URL Jellyfin's native "Download"/"Copy Stream URL" produces — so VLC
    // streams it directly.

    // Only leaf, downloadable types have a single playable stream.
    const VLC_PLAYLIST_SUPPORTED_TYPES = ['Movie', 'Episode'];

    // Builds the item's direct download URL (api_key included), same as native download.
    function buildVlcStreamUrl(itemId) {
        if (typeof ApiClient.getItemDownloadUrl === 'function') {
            return ApiClient.getItemDownloadUrl(itemId);
        }
        // Fallback for older/newer ApiClient shapes — same URL getItemDownloadUrl builds.
        return ApiClient.getUrl('Items/' + encodeURIComponent(itemId) + '/Download', { api_key: ApiClient.accessToken() });
    }

    // Human-friendly title for a playlist entry, e.g. "The Show - S01E02 - Pilot".
    function buildVlcPlaylistTitle(item) {
        if (item.Type === 'Episode') {
            const pad = (n) => String(n).padStart(2, '0');
            let code = '';
            if (item.ParentIndexNumber != null && item.IndexNumber != null) {
                code = `S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)}`;
                // Multi-episode files span a range, e.g. S01E02-E03.
                if (item.IndexNumberEnd != null && item.IndexNumberEnd > item.IndexNumber) {
                    code += `-E${pad(item.IndexNumberEnd)}`;
                }
            }
            return [item.SeriesName, code, item.Name].filter(Boolean).join(' - ') || 'Episode';
        }
        const year = item.ProductionYear ? ` (${item.ProductionYear})` : '';
        return (item.Name || 'video') + year;
    }

    // Strip filename-illegal chars across OSes, collapse whitespace, cap length
    // without splitting a surrogate pair, and trim leading/trailing dots/spaces.
    function sanitizeVlcFilename(name) {
        const cleaned = [...String(name || 'playlist')
            .replace(/[\/\\:*?"<>|\r\n\t]+/g, '_')
            .replace(/\s+/g, ' ')
            .trim()]
            .slice(0, 120)
            .join('')
            .replace(/^[.\s]+|[.\s]+$/g, '');
        return cleaned || 'playlist';
    }

    // Escape the five XML predefined entities for safe use in XSPF element text.
    function xmlEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // One XSPF <track>. Strips XML-1.0-illegal control chars (cannot be escaped,
    // only removed) and newlines, then XML-escapes (the URL's & becomes &amp;).
    function vlcXspfTrack(url, title) {
        const t = xmlEscape(String(title || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '').replace(/[\r\n]+/g, ' ').trim());
        const u = xmlEscape(String(url).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\r\n\t]+/g, '').trim());
        return `    <track>\n      <title>${t}</title>\n      <location>${u}</location>\n    </track>`;
    }

    // Wrap one or more <track> blocks into an XSPF document (VLC's native format).
    // The XML header declares UTF-8, so no BOM is needed.
    function buildVlcXspfDoc(tracksXml) {
        return `<?xml version="1.0" encoding="UTF-8"?>\n<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <trackList>\n${tracksXml}\n  </trackList>\n</playlist>\n`;
    }

    function createVlcPlaylistButton(item) {
        const button = document.createElement('button');
        button.setAttribute('is', 'emby-button');
        button.className = 'listItem listItem-button actionSheetMenuItem emby-button download-vlc-playlist-button';
        button.dataset.id = 'download-vlc-playlist';
        button.innerHTML = `
            <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons" aria-hidden="true">playlist_play</span>
            <div class="listItemBody actionsheetListItemBody"><div class="listItemBodyText actionSheetItemText">${JE.t('download_vlc_playlist')}</div></div>
        `;

        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                const url = buildVlcStreamUrl(item.Id);
                if (!url) throw new Error('empty stream url');
                const title = buildVlcPlaylistTitle(item);
                const playlist = buildVlcXspfDoc(vlcXspfTrack(url, title));
                JE.helpers.downloadTextFile(sanitizeVlcFilename(title) + '.xspf', playlist, 'application/xspf+xml');
                closeOpenActionSheet();
                showNotification(JE.t('download_vlc_playlist_success'), 'success');
            } catch (error) {
                console.warn('🪼 Jellyfin Enhanced: VLC playlist download failed', error);
                showNotification(JE.t('download_vlc_playlist_error'), 'error');
            }
        });

        return button;
    }

    function createVlcShowButton(item) {
        const isSeason = item.Type === 'Season';
        const label = isSeason
            ? JE.t('download_vlc_season_playlist')
            : JE.t('download_vlc_show_playlist');
        const button = document.createElement('button');
        button.setAttribute('is', 'emby-button');
        button.className = 'listItem listItem-button actionSheetMenuItem emby-button download-vlc-show-button';
        button.dataset.id = 'download-vlc-show';
        button.innerHTML = `
            <span class="actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons" aria-hidden="true">playlist_add</span>
            <div class="listItemBody actionsheetListItemBody"><div class="listItemBodyText actionSheetItemText">${label}</div></div>
        `;

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Scope by this item: a Season returns only its own episodes; a Series
            // (Recursive) returns every episode across all seasons.
            const parentId = item.Id;
            try {
                if (!parentId) throw new Error('no item id');
                const userId = ApiClient.getCurrentUserId();
                if (!userId) throw new Error('no current user');
                // Episodes under this item, in season→episode order. SeriesName is
                // requested so the filename and per-track titles get the show name
                // (a Season's own payload doesn't carry SeriesName).
                const url = ApiClient.getUrl(`/Users/${userId}/Items`, {
                    ParentId: parentId,
                    IncludeItemTypes: 'Episode',
                    Recursive: true,
                    SortBy: 'ParentIndexNumber,IndexNumber',
                    SortOrder: 'Ascending',
                    Fields: 'CanDownload,SeriesName'
                });
                const result = await ApiClient.ajax({ type: 'GET', url, dataType: 'json' });
                const episodes = ((result && result.Items) || []).filter(ep => ep && ep.Id && ep.CanDownload !== false);
                if (!episodes.length) throw new Error('no downloadable episodes');
                const showName = (episodes[0] && episodes[0].SeriesName) || item.SeriesName || item.Name || 'show';
                const playlistName = isSeason
                    ? [showName, item.Name].filter(Boolean).join(' - ')
                    : showName;
                const tracksXml = episodes
                    .map(ep => vlcXspfTrack(buildVlcStreamUrl(ep.Id), buildVlcPlaylistTitle(ep)))
                    .join('\n');
                const playlist = buildVlcXspfDoc(tracksXml);
                JE.helpers.downloadTextFile(sanitizeVlcFilename(playlistName) + '.xspf', playlist, 'application/xspf+xml');
                closeOpenActionSheet();
                showNotification(
                    isSeason
                        ? JE.t('download_vlc_season_success')
                        : JE.t('download_vlc_show_success'),
                    'success'
                );
            } catch (error) {
                console.warn('🪼 Jellyfin Enhanced: VLC show playlist download failed', error);
                showNotification(
                    isSeason
                        ? JE.t('download_vlc_season_error')
                        : JE.t('download_vlc_show_error'),
                    'error'
                );
            }
        });

        return button;
    }

    /**
     * Adds the single-stream "Download as VLC playlist" item to the Movie/Episode
     * details "..." action sheet (only when the item is downloadable).
     */
    JE.addVlcPlaylistButton = () => {
        if (typeof JE.isDetailsPage !== 'function' || !JE.isDetailsPage()) return;

        const scroller = document.querySelector('.actionSheetContent .actionSheetScroller');
        if (!scroller) return;
        if (scroller.querySelector('[data-id="download-vlc-playlist"]')) return;

        const query = window.location.hash.split('?')[1];
        const itemId = query ? new URLSearchParams(query).get('id') : null;
        if (!itemId) return;

        const userId = ApiClient.getCurrentUserId();
        const itemPromise = JE.helpers?.getItemCached
            ? JE.helpers.getItemCached(itemId, { userId })
            : ApiClient.getItem(userId, itemId);
        itemPromise.then((item) => {
            if (!item || !VLC_PLAYLIST_SUPPORTED_TYPES.includes(item.Type)) return;
            // CanDownload is absent from the default item payload, so only suppress on an
            // explicit false (matches native gating when the field is actually present).
            if (item.CanDownload === false) return;
            if (!scroller.isConnected || scroller.querySelector('[data-id="download-vlc-playlist"]')) return;

            const button = createVlcPlaylistButton(item);
            const insertionPoint = scroller.querySelector('[data-id="copy-stream"]')
                || scroller.querySelector('[data-id="download"]')
                || scroller.querySelector('[data-id="resume"]')
                || scroller.querySelector('[data-id="play"]');
            if (insertionPoint) {
                insertionPoint.after(button);
            } else {
                scroller.appendChild(button);
            }
        }).catch((error) => {
            console.warn('🪼 Jellyfin Enhanced: addVlcPlaylistButton failed', error);
        });
    };

    /**
     * Adds the multi-track VLC playlist item to the Season or Series details "..."
     * action sheet: from a Season it downloads just that season's episodes, from a
     * Series the whole show.
     */
    JE.addVlcShowPlaylistButton = () => {
        if (typeof JE.isDetailsPage !== 'function' || !JE.isDetailsPage()) return;

        const scroller = document.querySelector('.actionSheetContent .actionSheetScroller');
        if (!scroller) return;
        if (scroller.querySelector('[data-id="download-vlc-show"]')) return;

        const query = window.location.hash.split('?')[1];
        const itemId = query ? new URLSearchParams(query).get('id') : null;
        if (!itemId) return;

        const userId = ApiClient.getCurrentUserId();
        const itemPromise = JE.helpers?.getItemCached
            ? JE.helpers.getItemCached(itemId, { userId })
            : ApiClient.getItem(userId, itemId);
        itemPromise.then((item) => {
            if (!item || (item.Type !== 'Season' && item.Type !== 'Series')) return;
            if (!scroller.isConnected || scroller.querySelector('[data-id="download-vlc-show"]')) return;

            const button = createVlcShowButton(item);
            const insertionPoint = scroller.querySelector('[data-id="downloadall"]')
                || scroller.querySelector('[data-id="download"]')
                || scroller.querySelector('[data-id="resume"]')
                || scroller.querySelector('[data-id="play"]');
            if (insertionPoint) {
                insertionPoint.after(button);
            } else {
                scroller.appendChild(button);
            }
        }).catch((error) => {
            console.warn('🪼 Jellyfin Enhanced: addVlcShowPlaylistButton failed', error);
        });
    };


})(window.JellyfinEnhanced);
