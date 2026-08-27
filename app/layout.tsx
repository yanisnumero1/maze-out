import './globals.css';
export const metadata = { title: 'MAZE-OUT · BRIDGE', description: 'Pilotage live de soirée' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="fr"><body><main className="mx-auto min-h-screen max-w-7xl p-4 sm:p-6">{children}</main></body></html> }
