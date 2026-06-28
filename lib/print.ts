// En iOS PWA (standalone), window.print() y window.open() estan bloqueados.
// La unica salida confiable es el Web Share API nativo que muestra el share
// sheet de iOS — desde ahi el usuario puede elegir "Open in Safari" y
// desde Safari si funciona Print/Save PDF.
export async function printOrShare() {
  const isIOSPWA =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isIOSPWA) {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (data: { url: string }) => Promise<void> }).share({
          url: window.location.href,
        });
      } catch {
        // usuario cancelo el share — no hacer nada
      }
    } else {
      alert('To print: tap the Share button (□↑) then "Open in Safari"');
    }
    return;
  }

  window.print();
}
