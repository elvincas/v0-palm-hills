import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'overlays-content',
}

export const metadata: Metadata = {
  title: 'Palm Hills - Beauty & Health',
  description: 'Business management system for beauty and health businesses',
  generator: 'v0.app',
  metadataBase: new URL('https://v0-palm-hills.vercel.app'),
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Palm Hills',
  },
  openGraph: {
    title: 'Palm Hills - Beauty & Health',
    description: 'Business management system for beauty and health businesses',
    url: 'https://v0-palm-hills.vercel.app',
    siteName: 'Palm Hills',
    images: [
      {
        url: '/logo.png',
        width: 1080,
        height: 1080,
        alt: 'Palm Hills Beauty & Health',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Palm Hills - Beauty & Health',
    description: 'Business management system for beauty and health businesses',
    images: ['/logo.png'],
  },
  icons: {
    icon: [
      { url: '/logo.png', type: 'image/png' },
      { url: '/icon-light-32x32.png', sizes: '32x32', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', sizes: '32x32', type: 'image/png', media: '(prefers-color-scheme: dark)' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-background">
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
