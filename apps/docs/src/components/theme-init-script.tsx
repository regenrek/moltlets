export function ThemeInitScript() {
  const script = `(() => {
    try {
      const COOKIE = "clawlets-theme";
      let theme = null;

      try {
        theme = localStorage.getItem(COOKIE);
      } catch (_) {}

      if (!theme) {
        const match = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]*)"));
        theme = match ? decodeURIComponent(match[1]) : null;
      }

      if (theme !== "light" && theme !== "dark") {
        theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      }

      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(theme);

      let meta = document.querySelector('meta[name="color-scheme"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "color-scheme");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", "light dark");
    } catch (_) {}
  })();`

  return (
    <script id="theme-init" suppressHydrationWarning>
      {script}
    </script>
  )
}
