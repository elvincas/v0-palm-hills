// Baja un PDF generado en el servidor y abre el share sheet nativo (Print /
// Save to Files / AirDrop). Es el unico camino de impresion que funciona bien
// en Safari de iPhone: window.print() ahi no abre nada o ignora los cortes de
// pagina.
//
// Si iOS revoco el "user activation" mientras se generaba el PDF, share() falla
// con NotAllowedError sin que el usuario haya cancelado nada: en ese caso el
// PDF se abre directo. Y si el bloqueador de pop-ups tampoco deja abrir una
// pestana (mismo motivo), se navega al PDF en esta misma — volver con "atras".
export async function compartirPdf(url: string, nombre: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], nombre, { type: "application/pdf" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (shareErr) {
        if (shareErr instanceof DOMException && shareErr.name === "AbortError") return;
      }
    }
    const blobUrl = URL.createObjectURL(blob);
    if (!window.open(blobUrl, "_blank")) window.location.href = blobUrl;
  } catch (err) {
    alert("Could not generate the PDF: " + (err instanceof Error ? err.message : String(err)));
  }
}
