document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const fetchForm = document.getElementById('fetch-form');
    const videoUrlInput = document.getElementById('video-url');
    const pasteBtn = document.getElementById('paste-btn');
    const fetchSubmitBtn = document.getElementById('fetch-submit-btn');
    
    const loader = document.getElementById('loader');
    const errorAlert = document.getElementById('error-alert');
    const errorMessage = document.getElementById('error-message');
    
    const previewSection = document.getElementById('preview-section');
    const videoThumbnail = document.getElementById('video-thumbnail');
    const videoDuration = document.getElementById('video-duration');
    const videoTitle = document.getElementById('video-title');
    const videoChannel = document.getElementById('video-channel');
    const videoViews = document.getElementById('video-views');
    
    const formatSelect = document.getElementById('format-select');
    const tabVideo = document.getElementById('tab-video');
    const tabAudio = document.getElementById('tab-audio');
    const selectLabel = document.getElementById('select-label');
    const downloadBtnText = document.getElementById('download-btn-text');
    const downloadStartBtn = document.getElementById('download-start-btn');
    
    const progressSection = document.getElementById('progress-section');
    const progressStatusTitle = document.getElementById('progress-status-title');
    const progressPercent = document.getElementById('progress-percent');
    const progressBar = document.getElementById('progress-bar');
    const progressSpeed = document.getElementById('progress-speed');
    const progressEta = document.getElementById('progress-eta');
    
    const completedActions = document.getElementById('completed-actions');
    const fileDownloadLink = document.getElementById('file-download-link');
    const ffmpegBadgeContainer = document.getElementById('ffmpeg-badge-container');



    let pollingInterval = null;
    let currentVideoUrl = '';
    let fetchedFormats = [];
    let activeTab = 'video';

    /* ==========================================================================
       1. Custom Glowing Cursor
       ========================================================================== */
    const cursorDot = document.createElement('div');
    cursorDot.className = 'custom-cursor-dot';
    const cursorGlow = document.createElement('div');
    cursorGlow.className = 'custom-cursor-glow';
    document.body.appendChild(cursorDot);
    document.body.appendChild(cursorGlow);

    let mouseX = 0, mouseY = 0;
    let glowX = 0, glowY = 0;
    let isMoving = false;
    let cursorTimeout;

    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        
        // Show cursor elements
        cursorDot.classList.add('visible');
        cursorGlow.classList.add('visible');
        isMoving = true;

        // Reset inactivity timer
        clearTimeout(cursorTimeout);
        cursorTimeout = setTimeout(() => {
            cursorDot.classList.remove('visible');
            cursorGlow.classList.remove('visible');
            isMoving = false;
        }, 3000);

        // Move dot instantly
        cursorDot.style.left = `${mouseX}px`;
        cursorDot.style.top = `${mouseY}px`;
    });

    // LERP (Linear Interpolation) for smooth lag effect on glow
    function animateCursor() {
        glowX += (mouseX - glowX) * 0.16;
        glowY += (mouseY - glowY) * 0.16;
        cursorGlow.style.left = `${glowX}px`;
        cursorGlow.style.top = `${glowY}px`;
        requestAnimationFrame(animateCursor);
    }
    animateCursor();

    // Hover Scaling & Color Shifts
    const interactiveSelectors = 'button, input, select, a, .google-account-item, #paste-btn, .tab-btn';
    
    document.addEventListener('mouseover', (e) => {
        if (e.target.closest(interactiveSelectors)) {
            cursorGlow.classList.add('hovered');
            cursorDot.classList.add('hovered');
        }
    });

    document.addEventListener('mouseout', (e) => {
        if (e.target.closest(interactiveSelectors)) {
            cursorGlow.classList.remove('hovered');
            cursorDot.classList.remove('hovered');
        }
    });

    // Click Ripple Effect
    document.addEventListener('mousedown', () => {
        cursorGlow.classList.add('active');
        cursorDot.classList.add('active');
    });

    document.addEventListener('mouseup', () => {
        cursorGlow.classList.remove('active');
        cursorDot.classList.remove('active');
    });



    /* ==========================================================================
       3. Format Selection & Rendering
       ========================================================================== */
    function renderFormats(type) {
        activeTab = type;
        formatSelect.innerHTML = '';
        
        if (type === 'video') {
            selectLabel.textContent = 'Choose Resolution';
            downloadBtnText.textContent = 'Download MP4';
            
            const videoFormats = fetchedFormats.filter(fmt => fmt.extension === 'mp4');
            videoFormats.forEach(fmt => {
                const option = document.createElement('option');
                option.value = fmt.id;
                option.textContent = fmt.label;
                formatSelect.appendChild(option);
            });
        } else {
            selectLabel.textContent = 'Choose Audio Format';
            downloadBtnText.textContent = 'Download Audio';
            
            const audioFormats = fetchedFormats.filter(fmt => fmt.extension === 'mp3' || fmt.extension === 'm4a');
            audioFormats.forEach(fmt => {
                const option = document.createElement('option');
                option.value = fmt.id;
                option.textContent = fmt.label;
                formatSelect.appendChild(option);
            });
        }
    }

    // Tab Selection Event Listeners
    tabVideo.addEventListener('click', () => {
        if (activeTab === 'video') return;
        tabVideo.classList.add('active');
        tabAudio.classList.remove('active');
        renderFormats('video');
    });

    tabAudio.addEventListener('click', () => {
        if (activeTab === 'audio') return;
        tabAudio.classList.add('active');
        tabVideo.classList.remove('active');
        renderFormats('audio');
    });

    /* ==========================================================================
       4. Clipboard Paste Helper
       ========================================================================== */
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                videoUrlInput.value = text;
                videoUrlInput.focus();
            }
        } catch (err) {
            console.error('Failed to read clipboard contents: ', err);
        }
    });

    /* ==========================================================================
       5. Fetch Video Details Logic
       ========================================================================== */
    fetchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = videoUrlInput.value.trim();
        if (!url) return;

        currentVideoUrl = url;

        // Reset UI State
        errorAlert.classList.add('hidden');
        previewSection.classList.add('hidden');
        progressSection.classList.add('hidden');
        completedActions.classList.add('hidden');
        loader.classList.remove('hidden');
        fetchSubmitBtn.disabled = true;

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to analyze video URL.');
            }

            // Populate metadata card
            videoThumbnail.src = data.thumbnail || 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=600&auto=format&fit=crop&q=80';
            videoDuration.textContent = formatDuration(data.duration);
            videoTitle.textContent = data.title;
            videoChannel.textContent = data.channel;
            videoViews.textContent = `${formatViews(data.views)} views`;

            // Store formats and render default video tab
            fetchedFormats = data.formats || [];
            tabVideo.classList.add('active');
            tabAudio.classList.remove('active');
            renderFormats('video');

            // Set FFmpeg Badge
            renderFfmpegBadge(data.ffmpeg_installed);

            // Display metadata preview with fade in
            previewSection.classList.remove('hidden');
            
            // Scroll to preview
            previewSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        } catch (err) {
            errorMessage.textContent = err.message;
            errorAlert.classList.remove('hidden');
            errorAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } finally {
            loader.classList.add('hidden');
            fetchSubmitBtn.disabled = false;
        }
    });

    /* ==========================================================================
       6. Download Video Logic
       ========================================================================== */
    downloadStartBtn.addEventListener('click', async () => {
        const selectedFormat = formatSelect.value;
        if (!selectedFormat) return;

        // Disable elements
        downloadStartBtn.disabled = true;
        formatSelect.disabled = true;

        try {
            const response = await fetch('/api/download/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: currentVideoUrl,
                    format: selectedFormat
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to start download.');
            }

            const downloadId = data.download_id;

            // Shift view to progress card
            previewSection.classList.add('hidden');
            progressSection.classList.remove('hidden');
            completedActions.classList.add('hidden');
            
            // Reset Progress Stats
            progressStatusTitle.textContent = activeTab === 'video' ? 'Downloading video...' : 'Downloading audio...';
            progressPercent.textContent = '0%';
            progressBar.style.width = '0%';
            progressSpeed.textContent = 'Speed: Preparing...';
            progressEta.textContent = 'ETA: Calculating...';
            
            progressSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            // Start Polling progress endpoint
            startProgressPolling(downloadId);

        } catch (err) {
            errorMessage.textContent = err.message;
            errorAlert.classList.remove('hidden');
            previewSection.classList.remove('hidden');
            errorAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } finally {
            downloadStartBtn.disabled = false;
            formatSelect.disabled = false;
        }
    });

    /* ==========================================================================
       7. Download Progress Polling
       ========================================================================== */
    function startProgressPolling(downloadId) {
        if (pollingInterval) clearInterval(pollingInterval);

        pollingInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/download/progress/${downloadId}`);
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to get progress updates.');
                }

                if (data.status === 'downloading') {
                    const percentage = data.percentage || 0;
                    progressPercent.textContent = `${percentage}%`;
                    progressBar.style.width = `${percentage}%`;
                    progressSpeed.textContent = `Speed: ${formatSpeed(data.speed)}`;
                    progressEta.textContent = `ETA: ${formatETA(data.eta)}`;
                } else if (data.status === 'processing') {
                    progressPercent.textContent = '100%';
                    progressBar.style.width = '100%';
                    progressStatusTitle.textContent = 'Processing files... (Muxing Audio/Video)';
                    progressSpeed.textContent = 'Running post-processors';
                    progressEta.textContent = 'Almost done...';
                } else if (data.status === 'completed') {
                    clearInterval(pollingInterval);
                    progressStatusTitle.textContent = 'Download Complete!';
                    progressSpeed.textContent = 'Ready';
                    progressEta.textContent = 'Finished';

                    fileDownloadLink.href = `/api/download/file/${downloadId}`;
                    completedActions.classList.remove('hidden');

                    // Auto-trigger browser download
                    triggerBrowserDownload(`/api/download/file/${downloadId}`);
                } else if (data.status === 'error') {
                    throw new Error(data.error || 'An error occurred during video download.');
                }

            } catch (err) {
                clearInterval(pollingInterval);
                errorMessage.textContent = err.message;
                errorAlert.classList.remove('hidden');
                progressSection.classList.add('hidden');
                
                videoUrlInput.focus();
                errorAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 1000);
    }

    /* ==========================================================================
       8. Helper Formatters
       ========================================================================== */
    function triggerBrowserDownload(url) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        setTimeout(() => {
            document.body.removeChild(anchor);
        }, 100);
    }

    function formatDuration(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        
        const pad = (num) => num.toString().padStart(2, '0');
        
        if (h > 0) {
            return `${h}:${pad(m)}:${pad(s)}`;
        } else {
            return `${m}:${pad(s)}`;
        }
    }

    function formatViews(views) {
        if (!views || isNaN(views)) return '0';
        if (views >= 1e9) {
            return (views / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
        }
        if (views >= 1e6) {
            return (views / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        }
        if (views >= 1e3) {
            return (views / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        }
        return views.toString();
    }

    function formatSpeed(bytesPerSec) {
        if (!bytesPerSec || isNaN(bytesPerSec)) return '-- MB/s';
        const mb = bytesPerSec / (1024 * 1024);
        if (mb >= 1) {
            return `${mb.toFixed(2)} MB/s`;
        }
        const kb = bytesPerSec / 1024;
        return `${kb.toFixed(1)} KB/s`;
    }

    function formatETA(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) return '--s';
        if (seconds < 60) {
            return `${seconds}s`;
        }
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    }

    function renderFfmpegBadge(isInstalled) {
        ffmpegBadgeContainer.innerHTML = '';
        const badge = document.createElement('div');
        badge.className = isInstalled ? 'badge badge-success' : 'badge badge-warning';
        
        const dot = document.createElement('span');
        dot.style.display = 'inline-block';
        dot.style.width = '6px';
        dot.style.height = '6px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = isInstalled ? '#10b981' : '#f59e0b';
        
        const label = document.createElement('span');
        label.textContent = isInstalled ? 'FFmpeg: Connected' : 'FFmpeg: Configuring...';
        
        badge.appendChild(dot);
        badge.appendChild(label);
        ffmpegBadgeContainer.appendChild(badge);
    }

    /* ==========================================================================
       9. Drag-and-Drop Fun Movable Companion
       ========================================================================== */
    const companion = document.getElementById('movable-companion');
    let isDragging = false;
    let offsetX = 0, offsetY = 0;

    companion.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - companion.offsetLeft;
        offsetY = e.clientY - companion.offsetTop;
        companion.classList.add('dragging');
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            companion.style.left = `${e.clientX - offsetX}px`;
            companion.style.top = `${e.clientY - offsetY}px`;
            companion.style.bottom = 'auto';
            companion.style.right = 'auto';
        }
        
        // Eye-following cursor logic
        const eyes = document.querySelectorAll('.companion-eye');
        eyes.forEach(eye => {
            const rect = eye.getBoundingClientRect();
            const eyeX = rect.left + rect.width / 2;
            const eyeY = rect.top + rect.height / 2;
            const angle = Math.atan2(e.clientY - eyeY, e.clientX - eyeX);
            const distance = Math.min(3, Math.hypot(e.clientX - eyeX, e.clientY - eyeY) / 30);
            const pupilX = Math.cos(angle) * distance;
            const pupilY = Math.sin(angle) * distance;
            eye.style.transform = `translate(${pupilX}px, ${pupilY}px)`;
        });
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            companion.classList.remove('dragging');
        }
    });

    // Cycle emojis on double click
    const emojis = ['📼', '🎵', '💿', '🎧', '⚡', '🛸', '👾', '🚀'];
    let emojiIndex = 0;
    companion.addEventListener('dblclick', () => {
        emojiIndex = (emojiIndex + 1) % emojis.length;
        companion.querySelector('.companion-icon').textContent = emojis[emojiIndex];
        
        // Trigger bounce animation
        companion.style.animation = 'none';
        companion.offsetHeight; // trigger reflow
        companion.style.animation = 'companion-bounce 0.5s ease-out';
        setTimeout(() => {
            companion.style.animation = 'companion-float 4s ease-in-out infinite';
        }, 500);
    });
});
