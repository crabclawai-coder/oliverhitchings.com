/**
 * Scroll-scrubbed video playback.
 * Ties video.currentTime to the container's position in the viewport.
 *
 * Progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height)
 * Clamped to [0, 1]. Updated via requestAnimationFrame for smoothness.
 */

type ScrubPair = {
	video: HTMLVideoElement;
	container: HTMLElement;
};

export function initScrollScrubbedVideos(pairs: ScrubPair[]): () => void {
	let rafId = 0;
	let lastTick = 0;
	const TICK_MS = 16; // ~60fps cap

	const tick = (ts: number) => {
		if (ts - lastTick >= TICK_MS) {
			lastTick = ts;
			for (const { video, container } of pairs) {
				if (!video || !container) continue;
				const rect = container.getBoundingClientRect();
				const raw =
					(window.innerHeight - rect.top) / (window.innerHeight + rect.height);
				const progress = Math.max(0, Math.min(1, raw));
				if (
					video.duration > 0 &&
					isFinite(video.duration) &&
					!video.seeking
				) {
					video.currentTime = video.duration * progress;
				}
			}
		}
		rafId = requestAnimationFrame(tick);
	};

	rafId = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(rafId);
}

/**
 * Fallback: if a video hasn't loaded metadata within 2s (iOS Safari etc.),
 * switch it to autoplay-loop so the section doesn't look broken.
 */
export function scrubFallback(videos: HTMLVideoElement[], timeoutMs = 2000) {
	window.setTimeout(() => {
		for (const v of videos) {
			if (!isFinite(v.duration) || v.duration === 0) {
				v.loop = true;
				v.autoplay = true;
				v.play().catch(() => {
					/* autoplay blocked, nothing to do */
				});
			}
		}
	}, timeoutMs);
}
