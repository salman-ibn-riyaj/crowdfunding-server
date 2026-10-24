import { ObjectId } from "mongodb";

export const INITIAL_CREDITS = Object.freeze({ supporter: 50, creator: 20 });
export const PUBLIC_ROLES = Object.freeze(Object.keys(INITIAL_CREDITS));

export function validateRegistrationInput(input = {}) {
  const errors = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const image = typeof input.image === "string" ? input.image.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (name.length < 2 || name.length > 80) {
    errors.name = "Name must be between 2 and 80 characters.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  try {
    const imageUrl = new URL(image);
    if (!image || !["https:", "http:"].includes(imageUrl.protocol)) throw new Error();
  } catch {
    errors.image = "Enter a valid profile image URL using http or https.";
  }
  if (
    password.length < 12 ||
    password.length > 128 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    errors.password = "Use 12 or more characters with upper- and lowercase letters, a number, and a symbol.";
  }

  return errors;
}

export class OnboardingConflictError extends Error {
  constructor(message = "This account already has a different role.") {
    super(message);
    this.name = "OnboardingConflictError";
  }
}

export async function assignRoleAndInitialCredits(users, userId, role) {
  if (!PUBLIC_ROLES.includes(role)) {
    throw new TypeError("Choose either Supporter or Creator.");
  }
  if (!ObjectId.isValid(userId)) return null;

  const id = new ObjectId(userId);
  const credits = INITIAL_CREDITS[role];
  const result = await users.updateOne(
    { _id: id, role: "pending", roleOnboarded: { $ne: true } },
    { $set: { role, credits, roleOnboarded: true } },
  );

  if (result.modifiedCount === 1) {
    return { role, credits, roleOnboarded: true };
  }

  const existing = await users.findOne({ _id: id });
  if (!existing) return null;
  if (existing.roleOnboarded === true && existing.role === role) {
    return { role: existing.role, credits: existing.credits, roleOnboarded: true };
  }

  throw new OnboardingConflictError();
}