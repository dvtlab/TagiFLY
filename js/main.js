// TagiFLY - Professional AI Labeling Tool
// Minimal Working Version for Electron
const { ipcRenderer } = require('electron');
const JSZip = require('jszip');

// ========== CONFIGURATION ==========
const CONFIG = {
    DEFAULT_LABELS: ['person', 'car', 'bicycle', 'dog', 'cat'],
    COLORS: ['#007AFF', '#FF3B30', '#34C759', '#FF9500', '#AF52DE', '#00C7BE', '#FFCC00', '#FF2D92'],

    // Keypoint Templates
    KEYPOINT_TEMPLATES: {
        'person': {
            name: 'Human Pose (17 points)',
            points: [
                'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
                'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
                'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
                'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
            ],
            connections: [
                [0, 1], [0, 2], [1, 3], [2, 4], // Head
                [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], // Arms
                [5, 11], [6, 12], [11, 12], // Torso
                [11, 13], [13, 15], [12, 14], [14, 16] // Legs
            ]
        },
        'face': {
            name: 'Face Landmarks (5 points)',
            points: ['left_eye', 'right_eye', 'nose', 'left_mouth', 'right_mouth'],
            connections: [[0, 1], [0, 2], [1, 2], [2, 3], [2, 4], [3, 4]]
        },
        'hand': {
            name: 'Hand Landmarks (21 points)',
            points: [
                'wrist', 'thumb_1', 'thumb_2', 'thumb_3', 'thumb_tip',
                'index_1', 'index_2', 'index_3', 'index_tip',
                'middle_1', 'middle_2', 'middle_3', 'middle_tip',
                'ring_1', 'ring_2', 'ring_3', 'ring_tip',
                'pinky_1', 'pinky_2', 'pinky_3', 'pinky_tip'
            ],
            connections: [
                [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
                [0, 5], [5, 6], [6, 7], [7, 8], // Index
                [0, 9], [9, 10], [10, 11], [11, 12], // Middle
                [0, 13], [13, 14], [14, 15], [15, 16], // Ring
                [0, 17], [17, 18], [18, 19], [19, 20] // Pinky
            ]
        }
    }
};

// ========== NOTIFICATION SYSTEM ==========
class NotificationManager {
    static show(message, type = 'info') {
        const existing = document.querySelector('.notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.classList.add('show'), 10);
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    static success(message) { this.show(message, 'success'); }
    static error(message) { this.show(message, 'error'); }
    static info(message) { this.show(message, 'info'); }
}

// ========== MAIN APPLICATION ==========
class TagiFLYApp {
    constructor() {
        // Core Data
        this.images = [];
        this.currentImageIndex = 0;
        this.labels = [...CONFIG.DEFAULT_LABELS];

        this.labelColors = {};
        this.selectedLabel = null;
        this.annotations = {};

        // Canvas System
        this.canvas = null;
        this.ctx = null;
        this.currentImage = null;
        this.zoom = 1;
        this.minZoom = 0.1;
        this.maxZoom = 10;
        this.zoomStep = 0.1;

        // Pan System
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.panOffset = { x: 0, y: 0 };

        // Annotation System
        this.currentTool = 'boundingbox';
        this.isDrawing = false;
        this.currentBbox = null;

        // Polygon System
        this.polygonPoints = [];
        this.isPolygonDrawing = false;

        // Keypoint System
        this.keypointSets = {}; // Store keypoint sets by label
        this.currentKeypointSet = null;
        this.isKeypointMode = false;

        // Mask Paint System
        this.isMaskPainting = false;
        this.maskCanvas = null;
        this.maskCtx = null;
        this.maskBrushSize = 20;
        this.maskMode = 'paint'; // 'paint' or 'erase'
        this.currentMaskAnnotation = null;

        // Polyline System
        this.polylinePoints = [];
        this.isPolylineDrawing = false;

        // Editing System
        this.selectedAnnotation = null;
        this.selectedAnnotationIndex = -1;
        this.hoveredAnnotation = null;
        this.isDragging = false;
        this.isResizing = false;
        this.dragOffset = { x: 0, y: 0 };
        this.resizeHandle = null;
        this.dragReady = false;
        this.dragStartPos = null;

        // Keypoint Preview System
        this.keypointPreviewMode = false;
        this.currentKeypointGuide = null;

        // History System for Undo/Redo (Per Image)
        this.imageHistory = {}; // Each image has its own history
        this.imageHistoryIndex = {}; // Each image has its own history index
        this.maxHistorySize = 50; // Maximum history entries per image

        this.init();
    }

    // ========== INITIALIZATION ==========
    init() {
        console.log('🚀 TagiFLY Starting...');

        try {
            this.initCanvas();
            this.initTheme();
            this.setupEventListeners();
            this.renderLabels();
            this.updateUI();
            this.updateHistoryButtons();

            console.log('✅ TagiFLY Ready!');
            NotificationManager.success('TagiFLY Ready!');

        } catch (error) {
            console.error('❌ TagiFLY Error:', error);
            NotificationManager.error('Failed to initialize TagiFLY');
        }
    }

    initCanvas() {
        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

        if (!this.canvas || !this.ctx) {
            throw new Error('Canvas not found!');
        }

        this.canvas.style.display = 'none';

        // Create mask canvas for painting
        this.initMaskCanvas();

        console.log('✅ Canvas initialized');
    }

    initMaskCanvas() {
        // Create invisible mask canvas for mask operations
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d');

        // Set initial size (will be updated when image loads)
        this.maskCanvas.width = 800;
        this.maskCanvas.height = 600;

        console.log('✅ Mask canvas initialized');
    }

    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
                const newTheme = currentTheme === 'light' ? 'dark' : 'light';
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('theme', newTheme);
                NotificationManager.success(`Switched to ${newTheme} mode`);
            });
        }
        console.log('✅ Theme system initialized');
    }

    // ========== EVENT LISTENERS ==========
    setupEventListeners() {
        // Folder Selection
        const selectBtn = document.getElementById('selectFolder');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.selectFolder());
        }

        // Label Management
        const addBtn = document.getElementById('addLabel');
        const input = document.getElementById('newLabel');

        if (addBtn) addBtn.addEventListener('click', () => this.addLabel());
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.addLabel();
            });
        }

        // Navigation
        const prevBtn = document.getElementById('prevImage');
        const nextBtn = document.getElementById('nextImage');

        if (prevBtn) prevBtn.addEventListener('click', () => this.previousImage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextImage());

        // Annotation Tools
        document.querySelectorAll('.annotation-tool').forEach(button => {
            button.addEventListener('click', (e) => {
                const tool = e.currentTarget.getAttribute('data-tool');
                this.selectTool(tool);
            });
        });

        // Canvas Events for Drawing
        if (this.canvas) {
            this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
            this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
            this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
            this.canvas.addEventListener('contextmenu', (e) => this.handleRightClick(e));
        }

        // Keyboard Events for Editing
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Export System
        const exportBtn = document.getElementById('exportData');
        const exportModal = document.getElementById('exportModal');
        const closeModal = document.getElementById('closeModal');
        const cancelExport = document.getElementById('cancelExport');

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.openExportModal());
        }

        if (closeModal) {
            closeModal.addEventListener('click', () => this.closeExportModal());
        }

        if (cancelExport) {
            cancelExport.addEventListener('click', () => this.closeExportModal());
        }

        // Export format selection
        document.querySelectorAll('.export-option').forEach(button => {
            button.addEventListener('click', (e) => {
                const format = e.currentTarget.getAttribute('data-format');
                this.exportAnnotations(format);
            });
        });

        // Modal backdrop click to close
        if (exportModal) {
            exportModal.addEventListener('click', (e) => {
                if (e.target.classList.contains('modal-backdrop')) {
                    this.closeExportModal();
                }
            });
        }

        // Zoom Controls
        const zoomInBtn = document.getElementById('zoomIn');
        const zoomOutBtn = document.getElementById('zoomOut');
        const fitToScreenBtn = document.getElementById('fitToScreen');
        const actualSizeBtn = document.getElementById('actualSize');

        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
        if (fitToScreenBtn) fitToScreenBtn.addEventListener('click', () => this.fitToScreen());
        if (actualSizeBtn) actualSizeBtn.addEventListener('click', () => this.actualSize());

        // Mouse wheel zoom
        if (this.canvas) {
            this.canvas.addEventListener('wheel', (e) => this.handleWheelZoom(e));
        }

        // Undo/Redo Controls
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

        console.log('✅ Event listeners setup complete');
    }

    handleAnnotationRightClick(clickedAnnotation, x, y, e) {
        e.preventDefault();

        // Select the annotation
        this.selectAnnotation(clickedAnnotation.annotation, clickedAnnotation.index);

        // For now, just prevent panning when right-clicking on annotations
        // Future: Could add context menu here
        console.log('🖱️ Right-clicked on annotation:', clickedAnnotation.annotation.type);
    }

    // ========== FOLDER SELECTION ==========
    async selectFolder() {
        try {
            console.log('📁 Selecting folder...');
            const result = await ipcRenderer.invoke('select-folder');

            if (result) {
                this.images = result.imageFiles.map(imagePath => ({
                    path: imagePath,
                    name: imagePath.split('/').pop() || imagePath.split('\\').pop(),
                    url: `file://${imagePath}`
                }));

                this.currentImageIndex = 0;
                this.annotations = {};

                this.renderImageList();
                this.updateUI();

                if (this.images.length > 0) {
                    this.loadImage(this.images[0]);
                }

                NotificationManager.success(`${this.images.length} images loaded successfully`);
                console.log(`✅ Loaded ${this.images.length} images`);
            }
        } catch (error) {
            console.error('❌ Error selecting folder:', error);
            NotificationManager.error('Error loading folder');
        }
    }

    // ========== LABEL MANAGEMENT ==========
    renderLabels() {
        const container = document.getElementById('labelsList');
        if (!container) return;

        container.innerHTML = '';

        if (this.labels.length === 0) {
            container.innerHTML = '<div class="empty-state"><p style="font-size: 13px; color: var(--gray-500); text-align: center; padding: 16px 8px;">No labels yet</p></div>';
            return;
        }

        this.labels.forEach((label, index) => {
            console.log(`🏷️ Creating label item: ${label}`);

            if (!this.labelColors[label]) {
                const colorIndex = Object.keys(this.labelColors).length % CONFIG.COLORS.length;
                this.labelColors[label] = CONFIG.COLORS[colorIndex];
            }

            const item = document.createElement('div');
            item.className = `label-item ${this.selectedLabel === label ? 'selected' : ''}`;

            item.innerHTML = `
                <div class="label-content">
                    <div class="color-indicator" style="background-color: ${this.labelColors[label]}"></div>
                    <span class="label-text">${label}</span>
                    <span class="label-shortcut">${index + 1}</span>
                </div>
                <button class="label-delete-btn" onclick="window.tagiFLY.deleteLabel('${label}')">×</button>
            `;

            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('label-delete-btn')) {
                    this.selectLabel(label);
                }
            });

            container.appendChild(item);
        });

        console.log('✅ Labels rendered:', this.labels.length);
    }

    selectLabel(label) {
        this.selectedLabel = label;
        this.renderLabels();

        // If keypoint tool is active, show preview
        if (this.currentTool === 'keypoint') {
            this.showKeypointPreview();
        }

        NotificationManager.info(`Selected label: ${label}`);
        console.log(`🏷️ Label selected: ${label}`);
    }

    addLabel() {
        const input = document.getElementById('newLabel');
        if (!input) return;

        const newLabel = input.value.trim();
        if (newLabel && !this.labels.includes(newLabel)) {
            this.labels.push(newLabel);
            this.renderLabels();
            input.value = '';
            NotificationManager.success(`Label "${newLabel}" added`);
        } else if (this.labels.includes(newLabel)) {
            NotificationManager.error('Label already exists');
        }
    }

    deleteLabel(label) {
        const index = this.labels.indexOf(label);
        if (index > -1) {
            this.labels.splice(index, 1);
            if (this.selectedLabel === label) this.selectedLabel = null;
            delete this.labelColors[label];
            this.renderLabels();
            NotificationManager.success(`Label "${label}" deleted`);
        }
    }

    // ========== IMAGE MANAGEMENT ==========
    renderImageList() {
        const container = document.getElementById('imageListContainer');
        if (!container) return;

        container.innerHTML = '';

        if (this.images.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22 19C22 19.5304 21.7893 20.0391 21.4142 20.4142C21.0391 20.7893 20.5304 21 20 21H4C3.46957 21 2.96086 20.7893 2.58579 20.4142C2.21071 20.0391 2 19.5304 2 19V5C2 4.46957 2.21071 3.96086 2.58579 3.58579C2.96086 3.21071 3.46957 3 4 3H9L11 6H20C20.5304 6 21.0391 6.21071 21.4142 6.58579C21.7893 6.96086 22 7.46957 22 8V19Z" stroke="currentColor" stroke-width="1.5"/>
                    </svg>
                    <p>Select a folder to begin</p>
                </div>
            `;
            return;
        }

        this.images.forEach((imageObj, index) => {
            const fileName = imageObj.name;
            const item = document.createElement('div');

            const isActive = index === this.currentImageIndex;
            const hasAnnotations = this.annotations[imageObj.path] && this.annotations[imageObj.path].length > 0;

            item.className = 'image-item';
            if (isActive) item.classList.add('active');
            if (hasAnnotations) item.classList.add('labeled');

            item.innerHTML = `
                <div class="image-thumbnail">
                    <img src="${imageObj.url}" alt="${fileName}" onerror="this.style.display='none';">
                </div>
                <div class="image-info">
                    <span class="image-name">${fileName}</span>
                    <span class="image-status">${hasAnnotations ? '✅' : '⏳'}</span>
                </div>
            `;

            item.addEventListener('click', () => this.setCurrentImage(index));
            container.appendChild(item);
        });

        console.log('✅ Image list rendered:', this.images.length);
    }

    setCurrentImage(index) {
        if (index >= 0 && index < this.images.length) {
            console.log(`🖼️ Switching to image ${index + 1}/${this.images.length}`);
            this.currentImageIndex = index;
            this.renderImageList();
            this.updateUI();
            this.loadImage(this.images[index]);
        }
    }

    previousImage() {
        if (this.currentImageIndex > 0) {
            this.setCurrentImage(this.currentImageIndex - 1);
        }
    }

    nextImage() {
        if (this.currentImageIndex < this.images.length - 1) {
            this.setCurrentImage(this.currentImageIndex + 1);
        }
    }

    updateUI() {
        const prevBtn = document.getElementById('prevImage');
        const nextBtn = document.getElementById('nextImage');
        const counter = document.getElementById('imageCounter');
        const exportBtn = document.getElementById('exportData');

        if (prevBtn) prevBtn.disabled = this.currentImageIndex === 0;
        if (nextBtn) nextBtn.disabled = this.currentImageIndex >= this.images.length - 1;
        if (counter) {
            counter.textContent = this.images.length > 0 ?
                `${this.currentImageIndex + 1} / ${this.images.length}` : '0 / 0';
        }

        // Enable export button if there are annotations
        if (exportBtn) {
            const hasAnnotations = Object.keys(this.annotations).some(imagePath =>
                this.annotations[imagePath] && this.annotations[imagePath].length > 0
            );
            exportBtn.disabled = !hasAnnotations;
        }

        // Update progress tracking
        this.updateProgressTracking();
    }

    updateProgressTracking() {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');

        if (!progressBar || !progressText) return;

        // Eğer resim yoksa
        if (this.images.length === 0) {
            progressBar.style.width = '0%';
            progressText.textContent = 'No images loaded';
            return;
        }

        // Annotation yapılmış resimleri say
        let annotatedImages = 0;
        this.images.forEach(imageObj => {
            const imagePath = imageObj.path;
            const annotations = this.annotations[imagePath] || [];
            if (annotations.length > 0) {
                annotatedImages++;
            }
        });

        // Progress yüzdesini hesapla
        const progressPercentage = (annotatedImages / this.images.length) * 100;

        // Progress bar'ı güncelle
        progressBar.style.width = `${progressPercentage}%`;

        // Progress text'i güncelle
        if (annotatedImages === 0) {
            progressText.textContent = `${this.images.length} images loaded - Ready to annotate`;
        } else if (annotatedImages === this.images.length) {
            progressText.textContent = `🎉 All ${this.images.length} images annotated!`;
        } else {
            progressText.textContent = `${annotatedImages}/${this.images.length} images annotated (${Math.round(progressPercentage)}%)`;
        }

        console.log(`📊 Progress: ${annotatedImages}/${this.images.length} images (${Math.round(progressPercentage)}%)`);
    }

    // ========== HISTORY MANAGEMENT (PER IMAGE) ==========
    saveToHistory(action, data) {
        if (!this.currentImage) return;

        const imagePath = this.currentImage.path;

        // Initialize history for this image if not exists
        if (!this.imageHistory[imagePath]) {
            this.imageHistory[imagePath] = [];
            this.imageHistoryIndex[imagePath] = -1;
        }

        const history = this.imageHistory[imagePath];
        let historyIndex = this.imageHistoryIndex[imagePath];

        // Remove any future history if we're not at the end
        if (historyIndex < history.length - 1) {
            this.imageHistory[imagePath] = history.slice(0, historyIndex + 1);
        }

        // Add new history entry
        const historyEntry = {
            action: action,
            timestamp: Date.now(),
            imagePath: imagePath,
            data: JSON.parse(JSON.stringify(data)) // Deep clone
        };

        this.imageHistory[imagePath].push(historyEntry);
        this.imageHistoryIndex[imagePath] = this.imageHistory[imagePath].length - 1;

        // Limit history size per image
        if (this.imageHistory[imagePath].length > this.maxHistorySize) {
            this.imageHistory[imagePath].shift();
            this.imageHistoryIndex[imagePath]--;
        }

        this.updateHistoryButtons();
        console.log(`💾 History saved for ${imagePath}: ${action}`, historyEntry);
    }

    undo() {
        if (!this.currentImage) return;

        const imagePath = this.currentImage.path;
        const historyIndex = this.imageHistoryIndex[imagePath] || -1;

        if (historyIndex < 0) {
            NotificationManager.info('Nothing to undo in this image');
            return;
        }

        const history = this.imageHistory[imagePath];
        const historyEntry = history[historyIndex];

        this.applyHistoryEntry(historyEntry, 'undo');
        this.imageHistoryIndex[imagePath]--;
        this.updateHistoryButtons();

        // Silent undo - no notification spam
        console.log(`↶ Undo applied for ${imagePath}:`, historyEntry);
    }

    redo() {
        if (!this.currentImage) return;

        const imagePath = this.currentImage.path;
        const history = this.imageHistory[imagePath] || [];
        const historyIndex = this.imageHistoryIndex[imagePath] || -1;

        if (historyIndex >= history.length - 1) {
            NotificationManager.info('Nothing to redo in this image');
            return;
        }

        this.imageHistoryIndex[imagePath]++;
        const historyEntry = history[this.imageHistoryIndex[imagePath]];

        this.applyHistoryEntry(historyEntry, 'redo');
        this.updateHistoryButtons();

        // Silent redo - no notification spam
        console.log(`↷ Redo applied for ${imagePath}:`, historyEntry);
    }

    applyHistoryEntry(entry, direction) {
        if (!entry.imagePath || !this.annotations[entry.imagePath]) return;

        const imagePath = entry.imagePath;

        switch (entry.action) {
            case 'add_annotation':
                if (direction === 'undo') {
                    // Remove the annotation
                    const annotations = this.annotations[imagePath];
                    const index = annotations.findIndex(ann =>
                        ann.timestamp === entry.data.annotation.timestamp
                    );
                    if (index > -1) {
                        // Special handling for mask annotations
                        if (annotations[index].type === 'mask') {
                            // Clear mask canvas if this was the current mask
                            if (annotations[index] === this.currentMaskAnnotation) {
                                this.currentMaskAnnotation = null;
                                this.isMaskPainting = false;
                            }
                        }
                        annotations.splice(index, 1);
                    }
                } else {
                    // Add the annotation back
                    const annotation = entry.data.annotation;
                    this.annotations[imagePath].push(annotation);

                    // Special handling for mask annotations
                    if (annotation.type === 'mask' && annotation.maskData) {
                        // Mask data is already stored in the annotation, no need to restore canvas
                        console.log('🎨 Restored mask annotation with data');
                    }
                }
                break;

            case 'delete_annotation':
                if (direction === 'undo') {
                    // Add the annotation back
                    this.annotations[imagePath].splice(entry.data.index, 0, entry.data.annotation);
                } else {
                    // Remove the annotation
                    this.annotations[imagePath].splice(entry.data.index, 1);
                }
                break;

            case 'modify_annotation':
                if (direction === 'undo') {
                    // Restore old state
                    this.annotations[imagePath][entry.data.index] = entry.data.oldAnnotation;
                } else {
                    // Apply new state
                    this.annotations[imagePath][entry.data.index] = entry.data.newAnnotation;
                }
                break;

            case 'add_polygon_point':
                if (direction === 'undo') {
                    // Remove last point from current polygon
                    if (this.isPolygonDrawing && this.polygonPoints.length > 0) {
                        this.polygonPoints.pop();
                        if (this.polygonPoints.length === 0) {
                            this.isPolygonDrawing = false;
                        }
                    }
                } else {
                    // Restore polygon state
                    if (entry.data.points) {
                        this.polygonPoints = [...entry.data.points];
                        this.isPolygonDrawing = true;
                    }
                }
                break;
        }

        // Update UI
        this.redrawCanvas();
        this.renderImageList();
        this.updateUI();
    }

    updateHistoryButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');

        if (!this.currentImage) {
            if (undoBtn) undoBtn.disabled = true;
            if (redoBtn) redoBtn.disabled = true;
            return;
        }

        const imagePath = this.currentImage.path;
        const history = this.imageHistory[imagePath] || [];
        const historyIndex = this.imageHistoryIndex[imagePath] || -1;

        if (undoBtn) {
            undoBtn.disabled = historyIndex < 0;
        }

        if (redoBtn) {
            redoBtn.disabled = historyIndex >= history.length - 1;
        }
    }

    clearPolygonPointHistory() {
        if (!this.currentImage) return;

        const imagePath = this.currentImage.path;
        if (!this.imageHistory[imagePath]) return;

        // Remove polygon point entries from current image's history since polygon is complete
        this.imageHistory[imagePath] = this.imageHistory[imagePath].filter(entry => entry.action !== 'add_polygon_point');

        // Adjust history index for current image
        if (this.imageHistoryIndex[imagePath] >= this.imageHistory[imagePath].length) {
            this.imageHistoryIndex[imagePath] = this.imageHistory[imagePath].length - 1;
        }

        this.updateHistoryButtons();
    }

    // ========== CANVAS & IMAGE LOADING ==========
    loadImage(imageObj) {
        if (!imageObj || !this.canvas) return;

        const img = new Image();
        img.onload = () => {
            const viewport = document.querySelector('.image-viewport');
            const viewportRect = viewport.getBoundingClientRect();

            const originalWidth = img.width;
            const originalHeight = img.height;

            // Calculate fit-to-screen zoom
            const padding = 40;
            const maxWidth = viewportRect.width - padding;
            const maxHeight = viewportRect.height - padding;
            const fitZoomX = maxWidth / originalWidth;
            const fitZoomY = maxHeight / originalHeight;
            const fitZoom = Math.min(fitZoomX, fitZoomY, 1);

            this.zoom = fitZoom;
            this.panOffset.x = 0;
            this.panOffset.y = 0;

            const displayWidth = Math.floor(originalWidth * this.zoom);
            const displayHeight = Math.floor(originalHeight * this.zoom);

            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
            this.canvas.style.display = 'block';

            this.ctx.clearRect(0, 0, displayWidth, displayHeight);
            this.ctx.drawImage(img, 0, 0, displayWidth, displayHeight);

            this.currentImage = {
                element: img,
                path: imageObj.path,
                originalWidth,
                originalHeight,
                displayWidth,
                displayHeight
            };

            // Hide empty state
            const overlay = document.querySelector('.canvas-overlay');
            if (overlay) overlay.style.display = 'none';

            this.updateZoomIndicator();

            // Update mask canvas size to match new image
            if (this.maskCanvas) {
                this.maskCanvas.width = originalWidth;
                this.maskCanvas.height = originalHeight;
            }

            // ÖNEMLİ: Resim yüklendikten sonra annotations'ları çiz!
            this.redrawCanvas();

            // Update keypoint guide for current image if keypoint tool is active
            if (this.currentTool === 'keypoint') {
                this.updateKeypointGuideForCurrentImage();
            }

            // Update history buttons for current image
            this.updateHistoryButtons();

            console.log(`✅ Image loaded: ${imageObj.name}`);
            console.log(`📦 Annotations for this image:`, this.annotations[imageObj.path] || []);
        };

        img.onerror = () => {
            NotificationManager.error('Error loading image');
            console.error(`❌ Failed to load image: ${imageObj.name}`);
        };

        img.src = imageObj.url;
    }

    // ========== TOOL SELECTION ==========
    selectTool(toolName) {
        console.log(`🔧 Selecting tool: ${toolName}`);

        // Cancel any ongoing drawing
        this.cancelDrawing();

        // CRITICAL: Force deselect polygon when changing tools
        if (this.selectedAnnotation && this.selectedAnnotation.type === 'polygon') {
            console.log('🚫 Force deselecting polygon when changing tools');
            this.selectedAnnotation = null;
            this.selectedAnnotationIndex = -1;
        }

        this.currentTool = toolName;

        // Update UI - highlight active tool
        document.querySelectorAll('.annotation-tool').forEach(btn => {
            const isActive = btn.getAttribute('data-tool') === toolName;
            btn.classList.toggle('active', isActive);
        });

        // Show notification with usage hints
        const toolMessages = {
            'boundingbox': '📦 Bounding Box: Click and drag to draw rectangle',
            'polygon': '🔺 Polygon: Click to add points, click first point or press Enter to finish',
            'point': '📍 Point: Click to place point',
            'keypoint': '🎯 Keypoints: Click to place keypoints for selected template',
            'mask': '🎨 Mask Paint: Click+drag to paint new mask, right-drag to erase, [ ] brush size',
            'polyline': '📏 Polyline: Click to add points, double-click or Enter to finish'
        };

        NotificationManager.info(toolMessages[toolName] || `${toolName} tool selected`);

        // Special handling for keypoint tool
        // Special handling for keypoint tool
        if (toolName === 'keypoint') {
            this.showKeypointPreview();
        } else {
            this.hideKeypointPreview();
        }

        console.log(`✅ Tool selected: ${toolName}`);
    }

    // ========== MOUSE EVENTS FOR ANNOTATION ==========
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Right click - check for annotations first, then panning
        if (e.button === 2) {
            // Check if right-clicking on an annotation
            const clickedAnnotation = this.getAnnotationAt(x, y);
            if (clickedAnnotation) {
                // Right click on annotation - handle context menu or special actions
                this.handleAnnotationRightClick(clickedAnnotation, x, y, e);
                return;
            } else {
                // Right click on empty space - start panning
                this.startPanning(x, y);
                return;
            }
        }

        // Only left click for annotation creation/selection
        if (e.button !== 0) return;

        console.log(`🖱️ Mouse down at (${x}, ${y})`);

        // First check if clicking on existing annotation (use screen coordinates for UI)
        const clickedAnnotation = this.getAnnotationAt(x, y);

        if (clickedAnnotation) {
            console.log('📦 Clicked on existing annotation:', clickedAnnotation.annotation);

            // Eğer mask tool aktifse, annotation selection yapmayalım - direkt yeni mask başlat
            if (this.currentTool === 'mask') {
                console.log('🎨 Mask tool active, ignoring existing annotations - starting new mask');
                // Continue to start new mask below (don't return!)
            } else if (clickedAnnotation.annotation.type === 'keypoint') {
                // Keypoint annotation'ına tıklanırsa (hangi tool olursa olsun)
                console.log('🎯 Selecting keypoint annotation for editing');
                this.selectAnnotation(clickedAnnotation.annotation, clickedAnnotation.index);
                // NO DRAGGING for keypoints either
                return;
            } else if (clickedAnnotation.annotation.type === 'polygon') {
                // POLYGON: COMPLETELY IGNORE - NO SELECTION, NO DRAGGING, NOTHING!
                console.log('🚫 Polygon clicked - IGNORING completely to prevent pan issues');
                return;
            } else {
                // Diğer tool'lar için normal selection
                this.selectAnnotation(clickedAnnotation.annotation, clickedAnnotation.index);

                // Only allow dragging for specific types
                if (clickedAnnotation.annotation.type === 'boundingbox') {
                    const handle = this.getResizeHandleAt(x, y, clickedAnnotation.annotation);
                    if (handle) {
                        this.startResizing(handle);
                        return;
                    }
                    // Allow bounding box dragging
                    this.dragReady = true;
                    this.dragStartPos = { x, y };
                } else if (clickedAnnotation.annotation.type === 'point') {
                    // Allow point dragging
                    this.dragReady = true;
                    this.dragStartPos = { x, y };
                }
                console.log(`✅ Selected ${clickedAnnotation.annotation.type} annotation`);
                return;
            }
        }

        // If no annotation clicked, deselect current
        this.selectedAnnotation = null;
        this.selectedAnnotationIndex = -1;

        // Start drawing new annotation if label selected
        if (!this.selectedLabel) {
            NotificationManager.info('Please select a label first');
            return;
        }

        console.log(`🖱️ Starting new annotation with tool: ${this.currentTool}, label: ${this.selectedLabel}`);

        // Convert screen coordinates to image coordinates
        const imageCoords = this.screenToImage(x, y);

        // Start drawing based on current tool
        switch (this.currentTool) {
            case 'boundingbox':
                this.startBoundingBoxDrawing(imageCoords.x, imageCoords.y);
                break;
            case 'polygon':
                this.handlePolygonClick(imageCoords.x, imageCoords.y, e);
                break;
            case 'point':
                this.createPointAnnotation(imageCoords.x, imageCoords.y);
                break;
            case 'keypoint':
                this.handleKeypointClick(imageCoords.x, imageCoords.y);
                break;
            case 'mask':
                this.startMaskPainting(imageCoords.x, imageCoords.y, e);
                break;
            case 'polyline':
                this.handlePolylineClick(imageCoords.x, imageCoords.y, e);
                break;
            default:
                NotificationManager.info(`${this.currentTool} tool - Coming soon!`);
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Priority 1: Handle dragging (highest priority)
        if (this.isDragging && this.selectedAnnotation) {
            this.dragAnnotation(x, y);
            return;
        }

        // Priority 1.5: Start dragging if mouse moved while drag ready (only for allowed types)
        if (this.dragReady && this.selectedAnnotation && this.dragStartPos) {
            const allowedTypes = ['boundingbox', 'point'];
            if (allowedTypes.includes(this.selectedAnnotation.type)) {
                const distance = Math.sqrt((x - this.dragStartPos.x) ** 2 + (y - this.dragStartPos.y) ** 2);
                if (distance > 5) { // 5 pixel threshold to start drag
                    console.log(`🚚 Starting drag for ${this.selectedAnnotation.type}`);
                    this.dragReady = false;
                    this.startDragging(this.dragStartPos.x, this.dragStartPos.y);
                    this.dragAnnotation(x, y);
                    return;
                }
            } else {
                // Clear drag ready for non-draggable types
                console.log(`🚫 Clearing drag ready for ${this.selectedAnnotation.type} (not draggable)`);
                this.dragReady = false;
                this.dragStartPos = null;
            }
        }

        // Priority 2: Handle resizing
        if (this.isResizing && this.selectedAnnotation) {
            this.resizeAnnotation(x, y);
            return;
        }

        // CRITICAL: Force deselect polygon if selected (prevents pan issues)
        if (this.selectedAnnotation && this.selectedAnnotation.type === 'polygon') {
            console.log('🚫 Force deselecting polygon to prevent pan issues');
            this.selectedAnnotation = null;
            this.selectedAnnotationIndex = -1;
        }

        // Priority 3: Handle panning (only if not dragging/resizing/drawing)
        if (this.isPanning && !this.isDrawing && !this.isPolygonDrawing && !this.isPolylineDrawing && !this.isMaskPainting) {
            this.updatePanning(x, y);
            return;
        }

        // Priority 4: Update cursor based on what's under mouse
        this.updateCursor(x, y);

        // Priority 5: Handle drawing operations
        if (this.isDrawing) {
            this.drawTemporaryBoundingBox(x, y);
        } else if (this.isPolygonDrawing && this.polygonPoints.length > 0) {
            this.drawPolygonPreviewWithMouse(x, y);
        } else if (this.isPolylineDrawing && this.polylinePoints.length > 0) {
            this.drawPolylinePreviewWithMouse(x, y);
        } else if (this.currentTool === 'mask') {
            // Brush preview göster
            this.drawMaskBrushPreview(x, y);

            // Eğer mask painting aktifse, paint et
            if (this.isMaskPainting) {
                const imageCoords = this.screenToImage(x, y);
                this.paintMask(imageCoords.x, imageCoords.y);
            }
        }
    }

    handleMouseUp(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Stop panning for any button
        if (this.isPanning) {
            this.stopPanning();
        }

        // Handle right click
        if (e.button === 2) {
            return;
        }

        // Only left click for annotation
        if (e.button !== 0) return;

        if (this.isDrawing) {
            this.finishBoundingBoxDrawing(x, y);
        } else if (this.isMaskPainting) {
            // Stop painting on mouse up and auto-finish mask
            this.isMaskPainting = false;
            this.autoFinishMask();
            console.log('🎨 Mask painting stopped');
        } else if (this.isDragging) {
            this.finishDragging();
        } else if (this.isResizing) {
            this.finishResizing();
        }

        // Clear drag ready state
        this.dragReady = false;
        this.dragStartPos = null;
    }

    // ========== BOUNDING BOX DRAWING ==========
    startBoundingBoxDrawing(imageX, imageY) {
        this.isDrawing = true;
        this.currentBbox = {
            startX: imageX,
            startY: imageY,
            currentX: imageX,
            currentY: imageY
        };
        this.canvas.style.cursor = 'crosshair';
        console.log('📦 Started bounding box drawing');
    }

    drawTemporaryBoundingBox(screenX, screenY) {
        if (!this.currentBbox) return;

        const imageCoords = this.screenToImage(screenX, screenY);
        this.currentBbox.currentX = imageCoords.x;
        this.currentBbox.currentY = imageCoords.y;

        this.redrawCanvas();
        this.drawTemporaryBox();
    }

    drawTemporaryBox() {
        if (!this.currentBbox) return;

        const startScreen = this.imageToScreen(this.currentBbox.startX, this.currentBbox.startY);
        const currentScreen = this.imageToScreen(this.currentBbox.currentX, this.currentBbox.currentY);

        const width = currentScreen.x - startScreen.x;
        const height = currentScreen.y - startScreen.y;

        // Seçili etiketin rengini kullan
        const color = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF6B6B' : '#FF6B6B';
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(startScreen.x, startScreen.y, width, height);
        this.ctx.setLineDash([]);
    }

    finishBoundingBoxDrawing(screenX, screenY) {
        if (!this.currentBbox) return;

        const imageCoords = this.screenToImage(screenX, screenY);
        const endX = imageCoords.x;
        const endY = imageCoords.y;

        const minX = Math.min(this.currentBbox.startX, endX);
        const minY = Math.min(this.currentBbox.startY, endY);
        const maxX = Math.max(this.currentBbox.startX, endX);
        const maxY = Math.max(this.currentBbox.startY, endY);

        const width = maxX - minX;
        const height = maxY - minY;

        // Check minimum size
        if (width < 10 || height < 10) {
            this.cancelDrawing();
            NotificationManager.error('Bounding box too small');
            return;
        }

        // Create annotation
        const annotation = {
            type: 'boundingbox',
            label: this.selectedLabel,
            bbox: { x: minX, y: minY, width: width, height: height },
            timestamp: Date.now()
        };

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        this.annotations[imagePath].push(annotation);

        // Save to history
        this.saveToHistory('add_annotation', { annotation: annotation });

        this.cancelDrawing();
        this.redrawCanvas();

        NotificationManager.success(`Added ${annotation.label} bounding box`);
        this.renderImageList(); // Update status
        this.updateUI(); // Enable export button

        console.log('✅ Bounding box annotation added:', annotation);
    }

    // ========== POLYGON DRAWING ==========
    handlePolygonClick(imageX, imageY, e) {
        const point = { x: imageX, y: imageY };

        if (!this.isPolygonDrawing) {
            // Start new polygon
            this.isPolygonDrawing = true;
            this.polygonPoints = [point];
            NotificationManager.info('🔺 Polygon started! Click to add points, ESC to cancel, Enter or double-click first point to finish');
            console.log('🔺 Started polygon drawing');
        } else {
            // Check if clicking near first point to close polygon
            const firstPoint = this.polygonPoints[0];
            const distance = Math.sqrt(
                Math.pow(point.x - firstPoint.x, 2) +
                Math.pow(point.y - firstPoint.y, 2)
            );

            // Distance threshold adjusted for zoom (15 pixels in screen space)
            const threshold = 15 / this.zoom;
            if (distance < threshold && this.polygonPoints.length >= 3) {
                // Close polygon by clicking near first point
                this.finishPolygon();
                return;
            }

            // Add new point
            this.polygonPoints.push(point);

            // Save polygon point to history
            this.saveToHistory('add_polygon_point', {
                points: [...this.polygonPoints],
                pointIndex: this.polygonPoints.length - 1
            });

            console.log(`🔺 Added polygon point ${this.polygonPoints.length}`);
        }

        this.drawPolygonPreview();
    }

    finishPolygon() {
        if (this.polygonPoints.length < 3) {
            NotificationManager.error('Polygon needs at least 3 points');
            return;
        }

        const annotation = {
            type: 'polygon',
            label: this.selectedLabel,
            points: [...this.polygonPoints],
            timestamp: Date.now()
        };

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        this.annotations[imagePath].push(annotation);

        // Save to history
        this.saveToHistory('add_annotation', { annotation: annotation });

        // Clear polygon point history entries since polygon is now complete
        this.clearPolygonPointHistory();

        // Reset polygon state
        this.isPolygonDrawing = false;
        this.polygonPoints = [];

        this.redrawCanvas();
        this.renderImageList(); // Update status
        this.updateUI(); // Enable export button

        NotificationManager.success(`Polygon annotation added with ${annotation.points.length} points`);
        console.log('✅ Polygon annotation added:', annotation);
    }

    drawPolygonPreview() {
        if (this.polygonPoints.length === 0) return;

        this.redrawCanvas(); // Redraw base image and existing annotations

        const ctx = this.ctx;

        // Draw polygon preview lines
        const color = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF6B6B' : '#FF6B6B';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);

        if (this.polygonPoints.length > 1) {
            ctx.beginPath();
            const firstPoint = this.polygonPoints[0];
            const firstScreen = this.imageToScreen(firstPoint.x, firstPoint.y);
            ctx.moveTo(firstScreen.x, firstScreen.y);

            for (let i = 1; i < this.polygonPoints.length; i++) {
                const point = this.polygonPoints[i];
                let screenPoint = this.imageToScreen(point.x, point.y);
                ctx.lineTo(screenPoint.x, screenPoint.y);
            }

            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Draw points
        this.polygonPoints.forEach((point, index) => {
            const isFirst = index === 0;
            const radius = isFirst ? 6 : 4;
            let screenPoint = this.imageToScreen(point.x, point.y);

            // Point background
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, radius + 1, 0, 2 * Math.PI);
            ctx.fill();

            // Point color
            const pointColor = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF6B6B' : '#FF6B6B';
            ctx.fillStyle = isFirst ? pointColor : pointColor;
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, radius, 0, 2 * Math.PI);
            ctx.fill();

            // First point indicator
            if (isFirst && this.polygonPoints.length >= 3) {
                ctx.strokeStyle = '#FF3B30';
                ctx.lineWidth = 2;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(screenPoint.x, screenPoint.y, 12, 0, 2 * Math.PI);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // Point numbers
            ctx.fillStyle = 'white';
            ctx.font = '10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText((index + 1).toString(), screenPoint.x, screenPoint.y + 3);
        });

        // Show close hint
        if (this.polygonPoints.length >= 3) {
            const firstPoint = this.polygonPoints[0];
            const firstScreen = this.imageToScreen(firstPoint.x, firstPoint.y);
            ctx.fillStyle = 'rgba(255, 59, 48, 0.8)';
            ctx.font = '12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Click here to close', firstScreen.x, firstScreen.y - 20);
        }
    }

    drawPolygonPreviewWithMouse(mouseX, mouseY) {
        this.drawPolygonPreview();

        if (this.polygonPoints.length > 0) {
            const ctx = this.ctx;
            const lastPoint = this.polygonPoints[this.polygonPoints.length - 1];

            // Draw line from last point to mouse
            const lineColor = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF6B6B' : '#FF6B6B';
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            const lastScreen = this.imageToScreen(lastPoint.x, lastPoint.y);
            ctx.moveTo(lastScreen.x, lastScreen.y);
            ctx.lineTo(mouseX, mouseY);
            ctx.stroke();
            ctx.setLineDash([]);

            // If we have 3+ points, show potential close line
            if (this.polygonPoints.length >= 3) {
                const firstPoint = this.polygonPoints[0];
                const firstScreen = this.imageToScreen(firstPoint.x, firstPoint.y);
                const distance = Math.sqrt(
                    Math.pow(mouseX - firstScreen.x, 2) +
                    Math.pow(mouseY - firstScreen.y, 2)
                );

                if (distance < 20) {
                    ctx.strokeStyle = '#FF3B30';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(lastScreen.x, lastScreen.y);
                    ctx.lineTo(firstScreen.x, firstScreen.y);
                    ctx.stroke();
                }
            }
        }
    }

    drawMaskBrushPreview(x, y) {
        // Sadece mask tool seçiliyken brush preview göster
        if (this.currentTool !== 'mask') return;

        // Eğer painting yapılmıyorsa, sadece preview göster
        if (!this.isMaskPainting) {
            // Önce normal canvas'ı çiz
            this.redrawCanvas();

            // Save context for preview
            this.ctx.save();

            // Apply same transformation as in redrawCanvas
            this.ctx.translate(this.panOffset.x, this.panOffset.y);

            // Convert screen coordinates to image coordinates for brush position
            const imageCoords = this.screenToImage(x, y);
            const brushX = imageCoords.x * this.zoom;
            const brushY = imageCoords.y * this.zoom;
            const brushRadius = (this.maskBrushSize / 2) * this.zoom;

            // Brush preview circle
            this.ctx.strokeStyle = '#00BFFF'; // Mavi brush preview
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([4, 4]);
            this.ctx.globalAlpha = 0.7;

            this.ctx.beginPath();
            this.ctx.arc(brushX, brushY, brushRadius, 0, 2 * Math.PI);
            this.ctx.stroke();

            // Brush size text
            this.ctx.fillStyle = '#00BFFF';
            this.ctx.font = '12px Inter';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(`${this.maskBrushSize}px`, brushX, brushY - brushRadius - 10);

            this.ctx.setLineDash([]);
            this.ctx.globalAlpha = 1;

            // Restore context
            this.ctx.restore();
        }
    }

    // ========== POINT ANNOTATION ==========
    createPointAnnotation(imageX, imageY) {
        const annotation = {
            type: 'point',
            label: this.selectedLabel,
            x: imageX,
            y: imageY,
            timestamp: Date.now(),
            id: Date.now() // Unique ID for each point
        };

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        this.annotations[imagePath].push(annotation);

        // Save to history
        this.saveToHistory('add_annotation', { annotation: annotation });

        // Redraw canvas to show the new point immediately
        this.redrawCanvas();

        // Optional: Simple animation effect
        this.animatePointCreation(imageX, imageY);
        this.renderImageList();
        this.updateUI(); // Enable export button

        // Count total points for this label
        const totalPoints = this.annotations[imagePath].filter(ann =>
            ann.type === 'point' && ann.label === this.selectedLabel
        ).length;

        NotificationManager.success(`📍 Point "${this.selectedLabel}" added (Total: ${totalPoints})`);
        console.log('✅ Point annotation added:', annotation);
    }

    // ========== POLYLINE ANNOTATION ==========
    handlePolylineClick(x, y, e) {
        // x, y are already in image coordinates from handleMouseDown
        const point = { x: x, y: y };

        if (!this.isPolylineDrawing) {
            // Start new polyline
            this.isPolylineDrawing = true;
            this.polylinePoints = [point];
            NotificationManager.info('📏 Polyline started! Click to add points, double-click or Enter to finish');
            console.log('📏 Started polyline drawing');
        } else {
            // Add point to current polyline
            this.polylinePoints.push(point);
            console.log(`📏 Added polyline point ${this.polylinePoints.length}`);
        }

        // Check for double-click to finish polyline
        if (e.detail === 2 && this.polylinePoints.length >= 2) {
            this.finishPolyline();
        } else {
            this.drawPolylinePreview();
        }
    }

    finishPolyline() {
        if (this.polylinePoints.length < 2) {
            NotificationManager.error('Polyline needs at least 2 points');
            return;
        }

        const annotation = {
            type: 'polyline',
            label: this.selectedLabel,
            points: [...this.polylinePoints],
            timestamp: Date.now()
        };

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        this.annotations[imagePath].push(annotation);

        // Save to history
        this.saveToHistory('add_annotation', { annotation: annotation });

        // Reset polyline state
        this.isPolylineDrawing = false;
        this.polylinePoints = [];

        this.redrawCanvas();
        this.renderImageList();
        this.updateUI(); // Enable export button

        NotificationManager.success(`📏 Polyline "${annotation.label}" added with ${annotation.points.length} points!`);
        console.log('✅ Polyline annotation added:', annotation);
    }

    drawPolylinePreview() {
        if (this.polylinePoints.length === 0) return;

        this.redrawCanvas(); // Redraw base image and existing annotations

        const ctx = this.ctx;

        // Draw polyline preview with selected label color
        if (this.polylinePoints.length > 1) {
            const color = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF9500' : '#FF9500';
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([8, 4]);

            ctx.beginPath();
            const firstPoint = this.polylinePoints[0];
            const firstScreen = this.imageToScreen(firstPoint.x, firstPoint.y);
            ctx.moveTo(firstScreen.x, firstScreen.y);

            for (let i = 1; i < this.polylinePoints.length; i++) {
                const point = this.polylinePoints[i];
                let screenPoint = this.imageToScreen(point.x, point.y);
                ctx.lineTo(screenPoint.x, screenPoint.y);
            }

            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw points
        this.polylinePoints.forEach((point, index) => {
            const isFirst = index === 0;
            const isLast = index === this.polylinePoints.length - 1;
            const radius = isFirst ? 8 : (isLast ? 6 : 5);
            const color = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF9500' : '#FF9500';

            // Point background
            ctx.fillStyle = 'white';
            ctx.beginPath();
            const screenPoint = this.imageToScreen(point.x, point.y);
            ctx.arc(screenPoint.x, screenPoint.y, radius + 1, 0, 2 * Math.PI);
            ctx.fill();

            // Point color
            ctx.fillStyle = isFirst ? color : (isLast ? '#FF6B6B' : color);
            ctx.beginPath();
            ctx.arc(screenPoint.x, screenPoint.y, radius, 0, 2 * Math.PI);
            ctx.fill();

            // Point numbers
            ctx.fillStyle = 'white';
            ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((index + 1).toString(), screenPoint.x, screenPoint.y);
        });

        // Show finish hint
        if (this.polylinePoints.length >= 2) {
            const lastPoint = this.polylinePoints[this.polylinePoints.length - 1];
            const lastScreen = this.imageToScreen(lastPoint.x, lastPoint.y);
            ctx.fillStyle = 'rgba(255, 149, 0, 0.8)';
            ctx.font = '12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('Double-click to finish', lastScreen.x, lastScreen.y - 20);
        }
    }

    drawPolylinePreviewWithMouse(mouseX, mouseY) {
        this.drawPolylinePreview();

        if (this.polylinePoints.length > 0) {
            const ctx = this.ctx;
            const lastPoint = this.polylinePoints[this.polylinePoints.length - 1];
            const color = this.selectedLabel ? this.labelColors[this.selectedLabel] || '#FF9500' : '#FF9500';

            // Draw line from last point to mouse
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            const lastScreen = this.imageToScreen(lastPoint.x, lastPoint.y);
            ctx.moveTo(lastScreen.x, lastScreen.y);
            ctx.lineTo(mouseX, mouseY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // ========== KEYPOINT ANNOTATION ==========
    handleKeypointClick(x, y) {
        const template = CONFIG.KEYPOINT_TEMPLATES[this.selectedLabel];

        if (!template) {
            NotificationManager.error(`No keypoint template for "${this.selectedLabel}". Available: person, face, hand`);
            return;
        }

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        // Find existing keypoint set for this label or create new one
        let keypointAnnotation = this.annotations[imagePath].find(ann =>
            ann.type === 'keypoint' && ann.label === this.selectedLabel && !ann.completed
        );

        if (!keypointAnnotation) {
            keypointAnnotation = {
                type: 'keypoint',
                label: this.selectedLabel,
                template: template.name,
                keypoints: [],
                connections: template.connections,
                completed: false,
                timestamp: Date.now()
            };
            this.annotations[imagePath].push(keypointAnnotation);
            this.currentKeypointSet = keypointAnnotation;
        }

        // Add keypoint in sequence
        const nextIndex = keypointAnnotation.keypoints.length;
        if (nextIndex < template.points.length) {
            const keypoint = {
                id: nextIndex,
                name: template.points[nextIndex],
                x: x, // Already in image coordinates
                y: y, // Already in image coordinates
                visible: true
            };

            keypointAnnotation.keypoints.push(keypoint);

            // Redraw canvas first to show keypoint immediately
            this.redrawCanvas();

            // Then animate
            this.animateKeypointCreation(x, y, nextIndex);

            const remaining = template.points.length - keypointAnnotation.keypoints.length;
            if (remaining > 0) {
                const nextPointName = template.points[nextIndex + 1];
                NotificationManager.info(`✅ ${keypoint.name} placed! 🎯 Next: "${nextPointName}" (${remaining} remaining)`);

                // Show visual guide for next keypoint
                this.showKeypointGuide(nextPointName, nextIndex + 1);
            } else {
                keypointAnnotation.completed = true;
                this.currentKeypointSet = null;
                this.hideKeypointGuide();

                // Save completed keypoint set to history
                this.saveToHistory('add_annotation', { annotation: keypointAnnotation });

                NotificationManager.success(`🎉 ${template.name} completed! All keypoints placed.`);
            }
        }

        this.renderImageList();
        this.updateUI();

        console.log('✅ Keypoint added:', keypoint);
    }



    showKeypointPreview() {
        // Mevcut resim için keypoint guide'ı güncelle
        this.updateKeypointGuideForCurrentImage();
    }

    hideKeypointPreview() {
        this.hideKeypointGuide();
    }

    // Yeni fonksiyon: Keypoint guide göster
    showKeypointGuide(pointName, pointIndex) {
        // Canvas üzerinde visual guide göster
        this.currentKeypointGuide = {
            pointName: pointName,
            pointIndex: pointIndex
        };
        this.redrawCanvas();
    }

    // Yeni fonksiyon: Keypoint guide gizle
    hideKeypointGuide() {
        this.currentKeypointGuide = null;
        this.redrawCanvas();
    }

    // Yeni fonksiyon: Mevcut resim için keypoint guide güncelle
    updateKeypointGuideForCurrentImage() {
        if (!this.selectedLabel || !this.currentImage) {
            this.hideKeypointGuide();
            return;
        }

        const template = CONFIG.KEYPOINT_TEMPLATES[this.selectedLabel];
        if (!template) {
            this.hideKeypointGuide();
            return;
        }

        // Bu resim için incomplete keypoint set var mı kontrol et
        const imagePath = this.currentImage.path;
        const incompleteSet = this.annotations[imagePath]?.find(ann =>
            ann.type === 'keypoint' && ann.label === this.selectedLabel && !ann.completed
        );

        if (incompleteSet) {
            // Kaldığı yerden devam et
            const nextIndex = incompleteSet.keypoints.length;
            if (nextIndex < template.points.length) {
                const nextPointName = template.points[nextIndex];
                const remaining = template.points.length - nextIndex;
                NotificationManager.info(`🎯 Continue ${template.name}: "${nextPointName}" (${remaining} remaining)`);
                this.showKeypointGuide(nextPointName, nextIndex);
            } else {
                // Tamamlanmış ama completed flag yanlış - düzelt
                incompleteSet.completed = true;
                this.hideKeypointGuide();
            }
        } else {
            // Yeni başla
            NotificationManager.success(`🎯 ${template.name} ready! Click to place: "${template.points[0]}"`);
            this.showKeypointGuide(template.points[0], 0);
        }
    }

    // Yeni fonksiyon: Keypoint guide çiz
    drawKeypointGuide() {
        if (!this.currentKeypointGuide || !this.currentImage) return;

        const { pointName, pointIndex } = this.currentKeypointGuide;

        // Canvas center'da büyük bir indicator göster
        const centerX = this.currentImage.displayWidth / 2;
        const centerY = 50; // Top center

        // Background
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(centerX - 150, centerY - 25, 300, 50);

        // Border
        this.ctx.strokeStyle = '#007AFF';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(centerX - 150, centerY - 25, 300, 50);

        // Text
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const text = `🎯 Click to place: ${pointName}`;
        this.ctx.fillText(text, centerX, centerY);

        // Progress indicator - Bu resim için doğru progress göster
        const template = CONFIG.KEYPOINT_TEMPLATES[this.selectedLabel];
        if (template && this.currentImage) {
            // Bu resim için mevcut keypoint sayısını al
            const imagePath = this.currentImage.path;
            const currentSet = this.annotations[imagePath]?.find(ann =>
                ann.type === 'keypoint' && ann.label === this.selectedLabel && !ann.completed
            );

            const currentCount = currentSet ? currentSet.keypoints.length : 0;
            const progress = `${currentCount + 1}/${template.points.length}`;
            this.ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            this.ctx.fillStyle = '#007AFF';
            this.ctx.fillText(progress, centerX, centerY + 20);
        }

        // Reset text alignment
        this.ctx.textAlign = 'start';
        this.ctx.textBaseline = 'alphabetic';
    }

    drawKeypointPreview() {




        if (!this.selectedLabel || !this.currentImage) {
            console.log('🎯 Missing selectedLabel or currentImage');
            return;
        }

        const template = CONFIG.KEYPOINT_TEMPLATES[this.selectedLabel];
        if (!template) {
            console.log('🎯 No template found for label:', this.selectedLabel);
            return;
        }

        // Get image dimensions (context is already translated, so use zoom-scaled dimensions)
        const imageWidth = this.currentImage.originalWidth * this.zoom;
        const imageHeight = this.currentImage.originalHeight * this.zoom;

        // Define suggested positions for different templates
        const suggestedPositions = this.getSuggestedKeypointPositions(template, imageWidth, imageHeight);

        // Draw suggested keypoint positions
        template.points.forEach((pointName, index) => {
            const pos = suggestedPositions[index];
            console.log(`🎯 Drawing keypoint ${index}: ${pointName} at`, pos);
            if (!pos) {
                console.log(`🎯 No position for keypoint ${index}: ${pointName}`);
                return;
            }

            // Semi-transparent circle
            console.log(`🎯 Drawing circle at (${pos.x}, ${pos.y})`);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.strokeStyle = '#007AFF';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([4, 4]);

            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, 12, 0, 2 * Math.PI);
            this.ctx.fill();
            this.ctx.stroke();
            this.ctx.setLineDash([]);

            console.log(`🎯 Circle drawn successfully`);

            // Point number
            this.ctx.fillStyle = '#007AFF';
            this.ctx.font = 'bold 12px Inter';
            this.ctx.textAlign = 'center';
            this.ctx.fillText((index + 1).toString(), pos.x, pos.y + 4);

            // Point name with background
            this.ctx.font = 'bold 11px Inter';
            const textMetrics = this.ctx.measureText(pointName);
            const textWidth = textMetrics.width;

            // Background
            this.ctx.fillStyle = 'rgba(0, 122, 255, 0.9)';
            this.ctx.fillRect(pos.x - textWidth / 2 - 4, pos.y - 30, textWidth + 8, 16);

            // Text
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(pointName, pos.x, pos.y - 18);
        });

        // Show instruction
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(10, 10, 300, 40);
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 14px Inter';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`🎯 Click on the suggested points to place keypoints`, 20, 30);
    }

    getSuggestedKeypointPositions(template, imageWidth, imageHeight) {
        const positions = [];
        const centerX = imageWidth / 2;
        const centerY = imageHeight / 2;

        // Basit test için - tüm noktaları grid şeklinde yerleştir
        const cols = Math.ceil(Math.sqrt(template.points.length));
        const spacing = Math.min(imageWidth, imageHeight) / (cols + 1);

        template.points.forEach((pointName, index) => {
            const row = Math.floor(index / cols);
            const col = index % cols;

            const x = (col + 1) * spacing;
            const y = (row + 1) * spacing;

            positions[index] = { x, y };
            console.log(`🎯 Position ${index} (${pointName}): (${x}, ${y})`);
        });

        if (false) { // Disable complex positioning for now
            // Hand keypoints - simplified layout
            const handCenterX = centerX;
            const handCenterY = centerY;

            positions[0] = { x: handCenterX, y: handCenterY + 30 }; // wrist
            // Thumb
            positions[1] = { x: handCenterX - 20, y: handCenterY + 10 };
            positions[2] = { x: handCenterX - 30, y: handCenterY - 5 };
            positions[3] = { x: handCenterX - 35, y: handCenterY - 15 };
            positions[4] = { x: handCenterX - 40, y: handCenterY - 25 };
            // Index finger
            positions[5] = { x: handCenterX - 10, y: handCenterY + 5 };
            positions[6] = { x: handCenterX - 10, y: handCenterY - 10 };
            positions[7] = { x: handCenterX - 10, y: handCenterY - 25 };
            positions[8] = { x: handCenterX - 10, y: handCenterY - 35 };
            // Continue for other fingers...
        }

        return positions;
    }

    cancelKeypointAnnotation() {
        if (!this.currentKeypointSet || !this.currentImage) return;

        const imagePath = this.currentImage.path;
        const annotations = this.annotations[imagePath] || [];
        const index = annotations.indexOf(this.currentKeypointSet);

        if (index > -1) {
            annotations.splice(index, 1);
            this.currentKeypointSet = null;
            this.redrawCanvas();
            this.renderImageList();
            this.updateUI();
            NotificationManager.success('🗑️ Incomplete keypoint annotation cancelled');
            console.log('✅ Keypoint annotation cancelled');
        }
    }

    // ========== MASK PAINT ANNOTATION ==========
    startMaskPainting(imageX, imageY, e) {
        if (!this.currentImage) return;

        // Determine paint mode based on mouse button
        this.maskMode = e.button === 0 ? 'paint' : 'erase'; // 0 = left, 2 = right

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        // Her zaman yeni mask oluştur (basit yaklaşım)
        this.prepareNewMask();

        this.isMaskPainting = true;
        this.paintMask(imageX, imageY);

        console.log(`✅ Mask painting started - Mode: ${this.maskMode}`);
        console.log(`🎨 Current mask annotation:`, this.currentMaskAnnotation);
        console.log(`🎨 Mask canvas size: ${this.maskCanvas.width}x${this.maskCanvas.height}`);
    }

    paintMask(imageX, imageY) {
        if (!this.isMaskPainting || !this.currentMaskAnnotation) return;

        // Constrain to image bounds
        if (imageX < 0 || imageY < 0 || imageX >= this.currentImage.originalWidth || imageY >= this.currentImage.originalHeight) {
            return;
        }

        // Set paint mode
        if (this.maskMode === 'erase') {
            this.maskCtx.globalCompositeOperation = 'destination-out';
        } else {
            this.maskCtx.globalCompositeOperation = 'source-over';
            this.maskCtx.fillStyle = this.labelColors[this.selectedLabel] || CONFIG.COLORS[0];
        }

        this.maskCtx.globalAlpha = 0.8;

        // Paint circle - use image coordinates directly
        this.maskCtx.beginPath();
        this.maskCtx.arc(imageX, imageY, this.maskBrushSize / 2, 0, 2 * Math.PI);
        this.maskCtx.fill();

        // Reset context
        this.maskCtx.globalAlpha = 1;
        this.maskCtx.globalCompositeOperation = 'source-over';

        // Update display immediately
        this.redrawCanvas();

        console.log(`🎨 Painted at (${Math.round(imageX)}, ${Math.round(imageY)}) - Mode: ${this.maskMode}`);
    }

    finishMaskPainting() {
        if (!this.currentMaskAnnotation) {
            NotificationManager.error('No active mask to finish');
            return;
        }

        // Check if mask has any content
        const imageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        const hasContent = imageData.data.some((value, index) => index % 4 === 3 && value > 0); // Check alpha channel

        if (!hasContent) {
            NotificationManager.error('Mask is empty! Paint something first.');
            return;
        }

        // Store mask data
        this.currentMaskAnnotation.maskData = imageData;
        this.currentMaskAnnotation.completed = true;

        // Save to history
        this.saveToHistory('add_annotation', { annotation: this.currentMaskAnnotation });

        this.isMaskPainting = false;
        this.currentMaskAnnotation = null;
        this.maskMode = 'paint';

        this.redrawCanvas();
        this.renderImageList();
        this.updateUI(); // Enable export button

        const label = this.currentMaskAnnotation.label;
        NotificationManager.success(`🎨 "${label}" mask completed! Click+drag for next mask.`);
        console.log('✅ Mask painting finished');
    }

    autoFinishMask() {
        if (!this.currentMaskAnnotation) return;

        // Check if mask has any content
        const imageData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        const hasContent = imageData.data.some((value, index) => index % 4 === 3 && value > 0);

        if (hasContent) {
            // Auto-finish mask if it has content
            this.currentMaskAnnotation.maskData = imageData;
            this.currentMaskAnnotation.completed = true;

            const label = this.currentMaskAnnotation.label;
            const maskCount = this.annotations[this.currentImage.path].filter(ann =>
                ann.type === 'mask' && ann.label === label && ann.completed
            ).length;

            NotificationManager.success(`🎨 "${label}" mask #${maskCount} completed! Click+drag for next mask.`);
            console.log(`✅ Auto-finished mask: ${this.currentMaskAnnotation.id}`);
        } else {
            // Remove empty mask
            const imagePath = this.currentImage.path;
            const index = this.annotations[imagePath].indexOf(this.currentMaskAnnotation);
            if (index > -1) {
                this.annotations[imagePath].splice(index, 1);
            }
            console.log('🗑️ Removed empty mask');
        }

        this.currentMaskAnnotation = null;
        this.renderImageList();
        this.updateUI(); // Enable export button
    }

    prepareNewMask() {
        if (!this.selectedLabel || !this.currentImage) {
            return false;
        }

        const imagePath = this.currentImage.path;
        if (!this.annotations[imagePath]) {
            this.annotations[imagePath] = [];
        }

        // Setup mask canvas - always use original image dimensions
        this.maskCanvas.width = this.currentImage.originalWidth;
        this.maskCanvas.height = this.currentImage.originalHeight;
        this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);

        // Mevcut mask sayısını hesapla
        const existingMasks = this.annotations[imagePath].filter(ann =>
            ann.type === 'mask' && ann.label === this.selectedLabel
        ).length;

        // Yeni mask annotation oluştur
        const maskAnnotation = {
            type: 'mask',
            label: this.selectedLabel,
            maskData: null,
            completed: false,
            timestamp: Date.now(),
            id: `${this.selectedLabel}_mask_${existingMasks + 1}`
        };

        this.annotations[imagePath].push(maskAnnotation);
        this.currentMaskAnnotation = maskAnnotation;

        console.log(`🎨 Prepared new mask: ${maskAnnotation.id}`);
        return true;
    }

    animateKeypointCreation(imageX, imageY, index) {
        // Create a pulsing animation for keypoint creation
        try {
            let scale = 0.5;
            let opacity = 1;
            let animationCount = 0;
            const maxAnimations = 20;

            const animate = () => {
                if (animationCount >= maxAnimations || !this.ctx || !this.currentImage) {
                    return;
                }

                this.redrawCanvas();

                // Save context for animation
                this.ctx.save();

                // Apply same transformation as in redrawCanvas
                this.ctx.translate(this.panOffset.x, this.panOffset.y);

                // Draw pulsing circle at correct position
                this.ctx.globalAlpha = opacity;
                this.ctx.fillStyle = '#FFD700'; // Gold color
                this.ctx.strokeStyle = '#FF6B6B';
                this.ctx.lineWidth = 3;

                const radius = 8 * scale;
                const screenX = imageX * this.zoom;
                const screenY = imageY * this.zoom;

                this.ctx.beginPath();
                this.ctx.arc(screenX, screenY, radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();

                // Draw keypoint number
                this.ctx.fillStyle = '#000';
                this.ctx.font = 'bold 12px Inter';
                this.ctx.textAlign = 'center';
                this.ctx.fillText((index + 1).toString(), screenX, screenY + 4);

                // Restore context
                this.ctx.restore();

                scale += 0.1;
                opacity -= 0.05;
                animationCount++;

                if (opacity > 0 && scale < 2 && animationCount < maxAnimations) {
                    requestAnimationFrame(animate);
                }
            };
            animate();
        } catch (error) {
            console.error('Keypoint animation error:', error);
        }
    }

    animatePointCreation(imageX, imageY) {
        // Create a simple animation effect
        try {
            let radius = 5;
            let opacity = 1;
            let animationCount = 0;
            const maxAnimations = 10; // Limit animation frames

            const animate = () => {
                if (animationCount >= maxAnimations || !this.ctx || !this.currentImage) {
                    return; // Stop animation
                }

                this.redrawCanvas();

                // Save context for animation
                this.ctx.save();

                // Apply same transformation as in redrawCanvas
                this.ctx.translate(this.panOffset.x, this.panOffset.y);

                // Draw expanding circle at correct position
                this.ctx.globalAlpha = opacity;
                this.ctx.strokeStyle = '#00FF00';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.arc(imageX * this.zoom, imageY * this.zoom, radius, 0, 2 * Math.PI);
                this.ctx.stroke();

                // Restore context
                this.ctx.restore();

                radius += 2;
                opacity -= 0.1;
                animationCount++;

                if (opacity > 0 && animationCount < maxAnimations) {
                    requestAnimationFrame(animate);
                }
            };

            animate();
        } catch (error) {
            console.error('Animation error:', error);
            // Animation failed, but point should still be visible
        }
    }

    cancelDrawing() {
        const wasDrawing = this.isDrawing || this.isPolygonDrawing;

        this.isDrawing = false;
        this.currentBbox = null;

        // Cancel polygon drawing
        if (this.isPolygonDrawing) {
            this.isPolygonDrawing = false;
            this.polygonPoints = [];
            NotificationManager.info('Polygon drawing cancelled');
        }

        // Cancel keypoint drawing
        if (this.currentKeypointSet) {
            this.currentKeypointSet = null;
            NotificationManager.info('Keypoint drawing cancelled');
        }

        // Cancel mask painting
        if (this.isMaskPainting || this.currentMaskAnnotation) {
            if (this.currentMaskAnnotation) {
                // Remove incomplete mask
                const imagePath = this.currentImage.path;
                const index = this.annotations[imagePath].indexOf(this.currentMaskAnnotation);
                if (index > -1) {
                    this.annotations[imagePath].splice(index, 1);
                }
            }

            this.isMaskPainting = false;
            this.currentMaskAnnotation = null;
            this.maskMode = 'paint';
            NotificationManager.info('Mask painting cancelled');
        }

        if (this.canvas) {
            this.canvas.style.cursor = 'crosshair';
        }
        this.redrawCanvas();
    }

    redrawCanvas() {
        if (!this.currentImage) {
            console.log('⚠️ No current image to redraw');
            return;
        }

        console.log('🔄 Redrawing canvas with annotations');
        const { displayWidth, displayHeight, element } = this.currentImage;
        this.ctx.clearRect(0, 0, displayWidth, displayHeight);
        this.ctx.drawImage(element, 0, 0, displayWidth, displayHeight);
        this.drawAnnotations();
    }

    drawAnnotations() {
        if (!this.currentImage) {
            console.log('⚠️ No current image to draw annotations on');
            return;
        }

        const imagePath = this.currentImage.path;
        const annotations = this.annotations[imagePath] || [];

        console.log(`🎨 Drawing ${annotations.length} annotations for: ${imagePath}`);

        // Group points by proximity for clustering
        const points = annotations.filter(ann => ann.type === 'point');
        const otherAnnotations = annotations.filter(ann => ann.type !== 'point');

        // Draw non-point annotations first
        otherAnnotations.forEach((annotation, index) => {
            this.drawAnnotation(annotation);
        });

        // Draw points with clustering
        this.drawPointsWithClustering(points);
    }

    drawPointsWithClustering(points) {
        const clusterDistance = 30; // pixels
        const clusters = [];
        const processed = new Set();

        points.forEach((point, index) => {
            if (processed.has(index)) return;

            const cluster = [point];
            processed.add(index);

            // Find nearby points
            points.forEach((otherPoint, otherIndex) => {
                if (processed.has(otherIndex)) return;

                const distance = Math.sqrt(
                    Math.pow((point.x - otherPoint.x) * this.zoom, 2) +
                    Math.pow((point.y - otherPoint.y) * this.zoom, 2)
                );

                if (distance < clusterDistance) {
                    cluster.push(otherPoint);
                    processed.add(otherIndex);
                }
            });

            clusters.push(cluster);
        });

        // Draw clusters
        clusters.forEach(cluster => {
            if (cluster.length === 1) {
                // Single point
                this.drawAnnotation(cluster[0]);
            } else {
                // Multiple points - draw cluster
                this.drawPointCluster(cluster);
            }
        });
    }

    drawPointCluster(cluster) {
        // Calculate cluster center
        const centerX = cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length;
        const centerY = cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length;

        const x = centerX * this.zoom;
        const y = centerY * this.zoom;

        // Get dominant color (most common label)
        const labelCounts = {};
        cluster.forEach(point => {
            labelCounts[point.label] = (labelCounts[point.label] || 0) + 1;
        });
        const dominantLabel = Object.keys(labelCounts).reduce((a, b) =>
            labelCounts[a] > labelCounts[b] ? a : b
        );
        const color = this.labelColors[dominantLabel] || CONFIG.COLORS[0];

        // Draw cluster circle
        this.ctx.fillStyle = color;
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 3;

        const radius = Math.min(15, 8 + cluster.length * 2);
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
        this.ctx.fill();
        this.ctx.stroke();

        // Draw count
        this.ctx.fillStyle = 'white';
        this.ctx.font = 'bold 12px Inter';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(cluster.length.toString(), x, y + 4);

        // Draw cluster label
        this.drawPointLabel(`${dominantLabel} (${cluster.length})`, x, y, color);
    }

    drawKeypointAnnotation(annotation, color) {
        if (!annotation.keypoints || annotation.keypoints.length === 0) return;

        const isSelected = annotation === this.selectedAnnotation;
        const isHovered = annotation === this.hoveredAnnotation;

        // Draw connections first (skeleton)
        if (annotation.connections && annotation.keypoints.length > 1) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = isSelected ? 3 : 2;
            this.ctx.globalAlpha = 0.8;

            annotation.connections.forEach(([startIdx, endIdx]) => {
                const startPoint = annotation.keypoints[startIdx];
                const endPoint = annotation.keypoints[endIdx];

                if (startPoint && endPoint && startPoint.visible && endPoint.visible) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(startPoint.x * this.zoom, startPoint.y * this.zoom);
                    this.ctx.lineTo(endPoint.x * this.zoom, endPoint.y * this.zoom);
                    this.ctx.stroke();
                }
            });
            this.ctx.globalAlpha = 1;
        }

        // Draw keypoints
        annotation.keypoints.forEach((keypoint, index) => {
            if (!keypoint.visible) return;

            const x = keypoint.x * this.zoom;
            const y = keypoint.y * this.zoom;

            // Hover effect for individual keypoint
            if (isHovered && !isSelected) {
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 3;
                this.ctx.globalAlpha = 0.6;
                this.ctx.beginPath();
                this.ctx.arc(x, y, 10, 0, 2 * Math.PI);
                this.ctx.stroke();
                this.ctx.globalAlpha = 1;
            }

            // Selection effect
            if (isSelected) {
                const time = Date.now() * 0.003;
                const pulseRadius = 8 + Math.sin(time + index) * 2;
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;
                this.ctx.globalAlpha = 0.7;
                this.ctx.setLineDash([3, 3]);
                this.ctx.beginPath();
                this.ctx.arc(x, y, pulseRadius, 0, 2 * Math.PI);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
                this.ctx.globalAlpha = 1;
            }

            // Main keypoint circle - make it bigger for easier selection
            this.ctx.fillStyle = color;
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 3;

            const radius = isSelected ? 10 : 8; // Bigger radius for easier clicking
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
            this.ctx.fill();
            this.ctx.stroke();

            // Inner white circle for better visibility
            this.ctx.fillStyle = 'white';
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius - 3, 0, 2 * Math.PI);
            this.ctx.fill();

            // Keypoint number - make it more visible
            this.ctx.fillStyle = color;
            this.ctx.font = 'bold 12px Inter';
            this.ctx.textAlign = 'center';
            this.ctx.fillText((index + 1).toString(), x, y + 4);

            // Keypoint name (always show for better UX)
            this.ctx.fillStyle = color;
            this.ctx.font = isSelected ? 'bold 11px Inter' : '10px Inter';
            this.ctx.textAlign = 'center';

            // Background for better readability
            const textMetrics = this.ctx.measureText(keypoint.name);
            const textWidth = textMetrics.width;
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.fillRect(x - textWidth / 2 - 2, y - 25, textWidth + 4, 12);

            // Text
            this.ctx.fillStyle = color;
            this.ctx.fillText(keypoint.name, x, y - 15);
        });

        // Draw template info
        if (annotation.keypoints.length > 0) {
            const firstKeypoint = annotation.keypoints[0];
            const labelText = annotation.completed ?
                `${annotation.label} (${annotation.template})` :
                `${annotation.label} (${annotation.keypoints.length}/${CONFIG.KEYPOINT_TEMPLATES[annotation.label]?.points.length || '?'})`;

            this.drawKeypointLabel(labelText, firstKeypoint.x * this.zoom, firstKeypoint.y * this.zoom, color);
        }
    }

    drawKeypointLabel(label, x, y, color) {
        // Position label above the pose
        const labelX = x;
        const labelY = y - 30;

        this.ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'center';
        const textWidth = this.ctx.measureText(label).width;

        // Label background
        this.ctx.fillStyle = color;
        this.ctx.fillRect(labelX - textWidth / 2 - 4, labelY - 16, textWidth + 8, 18);

        // Label text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(label, labelX, labelY - 4);
    }

    drawMaskAnnotation(annotation, color) {
        const isSelected = annotation === this.selectedAnnotation;
        const isHovered = annotation === this.hoveredAnnotation;

        // Get mask data
        let maskData = null;
        if (annotation === this.currentMaskAnnotation) {
            // Current painting mask - use live canvas
            maskData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        } else if (annotation.maskData) {
            // Completed mask - use stored data
            maskData = annotation.maskData;
        }

        if (!maskData) return;

        // Create temporary canvas for mask overlay
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = maskData.width;
        tempCanvas.height = maskData.height;

        // Put mask data on temp canvas
        tempCtx.putImageData(maskData, 0, 0);

        // Draw mask overlay on main canvas with proper scaling
        this.ctx.globalAlpha = isSelected ? 0.8 : 0.6;
        this.ctx.globalCompositeOperation = 'source-over';

        // Scale mask to current zoom level (context is already translated)
        const scaledWidth = this.currentImage.originalWidth * this.zoom;
        const scaledHeight = this.currentImage.originalHeight * this.zoom;

        this.ctx.drawImage(
            tempCanvas,
            0, 0, tempCanvas.width, tempCanvas.height,
            0, 0, scaledWidth, scaledHeight
        );

        this.ctx.globalAlpha = 1;
        this.ctx.globalCompositeOperation = 'source-over';

        // Cleanup temporary canvas
        tempCanvas.width = 0;
        tempCanvas.height = 0;

        // Draw mask border
        if (isSelected || isHovered) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = isSelected ? 3 : 2;
            this.ctx.setLineDash(isSelected ? [] : [5, 5]);
            this.ctx.strokeRect(0, 0, scaledWidth, scaledHeight);
            this.ctx.setLineDash([]);
        }

        // Draw mask label
        this.drawMaskLabel(annotation.label, color, annotation === this.currentMaskAnnotation);
    }

    drawMaskLabel(label, color, isActive) {
        // Mask sayısını hesapla
        const imagePath = this.currentImage.path;
        const maskCount = this.annotations[imagePath] ?
            this.annotations[imagePath].filter(ann => ann.type === 'mask' && ann.label === label).length : 0;

        const labelText = isActive ?
            `${label} mask #${maskCount} (painting...)` :
            `${label} mask (${maskCount} total)`;
        const x = 10;
        const y = 30;

        this.ctx.font = '14px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'left';
        const textWidth = this.ctx.measureText(labelText).width;

        // Label background
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x - 4, y - 18, textWidth + 8, 22);

        // Label text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(labelText, x, y - 4);

        // Active indicator
        if (isActive) {
            const time = Date.now() * 0.005;
            const pulseAlpha = 0.5 + Math.sin(time) * 0.3;
            this.ctx.globalAlpha = pulseAlpha;
            this.ctx.fillStyle = color;
            this.ctx.fillRect(x - 6, y - 20, textWidth + 12, 26);
            this.ctx.globalAlpha = 1;
        }
    }

    drawAnnotation(annotation) {
        const color = this.labelColors[annotation.label] || CONFIG.COLORS[0];

        switch (annotation.type) {
            case 'boundingbox':
            case undefined: // Legacy support
                this.drawBoundingBoxAnnotation(annotation, color);
                break;
            case 'polygon':
                this.drawPolygonAnnotation(annotation, color);
                break;
            case 'point':
                this.drawPointAnnotation(annotation, color);
                break;
            case 'keypoint':
                this.drawKeypointAnnotation(annotation, color);
                break;
            case 'mask':
                this.drawMaskAnnotation(annotation, color);
                break;
            case 'polyline':
                this.drawPolylineAnnotation(annotation, color);
                break;
        }
    }

    drawBoundingBoxAnnotation(annotation, color) {
        const bbox = annotation.bbox;

        // Canvas context is already translated, so only apply zoom
        const x = bbox.x * this.zoom;
        const y = bbox.y * this.zoom;
        const width = bbox.width * this.zoom;
        const height = bbox.height * this.zoom;

        const isSelected = annotation === this.selectedAnnotation;
        const isHovered = annotation === this.hoveredAnnotation;

        // Hover effect - hafif glow
        if (isHovered && !isSelected) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 3;
            this.ctx.globalAlpha = 0.5;
            this.ctx.strokeRect(x - 1, y - 1, width + 2, height + 2);
            this.ctx.globalAlpha = 1;
        }

        // Draw bounding box
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = isSelected ? 3 : 2;
        this.ctx.setLineDash([]);
        this.ctx.strokeRect(x, y, width, height);

        // Draw selection handles if selected
        if (isSelected) {
            this.drawResizeHandles(x, y, width, height, color);
        }

        // Draw label
        this.drawLabel(annotation.label, x, y - 5, color);
    }

    drawPolygonAnnotation(annotation, color) {
        if (!annotation.points || annotation.points.length < 3) return;

        const isSelected = annotation === this.selectedAnnotation;
        const isHovered = annotation === this.hoveredAnnotation;

        // Hover effect
        if (isHovered && !isSelected) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 3;
            this.ctx.globalAlpha = 0.5;
            this.ctx.setLineDash([]);

            this.ctx.beginPath();
            const firstPoint = annotation.points[0];
            this.ctx.moveTo(firstPoint.x * this.zoom, firstPoint.y * this.zoom);

            for (let i = 1; i < annotation.points.length; i++) {
                const point = annotation.points[i];
                this.ctx.lineTo(point.x * this.zoom, point.y * this.zoom);
            }
            this.ctx.closePath();
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }

        // Draw polygon
        this.ctx.strokeStyle = color;
        this.ctx.fillStyle = color + '20'; // Semi-transparent fill
        this.ctx.lineWidth = isSelected ? 3 : 2;
        this.ctx.setLineDash([]);

        this.ctx.beginPath();
        const firstPoint = annotation.points[0];
        this.ctx.moveTo(firstPoint.x * this.zoom, firstPoint.y * this.zoom);

        for (let i = 1; i < annotation.points.length; i++) {
            const point = annotation.points[i];
            this.ctx.lineTo(point.x * this.zoom, point.y * this.zoom);
        }

        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        // Draw points if selected
        if (isSelected) {
            annotation.points.forEach((point, index) => {
                // Büyük handle
                this.ctx.fillStyle = 'white';
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;

                this.ctx.beginPath();
                this.ctx.arc(point.x * this.zoom, point.y * this.zoom, 6, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();

                // Point numarası
                this.ctx.fillStyle = color;
                this.ctx.font = '10px Inter';
                this.ctx.textAlign = 'center';
                this.ctx.fillText((index + 1).toString(), screenPoint.x, screenPoint.y + 3);
            });
        }

        // Draw label
        const minX = Math.min(...annotation.points.map(p => p.x));
        const minY = Math.min(...annotation.points.map(p => p.y));
        this.drawLabel(annotation.label, minX * this.zoom, minY * this.zoom, color);
    }

    drawPointAnnotation(annotation, color) {
        const x = annotation.x * this.zoom;
        const y = annotation.y * this.zoom;

        const isSelected = annotation === this.selectedAnnotation;
        const isHovered = annotation === this.hoveredAnnotation;

        // Hover effect - glowing ring
        if (isHovered && !isSelected) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 3;
            this.ctx.globalAlpha = 0.6;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 12, 0, 2 * Math.PI);
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }

        // Selection effect - pulsing ring
        if (isSelected) {
            const time = Date.now() * 0.005;
            const pulseRadius = 10 + Math.sin(time) * 2;
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.globalAlpha = 0.7;
            this.ctx.setLineDash([4, 4]);
            this.ctx.beginPath();
            this.ctx.arc(x, y, pulseRadius, 0, 2 * Math.PI);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            this.ctx.globalAlpha = 1;
        }

        // Main point - multi-layer design
        // Outer ring
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = isSelected ? 3 : 2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 8, 0, 2 * Math.PI);
        this.ctx.stroke();

        // White middle ring
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 6, 0, 2 * Math.PI);
        this.ctx.stroke();

        // Inner filled circle
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, 2 * Math.PI);
        this.ctx.fill();

        // Center dot
        this.ctx.fillStyle = 'white';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
        this.ctx.fill();

        // Draw label with better positioning
        this.drawPointLabel(annotation.label, x, y, color);
    }

    drawPointLabel(label, x, y, color) {
        // Smart label positioning - avoid overlapping with point
        const labelOffset = 15;
        let labelX = x + labelOffset;
        let labelY = y - labelOffset;

        // Check if label would go off screen and adjust
        const canvas = this.canvas;
        if (labelX + 60 > canvas.width) labelX = x - labelOffset - 60;
        if (labelY - 25 < 0) labelY = y + labelOffset + 20;

        this.ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'left';
        const textWidth = this.ctx.measureText(label).width;

        // Label background with rounded corners effect
        this.ctx.fillStyle = color;
        this.ctx.fillRect(labelX - 2, labelY - 18, textWidth + 8, 20);

        // Label text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(label, labelX + 2, labelY - 4);

        // Connection line from point to label
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 1;
        this.ctx.globalAlpha = 0.6;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(labelX, labelY - 8);
        this.ctx.stroke();
        this.ctx.globalAlpha = 1;
    }

    drawResizeHandles(x, y, width, height, color) {
        const handleSize = Math.max(8, 6 / this.zoom); // Zoom'a göre ayarlanır
        const centerX = x + width / 2;
        const centerY = y + height / 2;

        // 8 resize handles: 4 köşe + 4 kenar ortası
        const handles = [
            // Köşeler (daha büyük)
            { x: x - handleSize / 2, y: y - handleSize / 2, size: handleSize }, // nw
            { x: x + width - handleSize / 2, y: y - handleSize / 2, size: handleSize }, // ne
            { x: x - handleSize / 2, y: y + height - handleSize / 2, size: handleSize }, // sw
            { x: x + width - handleSize / 2, y: y + height - handleSize / 2, size: handleSize }, // se

            // Kenar ortaları (biraz daha küçük)
            { x: centerX - handleSize / 2, y: y - handleSize / 2, size: handleSize - 1 }, // n
            { x: centerX - handleSize / 2, y: y + height - handleSize / 2, size: handleSize - 1 }, // s
            { x: x - handleSize / 2, y: centerY - handleSize / 2, size: handleSize - 1 }, // w
            { x: x + width - handleSize / 2, y: centerY - handleSize / 2, size: handleSize - 1 } // e
        ];

        handles.forEach(handle => {
            // Handle background (beyaz)
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(handle.x, handle.y, handle.size, handle.size);

            // Handle border (renkli)
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(handle.x, handle.y, handle.size, handle.size);
        });
    }

    drawLabel(label, x, y, color) {
        this.ctx.font = '12px Inter, -apple-system, BlinkMacSystemFont, sans-serif';
        this.ctx.textAlign = 'left';
        const textWidth = this.ctx.measureText(label).width;

        // Label background
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y - 22, textWidth + 12, 22);

        // Label text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(label, x + 6, y - 8);
    }

    drawPolylineAnnotation(annotation, color) {
        if (!annotation.points || annotation.points.length < 2) return;

        const isSelected = annotation === this.selectedAnnotation;
        const isHovered = annotation === this.hoveredAnnotation;

        // Hover effect
        if (isHovered && !isSelected) {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 4;
            this.ctx.globalAlpha = 0.5;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';
            this.ctx.setLineDash([]);

            this.ctx.beginPath();
            const firstPoint = annotation.points[0];
            this.ctx.moveTo(firstPoint.x * this.zoom, firstPoint.y * this.zoom);

            for (let i = 1; i < annotation.points.length; i++) {
                const point = annotation.points[i];
                this.ctx.lineTo(point.x * this.zoom, point.y * this.zoom);
            }
            this.ctx.stroke();
            this.ctx.globalAlpha = 1;
        }

        // Draw polyline (açık çizgi - polygon gibi kapalı değil)
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = isSelected ? 4 : 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.setLineDash([]);

        this.ctx.beginPath();
        const firstPoint = annotation.points[0];
        this.ctx.moveTo(firstPoint.x * this.zoom, firstPoint.y * this.zoom);

        for (let i = 1; i < annotation.points.length; i++) {
            const point = annotation.points[i];
            this.ctx.lineTo(point.x * this.zoom, point.y * this.zoom);
        }
        // NOT: closePath() çağırmıyoruz çünkü polyline açık bir çizgi

        this.ctx.stroke();

        // Draw points if selected
        if (isSelected) {
            annotation.points.forEach((point, index) => {
                const isFirst = index === 0;
                const isLast = index === annotation.points.length - 1;
                const radius = isFirst ? 8 : (isLast ? 6 : 5);

                // Point background
                this.ctx.fillStyle = 'white';
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 2;

                this.ctx.beginPath();
                this.ctx.arc(point.x * this.zoom, point.y * this.zoom, radius, 0, 2 * Math.PI);
                this.ctx.fill();
                this.ctx.stroke();

                // Point color - first ve last farklı renk
                this.ctx.fillStyle = isFirst ? color : (isLast ? '#FF6B6B' : color);
                this.ctx.beginPath();
                this.ctx.arc(point.x * this.zoom, point.y * this.zoom, radius - 2, 0, 2 * Math.PI);
                this.ctx.fill();

                // Point numarası
                this.ctx.fillStyle = 'white';
                this.ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText((index + 1).toString(), point.x * this.zoom, point.y * this.zoom);
            });
        }

        // Draw label at start point
        const startPoint = annotation.points[0];
        this.drawLabel(annotation.label, startPoint.x * this.zoom, startPoint.y * this.zoom - 5, color);
    }

    // ========== ANNOTATION SELECTION & EDITING ==========




    selectAnnotation(annotation, index) {
        this.selectedAnnotation = annotation;
        this.selectedAnnotationIndex = index;
        this.redrawCanvas();
        NotificationManager.info(`Selected ${annotation.label} annotation`);
        console.log('✅ Annotation selected:', annotation);
    }

    getResizeHandleAt(screenX, screenY, annotation) {
        // Convert screen coordinates to image coordinates
        const imageCoords = this.screenToImage(screenX, screenY);
        const x = imageCoords.x;
        const y = imageCoords.y;

        if (annotation.type === 'polygon') {
            // Polygon için her point bir handle
            const handleSize = 8 / this.zoom; // Image coordinate space

            for (let i = 0; i < annotation.points.length; i++) {
                const point = annotation.points[i];
                if (x >= point.x - handleSize / 2 && x <= point.x + handleSize / 2 &&
                    y >= point.y - handleSize / 2 && y <= point.y + handleSize / 2) {
                    return `point-${i}`;
                }
            }
            return null;
        }

        if (annotation.type !== 'boundingbox') return null;

        const bbox = annotation.bbox;
        const handleSize = 8 / this.zoom; // Image coordinate space
        const tolerance = 4 / this.zoom;
        const centerX = bbox.x + bbox.width / 2;
        const centerY = bbox.y + bbox.height / 2;

        // 8 resize handles: 4 köşe + 4 kenar ortası
        const handles = {
            // Köşeler
            'nw': { x: bbox.x - handleSize / 2, y: bbox.y - handleSize / 2 },
            'ne': { x: bbox.x + bbox.width - handleSize / 2, y: bbox.y - handleSize / 2 },
            'sw': { x: bbox.x - handleSize / 2, y: bbox.y + bbox.height - handleSize / 2 },
            'se': { x: bbox.x + bbox.width - handleSize / 2, y: bbox.y + bbox.height - handleSize / 2 },

            // Kenar ortaları
            'n': { x: centerX - handleSize / 2, y: bbox.y - handleSize / 2 },
            's': { x: centerX - handleSize / 2, y: bbox.y + bbox.height - handleSize / 2 },
            'w': { x: bbox.x - handleSize / 2, y: centerY - handleSize / 2 },
            'e': { x: bbox.x + bbox.width - handleSize / 2, y: centerY - handleSize / 2 }
        };

        for (const [handle, pos] of Object.entries(handles)) {
            if (x >= pos.x - tolerance && x <= pos.x + handleSize + tolerance &&
                y >= pos.y - tolerance && y <= pos.y + handleSize + tolerance) {
                return handle;
            }
        }
        return null;
    }

    updateCursor(x, y) {
        if (!this.canvas) return;

        const annotation = this.getAnnotationAt(x, y);

        // Update hovered annotation for visual feedback (ignore polygons)
        const newHovered = (annotation && annotation.annotation.type !== 'polygon') ? annotation.annotation : null;
        if (newHovered !== this.hoveredAnnotation) {
            this.hoveredAnnotation = newHovered;
            this.redrawCanvas();
        }

        if (annotation && annotation.annotation === this.selectedAnnotation) {
            const handle = this.getResizeHandleAt(x, y, annotation.annotation);
            if (handle) {
                if (handle.startsWith('point-')) {
                    this.canvas.style.cursor = 'grab';
                } else {
                    const cursors = {
                        'nw': 'nw-resize', 'ne': 'ne-resize', 'sw': 'sw-resize', 'se': 'se-resize',
                        'n': 'n-resize', 's': 's-resize', 'w': 'w-resize', 'e': 'e-resize'
                    };
                    this.canvas.style.cursor = cursors[handle];
                }
            } else if (annotation.annotation.type === 'keypoint') {
                // Keypoint annotation üzerindeyken grab cursor göster
                this.canvas.style.cursor = 'grab';
            } else if (annotation.annotation.type === 'polygon') {
                // Polygon için hiçbir cursor değişikliği yapma
                this.canvas.style.cursor = 'crosshair';
            } else {
                this.canvas.style.cursor = 'move';
            }
        } else if (annotation) {
            if (annotation.annotation.type === 'keypoint') {
                this.canvas.style.cursor = 'pointer';
            } else {
                this.canvas.style.cursor = 'pointer';
            }
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
    }

    // OLD DRAG SYSTEM REMOVED - Using new system at line 4754+

    startResizing(handle) {
        this.isResizing = true;
        this.resizeHandle = handle;

        if (handle.startsWith('point-')) {
            console.log('📏 Started moving polygon point:', handle);
        } else {
            console.log('📏 Started resizing annotation:', handle);
        }
    }

    resizeAnnotation(x, y) {
        if (!this.isResizing || !this.selectedAnnotation || !this.resizeHandle) return;

        const mouseX = x / this.zoom;
        const mouseY = y / this.zoom;

        // Polygon point moving
        if (this.resizeHandle.startsWith('point-')) {
            const pointIndex = parseInt(this.resizeHandle.split('-')[1]);
            if (pointIndex >= 0 && pointIndex < this.selectedAnnotation.points.length) {
                this.selectedAnnotation.points[pointIndex].x = mouseX;
                this.selectedAnnotation.points[pointIndex].y = mouseY;
            }
            this.redrawCanvas();
            return;
        }

        // Bounding box resizing
        const bbox = this.selectedAnnotation.bbox;
        const minSize = 10;

        switch (this.resizeHandle) {
            // Köşeler
            case 'nw':
                const newWidth = bbox.width + (bbox.x - mouseX);
                const newHeight = bbox.height + (bbox.y - mouseY);
                if (newWidth > minSize && newHeight > minSize) {
                    bbox.x = mouseX;
                    bbox.y = mouseY;
                    bbox.width = newWidth;
                    bbox.height = newHeight;
                }
                break;
            case 'ne':
                const newWidth2 = mouseX - bbox.x;
                const newHeight2 = bbox.height + (bbox.y - mouseY);
                if (newWidth2 > minSize && newHeight2 > minSize) {
                    bbox.y = mouseY;
                    bbox.width = newWidth2;
                    bbox.height = newHeight2;
                }
                break;
            case 'sw':
                const newWidth3 = bbox.width + (bbox.x - mouseX);
                const newHeight3 = mouseY - bbox.y;
                if (newWidth3 > minSize && newHeight3 > minSize) {
                    bbox.x = mouseX;
                    bbox.width = newWidth3;
                    bbox.height = newHeight3;
                }
                break;
            case 'se':
                const newWidth4 = mouseX - bbox.x;
                const newHeight4 = mouseY - bbox.y;
                if (newWidth4 > minSize && newHeight4 > minSize) {
                    bbox.width = newWidth4;
                    bbox.height = newHeight4;
                }
                break;

            // Kenar ortaları
            case 'n': // Üst kenar
                const newHeight5 = bbox.height + (bbox.y - mouseY);
                if (newHeight5 > minSize) {
                    bbox.y = mouseY;
                    bbox.height = newHeight5;
                }
                break;
            case 's': // Alt kenar
                const newHeight6 = mouseY - bbox.y;
                if (newHeight6 > minSize) {
                    bbox.height = newHeight6;
                }
                break;
            case 'w': // Sol kenar
                const newWidth7 = bbox.width + (bbox.x - mouseX);
                if (newWidth7 > minSize) {
                    bbox.x = mouseX;
                    bbox.width = newWidth7;
                }
                break;
            case 'e': // Sağ kenar
                const newWidth8 = mouseX - bbox.x;
                if (newWidth8 > minSize) {
                    bbox.width = newWidth8;
                }
                break;
        }

        this.redrawCanvas();
    }

    finishResizing() {
        this.isResizing = false;
        this.resizeHandle = null;
        console.log('✅ Finished resizing annotation');
    }

    // ========== KEYBOARD SHORTCUTS ==========
    handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // Undo/Redo shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'z':
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.redo(); // Ctrl+Shift+Z = Redo
                    } else {
                        this.undo(); // Ctrl+Z = Undo
                    }
                    break;
                case 'y':
                    e.preventDefault();
                    this.redo(); // Ctrl+Y = Redo
                    break;
            }
            return; // Don't process other shortcuts when Ctrl/Cmd is pressed
        }

        // Tool shortcuts
        if (!e.ctrlKey && !e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'b':
                    e.preventDefault();
                    this.selectTool('boundingbox');
                    break;
                case 'p':
                    e.preventDefault();
                    this.selectTool('polygon');
                    break;
                case 'o':
                    e.preventDefault();
                    this.selectTool('point');
                    break;
                case 'k':
                    e.preventDefault();
                    this.selectTool('keypoint');
                    break;
                case 'm':
                    e.preventDefault();
                    if (this.currentTool === 'mask') {
                        // Mask tool aktifse, aktif mask'i bitir
                        if (this.isMaskPainting || this.currentMaskAnnotation) {
                            this.finishMaskPainting();
                        }
                    } else {
                        this.selectTool('mask');
                    }
                    break;
                case 'l':
                    e.preventDefault();
                    this.selectTool('polyline');
                    break;
            }
        }

        switch (e.key) {
            case 'Delete':
            case 'Backspace':
                if (this.selectedAnnotation && this.selectedAnnotationIndex >= 0) {
                    this.deleteSelectedAnnotation();
                } else if (this.currentKeypointSet && !this.currentKeypointSet.completed) {
                    // Tamamlanmamış keypoint annotation'ını sil
                    this.cancelKeypointAnnotation();
                }
                break;
            case 'Enter':
                // Finish polygon with Enter key
                if (this.isPolygonDrawing && this.polygonPoints.length >= 3) {
                    this.finishPolygon();
                }
                // Finish polyline with Enter key
                if (this.isPolylineDrawing && this.polylinePoints.length >= 2) {
                    this.finishPolyline();
                }
                // Finish mask painting
                if (this.isMaskPainting) {
                    this.finishMaskPainting();
                }
                break;
            case '[':
                // Decrease brush size
                if (this.currentTool === 'mask') {
                    this.maskBrushSize = Math.max(5, this.maskBrushSize - 5);
                    NotificationManager.info(`🖌️ Brush size: ${this.maskBrushSize}px`);
                }
                break;
            case ']':
                // Increase brush size
                if (this.currentTool === 'mask') {
                    this.maskBrushSize = Math.min(100, this.maskBrushSize + 5);
                    NotificationManager.info(`🖌️ Brush size: ${this.maskBrushSize}px`);
                }
                break;
            case 'Escape':
                this.cancelDrawing();
                // Cancel incomplete keypoint annotation
                if (this.currentKeypointSet && !this.currentKeypointSet.completed) {
                    this.cancelKeypointAnnotation();
                }
                this.selectedAnnotation = null;
                this.selectedAnnotationIndex = -1;
                this.redrawCanvas();
                break;
        }
    }

    deleteSelectedAnnotation() {
        if (!this.selectedAnnotation || this.selectedAnnotationIndex < 0 || !this.currentImage) return;

        const imagePath = this.currentImage.path;
        const annotations = this.annotations[imagePath] || [];

        if (this.selectedAnnotationIndex < annotations.length) {
            const deletedAnnotation = annotations[this.selectedAnnotationIndex];
            annotations.splice(this.selectedAnnotationIndex, 1);

            this.selectedAnnotation = null;
            this.selectedAnnotationIndex = -1;

            this.redrawCanvas();
            this.renderImageList(); // Update status

            NotificationManager.success(`Deleted ${deletedAnnotation.label} annotation`);
            console.log('🗑️ Annotation deleted');
        }
    }

    handleRightClick(e) {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Mask painting için sağ tık - erase mode ile başlat
        if (this.currentTool === 'mask' && this.selectedLabel) {
            this.startMaskPainting(x, y, { button: 2 }); // Right click
            return;
        }

        // Polygon editing için sağ tık
        if (this.selectedAnnotation && this.selectedAnnotation.type === 'polygon') {
            const handle = this.getResizeHandleAt(x, y, this.selectedAnnotation);

            if (handle && handle.startsWith('point-')) {
                // Point'e sağ tık - sil
                const pointIndex = parseInt(handle.split('-')[1]);
                if (this.selectedAnnotation.points.length > 3) {
                    this.selectedAnnotation.points.splice(pointIndex, 1);
                    this.redrawCanvas();
                    NotificationManager.success('Polygon point deleted');
                } else {
                    NotificationManager.error('Polygon needs at least 3 points');
                }
            } else if (this.isPointInAnnotation(x, y, this.selectedAnnotation)) {
                // Polygon içine sağ tık - yeni point ekle
                this.addPolygonPoint(x, y);
            }
        }
    }

    addPolygonPoint(x, y) {
        if (!this.selectedAnnotation || this.selectedAnnotation.type !== 'polygon') return;

        const newPoint = { x: x / this.zoom, y: y / this.zoom };

        // En yakın edge'i bul ve oraya point ekle
        let minDistance = Infinity;
        let insertIndex = 0;

        for (let i = 0; i < this.selectedAnnotation.points.length; i++) {
            const p1 = this.selectedAnnotation.points[i];
            const p2 = this.selectedAnnotation.points[(i + 1) % this.selectedAnnotation.points.length];

            const distance = this.distanceToLineSegment(newPoint, p1, p2);
            if (distance < minDistance) {
                minDistance = distance;
                insertIndex = i + 1;
            }
        }

        this.selectedAnnotation.points.splice(insertIndex, 0, newPoint);
        this.redrawCanvas();
        NotificationManager.success('Polygon point added');
    }

    distanceToLineSegment(point, lineStart, lineEnd) {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dot / lenSq;

        let xx, yy;
        if (param < 0) {
            xx = lineStart.x;
            yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x;
            yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }

        const dx = point.x - xx;
        const dy = point.y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ========== ZOOM SYSTEM ==========
    zoomIn() {
        const newZoom = Math.min(this.zoom + this.zoomStep, this.maxZoom);
        this.setZoom(newZoom);
    }

    zoomOut() {
        const newZoom = Math.max(this.zoom - this.zoomStep, this.minZoom);
        this.setZoom(newZoom);
    }

    fitToScreen() {
        if (!this.currentImage) return;

        const viewport = document.querySelector('.image-viewport');
        const viewportRect = viewport.getBoundingClientRect();

        const padding = 40;
        const maxWidth = viewportRect.width - padding;
        const maxHeight = viewportRect.height - padding;

        const fitZoomX = maxWidth / this.currentImage.originalWidth;
        const fitZoomY = maxHeight / this.currentImage.originalHeight;
        const fitZoom = Math.min(fitZoomX, fitZoomY, 1);

        this.setZoom(fitZoom);
        this.centerImage();
    }

    actualSize() {
        this.setZoom(1);
        this.centerImage();
    }

    setZoom(newZoom) {
        if (!this.currentImage) return;

        const oldZoom = this.zoom;
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));

        // Update canvas size
        const displayWidth = Math.floor(this.currentImage.originalWidth * this.zoom);
        const displayHeight = Math.floor(this.currentImage.originalHeight * this.zoom);

        this.canvas.width = displayWidth;
        this.canvas.height = displayHeight;

        // Adjust pan offset to zoom around center
        const zoomRatio = this.zoom / oldZoom;
        this.panOffset.x *= zoomRatio;
        this.panOffset.y *= zoomRatio;

        this.updateZoomIndicator();
        this.redrawCanvas();

        console.log(`🔍 Zoom set to ${(this.zoom * 100).toFixed(0)}%`);
    }

    centerImage() {
        this.panOffset.x = 0;
        this.panOffset.y = 0;
        this.redrawCanvas();
    }

    updateZoomIndicator() {
        const zoomLevel = document.getElementById('zoomLevel');
        if (zoomLevel) {
            zoomLevel.textContent = `${(this.zoom * 100).toFixed(0)}%`;
        }
    }

    handleWheelZoom(e) {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Zoom direction
        const zoomDirection = e.deltaY > 0 ? -1 : 1;
        const zoomFactor = 1 + (this.zoomStep * zoomDirection);
        const newZoom = this.zoom * zoomFactor;

        if (newZoom >= this.minZoom && newZoom <= this.maxZoom) {
            // Zoom around mouse position
            const beforeZoomX = (mouseX - this.panOffset.x) / this.zoom;
            const beforeZoomY = (mouseY - this.panOffset.y) / this.zoom;

            this.zoom = newZoom;

            const afterZoomX = beforeZoomX * this.zoom;
            const afterZoomY = beforeZoomY * this.zoom;

            this.panOffset.x = mouseX - afterZoomX;
            this.panOffset.y = mouseY - afterZoomY;

            // Update canvas size
            const displayWidth = Math.floor(this.currentImage.originalWidth * this.zoom);
            const displayHeight = Math.floor(this.currentImage.originalHeight * this.zoom);

            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;

            this.updateZoomIndicator();
            this.redrawCanvas();
        }
    }

    // ========== PAN SYSTEM ==========
    startPanning(x, y) {
        // Don't start panning if we're in the middle of drawing
        if (this.isDrawing || this.isPolygonDrawing || this.isPolylineDrawing || this.isMaskPainting) {
            console.log('🚫 Cannot start panning - drawing operation in progress');
            return;
        }

        this.isPanning = true;
        this.panStart.x = x - this.panOffset.x;
        this.panStart.y = y - this.panOffset.y;
        this.canvas.style.cursor = 'grabbing';
        console.log('🖐️ Started panning');
    }

    updatePanning(x, y) {
        if (!this.isPanning) return;

        this.panOffset.x = x - this.panStart.x;
        this.panOffset.y = y - this.panStart.y;

        this.redrawCanvas();
    }

    stopPanning() {
        this.isPanning = false;
        this.canvas.style.cursor = 'default';
    }

    // ========== COORDINATE CONVERSION ==========
    screenToImage(screenX, screenY) {
        // Convert screen coordinates to image coordinates
        // Account for canvas position and pan offset
        const imageX = (screenX - this.panOffset.x) / this.zoom;
        const imageY = (screenY - this.panOffset.y) / this.zoom;
        return { x: imageX, y: imageY };
    }

    imageToScreen(imageX, imageY) {
        // Convert image coordinates to screen coordinates
        // Apply zoom and pan offset
        const screenX = imageX * this.zoom + this.panOffset.x;
        const screenY = imageY * this.zoom + this.panOffset.y;
        return { x: screenX, y: screenY };
    }

    // ========== CANVAS REDRAW ==========
    redrawCanvas() {
        if (!this.currentImage || !this.ctx) return;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Save context
        this.ctx.save();

        // Apply pan offset
        this.ctx.translate(this.panOffset.x, this.panOffset.y);

        // Draw image at zoom level
        this.ctx.drawImage(
            this.currentImage.element,
            0, 0,
            this.currentImage.originalWidth * this.zoom,
            this.currentImage.originalHeight * this.zoom
        );

        // Draw annotations
        this.drawAnnotations();

        // Keypoint preview removed for better UX

        // Restore context
        this.ctx.restore();
    }

    drawAnnotations() {
        if (!this.currentImage) return;

        const imagePath = this.currentImage.path;
        const annotations = this.annotations[imagePath] || [];

        annotations.forEach(annotation => {
            this.drawAnnotation(annotation);
        });

        // Draw keypoint guide if active
        if (this.currentKeypointGuide) {
            this.drawKeypointGuide();
        }
    }

    // ========== EXPORT SYSTEM ==========
    openExportModal() {
        // Check if there are any annotations
        const hasAnnotations = Object.keys(this.annotations).some(imagePath =>
            this.annotations[imagePath] && this.annotations[imagePath].length > 0
        );

        if (!hasAnnotations) {
            NotificationManager.error('No annotations to export');
            return;
        }

        const modal = document.getElementById('exportModal');
        if (modal) {
            modal.classList.add('show');
            console.log('📤 Export modal opened');
        }
    }

    closeExportModal() {
        const modal = document.getElementById('exportModal');
        if (modal) {
            modal.classList.remove('show');
            console.log('❌ Export modal closed');
        }
    }

    async exportAnnotations(format) {
        console.log(`📤 Exporting annotations in ${format} format`);

        try {
            let exportData;
            let fileName;
            let fileExtension;

            switch (format) {
                case 'json':
                    exportData = this.exportToJSON();
                    fileName = 'tagifly_annotations.json';
                    fileExtension = 'json';
                    break;
                case 'yolo':
                    const yoloZip = await this.exportToYOLO();
                    exportData = yoloZip.buffer;
                    fileName = 'yolo_dataset.zip';
                    fileExtension = 'zip';
                    break;
                case 'coco':
                    exportData = this.exportToCOCO();
                    fileName = 'coco_annotations.json';
                    fileExtension = 'json';
                    break;
                case 'pascal':
                    const pascalZip = await this.exportToPascalVOC();
                    exportData = pascalZip.buffer;
                    fileName = 'pascal_voc_dataset.zip';
                    fileExtension = 'zip';
                    break;
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }

            // Save file using Electron
            const result = await ipcRenderer.invoke('save-file', exportData, fileName, fileExtension);

            if (result.success) {
                NotificationManager.success(`${format.toUpperCase()} annotations exported successfully!`);
                this.closeExportModal();
                console.log(`✅ Export completed: ${result.path}`);
            } else if (result.canceled) {
                NotificationManager.info('Export canceled');
            } else {
                throw new Error(result.error || 'Unknown error');
            }

        } catch (error) {
            console.error('❌ Export error:', error);
            NotificationManager.error(`Export failed: ${error.message}`);
        }
    }

    exportToJSON() {
        const exportData = {
            version: '1.0',
            created: new Date().toISOString(),
            tool: 'TagiFLY - Professional AI Labeling Tool',
            totalImages: this.images.length,
            totalAnnotations: this.getTotalAnnotationCount(),
            labels: this.labels,
            labelColors: this.labelColors,
            images: [],
            annotations: {}
        };

        // Add image metadata and their annotations
        this.images.forEach(imageObj => {
            const imageAnnotations = this.annotations[imageObj.path] || [];

            exportData.images.push({
                path: imageObj.path,
                name: imageObj.name,
                annotationCount: imageAnnotations.length,
                hasAnnotations: imageAnnotations.length > 0
            });

            // Only include images that have annotations
            if (imageAnnotations.length > 0) {
                exportData.annotations[imageObj.name] = imageAnnotations.map(ann => ({
                    ...ann,
                    created: ann.timestamp ? new Date(ann.timestamp).toISOString() : new Date().toISOString()
                }));
            }
        });

        return JSON.stringify(exportData, null, 2);
    }

    getTotalAnnotationCount() {
        return Object.values(this.annotations).reduce((total, imageAnnotations) => {
            return total + (imageAnnotations ? imageAnnotations.length : 0);
        }, 0);
    }

    async exportToYOLO() {
        const zip = new JSZip();
        let processedImages = 0;
        let totalAnnotations = 0;

        // Create classes.txt content
        const classesContent = this.labels.join('\n');
        zip.file('classes.txt', classesContent);

        // Create README.txt with export info
        const readmeContent = `# YOLO Dataset Export from TagiFLY
# Export Date: ${new Date().toISOString()}
# Total Classes: ${this.labels.length}

# Classes:
${this.labels.map((label, index) => `${index}: ${label}`).join('\n')}

# Usage:
# 1. Extract this ZIP file
# 2. Use classes.txt for class names
# 3. Each .txt file contains annotations for corresponding image
# 4. Format: class_id center_x center_y width height (normalized 0-1)
`;
        zip.file('README.txt', readmeContent);

        // Process each image
        for (const imagePath of Object.keys(this.annotations)) {
            const annotations = this.annotations[imagePath];
            if (!annotations || annotations.length === 0) continue;

            const imageObj = this.images.find(img => img.path === imagePath);
            if (!imageObj) continue;

            const yoloAnnotations = [];

            // Get image dimensions
            const imgWidth = this.currentImage?.originalWidth || 1920;
            const imgHeight = this.currentImage?.originalHeight || 1080;

            annotations.forEach(annotation => {
                switch (annotation.type) {
                    case 'boundingbox':
                        const classId = this.labels.indexOf(annotation.label);
                        if (classId === -1) return;

                        // Convert to YOLO format (normalized 0-1)
                        const centerX = (annotation.bbox.x + annotation.bbox.width / 2) / imgWidth;
                        const centerY = (annotation.bbox.y + annotation.bbox.height / 2) / imgHeight;
                        const width = annotation.bbox.width / imgWidth;
                        const height = annotation.bbox.height / imgHeight;

                        // Ensure values are within 0-1 range
                        const normalizedCenterX = Math.max(0, Math.min(1, centerX));
                        const normalizedCenterY = Math.max(0, Math.min(1, centerY));
                        const normalizedWidth = Math.max(0, Math.min(1, width));
                        const normalizedHeight = Math.max(0, Math.min(1, height));

                        yoloAnnotations.push(`${classId} ${normalizedCenterX.toFixed(6)} ${normalizedCenterY.toFixed(6)} ${normalizedWidth.toFixed(6)} ${normalizedHeight.toFixed(6)}`);
                        totalAnnotations++;
                        break;

                    case 'polygon':
                        // YOLO segmentation format
                        const polyClassId = this.labels.indexOf(annotation.label);
                        if (polyClassId === -1 || !annotation.points) return;

                        const normalizedPoints = annotation.points.map(point => [
                            Math.max(0, Math.min(1, point.x / imgWidth)),
                            Math.max(0, Math.min(1, point.y / imgHeight))
                        ]).flat();

                        yoloAnnotations.push(`${polyClassId} ${normalizedPoints.map(p => p.toFixed(6)).join(' ')}`);
                        totalAnnotations++;
                        break;

                    case 'point':
                        // YOLO point format (as small bounding box)
                        const pointClassId = this.labels.indexOf(annotation.label);
                        if (pointClassId === -1 || annotation.x === undefined || annotation.y === undefined) return;

                        // Create small bounding box around point (5px radius)
                        const pointSize = 10; // 10px total size
                        const pointCenterX = annotation.x / imgWidth;
                        const pointCenterY = annotation.y / imgHeight;
                        const pointWidth = pointSize / imgWidth;
                        const pointHeight = pointSize / imgHeight;

                        const normalizedPointCenterX = Math.max(0, Math.min(1, pointCenterX));
                        const normalizedPointCenterY = Math.max(0, Math.min(1, pointCenterY));
                        const normalizedPointWidth = Math.max(0, Math.min(1, pointWidth));
                        const normalizedPointHeight = Math.max(0, Math.min(1, pointHeight));

                        yoloAnnotations.push(`${pointClassId} ${normalizedPointCenterX.toFixed(6)} ${normalizedPointCenterY.toFixed(6)} ${normalizedPointWidth.toFixed(6)} ${normalizedPointHeight.toFixed(6)}`);
                        totalAnnotations++;
                        break;

                    case 'keypoint':
                        // YOLO keypoint format (each keypoint as separate annotation)
                        const keypointClassId = this.labels.indexOf(annotation.label);
                        if (keypointClassId === -1 || !annotation.keypoints) return;

                        annotation.keypoints.forEach(kp => {
                            if (kp.x !== undefined && kp.y !== undefined) {
                                const keypointSize = 8; // 8px total size for keypoints
                                const keypointCenterX = kp.x / imgWidth;
                                const keypointCenterY = kp.y / imgHeight;
                                const keypointWidth = keypointSize / imgWidth;
                                const keypointHeight = keypointSize / imgHeight;

                                const normalizedKeypointCenterX = Math.max(0, Math.min(1, keypointCenterX));
                                const normalizedKeypointCenterY = Math.max(0, Math.min(1, keypointCenterY));
                                const normalizedKeypointWidth = Math.max(0, Math.min(1, keypointWidth));
                                const normalizedKeypointHeight = Math.max(0, Math.min(1, keypointHeight));

                                yoloAnnotations.push(`${keypointClassId} ${normalizedKeypointCenterX.toFixed(6)} ${normalizedKeypointCenterY.toFixed(6)} ${normalizedKeypointWidth.toFixed(6)} ${normalizedKeypointHeight.toFixed(6)}`);
                                totalAnnotations++;
                            }
                        });
                        break;

                    case 'polyline':
                        // YOLO polyline format (as segmentation)
                        const lineClassId = this.labels.indexOf(annotation.label);
                        if (lineClassId === -1 || !annotation.points) return;

                        const normalizedLinePoints = annotation.points.map(point => [
                            Math.max(0, Math.min(1, point.x / imgWidth)),
                            Math.max(0, Math.min(1, point.y / imgHeight))
                        ]).flat();

                        yoloAnnotations.push(`${lineClassId} ${normalizedLinePoints.map(p => p.toFixed(6)).join(' ')}`);
                        totalAnnotations++;
                        break;

                    case 'mask':
                        // YOLO mask format (extract real bounding box from mask data)
                        const maskClassId = this.labels.indexOf(annotation.label);
                        if (maskClassId === -1 || !annotation.maskData) return;

                        // Calculate real bounding box from mask data
                        const maskBounds = this.calculateMaskBounds(annotation.maskData);
                        if (!maskBounds) return;

                        // Convert to YOLO format (normalized 0-1)
                        const maskCenterX = (maskBounds.minX + maskBounds.maxX) / 2 / imgWidth;
                        const maskCenterY = (maskBounds.minY + maskBounds.maxY) / 2 / imgHeight;
                        const maskWidth = (maskBounds.maxX - maskBounds.minX) / imgWidth;
                        const maskHeight = (maskBounds.maxY - maskBounds.minY) / imgHeight;

                        // Ensure values are within 0-1 range
                        const normalizedMaskCenterX = Math.max(0, Math.min(1, maskCenterX));
                        const normalizedMaskCenterY = Math.max(0, Math.min(1, maskCenterY));
                        const normalizedMaskWidth = Math.max(0, Math.min(1, maskWidth));
                        const normalizedMaskHeight = Math.max(0, Math.min(1, maskHeight));

                        yoloAnnotations.push(`${maskClassId} ${normalizedMaskCenterX.toFixed(6)} ${normalizedMaskCenterY.toFixed(6)} ${normalizedMaskWidth.toFixed(6)} ${normalizedMaskHeight.toFixed(6)}`);
                        totalAnnotations++;
                        break;
                }
            });

            if (yoloAnnotations.length > 0) {
                const txtFileName = imageObj.name.replace(/\.[^/.]+$/, '.txt');
                zip.file(txtFileName, yoloAnnotations.join('\n'));
                processedImages++;
            }
        }

        // Add summary file
        const summaryContent = `# YOLO Export Summary
Total Images: ${processedImages}
Total Annotations: ${totalAnnotations}
Classes: ${this.labels.length}
Export Date: ${new Date().toISOString()}

# Files in this ZIP:
- classes.txt: Class names (one per line)
- *.txt: Annotation files (one per image)
- README.txt: Usage instructions
- summary.txt: Export statistics
`;
        zip.file('summary.txt', summaryContent);

        // Generate ZIP buffer
        const buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        return { buffer, processedImages, totalAnnotations };
    }

    calculateMaskBounds(maskData) {
        if (!maskData || !maskData.data) return null;

        let minX = maskData.width;
        let minY = maskData.height;
        let maxX = 0;
        let maxY = 0;
        let hasContent = false;

        // Scan through mask data to find bounds
        for (let y = 0; y < maskData.height; y++) {
            for (let x = 0; x < maskData.width; x++) {
                const pixelIndex = (y * maskData.width + x) * 4;
                const alpha = maskData.data[pixelIndex + 3];

                if (alpha > 0) { // Has mask content
                    hasContent = true;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }

        if (!hasContent) return null;

        return { minX, minY, maxX, maxY };
    }

    exportToCOCO() {
        const cocoData = {
            info: {
                description: 'TagiFLY Professional AI Labeling Tool Export',
                url: 'https://github.com/tagifly',
                version: '1.0',
                year: new Date().getFullYear(),
                contributor: 'TagiFLY User',
                date_created: new Date().toISOString()
            },
            licenses: [
                {
                    id: 1,
                    name: 'TagiFLY License',
                    url: 'https://github.com/tagifly'
                }
            ],
            images: [],
            annotations: [],
            categories: []
        };

        // Add categories (labels)
        this.labels.forEach((label, index) => {
            cocoData.categories.push({
                id: index + 1,
                name: label,
                supercategory: 'object'
            });
        });

        let imageId = 1;
        let annotationId = 1;

        // Process each image
        Object.keys(this.annotations).forEach(imagePath => {
            const annotations = this.annotations[imagePath];
            if (!annotations || annotations.length === 0) return;

            const imageObj = this.images.find(img => img.path === imagePath);
            if (!imageObj) return;

            // Get image dimensions
            const imgWidth = this.currentImage?.originalWidth || 1920;
            const imgHeight = this.currentImage?.originalHeight || 1080;

            cocoData.images.push({
                id: imageId,
                width: imgWidth,
                height: imgHeight,
                file_name: imageObj.name,
                license: 1,
                flickr_url: '',
                coco_url: '',
                date_captured: new Date().getTime()
            });

            // Add annotations
            annotations.forEach(annotation => {
                const categoryId = this.labels.indexOf(annotation.label) + 1;
                if (categoryId === 0) return;

                switch (annotation.type) {
                    case 'boundingbox':
                        const area = annotation.bbox.width * annotation.bbox.height;

                        cocoData.annotations.push({
                            id: annotationId++,
                            image_id: imageId,
                            category_id: categoryId,
                            segmentation: [],
                            area: Math.round(area),
                            bbox: [
                                Math.round(annotation.bbox.x),
                                Math.round(annotation.bbox.y),
                                Math.round(annotation.bbox.width),
                                Math.round(annotation.bbox.height)
                            ],
                            iscrowd: 0
                        });
                        break;

                    case 'polygon':
                        if (!annotation.points || annotation.points.length < 3) return;

                        // Convert polygon to COCO segmentation format
                        const segmentation = annotation.points.reduce((acc, point) => {
                            acc.push(Math.round(point.x), Math.round(point.y));
                            return acc;
                        }, []);

                        // Calculate polygon area using shoelace formula
                        let polygonArea = 0;
                        for (let i = 0; i < annotation.points.length; i++) {
                            const j = (i + 1) % annotation.points.length;
                            polygonArea += annotation.points[i].x * annotation.points[j].y;
                            polygonArea -= annotation.points[j].x * annotation.points[i].y;
                        }
                        polygonArea = Math.abs(polygonArea) / 2;

                        // Calculate bounding box for polygon
                        const xs = annotation.points.map(p => p.x);
                        const ys = annotation.points.map(p => p.y);
                        const minX = Math.min(...xs);
                        const minY = Math.min(...ys);
                        const maxX = Math.max(...xs);
                        const maxY = Math.max(...ys);

                        cocoData.annotations.push({
                            id: annotationId++,
                            image_id: imageId,
                            category_id: categoryId,
                            segmentation: [segmentation],
                            area: Math.round(polygonArea),
                            bbox: [
                                Math.round(minX),
                                Math.round(minY),
                                Math.round(maxX - minX),
                                Math.round(maxY - minY)
                            ],
                            iscrowd: 0
                        });
                        break;

                    case 'point':
                        // COCO keypoints format
                        if (annotation.x !== undefined && annotation.y !== undefined) {
                            cocoData.annotations.push({
                                id: annotationId++,
                                image_id: imageId,
                                category_id: categoryId,
                                keypoints: [Math.round(annotation.x), Math.round(annotation.y), 2], // 2 = visible
                                num_keypoints: 1,
                                area: 1,
                                bbox: [
                                    Math.round(annotation.x - 1),
                                    Math.round(annotation.y - 1),
                                    2,
                                    2
                                ],
                                iscrowd: 0
                            });
                        }
                        break;

                    case 'keypoint':
                        // COCO keypoints format for pose estimation
                        if (annotation.keypoints && annotation.keypoints.length > 0) {
                            const keypointArray = [];
                            annotation.keypoints.forEach(kp => {
                                keypointArray.push(Math.round(kp.x), Math.round(kp.y), kp.visible ? 2 : 1);
                            });

                            // Calculate bounding box from keypoints
                            const xs = annotation.keypoints.map(kp => kp.x);
                            const ys = annotation.keypoints.map(kp => kp.y);
                            const minX = Math.min(...xs);
                            const minY = Math.min(...ys);
                            const maxX = Math.max(...xs);
                            const maxY = Math.max(...ys);

                            cocoData.annotations.push({
                                id: annotationId++,
                                image_id: imageId,
                                category_id: categoryId,
                                keypoints: keypointArray,
                                num_keypoints: annotation.keypoints.length,
                                area: Math.round((maxX - minX) * (maxY - minY)),
                                bbox: [
                                    Math.round(minX),
                                    Math.round(minY),
                                    Math.round(maxX - minX),
                                    Math.round(maxY - minY)
                                ],
                                iscrowd: 0
                            });
                        }
                        break;

                    case 'polyline':
                        // COCO polyline as segmentation
                        if (annotation.points && annotation.points.length >= 2) {
                            const segmentation = annotation.points.reduce((acc, point) => {
                                acc.push(Math.round(point.x), Math.round(point.y));
                                return acc;
                            }, []);

                            // Calculate bounding box
                            const xs = annotation.points.map(p => p.x);
                            const ys = annotation.points.map(p => p.y);
                            const minX = Math.min(...xs);
                            const minY = Math.min(...ys);
                            const maxX = Math.max(...xs);
                            const maxY = Math.max(...ys);

                            cocoData.annotations.push({
                                id: annotationId++,
                                image_id: imageId,
                                category_id: categoryId,
                                segmentation: [segmentation],
                                area: Math.round((maxX - minX) * (maxY - minY)),
                                bbox: [
                                    Math.round(minX),
                                    Math.round(minY),
                                    Math.round(maxX - minX),
                                    Math.round(maxY - minY)
                                ],
                                iscrowd: 0
                            });
                        }
                        break;

                    case 'mask':
                        // COCO mask format (simplified)
                        if (annotation.maskData) {
                            // For now, create a simple bounding box representation
                            // In full implementation, this would convert mask to RLE format
                            cocoData.annotations.push({
                                id: annotationId++,
                                image_id: imageId,
                                category_id: categoryId,
                                segmentation: [], // Would contain RLE encoded mask
                                area: 100, // Would calculate from mask
                                bbox: [0, 0, 100, 100], // Would calculate from mask bounds
                                iscrowd: 0
                            });
                        }
                        break;
                }
            });

            imageId++;
        });

        return JSON.stringify(cocoData, null, 2);
    }

    async exportToPascalVOC() {
        const zip = new JSZip();
        let processedImages = 0;
        let totalAnnotations = 0;

        // Create README.txt with export info
        const readmeContent = `# Pascal VOC Dataset Export from TagiFLY
# Export Date: ${new Date().toISOString()}
# Total Classes: ${this.labels.length}

# Classes:
${this.labels.map((label, index) => `${index + 1}: ${label}`).join('\n')}

# Usage:
# 1. Extract this ZIP file
# 2. Each .xml file contains annotations for corresponding image
# 3. Standard Pascal VOC XML format with bounding boxes and polygons
# 4. Compatible with most computer vision frameworks

# Files Structure:
# - image1.xml: Annotations for image1.jpg
# - image2.xml: Annotations for image2.jpg
# - etc...
`;
        zip.file('README.txt', readmeContent);

        // Process ALL images with annotations (not just the first one!)
        for (const imagePath of Object.keys(this.annotations)) {
            const annotations = this.annotations[imagePath];
            if (!annotations || annotations.length === 0) continue;

            const imageObj = this.images.find(img => img.path === imagePath);
            if (!imageObj) continue;

            // Get image dimensions (use current image dimensions as fallback)
            const imgWidth = this.currentImage?.originalWidth || 1920;
            const imgHeight = this.currentImage?.originalHeight || 1080;

            // Create Pascal VOC XML for this specific image
            let xml = `<?xml version="1.0" encoding="UTF-8"?>
<annotation>
    <folder>images</folder>
    <filename>${imageObj.name}</filename>
    <path>${imagePath}</path>
    <source>
        <database>TagiFLY</database>
        <annotation>TagiFLY Professional AI Labeling Tool</annotation>
        <image>TagiFLY</image>
    </source>
    <size>
        <width>${imgWidth}</width>
        <height>${imgHeight}</height>
        <depth>3</depth>
    </size>
    <segmented>0</segmented>
`;

            let imageAnnotationCount = 0;

            // Add all objects for this specific image
            annotations.forEach(annotation => {
                switch (annotation.type) {
                    case 'boundingbox':
                        xml += `    <object>
        <name>${annotation.label}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>${Math.round(annotation.bbox.x)}</xmin>
            <ymin>${Math.round(annotation.bbox.y)}</ymin>
            <xmax>${Math.round(annotation.bbox.x + annotation.bbox.width)}</xmax>
            <ymax>${Math.round(annotation.bbox.y + annotation.bbox.height)}</ymax>
        </bndbox>
    </object>
`;
                        imageAnnotationCount++;
                        totalAnnotations++;
                        break;

                    case 'polygon':
                        if (!annotation.points || annotation.points.length < 3) return;

                        // Calculate bounding box for polygon
                        const xs = annotation.points.map(p => p.x);
                        const ys = annotation.points.map(p => p.y);
                        const minX = Math.min(...xs);
                        const minY = Math.min(...ys);
                        const maxX = Math.max(...xs);
                        const maxY = Math.max(...ys);

                        xml += `    <object>
        <name>${annotation.label}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>${Math.round(minX)}</xmin>
            <ymin>${Math.round(minY)}</ymin>
            <xmax>${Math.round(maxX)}</xmax>
            <ymax>${Math.round(maxY)}</ymax>
        </bndbox>
        <polygon>
`;
                        annotation.points.forEach((point, index) => {
                            xml += `            <point${index + 1}>
                <x>${Math.round(point.x)}</x>
                <y>${Math.round(point.y)}</y>
            </point${index + 1}>
`;
                        });
                        xml += `        </polygon>
    </object>
`;
                        imageAnnotationCount++;
                        totalAnnotations++;
                        break;

                    case 'point':
                        if (annotation.x !== undefined && annotation.y !== undefined) {
                            xml += `    <object>
        <name>${annotation.label}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>${Math.round(annotation.x - 5)}</xmin>
            <ymin>${Math.round(annotation.y - 5)}</ymin>
            <xmax>${Math.round(annotation.x + 5)}</xmax>
            <ymax>${Math.round(annotation.y + 5)}</ymax>
        </bndbox>
        <point>
            <x>${Math.round(annotation.x)}</x>
            <y>${Math.round(annotation.y)}</y>
        </point>
    </object>
`;
                            imageAnnotationCount++;
                            totalAnnotations++;
                        }
                        break;

                    case 'keypoint':
                        if (annotation.keypoints && annotation.keypoints.length > 0) {
                            // Calculate bounding box from all keypoints
                            const xs = annotation.keypoints.map(kp => kp.x);
                            const ys = annotation.keypoints.map(kp => kp.y);
                            const minX = Math.min(...xs);
                            const minY = Math.min(...ys);
                            const maxX = Math.max(...xs);
                            const maxY = Math.max(...ys);

                            xml += `    <object>
        <name>${annotation.label}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>${Math.round(minX)}</xmin>
            <ymin>${Math.round(minY)}</ymin>
            <xmax>${Math.round(maxX)}</xmax>
            <ymax>${Math.round(maxY)}</ymax>
        </bndbox>
        <keypoints>
`;
                            annotation.keypoints.forEach((kp, index) => {
                                xml += `            <keypoint${index + 1}>
                <name>${kp.name || `point_${index + 1}`}</name>
                <x>${Math.round(kp.x)}</x>
                <y>${Math.round(kp.y)}</y>
                <visible>${kp.visible ? 1 : 0}</visible>
            </keypoint${index + 1}>
`;
                            });
                            xml += `        </keypoints>
    </object>
`;
                            imageAnnotationCount++;
                            totalAnnotations++;
                        }
                        break;

                    case 'polyline':
                        if (annotation.points && annotation.points.length >= 2) {
                            // Calculate bounding box for polyline
                            const xs = annotation.points.map(p => p.x);
                            const ys = annotation.points.map(p => p.y);
                            const minX = Math.min(...xs);
                            const minY = Math.min(...ys);
                            const maxX = Math.max(...xs);
                            const maxY = Math.max(...ys);

                            xml += `    <object>
        <name>${annotation.label}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>${Math.round(minX)}</xmin>
            <ymin>${Math.round(minY)}</ymin>
            <xmax>${Math.round(maxX)}</xmax>
            <ymax>${Math.round(maxY)}</ymax>
        </bndbox>
        <polyline>
`;
                            annotation.points.forEach((point, index) => {
                                xml += `            <point${index + 1}>
                <x>${Math.round(point.x)}</x>
                <y>${Math.round(point.y)}</y>
            </point${index + 1}>
`;
                            });
                            xml += `        </polyline>
    </object>
`;
                            imageAnnotationCount++;
                            totalAnnotations++;
                        }
                        break;

                    case 'mask':
                        if (annotation.maskData) {
                            // For mask, create a placeholder bounding box
                            // In full implementation, this would extract actual mask bounds
                            xml += `    <object>
        <name>${annotation.label}</name>
        <pose>Unspecified</pose>
        <truncated>0</truncated>
        <difficult>0</difficult>
        <bndbox>
            <xmin>0</xmin>
            <ymin>0</ymin>
            <xmax>100</xmax>
            <ymax>100</ymax>
        </bndbox>
        <mask>
            <id>${annotation.id || 'mask_' + imageAnnotationCount}</id>
            <type>painted_mask</type>
        </mask>
    </object>
`;
                            imageAnnotationCount++;
                            totalAnnotations++;
                        }
                        break;
                }
            });

            xml += '</annotation>';

            // Add this XML file to ZIP (only if it has annotations)
            if (imageAnnotationCount > 0) {
                const xmlFileName = imageObj.name.replace(/\.[^/.]+$/, '.xml');
                zip.file(xmlFileName, xml);
                processedImages++;
                console.log(`✅ Added ${xmlFileName} with ${imageAnnotationCount} annotations`);
            }
        }

        // Check if we have any files to export
        if (processedImages === 0) {
            throw new Error('No annotations found to export');
        }

        // Add summary file
        const summaryContent = `# Pascal VOC Export Summary
Total Images Processed: ${processedImages}
Total Annotations: ${totalAnnotations}
Classes: ${this.labels.length}
Export Date: ${new Date().toISOString()}

# Files in this ZIP:
${Array.from({ length: processedImages }, (_, i) => `- XML file ${i + 1}: Annotation file for corresponding image`).join('\n')}
- README.txt: Usage instructions
- summary.txt: Export statistics

# Classes used in this export:
${this.labels.join(', ')}
`;
        zip.file('summary.txt', summaryContent);

        // Generate ZIP buffer
        const buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        console.log(`📦 Pascal VOC ZIP created with ${processedImages} XML files`);
        return { buffer, processedImages, totalAnnotations };
    }

    // ========== ANNOTATION SELECTION ==========
    getAnnotationAt(screenX, screenY) {
        if (!this.currentImage) return null;

        const imagePath = this.currentImage.path;
        const annotations = this.annotations[imagePath] || [];

        // Convert screen coordinates to image coordinates for checking
        const imageCoords = this.screenToImage(screenX, screenY);

        // Check annotations in reverse order (top to bottom)
        for (let i = annotations.length - 1; i >= 0; i--) {
            const annotation = annotations[i];

            if (this.isPointInAnnotation(imageCoords.x, imageCoords.y, annotation)) {
                return { annotation, index: i };
            }
        }

        return null;
    }

    isPointInAnnotation(imageX, imageY, annotation) {
        switch (annotation.type) {
            case 'boundingbox':
                return this.isPointInBoundingBox(imageX, imageY, annotation.bbox);
            case 'polygon':
                // POLYGON: COMPLETELY DISABLED FOR SELECTION
                return false;
            case 'point':
                return this.isPointNearPoint(imageX, imageY, annotation.x, annotation.y);
            case 'keypoint':
                const keypointHit = this.isPointNearKeypoints(imageX, imageY, annotation.keypoints);
                if (keypointHit) {
                    // Store which keypoint was clicked for dragging
                    annotation._selectedKeypointIndex = keypointHit.index;
                    return true;
                }
                return false;
            case 'polyline':
                const polylineHit = this.isPointNearPolyline(imageX, imageY, annotation.points);
                if (polylineHit) {
                    // Store which point was clicked for dragging
                    annotation._selectedPointIndex = polylineHit.index;
                    return true;
                }
                return false;
            case 'mask':
                // Mask annotations can be selected by clicking anywhere on the image
                // Since mask covers the entire image area, always return true for selection
                return this.isPointInMask(imageX, imageY, annotation);
            default:
                return false;
        }
    }

    isPointInBoundingBox(x, y, bbox) {
        // Hit margin in image coordinates (adjusted for zoom)
        const hitMargin = 10 / this.zoom;
        return x >= bbox.x - hitMargin && x <= bbox.x + bbox.width + hitMargin &&
            y >= bbox.y - hitMargin && y <= bbox.y + bbox.height + hitMargin;
    }

    getPolygonBoundingBox(points) {
        if (!points || points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

        const xs = points.map(p => p.x);
        const ys = points.map(p => p.y);

        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    isPointInPolygon(x, y, points) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            if (((points[i].y > y) !== (points[j].y > y)) &&
                (x < (points[j].x - points[i].x) * (y - points[i].y) / (points[j].y - points[i].y) + points[i].x)) {
                inside = !inside;
            }
        }
        return inside;
    }

    isPointNearPoint(x1, y1, x2, y2) {
        const distance = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
        return distance < 10 / this.zoom; // 10 pixel tolerance adjusted for zoom
    }

    isPointNearKeypoints(x, y, keypoints) {
        const hitRadius = 20 / this.zoom; // Bigger hit radius for easier selection

        // Find the closest keypoint within hit radius
        let closestKeypoint = null;
        let closestDistance = Infinity;

        keypoints.forEach((keypoint, index) => {
            if (!keypoint.visible) return;
            const distance = Math.sqrt((x - keypoint.x) ** 2 + (y - keypoint.y) ** 2);
            if (distance <= hitRadius && distance < closestDistance) {
                closestDistance = distance;
                closestKeypoint = { keypoint, index };
            }
        });

        return closestKeypoint;
    }

    isPointNearPolyline(x, y, points) {
        if (!points || points.length < 2) return false;

        const hitRadius = 15 / this.zoom; // Hit radius for polyline points

        // First check if clicking on any point
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
            if (distance <= hitRadius) {
                return { point, index: i };
            }
        }

        // Then check if clicking near any line segment
        const lineHitRadius = 8 / this.zoom;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];

            // Calculate distance from point to line segment
            const A = x - p1.x;
            const B = y - p1.y;
            const C = p2.x - p1.x;
            const D = p2.y - p1.y;

            const dot = A * C + B * D;
            const lenSq = C * C + D * D;

            if (lenSq === 0) continue; // p1 and p2 are the same point

            let param = dot / lenSq;
            param = Math.max(0, Math.min(1, param)); // Clamp to segment

            const xx = p1.x + param * C;
            const yy = p1.y + param * D;

            const dx = x - xx;
            const dy = y - yy;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= lineHitRadius) {
                // Return closest point on the line for potential point insertion
                return { point: { x: xx, y: yy }, index: i + 1, isLineHit: true };
            }
        }

        return false;
    }

    isPointNearPolygonPoints(x, y, points) {
        if (!points || points.length === 0) return false;

        const hitRadius = 15 / this.zoom; // Hit radius for polygon points

        // Check if clicking on any point
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const distance = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
            if (distance <= hitRadius) {
                return { point, index: i };
            }
        }

        return false;
    }

    isPointInMask(x, y, annotation) {
        // For mask annotations, check if the point is within the image bounds
        // and if there's actual mask data at that location
        if (!annotation.maskData) return false;

        // Convert image coordinates to mask canvas coordinates
        const maskX = Math.floor(x);
        const maskY = Math.floor(y);

        // Check bounds
        if (maskX < 0 || maskY < 0 || maskX >= annotation.maskData.width || maskY >= annotation.maskData.height) {
            return false;
        }

        // Check if there's mask data at this pixel (alpha channel > 0)
        const pixelIndex = (maskY * annotation.maskData.width + maskX) * 4;
        const alpha = annotation.maskData.data[pixelIndex + 3];

        return alpha > 0; // Return true if there's mask content at this location
    }

    // ========== DRAG & RESIZE SYSTEM ==========
    startDragging(screenX, screenY) {
        if (!this.selectedAnnotation) return;

        // CRITICAL: Stop any panning that might be active
        if (this.isPanning) {
            console.log('🛑 Stopping pan to start drag');
            this.stopPanning();
        }

        console.log(`🖱️ Starting drag for ${this.selectedAnnotation.type} annotation`);

        this.isDragging = true;
        const imageCoords = this.screenToImage(screenX, screenY);

        // Store offset from annotation position
        switch (this.selectedAnnotation.type) {
            case 'boundingbox':
                this.dragOffset.x = imageCoords.x - this.selectedAnnotation.bbox.x;
                this.dragOffset.y = imageCoords.y - this.selectedAnnotation.bbox.y;
                break;
            case 'point':
                this.dragOffset.x = imageCoords.x - this.selectedAnnotation.x;
                this.dragOffset.y = imageCoords.y - this.selectedAnnotation.y;
                break;
            case 'keypoint':
                // For keypoints, we drag individual keypoint
                if (this.selectedAnnotation._selectedKeypointIndex !== undefined) {
                    const keypoint = this.selectedAnnotation.keypoints[this.selectedAnnotation._selectedKeypointIndex];
                    this.dragOffset.x = imageCoords.x - keypoint.x;
                    this.dragOffset.y = imageCoords.y - keypoint.y;
                }
                break;
            // POLYGON: NO DRAGGING SUPPORT
            case 'polyline':
                // For polylines, we drag individual point
                if (this.selectedAnnotation._selectedPointIndex !== undefined) {
                    const point = this.selectedAnnotation.points[this.selectedAnnotation._selectedPointIndex];
                    this.dragOffset.x = imageCoords.x - point.x;
                    this.dragOffset.y = imageCoords.y - point.y;
                }
                break;
        }

        this.canvas.style.cursor = 'move';
    }

    dragAnnotation(screenX, screenY) {
        if (!this.isDragging || !this.selectedAnnotation) return;

        const imageCoords = this.screenToImage(screenX, screenY);

        switch (this.selectedAnnotation.type) {
            case 'boundingbox':
                this.selectedAnnotation.bbox.x = imageCoords.x - this.dragOffset.x;
                this.selectedAnnotation.bbox.y = imageCoords.y - this.dragOffset.y;
                break;
            case 'point':
                this.selectedAnnotation.x = imageCoords.x - this.dragOffset.x;
                this.selectedAnnotation.y = imageCoords.y - this.dragOffset.y;
                break;
            case 'keypoint':
                // Drag individual keypoint
                if (this.selectedAnnotation._selectedKeypointIndex !== undefined) {
                    const keypoint = this.selectedAnnotation.keypoints[this.selectedAnnotation._selectedKeypointIndex];
                    keypoint.x = imageCoords.x - this.dragOffset.x;
                    keypoint.y = imageCoords.y - this.dragOffset.y;

                    // Silent keypoint dragging
                }
                break;
            // POLYGON: NO DRAGGING SUPPORT
            case 'polyline':
                // Drag individual polyline point
                if (this.selectedAnnotation._selectedPointIndex !== undefined) {
                    const point = this.selectedAnnotation.points[this.selectedAnnotation._selectedPointIndex];
                    point.x = imageCoords.x - this.dragOffset.x;
                    point.y = imageCoords.y - this.dragOffset.y;

                    // Silent polyline point dragging
                }
                break;
        }

        this.redrawCanvas();
    }

    finishDragging() {
        console.log('🛑 Finishing drag operation');

        this.isDragging = false;
        this.canvas.style.cursor = 'default';

        // CRITICAL: Ensure panning is completely stopped
        if (this.isPanning) {
            console.log('🛑 Force stopping pan after drag');
            this.stopPanning();
        }

        // Clear selection indices
        if (this.selectedAnnotation) {
            if (this.selectedAnnotation.type === 'keypoint') {
                delete this.selectedAnnotation._selectedKeypointIndex;
            } else if (this.selectedAnnotation.type === 'polyline' || this.selectedAnnotation.type === 'polygon') {
                delete this.selectedAnnotation._selectedPointIndex;
            }
        }

        console.log('✅ Drag finished, pan stopped');
    }

    selectAnnotation(annotation, index) {
        this.selectedAnnotation = annotation;
        this.selectedAnnotationIndex = index;
        this.redrawCanvas();
    }



    startResizing(handle) {
        this.isResizing = true;
        this.resizeHandle = handle;
        this.canvas.style.cursor = this.getResizeCursor(handle);
    }

    resizeAnnotation(screenX, screenY) {
        if (!this.isResizing || !this.selectedAnnotation || this.selectedAnnotation.type !== 'boundingbox') return;

        const imageCoords = this.screenToImage(screenX, screenY);
        const bbox = this.selectedAnnotation.bbox;

        switch (this.resizeHandle) {
            case 'nw':
                const newWidth = bbox.x + bbox.width - imageCoords.x;
                const newHeight = bbox.y + bbox.height - imageCoords.y;
                if (newWidth > 5 && newHeight > 5) {
                    bbox.width = newWidth;
                    bbox.height = newHeight;
                    bbox.x = imageCoords.x;
                    bbox.y = imageCoords.y;
                }
                break;
            case 'n':
                const heightN = bbox.y + bbox.height - imageCoords.y;
                if (heightN > 5) {
                    bbox.height = heightN;
                    bbox.y = imageCoords.y;
                }
                break;
            case 'ne':
                const widthNE = imageCoords.x - bbox.x;
                const heightNE = bbox.y + bbox.height - imageCoords.y;
                if (widthNE > 5 && heightNE > 5) {
                    bbox.width = widthNE;
                    bbox.height = heightNE;
                    bbox.y = imageCoords.y;
                }
                break;
            case 'e':
                const widthE = imageCoords.x - bbox.x;
                if (widthE > 5) {
                    bbox.width = widthE;
                }
                break;
            case 'se':
                const widthSE = imageCoords.x - bbox.x;
                const heightSE = imageCoords.y - bbox.y;
                if (widthSE > 5 && heightSE > 5) {
                    bbox.width = widthSE;
                    bbox.height = heightSE;
                }
                break;
            case 's':
                const heightS = imageCoords.y - bbox.y;
                if (heightS > 5) {
                    bbox.height = heightS;
                }
                break;
            case 'sw':
                const widthSW = bbox.x + bbox.width - imageCoords.x;
                const heightSW = imageCoords.y - bbox.y;
                if (widthSW > 5 && heightSW > 5) {
                    bbox.width = widthSW;
                    bbox.height = heightSW;
                    bbox.x = imageCoords.x;
                }
                break;
            case 'w':
                const widthW = bbox.x + bbox.width - imageCoords.x;
                if (widthW > 5) {
                    bbox.width = widthW;
                    bbox.x = imageCoords.x;
                }
                break;
        }

        this.redrawCanvas();
    }

    getResizeCursor(handle) {
        const cursors = {
            'nw': 'nw-resize',
            'n': 'n-resize',
            'ne': 'ne-resize',
            'e': 'e-resize',
            'se': 'se-resize',
            's': 's-resize',
            'sw': 'sw-resize',
            'w': 'w-resize'
        };
        return cursors[handle] || 'default';
    }

    finishResizing() {
        this.isResizing = false;
        this.resizeHandle = null;
        this.canvas.style.cursor = 'default';
    }



    drawLabel(text, x, y, color) {
        if (!text) return;

        this.ctx.font = '12px Inter';
        this.ctx.textAlign = 'left';

        const metrics = this.ctx.measureText(text);
        const textWidth = metrics.width;
        const textHeight = 16;

        // Background
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y - textHeight, textWidth + 8, textHeight + 4);

        // Text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(text, x + 4, y - 4);
    }



    cancelDrawing() {
        this.isDrawing = false;
        this.isPolygonDrawing = false;
        this.isMaskPainting = false;
        this.isPolylineDrawing = false;
        this.currentBbox = null;
        this.polygonPoints = [];
        this.polylinePoints = [];
        this.currentMaskAnnotation = null;
        this.canvas.style.cursor = 'default';
        this.redrawCanvas();
        NotificationManager.info('Drawing cancelled');
    }

    deleteSelectedAnnotation() {
        if (!this.selectedAnnotation || !this.currentImage) return;

        const imagePath = this.currentImage.path;
        const annotations = this.annotations[imagePath] || [];
        const index = annotations.indexOf(this.selectedAnnotation);

        if (index > -1) {
            // Save to history before deleting
            this.saveToHistory('delete_annotation', {
                annotation: this.selectedAnnotation,
                index: index
            });

            annotations.splice(index, 1);
            this.selectedAnnotation = null;
            this.selectedAnnotationIndex = -1;
            this.redrawCanvas();
            this.renderImageList();
            this.updateUI();
            NotificationManager.success('Annotation deleted');
        }
    }
}

// ========== INITIALIZE APPLICATION ==========
document.addEventListener('DOMContentLoaded', () => {
    console.log('🌐 DOM Content Loaded');
    window.tagiFLY = new TagiFLYApp();
});