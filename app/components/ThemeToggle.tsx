import { Moon, Sun } from "lucide-react";
import { useColorTheme } from "../hooks/useColorTheme.ts";

/** The one island on the static pages. A real button, 44px target. */
export default function ThemeToggle() {
	const { theme, toggle } = useColorTheme();
	const next = theme === "dark" ? "light" : "dark";
	return (
		<button
			type="button"
			className="icon-button"
			onClick={toggle}
			aria-label={`Switch to ${next} mode`}
			title={`Switch to ${next} mode`}
		>
			{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
		</button>
	);
}
