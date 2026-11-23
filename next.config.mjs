/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // El PDF del catalogo lee sus fuentes y emoji de public/catalogo desde el
  // disco: hay que meterlos en la funcion serverless de esa ruta.
  outputFileTracingIncludes: {
    "/api/reportes/catalogo/pdf": ["./public/catalogo/**/*"],
  },
}

export default nextConfig
