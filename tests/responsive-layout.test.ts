import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('passe responsive des interfaces opérationnelles', () => {
  it('protège le conteneur commun contre le débordement horizontal', () => {
    expect(source('app/layout.tsx')).toContain('min-h-[100dvh] max-w-7xl overflow-x-hidden p-3 sm:p-6');
  });

  it('replie la navigation et maintient des zones tactiles utilisables', () => {
    const navigation = source('components/navigation.tsx');
    expect(navigation).toContain('flex flex-wrap items-center gap-2');
    expect(navigation).toContain('flex w-full flex-wrap gap-2 sm:w-auto');
    expect(navigation).toContain('min-h-11');
  });

  it('garde les actions et les cartes Live lisibles sur petits écrans', () => {
    const dashboard = source('components/live-dashboard.tsx');
    expect(dashboard).toContain('w-full min-w-0 text-left sm:w-auto');
    expect(dashboard).toContain('grid grid-cols-2 gap-2 sm:grid-cols-4');
    expect(dashboard).toContain('flex flex-wrap gap-2');
    expect(dashboard).toContain('min-w-0');
  });

  it('rend les onglets, compteurs et transferts Hôtesse utilisables au tactile', () => {
    const hub = source('components/hostess-hub.tsx');
    const console = source('components/hostess-console.tsx');
    expect(hub).toContain('snap-x gap-2 overflow-x-auto');
    expect(console).toContain('max-h-[min(16rem,45dvh)]');
    expect(console).toContain('flex flex-col gap-2 sm:flex-row');
    expect(console).toContain('min-h-14 w-full');
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
