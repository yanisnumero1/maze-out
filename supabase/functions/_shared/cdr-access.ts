export const CDR_EMAIL_DOMAIN = 'cdr.maze-out.local';

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;
const PASSWORD_MIN_LENGTH = 12;

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

export function technicalEmailToCdrUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  const suffix = `@${CDR_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? normalizeCdrUsername(email.slice(0, -suffix.length)) : null;
}

export function suggestCdrUsername(firstName: string, lastName: string): string {
  const candidate = `${firstName}.${lastName}`
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32)
    .replace(/[._-]+$/g, '');
  return normalizeCdrUsername(candidate) ?? '';
}

export function isSecureTemporaryPassword(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH
    && /[a-z]/.test(value)
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

export function generateTemporaryPassword(randomValues: (length: number) => Uint32Array = secureRandomValues): string {
  const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%*-_'];
  const all = groups.join('');
  const characters = groups.map((group) => pick(group, randomValues));
  while (characters.length < 16) characters.push(pick(all, randomValues));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = Number(randomValues(1)[0] % (index + 1));
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}

function secureRandomValues(length: number): Uint32Array {
  return crypto.getRandomValues(new Uint32Array(length));
}

function pick(source: string, randomValues: (length: number) => Uint32Array): string {
  return source[Number(randomValues(1)[0] % source.length)];
}

