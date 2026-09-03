import { useCallback, useEffect, useRef } from "react";

type MotionEventCtor = typeof DeviceMotionEvent & {
	requestPermission?: () => Promise<"granted" | "denied">;
};

/**
 * Shake-to-shuffle. Listens to devicemotion and fires when the acceleration
 * jumps by more than the threshold, at most once per second. Returns `arm`,
 * to be called from a user gesture: iOS only grants motion access from one.
 */
export function useShake(onShake: () => void, enabled: boolean) {
	const last = useRef<{ x: number; y: number; z: number } | null>(null);
	const firedAt = useRef(0);

	useEffect(() => {
		if (
			!enabled ||
			typeof window === "undefined" ||
			!("DeviceMotionEvent" in window)
		)
			return;
		const onMotion = (e: DeviceMotionEvent) => {
			const a = e.accelerationIncludingGravity;
			if (!a || a.x == null || a.y == null || a.z == null) return;
			const prev = last.current;
			last.current = { x: a.x, y: a.y, z: a.z };
			if (!prev) return;
			const delta =
				Math.abs(a.x - prev.x) +
				Math.abs(a.y - prev.y) +
				Math.abs(a.z - prev.z);
			// 30 m/s² summed across axes: a deliberate shake, not a walk.
			const now = Date.now();
			if (delta > 30 && now - firedAt.current > 1000) {
				firedAt.current = now;
				onShake();
			}
		};
		window.addEventListener("devicemotion", onMotion);
		return () => window.removeEventListener("devicemotion", onMotion);
	}, [onShake, enabled]);

	const arm = useCallback(() => {
		const ctor = (
			typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : undefined
		) as MotionEventCtor | undefined;
		// Rejections are ignored: a denied permission just means no shake, and
		// the shuffle button still works.
		ctor?.requestPermission?.().catch(() => undefined);
	}, []);

	return arm;
}
