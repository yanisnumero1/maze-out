import { LiveDashboard } from '@/components/live-dashboard'; import { AuthPanel } from '@/components/auth-panel'; import { Navigation } from '@/components/navigation'; import { getLiveTables } from '@/lib/data';
export default async function Home(){return <><AuthPanel/><Navigation/><LiveDashboard initialTables={await getLiveTables()}/></>}
