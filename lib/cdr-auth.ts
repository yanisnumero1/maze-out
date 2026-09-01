const CDR_EMAIL_DOMAIN = 'cdr.maze-out.local';
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;

export function normalizeCdrUsername(value: string): string | null {
  const username = value
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  return USERNAME_PATTERN.test(username) ? username : null;
}

export function cdrUsernameToEmail(username: string): string | null {
  const normalized = normalizeCdrUsername(username);
  return normalized ? `${normalized}@${CDR_EMAIL_DOMAIN}` : null;
}
