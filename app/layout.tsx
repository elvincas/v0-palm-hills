import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Palm Hills - Beauty & Health',
  description: 'Sistema de gestión empresarial para negocios de belleza y salud',
  generator: 'v0.app',
  metadataBase: new URL('https://v0-palm-hills.vercel.app'),
  openGraph: {
    title: 'Palm Hills - Beauty & Health',
    description: 'Sistema de gestión empresarial para negocios de belleza y salud',
    url: 'https://v0-palm-hills.vercel.app',
    siteName: 'Palm Hills',
    images: [
      {
        url: '/og-image.png',
        width: 1024,
        height: 1024,
        alt: 'Palm Hills Beauty & Health',
      },
    ],
    locale: 'es_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Palm Hills - Beauty & Health',
    description: 'Sistema de gestión empresarial para negocios de belleza y salud',
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className="bg-background">
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
