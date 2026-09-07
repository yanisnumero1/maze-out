export type CdrAccessStatus = 'none' | 'active' | 'disabled' | 'inconsistent';

export type CdrAccessRow = {
  headWaiterId: string;
  firstName: string;
  lastName: string;
  username: string | null;
  status: CdrAccessStatus;
};

export type CdrAccessAction = 'create' | 'reset_password' | 'disable' | 'enable';

export function cdrAccessStatusLabel(status: CdrAccessStatus): string {
  return status === 'active' ? 'Accès actif'
    : status === 'disabled' ? 'Accès désactivé'
      : status === 'inconsistent' ? 'Configuration incohérente'
        : 'Aucun accès';
}

export function cdrAccessErrorMessage(code: string | null | undefined): string {
  const messages: Record<string, string> = {
    admin_required: 'Cette opération est réservée aux administrateurs.',
    already_linked: 'Ce chef de rang possède déjà un accès.',
    auth_user_missing: 'Le compte Auth associé est introuvable. Une intervention est nécessaire.',
    head_waiter_not_found: 'Le chef de rang sélectionné est introuvable.',
    inconsistent_profile: 'La configuration du profil est incohérente. Aucune modification n’a été effectuée.',
    invalid_request: 'La demande est invalide.',
    invalid_username: 'L’identifiant doit contenir uniquement des lettres, chiffres, points, tirets ou underscores.',
    username_taken: 'Cet identifiant est déjà utilisé.',
  };
  return messages[code ?? ''] ?? 'L’opération n’a pas pu être effectuée. Réessayez.';
}
