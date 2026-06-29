// En iOS PWA (standalone), window.print() no funciona directamente.
// Abrimos la misma URL con ?print=1 en Safari (window.open desde PWA abre Safari),
// y la página detecta el parámetro y llama window.print() automaticamente.
export async function printOrShare() {
  const isIOSPWA =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isIOSPWA) {
    const base = window.location.href.split("?")[0];
    const opened = window.open(base + "?print=1", "_blank");
    if (!opened) {
      // window.open bloqueado (iOS muy antiguo) — fallback al share sheet
      if (typeof navigator !== "undefined" && "share" in navigator) {
        try {
          await (navigator as Navigator & { share: (data: { url: string }) => Promise<void> }).share({
            url: window.location.href,
          });
        } catch {
          // usuario canceló
        }
      } else {
        alert('To print: tap the Share button (□↑) then "Open in Safari"');
      }
    }
    return;
  }

  window.print();
}
