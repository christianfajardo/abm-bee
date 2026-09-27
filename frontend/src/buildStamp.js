// Build-time stamp, injected by vite.config.js (define: __BUILD_STAMP__).
// Shown in the sidebar so a user can see whether their tab is running a
// stale cached bundle. In dev mode the bare identifier is undefined, so
// fall back to "dev".
export const BUILD_STAMP =
  typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "dev";