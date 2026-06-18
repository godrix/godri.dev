export function startPageTransition(callback: () => void) {
  if (typeof document !== "undefined" && "startViewTransition" in document) {
    document.startViewTransition(callback);
  } else {
    callback();
  }
}
