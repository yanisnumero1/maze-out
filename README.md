# Nightflow Live

Application PWA responsive de pilotage d'une soirée. La configuration Supabase et les instructions de démarrage sont dans ce dépôt.

## Démarrer

1. Créer un projet Supabase, appliquer les migrations dans l'ordre (`0001`, `0002`, `0003`), puis exécuter `supabase/seed.sql`. Le seed applique aussi la disposition du plan.
2. Copier `.env.example` vers `.env.local` et renseigner les clés publiques.
3. `npm install && npm run dev`

Le seed est une **démonstration** : 4 zones, 69 tables et 6 chefs de rang, tous modifiables dans la base.
