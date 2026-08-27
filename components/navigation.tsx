import Link from 'next/link';
export function Navigation(){return <nav className="mb-5 flex gap-2 text-sm"><Link className="rounded-full bg-fuchsia-600 px-4 py-2 font-semibold" href={'/hostess' as any}>Hôtesse</Link><Link className="rounded-full bg-zinc-800 px-4 py-2 font-semibold" href={'/admin' as any}>Administration</Link></nav>}
