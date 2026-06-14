import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecial: boolean;
}

// Lenient by default: phone numbers are the initial password, and users may
// later "change to anything". Only a minimum length is enforced unless the
// stricter checks are explicitly turned on via env.
export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: Number(process.env.PASSWORD_MIN_LENGTH) || 4,
  requireUppercase: process.env.PASSWORD_REQUIRE_UPPERCASE === 'true',
  requireNumbers: process.env.PASSWORD_REQUIRE_NUMBERS === 'true',
  requireSpecial: process.env.PASSWORD_REQUIRE_SPECIAL === 'true',
};

/**
 * Validate password strength. Returns a list of human-readable errors
 * (empty array = valid).
 */
export function validatePasswordStrength(
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY
): string[] {
  const errors: string[] = [];
  if (password.length < policy.minLength) {
    errors.push(`Must be at least ${policy.minLength} characters`);
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Must include an uppercase letter');
  }
  if (policy.requireNumbers && !/[0-9]/.test(password)) {
    errors.push('Must include a number');
  }
  if (policy.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Must include a special character');
  }
  return errors;
}
