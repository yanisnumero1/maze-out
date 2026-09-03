import './globals.css';
export const metadata = { title: 'MAZE-OUT · BRIDGE', description: 'Pilotage live de soirée' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="fr"><body><main className="app-shell mx-auto min-h-[100dvh] max-w-7xl overflow-x-hidden p-3 sm:p-6">{children}</main></body></html> }
