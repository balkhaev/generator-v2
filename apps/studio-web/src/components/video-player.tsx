"use client";

import { cn } from "@generator/ui/lib/utils";
import { Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import IconButton from "./icon-button";

const emptyCaptionTrack = "data:text/vtt;charset=utf-8,WEBVTT";

function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) {
		return "0:00";
	}

	const totalSeconds = Math.floor(seconds);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;

	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function VideoPlayer({
	bottomBarExtra,
	label,
	meta,
	src,
}: {
	bottomBarExtra?: ReactNode;
	label: string;
	meta: ReactNode;
	src: string;
}) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isMuted, setIsMuted] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [isScrubbing, setIsScrubbing] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		setIsPlaying(!video.paused);
		setIsMuted(video.muted);
		setCurrentTime(video.currentTime);
		setDuration(Number.isFinite(video.duration) ? video.duration : 0);
		setIsLoading(video.readyState < 3 && !video.paused);
	}, []);

	const togglePlay = useCallback(async () => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		try {
			if (video.paused) {
				if (video.readyState < 3) {
					setIsLoading(true);
				}
				await video.play();
			} else {
				video.pause();
			}
		} catch {
			setIsLoading(false);
		}
	}, []);

	const toggleMute = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		video.muted = !video.muted;
		setIsMuted(video.muted);
	}, []);

	const handleSeek = useCallback((value: number) => {
		const video = videoRef.current;
		if (!(video && Number.isFinite(video.duration))) {
			return;
		}

		video.currentTime = value;
		setCurrentTime(value);
	}, []);

	const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

	function renderPlayPauseIcon() {
		if (isLoading) {
			return <Loader2 className="size-3 animate-spin" />;
		}

		if (isPlaying) {
			return <Pause className="size-3" />;
		}

		return <Play className="size-3" />;
	}

	return (
		<div className="relative flex h-full w-full items-center justify-center">
			<video
				className="h-full w-full cursor-pointer bg-black/90 object-contain"
				onCanPlay={() => setIsLoading(false)}
				onClick={() => {
					togglePlay();
				}}
				onDurationChange={(event) => {
					const next = event.currentTarget.duration;
					setDuration(Number.isFinite(next) ? next : 0);
				}}
				onLoadedMetadata={(event) => {
					const next = event.currentTarget.duration;
					setDuration(Number.isFinite(next) ? next : 0);
				}}
				onLoadStart={() => {
					const video = videoRef.current;
					if (video && video.readyState < 3) {
						setIsLoading(true);
					}
				}}
				onPause={() => setIsPlaying(false)}
				onPlay={() => setIsPlaying(true)}
				onPlaying={() => setIsLoading(false)}
				onSeeked={() => setIsLoading(false)}
				onSeeking={() => setIsLoading(true)}
				onStalled={() => setIsLoading(true)}
				onTimeUpdate={(event) => {
					if (!isScrubbing) {
						setCurrentTime(event.currentTarget.currentTime);
					}
				}}
				onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
				onWaiting={() => setIsLoading(true)}
				playsInline
				preload="metadata"
				ref={videoRef}
				src={src}
			>
				<track
					default
					kind="captions"
					label="Captions unavailable"
					src={emptyCaptionTrack}
					srcLang="en"
				/>
			</video>

			{isLoading ? (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="flex size-12 items-center justify-center rounded-full bg-background/70 backdrop-blur-md">
						<Loader2 className="size-6 animate-spin text-foreground" />
					</div>
				</div>
			) : null}

			<div className="absolute right-2 bottom-2 left-2 flex flex-col gap-1.5 rounded-lg bg-background/80 px-3 py-2 backdrop-blur-lg dark:bg-background/60">
				<input
					aria-label="Seek video"
					className={cn(
						"h-1 w-full cursor-pointer appearance-none rounded-full bg-foreground/15",
						"[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full",
						"[&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground",
						"[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-foreground",
						"[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full"
					)}
					max={duration || 0}
					min={0}
					onChange={(event) => handleSeek(Number(event.target.value))}
					onMouseDown={() => setIsScrubbing(true)}
					onMouseUp={() => setIsScrubbing(false)}
					onTouchEnd={() => setIsScrubbing(false)}
					onTouchStart={() => setIsScrubbing(true)}
					step={0.01}
					style={{
						background: `linear-gradient(to right, var(--color-foreground) 0%, var(--color-foreground) ${progressPercent}%, color-mix(in oklab, var(--color-foreground) 15%, transparent) ${progressPercent}%, color-mix(in oklab, var(--color-foreground) 15%, transparent) 100%)`,
					}}
					type="range"
					value={Math.min(currentTime, duration || 0)}
				/>

				<div className="flex items-center gap-2">
					<IconButton
						hint={isPlaying ? "Pause" : "Play"}
						label={isPlaying ? "Pause video" : "Play video"}
						onClick={togglePlay}
						size="icon-xs"
					>
						{renderPlayPauseIcon()}
					</IconButton>
					<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
						{formatTime(currentTime)} / {formatTime(duration)}
					</span>
					<div className="min-w-0 flex-1">
						<p className="truncate text-xs">{label}</p>
						<p className="truncate text-[11px] text-muted-foreground">{meta}</p>
					</div>
					{bottomBarExtra}
					<IconButton
						hint={isMuted ? "Unmute" : "Mute"}
						label={isMuted ? "Unmute video" : "Mute video"}
						onClick={toggleMute}
						size="icon-xs"
					>
						{isMuted ? (
							<VolumeX className="size-3" />
						) : (
							<Volume2 className="size-3" />
						)}
					</IconButton>
				</div>
			</div>
		</div>
	);
}
