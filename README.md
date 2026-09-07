# Nightflow Live

Application PWA responsive de pilotage d'une soirée. La configuration Supabase et les instructions de démarrage sont dans ce dépôt.

## Démarrer

1. Créer un projet Supabase, appliquer les migrations dans l'ordre (`0001`, `0002`, `0003`), puis exécuter `supabase/seed.sql`. Le seed applique aussi la disposition du plan.
2. Copier `.env.example` vers `.env.local` et renseigner les clés publiques.
3. `npm install && npm run dev`

Le seed est une **démonstration** : 4 zones, 69 tables et 6 chefs de rang, tous modifiables dans la base.

## Gestion des accès CDR

L’administration contient une section **Accès Chefs de rang**. Elle appelle exclusivement l’Edge Function `manage-cdr-access`; aucune clé privilégiée n’est envoyée au navigateur.

Le CDR se connecte avec un identifiant simple. Supabase Auth reçoit en interne une adresse déterministe de la forme `identifiant@cdr.maze-out.local`. Cette adresse est technique et ne doit pas être utilisée comme adresse personnelle.

### Ordre de mise en service

1. Examiner puis appliquer `supabase/migrations/0038_cdr_access_management.sql` dans l’environnement visé.
2. Déployer l’Edge Function : `npx supabase functions deploy manage-cdr-access`.
3. Vérifier que les secrets Supabase fournis automatiquement aux fonctions sont disponibles : `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` (ou la convention de clé secrète déjà configurée).
4. Déployer ensuite l’application frontend.

Ne déployez pas le frontend avant la migration : `AuthGate` utilise le marqueur `profiles.cdr_access_disabled_at`.

### Sécurité et audit

- L’Edge Function valide le JWT, puis relit le rôle `admin` dans `profiles` avec le client serveur.
- Les mots de passe temporaires sont générés côté serveur, renvoyés une seule fois et ne sont jamais écrits dans une table ou un log.
- La désactivation combine un bannissement Supabase Auth et un verrou immédiat dans `profiles`. `current_role()` et `cdr_head_waiter_id()` refusent alors les permissions même si un ancien JWT n’a pas encore expiré.
- Les créations, réinitialisations, désactivations et réactivations utilisent `operational_audit_log`, sans mot de passe ni secret.

### Vérification locale

Après validation de la migration, avec Docker et la CLI Supabase installés :

```sh
npx supabase start
npx supabase db reset
npx supabase functions serve manage-cdr-access
npm run test
npx tsc --noEmit
npm run build
```

Les tests navigateur de création réelle nécessitent des comptes Admin/CDR exclusivement locaux. N’utilisez jamais un projet Supabase de production.

Le scénario d’intégration Auth/RLS est volontairement désactivé par défaut lors d’un lancement local ordinaire. Après démarrage de Supabase local et de l’Edge Function, fournissez uniquement les variables locales `SUPABASE_LOCAL_URL`, `SUPABASE_LOCAL_ANON_KEY`, `SUPABASE_LOCAL_SERVICE_ROLE_KEY`, puis lancez :

```sh
RUN_CDR_ACCESS_INTEGRATION=1 npm run test -- tests/cdr-access-integration.test.ts
```

Le test refuse explicitement toute URL dont l’hôte n’est pas `localhost`, `127.0.0.1` ou `::1`.

La CI exécute ce scénario dans un job isolé : elle démarre Supabase avec Docker, sert `manage-cdr-access`, récupère les clés éphémères avec `npx supabase status -o env`, lance uniquement le test d’intégration, puis arrête systématiquement l’environnement local. Aucun secret GitHub et aucun projet Supabase distant ne sont utilisés. En cas d’échec, seuls les logs expurgés de l’Edge Function sont affichés.

### Retour arrière de la migration 0038

Avant tout retour arrière, désactivez la nouvelle interface et l’Edge Function. Conservez les lignes d’audit. Si un retour de schéma est réellement nécessaire, restaurez d’abord les définitions précédentes de `current_role()`, `cdr_head_waiter_id()` et de la contrainte `operational_audit_log_action_type_check`, puis supprimez l’index `profiles_one_cdr_per_head_waiter_idx` et enfin la colonne `cdr_access_disabled_at`. La colonne ne doit pas être supprimée tant que le frontend ou l’Edge Function déployé l’utilise.
