/** Lightweight toast notifications (prototype port). */
export function showToast(message: string): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast-msg";
  toast.innerHTML = `<span class="status-dot"></span><span>${message}</span>`;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.2s ease";
    window.setTimeout(() => toast.remove(), 200);
  }, 2400);
}
