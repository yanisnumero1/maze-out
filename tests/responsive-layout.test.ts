import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('passe responsive des interfaces opérationnelles', () => {
  it('protège le conteneur commun contre le débordement horizontal', () => {
    const layout = source('app/layout.tsx');
    const styles = source('app/globals.css');
    expect(layout).toContain('app-shell mx-auto min-h-[100dvh] max-w-7xl overflow-x-hidden');
    expect(layout).toContain("viewportFit: 'cover'");
    for (const inset of ['top', 'right', 'bottom', 'left']) expect(styles).toContain(`env(safe-area-inset-${inset})`);
  });

  it('replie la navigation et maintient des zones tactiles utilisables', () => {
    const navigation = source('components/navigation.tsx');
    const styles = source('app/globals.css');
    expect(navigation).toContain('topbar-inner');
    expect(navigation).toContain('nav-scroll');
    expect(navigation).toContain("role === 'hostess'");
    expect(styles).toContain('.nav-scroll');
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('.nav-link, .signout-button { min-height: 2.5rem; }');
  });

  it('garde les actions et les cartes Live lisibles sur petits écrans', () => {
    const dashboard = source('components/live-dashboard.tsx');
    expect(dashboard).toContain('grid grid-cols-2 gap-2 sm:grid-cols-3');
    expect(dashboard).toContain('[&>article:last-child]:col-span-2');
    expect(dashboard).toContain('grid gap-3 sm:grid-cols-2');
    expect(dashboard).toContain('grid grid-cols-2 gap-2 sm:grid-cols-4');
    expect(dashboard).toContain('flex flex-wrap gap-2');
    expect(dashboard).toContain('min-w-0');
  });

  it('rend les onglets, compteurs et transferts Hôtesse utilisables au tactile', () => {
    const hub = source('components/hostess-hub.tsx');
    const console = source('components/hostess-console.tsx');
    expect(hub).toContain('segmented-control');
    expect(hub).toContain('overflow-x-auto');
    expect(console).toContain('max-h-[min(16rem,45dvh)]');
    expect(console).toContain('flex flex-col gap-2 sm:flex-row');
    expect(console).toContain('min-h-14 w-full');
    expect(console).toContain('active:scale-[.99]');
    expect(console).toContain('h-11 min-w-11');
  });

  it('compacte les Carrés en mobile et exploite la tablette dès 768 px', () => {
    const console = source('components/hostess-console.tsx');
    expect(console).toContain('grid grid-cols-1 gap-3 md:grid-cols-2 sm:gap-4');
    expect(console).toContain('panel min-w-0 p-3 sm:p-4');
    expect(console).toContain('rounded-full bg-fuchsia-500/15');
    expect(console).toContain('grid grid-cols-1 gap-2.5 xl:grid-cols-2');
  });

  it('garde recherche et opérations adaptées au clavier mobile', () => {
    const search = source('components/global-search.tsx');
    const operations = source('components/hostess-operations.tsx');
    expect(search).toContain('max-h-[min(24rem,55dvh)]');
    expect(search).toContain('min-h-11 w-full');
    expect(operations).toContain('inputMode="numeric"');
    expect(operations).toContain('flex flex-col gap-3 p-3 sm:flex-row sm:p-4');
    expect(operations).not.toContain('min-h-10');
  });

  it('préserve les tableaux administratifs scrollables et les confirmations sans ligne forcée', () => {
    const admin = source('components/admin-console.tsx');
    const recap = source('components/recap-console.tsx');
    expect(admin).toContain('overflow-x-auto p-4 touch-pan-x');
    expect(admin).toContain('flex flex-col gap-3 sm:flex-row');
    expect(recap).toContain('flex flex-col gap-3 sm:flex-row');
    expect(recap).toContain('break-words');
  });
});
