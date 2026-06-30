// window.print() funciona directamente en iOS 16.4+ en modo PWA standalone.
// El enfoque anterior (window.open + ?print=1) abria Safari en un contexto
// separado sin sesion de autenticacion, mostrando el login en vez del documento.
export async function printOrShare() {
  window.print();
}
